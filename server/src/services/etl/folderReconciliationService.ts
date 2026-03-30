import pg from "pg";
import { EncompassApiService } from "../encompassApiService.js";

export interface ReconciliationResult {
  loansChecked: number;
  loansDeleted: number;
  deletions: Array<{ guid: string }>;
}

const DELETE_BATCH_SIZE = 500;

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
   * Approach:
   *   1. Fetch all GUIDs from the DB
   *   2. Fetch all GUIDs that currently exist in the synced folders via the
   *      Encompass Pipeline API (folder-filter, Fields.GUID only)
   *   3. Delete any DB loan whose GUID is not in the API result set
   *
   * This uses the proven folder-filter approach rather than a loanGuids lookup,
   * which the v3 Pipeline API does not support.
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
      return { loansChecked: 0, loansDeleted: 0, deletions: [] };
    }

    // Step 1: Get all GUIDs currently in the DB
    const dbResult = await this.tenantPool.query<{ guid: string }>(
      `SELECT guid FROM public.loans WHERE guid IS NOT NULL AND guid != ''`,
    );
    const dbGuids = dbResult.rows.map((r) => r.guid.replace(/[{}]/g, "").toLowerCase());

    if (dbGuids.length === 0) {
      console.log("[Reconcile] No loans in DB — skipping folder reconciliation");
      return { loansChecked: 0, loansDeleted: 0, deletions: [] };
    }

    console.log(
      `[Reconcile] Checking ${dbGuids.length} DB loans against ${syncedFolderNames.length} synced folder(s) via Encompass API`,
    );

    // Step 2: Fetch all GUIDs that the API returns for the synced folders.
    // If the API call itself throws (e.g. auth failure), abort rather than
    // deleting everything — better to skip this cycle than nuke the DB.
    let apiGuids: Set<string>;
    try {
      apiGuids = await this.apiService.getLoanGuidsByFolders(
        tenantId,
        losConnectionId,
        syncedFolderNames,
        loanStartDate,
      );
    } catch (err: any) {
      console.warn(
        `[Reconcile] API call failed — skipping reconciliation to avoid false deletes: ${err.message}`,
      );
      return { loansChecked: dbGuids.length, loansDeleted: 0, deletions: [] };
    }

    console.log(
      `[Reconcile] API returned ${apiGuids.size} GUIDs across synced folders`,
    );

    // Step 3: Identify DB loans not present in the API result
    const guidsToDelete: string[] = [];
    for (const guid of dbGuids) {
      if (!apiGuids.has(guid)) {
        guidsToDelete.push(guid);
      }
    }

    if (guidsToDelete.length === 0) {
      console.log(
        `[Reconcile] All ${dbGuids.length} loans confirmed in synced folders — nothing to delete`,
      );
      return { loansChecked: dbGuids.length, loansDeleted: 0, deletions: [] };
    }

    // Safety threshold: abort if the deletion set is suspiciously large.
    // A very high delete count is usually a sign of an incomplete API GUID set
    // (e.g. auth issue, pagination failure) rather than a legitimate mass move.
    const deleteFraction = guidsToDelete.length / dbGuids.length;
    if (deleteFraction > MAX_RECONCILE_DELETE_FRACTION) {
      console.warn(
        `[Reconcile] SAFETY THRESHOLD EXCEEDED: would delete ${guidsToDelete.length} / ${dbGuids.length} loans ` +
        `(${(deleteFraction * 100).toFixed(1)}% > ${(MAX_RECONCILE_DELETE_FRACTION * 100).toFixed(0)}% limit). ` +
        `Aborting reconciliation to prevent mass false-deletion. ` +
        `API returned only ${apiGuids.size} GUIDs — verify Encompass connection and folder filter. ` +
        `Set MAX_RECONCILE_DELETE_FRACTION env var to override this limit if needed.`
      );
      return { loansChecked: dbGuids.length, loansDeleted: 0, deletions: [] };
    }

    console.log(
      `[Reconcile] Deleting ${guidsToDelete.length} loan(s) no longer in synced folders`,
    );

    // Batch-delete to avoid query parameter limits
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
      `[Reconcile] Deleted ${totalDeleted} loan(s). Checked ${dbGuids.length} total.`,
    );

    return {
      loansChecked: dbGuids.length,
      loansDeleted: totalDeleted,
      deletions: guidsToDelete.map((guid) => ({ guid })),
    };
  }
}
