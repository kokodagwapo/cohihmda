import pg from "pg";
import { EncompassApiService } from "../encompassApiService.js";
import {
  coheusAliasToColumnName,
  getFieldSwapsPendingBackfill,
  normalizeEncompassFieldId,
  updateFieldSwapBackfillStatus,
} from "../encompassFieldMapper.js";

export interface FieldBackfillOptions {
  loanStartDate?: Date;
  loanStartDateField?: string;
  folderName?: string;
  folderNames?: string[];
  limit?: number;
}

export interface FieldBackfillResult {
  success: boolean;
  pendingSwaps: number;
  fieldsBackfilled: number;
  loansScanned: number;
  loansUpdated: number;
  duration: number;
  skippedReason?: string;
}

const DB_BATCH_SIZE = 500;

export class FieldBackfillService {
  private readonly tenantPool: pg.Pool;
  private readonly apiService: EncompassApiService;

  constructor(tenantPool: pg.Pool) {
    this.tenantPool = tenantPool;
    this.apiService = new EncompassApiService(tenantPool);
  }

  async getPendingBackfillCount(losConnectionId: string): Promise<number> {
    const pending = await getFieldSwapsPendingBackfill(this.tenantPool, losConnectionId);
    return pending.length;
  }

  async backfillSwappedFields(
    tenantId: string,
    losConnectionId: string,
    options: FieldBackfillOptions = {}
  ): Promise<FieldBackfillResult> {
    const startedAt = Date.now();
    const pendingSwaps = await getFieldSwapsPendingBackfill(this.tenantPool, losConnectionId);
    if (pendingSwaps.length === 0) {
      return {
        success: true,
        pendingSwaps: 0,
        fieldsBackfilled: 0,
        loansScanned: 0,
        loansUpdated: 0,
        duration: Date.now() - startedAt,
        skippedReason: "No pending field swaps",
      };
    }

    const swapIds = pendingSwaps.map((swap) => swap.id);
    await updateFieldSwapBackfillStatus(this.tenantPool, swapIds, "in_progress");

    try {
      const swapColumns = pendingSwaps.map((swap) => ({
        swapId: swap.id,
        coheusAlias: swap.coheusAlias,
        columnName: coheusAliasToColumnName(swap.coheusAlias),
        encompassFieldId: normalizeEncompassFieldId(swap.encompassFieldId),
      }));

      const availableColumns = await this.getLoanColumns();
      const activeColumns = swapColumns.filter((swap) => availableColumns.has(swap.columnName));
      if (activeColumns.length === 0) {
        await updateFieldSwapBackfillStatus(this.tenantPool, swapIds, "skipped");
        return {
          success: true,
          pendingSwaps: pendingSwaps.length,
          fieldsBackfilled: 0,
          loansScanned: 0,
          loansUpdated: 0,
          duration: Date.now() - startedAt,
          skippedReason: "No mapped loan columns found for pending swaps",
        };
      }

      const fields = Array.from(
        new Set(["Fields.GUID", ...activeColumns.map((swap) => swap.encompassFieldId)])
      );

      const pipeline = await this.apiService.getLoans(tenantId, losConnectionId, {
        loanStartDate: options.loanStartDate,
        loanStartDateField: options.loanStartDateField,
        folderName: options.folderName,
        folderNames: options.folderNames,
        limit: options.limit,
        fields,
        skipArchiveDetection: true,
      });

      const loanUpdates = pipeline.data
        .map((loan) => this.mapLoanToBackfillUpdate(loan, activeColumns))
        .filter((loan): loan is { guid: string; values: Record<string, any> } => loan !== null);

      const loansUpdated = await this.applyUpdatesInBatches(loanUpdates);
      await updateFieldSwapBackfillStatus(this.tenantPool, swapIds, "completed");

      return {
        success: true,
        pendingSwaps: pendingSwaps.length,
        fieldsBackfilled: activeColumns.length,
        loansScanned: pipeline.data.length,
        loansUpdated,
        duration: Date.now() - startedAt,
      };
    } catch (error) {
      await updateFieldSwapBackfillStatus(this.tenantPool, swapIds, "pending");
      throw error;
    }
  }

  private async getLoanColumns(): Promise<Set<string>> {
    const result = await this.tenantPool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'loans'`
    );
    return new Set(result.rows.map((r: any) => r.column_name));
  }

  private mapLoanToBackfillUpdate(
    loan: Record<string, any>,
    activeColumns: Array<{
      swapId: string;
      coheusAlias: string;
      columnName: string;
      encompassFieldId: string;
    }>
  ): { guid: string; values: Record<string, any> } | null {
    const rawGuid =
      loan.guid ||
      loan.loanGuid ||
      loan.GUID ||
      loan["GUID"] ||
      loan["Fields.GUID"];
    if (!rawGuid) return null;

    const guid = String(rawGuid).replace(/[{}]/g, "").toLowerCase();
    if (!guid) return null;

    const values: Record<string, any> = {};
    for (const swap of activeColumns) {
      values[swap.columnName] = this.readLoanFieldValue(loan, swap.encompassFieldId);
    }

    return { guid, values };
  }

  private readLoanFieldValue(loan: Record<string, any>, fieldId: string): any {
    const normalized = normalizeEncompassFieldId(fieldId);
    const noPrefix = normalized.startsWith("Fields.")
      ? normalized.slice("Fields.".length)
      : normalized;
    const withPrefix = normalized.startsWith("Fields.")
      ? normalized
      : `Fields.${normalized}`;

    if (Object.prototype.hasOwnProperty.call(loan, normalized)) return loan[normalized];
    if (Object.prototype.hasOwnProperty.call(loan, withPrefix)) return loan[withPrefix];
    if (Object.prototype.hasOwnProperty.call(loan, noPrefix)) return loan[noPrefix];
    return null;
  }

  private async applyUpdatesInBatches(
    updates: Array<{ guid: string; values: Record<string, any> }>
  ): Promise<number> {
    if (updates.length === 0) return 0;
    let updatedRows = 0;

    for (let i = 0; i < updates.length; i += DB_BATCH_SIZE) {
      const batch = updates.slice(i, i + DB_BATCH_SIZE);
      const client = await this.tenantPool.connect();
      try {
        await client.query("BEGIN");
        for (const row of batch) {
          const entries = Object.entries(row.values);
          if (entries.length === 0) continue;

          const setClauses: string[] = [];
          const params: any[] = [];
          entries.forEach(([column, value], idx) => {
            setClauses.push(`${column} = $${idx + 1}`);
            params.push(value);
          });
          params.push(row.guid);

          const updateResult = await client.query(
            `UPDATE public.loans
             SET ${setClauses.join(", ")}, updated_at = NOW()
             WHERE guid = $${params.length}`,
            params
          );
          updatedRows += updateResult.rowCount || 0;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return updatedRows;
  }
}
