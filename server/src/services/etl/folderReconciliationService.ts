import pg from "pg";
import { EncompassApiService } from "../encompassApiService.js";

export interface ReconciliationResult {
  loansChecked: number;
  loansDeleted: number;
  loansFoldersRefreshed: number;
  deletions: Array<{ guid: string }>;
}

const DELETE_BATCH_SIZE = 500;
const FOLDER_REFRESH_BATCH_SIZE = 500;

/**
 * Maximum fraction of DB loans that reconciliation is allowed to delete in a
 * single run. If the computed deletion set exceeds this threshold the run is
 * aborted and a warning is logged.  This guards against API pagination bugs or
 * auth failures returning an incomplete GUID set, which would otherwise cause
 * mass false-deletions.
 *
 * Set to 0.25 (25 %).  Raise via the MAX_RECONCILE_DELETE_FRACTION env var if
 * intentional large-scale cleanup is needed.
 */
const MAX_RECONCILE_DELETE_FRACTION =
  parseFloat(process.env.MAX_RECONCILE_DELETE_FRACTION ?? "0.25");

function normalizeGuid(guid: string): string {
  return guid.replace(/[{}]/g, "").toLowerCase();
}

export class FolderReconciliationService {
  private apiService: EncompassApiService;

  constructor(private readonly tenantPool: pg.Pool) {
    this.apiService = new EncompassApiService(tenantPool);
  }

  /**
   * Verifies every loan in the DB still belongs to a configured synced folder
   * in Encompass. Loans that have moved to non-synced folders, or that no
   * longer exist in Encompass, are deleted from the database.
   *
   * Also refreshes `loan_folder` for loans that moved between selected folders
   * (e.g. My Pipeline → Bond 2nd) without requiring a full incremental extract.
   *
   * Approach:
   *   1. Fetch all GUIDs from the DB
   *   2. Fetch GUID → folder map for all loans in synced folders (Pipeline API)
   *   3. Update stale loan_folder values in the DB
   *   4. Delete any DB loan whose GUID is not in the API result set
   */
  async reconcileFolders(
    tenantId: string,
    losConnectionId: string,
    syncedFolderNames: string[],
    loanStartDate?: Date,
  ): Promise<ReconciliationResult> {
    if (!syncedFolderNames || syncedFolderNames.length === 0) {
      console.log(
        "[Reconcile] No synced folders configured — skipping folder reconciliation",
      );
      return {
        loansChecked: 0,
        loansDeleted: 0,
        loansFoldersRefreshed: 0,
        deletions: [],
      };
    }

    const dbResult = await this.tenantPool.query<{
      guid: string;
      loan_folder: string | null;
    }>(
      `SELECT guid, loan_folder FROM public.loans WHERE guid IS NOT NULL AND guid != ''`,
    );

    if (dbResult.rows.length === 0) {
      console.log("[Reconcile] No loans in DB — skipping folder reconciliation");
      return {
        loansChecked: 0,
        loansDeleted: 0,
        loansFoldersRefreshed: 0,
        deletions: [],
      };
    }

    console.log(
      `[Reconcile] Checking ${dbResult.rows.length} DB loans against ${syncedFolderNames.length} synced folder(s) via Encompass API`,
    );

    let folderByGuid: Map<string, string>;
    try {
      folderByGuid = await this.apiService.getLoanFolderAssignmentsBySyncedFolders(
        tenantId,
        losConnectionId,
        syncedFolderNames,
        loanStartDate,
      );
    } catch (err: any) {
      console.warn(
        `[Reconcile] API call failed — skipping reconciliation to avoid false deletes: ${err.message}`,
      );
      return {
        loansChecked: dbResult.rows.length,
        loansDeleted: 0,
        loansFoldersRefreshed: 0,
        deletions: [],
      };
    }

    console.log(
      `[Reconcile] API returned ${folderByGuid.size} loan(s) across synced folders`,
    );

    const loansFoldersRefreshed = await this.refreshStaleLoanFolders(
      dbResult.rows,
      folderByGuid,
    );
    if (loansFoldersRefreshed > 0) {
      console.log(
        `[Reconcile] Refreshed loan_folder on ${loansFoldersRefreshed} loan(s)`,
      );
    }

    const guidsToDelete: string[] = [];
    for (const row of dbResult.rows) {
      const norm = normalizeGuid(row.guid);
      if (!folderByGuid.has(norm)) {
        guidsToDelete.push(norm);
      }
    }

    if (guidsToDelete.length === 0) {
      console.log(
        `[Reconcile] All ${dbResult.rows.length} loans confirmed in synced folders — nothing to delete`,
      );
      return {
        loansChecked: dbResult.rows.length,
        loansDeleted: 0,
        loansFoldersRefreshed,
        deletions: [],
      };
    }

    const deleteFraction = guidsToDelete.length / dbResult.rows.length;
    if (deleteFraction > MAX_RECONCILE_DELETE_FRACTION) {
      console.warn(
        `[Reconcile] SAFETY THRESHOLD EXCEEDED: would delete ${guidsToDelete.length} / ${dbResult.rows.length} loans ` +
        `(${(deleteFraction * 100).toFixed(1)}% > ${(MAX_RECONCILE_DELETE_FRACTION * 100).toFixed(0)}% limit). ` +
        `Aborting reconciliation to prevent mass false-deletion. ` +
        `API returned only ${folderByGuid.size} GUIDs — verify Encompass connection and folder filter. ` +
        `Set MAX_RECONCILE_DELETE_FRACTION env var to override this limit if needed.`,
      );
      return {
        loansChecked: dbResult.rows.length,
        loansDeleted: 0,
        loansFoldersRefreshed,
        deletions: [],
      };
    }

    console.log(
      `[Reconcile] Deleting ${guidsToDelete.length} loan(s) no longer in synced folders`,
    );

    let totalDeleted = 0;
    for (let i = 0; i < guidsToDelete.length; i += DELETE_BATCH_SIZE) {
      const batch = guidsToDelete.slice(i, i + DELETE_BATCH_SIZE);
      const result = await this.tenantPool.query(
        `DELETE FROM public.loans WHERE guid = ANY($1)`,
        [batch],
      );
      totalDeleted += result.rowCount ?? 0;
    }

    console.log(
      `[Reconcile] Deleted ${totalDeleted} loan(s). Checked ${dbResult.rows.length} total.`,
    );

    return {
      loansChecked: dbResult.rows.length,
      loansDeleted: totalDeleted,
      loansFoldersRefreshed,
      deletions: guidsToDelete.map((guid) => ({ guid })),
    };
  }

  /**
   * Align stored loan_folder with Encompass for loans still in synced folders.
   */
  private async refreshStaleLoanFolders(
    dbRows: Array<{ guid: string; loan_folder: string | null }>,
    folderByGuid: Map<string, string>,
  ): Promise<number> {
    const guidsToUpdate: string[] = [];
    const foldersToUpdate: string[] = [];

    for (const row of dbRows) {
      const norm = normalizeGuid(row.guid);
      const apiFolder = folderByGuid.get(norm);
      if (apiFolder === undefined || !apiFolder) continue;

      const current = (row.loan_folder ?? "").trim();
      if (current !== apiFolder) {
        guidsToUpdate.push(row.guid);
        foldersToUpdate.push(apiFolder);
      }
    }

    if (guidsToUpdate.length === 0) return 0;

    let totalRefreshed = 0;
    for (let i = 0; i < guidsToUpdate.length; i += FOLDER_REFRESH_BATCH_SIZE) {
      const batchGuids = guidsToUpdate.slice(i, i + FOLDER_REFRESH_BATCH_SIZE);
      const batchFolders = foldersToUpdate.slice(
        i,
        i + FOLDER_REFRESH_BATCH_SIZE,
      );
      const result = await this.tenantPool.query(
        `UPDATE public.loans AS l
         SET loan_folder = v.folder, updated_at = NOW()
         FROM (
           SELECT * FROM unnest($1::text[], $2::text[]) AS t(guid, folder)
         ) AS v
         WHERE l.guid = v.guid
           AND (l.loan_folder IS DISTINCT FROM v.folder)`,
        [batchGuids, batchFolders],
      );
      totalRefreshed += result.rowCount ?? 0;
    }

    return totalRefreshed;
  }
}
