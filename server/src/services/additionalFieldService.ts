/**
 * Additional Field Service
 * Manages client-defined additional loan fields with dynamic column creation
 * Handles CRUD operations, dynamic ALTER TABLE, and ETL integration
 */

import pg from 'pg';
import { EncompassApiService } from './encompassApiService.js';

// ============================================================================
// Types
// ============================================================================

export type DataType = 'string' | 'number' | 'date' | 'boolean' | 'currency' | 'percentage';

export interface AdditionalFieldDefinition {
  id: string;
  losConnectionId: string;
  losFieldId: string;
  columnName: string;
  displayName: string;
  dataType: DataType;
  dbColumnType: string;
  category?: string;
  description?: string;
  isEnabled: boolean;
  includeInRag: boolean;
  sortOrder: number;
  columnCreated: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAdditionalFieldInput {
  losConnectionId: string;
  losFieldId: string;
  displayName: string;
  dataType: DataType;
  category?: string;
  description?: string;
  includeInRag?: boolean;
  createdBy?: string;
}

export interface UpdateAdditionalFieldInput {
  displayName?: string;
  category?: string;
  description?: string;
  isEnabled?: boolean;
  includeInRag?: boolean;
  sortOrder?: number;
}

export interface AdditionalFieldAuditEntry {
  id: string;
  fieldDefinitionId?: string;
  action: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  performedBy?: string;
  performedAt: Date;
  notes?: string;
}

export interface ReconcileColumnsReport {
  created: string[];
  failed: Array<{ columnName: string; error: string }>;
  setColumnCreatedFalse: string[];
}

// ============================================================================
// Data Type Mappings
// ============================================================================

const DATA_TYPE_TO_DB_TYPE: Record<DataType, string> = {
  string: 'TEXT',
  number: 'DECIMAL(15,4)',
  date: 'DATE',
  boolean: 'BOOLEAN',
  currency: 'DECIMAL(15,2)',
  percentage: 'DECIMAL(8,4)',
};

// ============================================================================
// Service Implementation
// ============================================================================

export class AdditionalFieldService {
  private tenantPool: pg.Pool;

  constructor(tenantPool: pg.Pool) {
    this.tenantPool = tenantPool;
  }

  // --------------------------------------------------------------------------
  // Column Name Generation
  // --------------------------------------------------------------------------

  /**
   * Generate a safe PostgreSQL column name from display name
   */
  generateColumnName(displayName: string): string {
    let result = displayName.toLowerCase();
    
    // Replace spaces and special chars with underscores
    result = result.replace(/[^a-z0-9]+/g, '_');
    
    // Remove leading/trailing underscores
    result = result.replace(/^_+|_+$/g, '');
    
    // Collapse multiple underscores
    result = result.replace(/_+/g, '_');
    
    // Ensure it starts with a letter (PostgreSQL requirement)
    if (result && !/^[a-z]/.test(result)) {
      result = 'field_' + result;
    }
    
    // Truncate to 63 chars (PostgreSQL limit)
    if (result.length > 63) {
      result = result.substring(0, 63);
      // Remove trailing underscore if truncation created one
      result = result.replace(/_+$/, '');
    }
    
    return result;
  }

  /**
   * Check if a column name already exists in the loans table or in definitions
   */
  async isColumnNameUnique(columnName: string, excludeId?: string): Promise<boolean> {
    // Check existing column names in definitions
    const defQuery = excludeId
      ? `SELECT COUNT(*) FROM additional_field_definitions WHERE column_name = $1 AND id != $2`
      : `SELECT COUNT(*) FROM additional_field_definitions WHERE column_name = $1`;
    
    const defParams = excludeId ? [columnName, excludeId] : [columnName];
    const defResult = await this.tenantPool.query(defQuery, defParams);
    
    if (parseInt(defResult.rows[0].count) > 0) {
      return false;
    }

    // Check if column exists in loans table
    const colResult = await this.tenantPool.query(`
      SELECT COUNT(*) FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'loans' 
        AND column_name = $1
    `, [columnName]);

    if (parseInt(colResult.rows[0].count) > 0) {
      return false;
    }

    // Check for built-in column variants (with/without _date suffix) to avoid duplicates like disclosure_prep vs disclosure_prep_date
    const variants: string[] = [columnName];
    if (!columnName.endsWith("_date")) {
      variants.push(columnName + "_date");
    }
    if (columnName.endsWith("_date")) {
      variants.push(columnName.replace(/_date$/, ""));
    }
    const variantResult = await this.tenantPool.query(
      `SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'loans'
         AND column_name = ANY($1::text[])`,
      [variants]
    );

    return parseInt(variantResult.rows[0].count) === 0;
  }

  /**
   * Generate a unique column name, appending numbers if needed
   */
  async generateUniqueColumnName(displayName: string): Promise<string> {
    let baseName = this.generateColumnName(displayName);
    let columnName = baseName;
    let counter = 1;

    while (!(await this.isColumnNameUnique(columnName))) {
      // Append number to make unique
      const suffix = `_${counter}`;
      columnName = baseName.length + suffix.length > 63
        ? baseName.substring(0, 63 - suffix.length) + suffix
        : baseName + suffix;
      counter++;

      // Safety: don't loop forever
      if (counter > 100) {
        throw new Error(`Unable to generate unique column name for: ${displayName}`);
      }
    }

    return columnName;
  }

  // --------------------------------------------------------------------------
  // Dynamic Column Management
  // --------------------------------------------------------------------------

  /**
   * Add a column to the loans table for an additional field
   */
  async addColumn(columnName: string, dbType: string): Promise<void> {
    console.log(`[AdditionalFieldService] Adding column ${columnName} (${dbType}) to loans table`);

    // Validate column name is safe (basic SQL injection prevention)
    if (!/^[a-z][a-z0-9_]*$/.test(columnName)) {
      throw new Error(`Invalid column name format: ${columnName}`);
    }

    // Validate column doesn't already exist
    const existsResult = await this.tenantPool.query(`
      SELECT COUNT(*) FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'loans' 
        AND column_name = $1
    `, [columnName]);

    if (parseInt(existsResult.rows[0].count) > 0) {
      console.log(`[AdditionalFieldService] Column ${columnName} already exists, skipping creation`);
      return;
    }

    // Add the column
    await this.tenantPool.query(`
      ALTER TABLE public.loans ADD COLUMN ${columnName} ${dbType}
    `);

    console.log(`[AdditionalFieldService] Successfully added column ${columnName}`);
  }

  /**
   * Drop a column from the loans table (for additional fields only)
   */
  async dropColumn(columnName: string): Promise<void> {
    console.log(`[AdditionalFieldService] Dropping column ${columnName} from loans table`);

    // Validate column name is safe
    if (!/^[a-z][a-z0-9_]*$/.test(columnName)) {
      throw new Error(`Invalid column name format: ${columnName}`);
    }

    // Check if column exists
    const existsResult = await this.tenantPool.query(`
      SELECT COUNT(*) FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'loans' 
        AND column_name = $1
    `, [columnName]);

    if (parseInt(existsResult.rows[0].count) === 0) {
      console.log(`[AdditionalFieldService] Column ${columnName} doesn't exist, skipping drop`);
      return;
    }

    // Drop the column
    await this.tenantPool.query(`
      ALTER TABLE public.loans DROP COLUMN ${columnName}
    `);

    console.log(`[AdditionalFieldService] Successfully dropped column ${columnName}`);
  }

  // --------------------------------------------------------------------------
  // CRUD Operations
  // --------------------------------------------------------------------------

  /**
   * Get all additional field definitions for a connection
   */
  async getFieldDefinitions(connectionId?: string): Promise<AdditionalFieldDefinition[]> {
    const query = connectionId
      ? `SELECT * FROM additional_field_definitions WHERE los_connection_id = $1 ORDER BY sort_order, display_name`
      : `SELECT * FROM additional_field_definitions ORDER BY los_connection_id, sort_order, display_name`;
    
    const params = connectionId ? [connectionId] : [];
    const result = await this.tenantPool.query(query, params);

    return result.rows.map(this.rowToDefinition);
  }

  /**
   * Get a single field definition by ID
   */
  async getFieldDefinitionById(id: string): Promise<AdditionalFieldDefinition | null> {
    const result = await this.tenantPool.query(
      `SELECT * FROM additional_field_definitions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToDefinition(result.rows[0]);
  }

  /**
   * Get enabled fields for ETL (only those with columns created)
   */
  async getEnabledFieldsForEtl(connectionId: string): Promise<AdditionalFieldDefinition[]> {
    const result = await this.tenantPool.query(`
      SELECT * FROM additional_field_definitions 
      WHERE los_connection_id = $1 
        AND is_enabled = TRUE 
        AND column_created = TRUE
      ORDER BY sort_order, display_name
    `, [connectionId]);

    return result.rows.map(this.rowToDefinition);
  }

  /**
   * Get RAG-enabled fields for a connection
   */
  async getRagEnabledFields(connectionId: string): Promise<AdditionalFieldDefinition[]> {
    const result = await this.tenantPool.query(`
      SELECT * FROM additional_field_definitions 
      WHERE los_connection_id = $1 
        AND is_enabled = TRUE 
        AND include_in_rag = TRUE
        AND column_created = TRUE
      ORDER BY sort_order, display_name
    `, [connectionId]);

    return result.rows.map(this.rowToDefinition);
  }

  /**
   * Create a new additional field definition and add column to loans table
   */
  async createField(input: CreateAdditionalFieldInput): Promise<AdditionalFieldDefinition> {
    const { 
      losConnectionId, 
      losFieldId, 
      displayName, 
      dataType, 
      category, 
      description,
      includeInRag = true,
      createdBy 
    } = input;

    // Generate column name and DB type
    const columnName = await this.generateUniqueColumnName(displayName);
    const dbColumnType = DATA_TYPE_TO_DB_TYPE[dataType];

    console.log(`[AdditionalFieldService] Creating additional field: ${displayName} -> ${columnName} (${dbColumnType})`);

    // Start transaction
    const client = await this.tenantPool.connect();
    try {
      await client.query('BEGIN');

      // Insert the definition
      const insertResult = await client.query(`
        INSERT INTO additional_field_definitions (
          los_connection_id, los_field_id, column_name, display_name, 
          data_type, db_column_type, category, description, 
          include_in_rag, column_created, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)
        RETURNING *
      `, [
        losConnectionId, losFieldId, columnName, displayName,
        dataType, dbColumnType, category || null, description || null,
        includeInRag, createdBy || null
      ]);

      const definition = this.rowToDefinition(insertResult.rows[0]);

      // Add column to loans table
      await client.query(`
        ALTER TABLE public.loans ADD COLUMN ${columnName} ${dbColumnType}
      `);

      // Mark column as created
      await client.query(`
        UPDATE additional_field_definitions SET column_created = TRUE WHERE id = $1
      `, [definition.id]);

      // Log the action
      await client.query(`
        INSERT INTO additional_field_audit_log (field_definition_id, action, new_values, performed_by)
        VALUES ($1, 'create', $2, $3)
      `, [definition.id, JSON.stringify(definition), createdBy || null]);

      await client.query('COMMIT');

      // Return updated definition
      definition.columnCreated = true;
      console.log(`[AdditionalFieldService] Successfully created additional field: ${definition.id}`);
      return definition;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an additional field definition
   */
  async updateField(id: string, input: UpdateAdditionalFieldInput, userId?: string): Promise<AdditionalFieldDefinition | null> {
    const existing = await this.getFieldDefinitionById(id);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category || null);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description || null);
    }
    if (input.isEnabled !== undefined) {
      updates.push(`is_enabled = $${paramIndex++}`);
      values.push(input.isEnabled);
    }
    if (input.includeInRag !== undefined) {
      updates.push(`include_in_rag = $${paramIndex++}`);
      values.push(input.includeInRag);
    }
    if (input.sortOrder !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      values.push(input.sortOrder);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.tenantPool.query(`
      UPDATE additional_field_definitions 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    const updated = this.rowToDefinition(result.rows[0]);

    // Log the action
    await this.tenantPool.query(`
      INSERT INTO additional_field_audit_log (field_definition_id, action, previous_values, new_values, performed_by)
      VALUES ($1, 'update', $2, $3, $4)
    `, [id, JSON.stringify(existing), JSON.stringify(updated), userId || null]);

    return updated;
  }

  /**
   * Change the data type of an additional field (ALTERs the column in the loans table)
   */
  async changeFieldDataType(id: string, newDataType: DataType, userId?: string): Promise<AdditionalFieldDefinition | null> {
    const existing = await this.getFieldDefinitionById(id);
    if (!existing) {
      return null;
    }

    if (existing.dataType === newDataType) {
      return existing;
    }

    const newDbColumnType = DATA_TYPE_TO_DB_TYPE[newDataType];
    const columnName = existing.columnName;

    console.log(`[AdditionalFieldService] Changing data type for ${existing.displayName} (${columnName}): ${existing.dataType} -> ${newDataType} (${existing.dbColumnType} -> ${newDbColumnType})`);

    const client = await this.tenantPool.connect();
    try {
      await client.query('BEGIN');

      // ALTER the column type in the loans table
      // Use USING clause to attempt automatic casting
      let usingClause = '';
      if (newDataType === 'string') {
        usingClause = `USING ${columnName}::TEXT`;
      } else if (newDataType === 'number' || newDataType === 'currency' || newDataType === 'percentage') {
        // Cast text to numeric - NULLify values that can't be cast
        usingClause = `USING CASE WHEN ${columnName} IS NULL OR TRIM(${columnName}::TEXT) = '' THEN NULL ELSE NULLIF(REGEXP_REPLACE(TRIM(${columnName}::TEXT), '[^0-9.\\-]', '', 'g'), '')::${newDbColumnType} END`;
      } else if (newDataType === 'date') {
        usingClause = `USING CASE WHEN ${columnName} IS NULL OR TRIM(${columnName}::TEXT) = '' THEN NULL ELSE ${columnName}::DATE END`;
      } else if (newDataType === 'boolean') {
        usingClause = `USING CASE WHEN ${columnName} IS NULL OR TRIM(${columnName}::TEXT) = '' THEN NULL ELSE ${columnName}::BOOLEAN END`;
      }

      await client.query(`
        ALTER TABLE public.loans 
        ALTER COLUMN ${columnName} TYPE ${newDbColumnType} ${usingClause}
      `);

      // Update the field definition
      const result = await client.query(`
        UPDATE additional_field_definitions 
        SET data_type = $1, db_column_type = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `, [newDataType, newDbColumnType, id]);

      // Audit log
      await client.query(`
        INSERT INTO additional_field_audit_log (field_definition_id, action, previous_values, new_values, performed_by, notes)
        VALUES ($1, 'update', $2, $3, $4, $5)
      `, [id, JSON.stringify({ dataType: existing.dataType, dbColumnType: existing.dbColumnType }), JSON.stringify({ dataType: newDataType, dbColumnType: newDbColumnType }), userId || null, `Data type changed from ${existing.dataType} to ${newDataType}`]);

      await client.query('COMMIT');

      return this.rowToDefinition(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete an additional field definition and drop the column
   */
  async deleteField(id: string, userId?: string): Promise<boolean> {
    const existing = await this.getFieldDefinitionById(id);
    if (!existing) {
      return false;
    }

    console.log(`[AdditionalFieldService] Deleting additional field: ${existing.displayName} (${existing.columnName})`);

    const client = await this.tenantPool.connect();
    try {
      await client.query('BEGIN');

      // Log the action first (before deleting the definition)
      await client.query(`
        INSERT INTO additional_field_audit_log (field_definition_id, action, previous_values, performed_by)
        VALUES ($1, 'delete', $2, $3)
      `, [id, JSON.stringify(existing), userId || null]);

      // Drop the column if it was created
      if (existing.columnCreated) {
        await client.query(`
          ALTER TABLE public.loans DROP COLUMN IF EXISTS ${existing.columnName}
        `);
      }

      // Delete the definition
      await client.query(`
        DELETE FROM additional_field_definitions WHERE id = $1
      `, [id]);

      await client.query('COMMIT');

      console.log(`[AdditionalFieldService] Successfully deleted additional field: ${id}`);
      return true;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  /**
   * Validate that a LOS field ID exists in Encompass
   */
  async validateFieldExists(
    tenantId: string,
    connectionId: string,
    losFieldId: string,
    apiServer?: string
  ): Promise<{ exists: boolean; description?: string }> {
    try {
      const apiService = new EncompassApiService(this.tenantPool, apiServer);

      // Check RDB fields
      const rdbResponse = await apiService.getRdbFields(tenantId, connectionId);
      const rdbField = rdbResponse.data.find(f => 
        f.fieldID === losFieldId || 
        `Fields.${f.fieldID}` === losFieldId ||
        f.fieldID === losFieldId.replace('Fields.', '')
      );

      if (rdbField) {
        return { exists: true, description: rdbField.description };
      }

      // Check custom fields
      const customResponse = await apiService.getCustomFields(tenantId, connectionId);
      const customField = customResponse.data.find(f => 
        f.Id === losFieldId || 
        `CX.${f.Id}` === losFieldId ||
        f.Id === losFieldId.replace('CX.', '')
      );

      if (customField) {
        return { exists: true, description: customField.Audit?.Data || customField.Id };
      }

      return { exists: false };

    } catch (error: any) {
      console.error(`[AdditionalFieldService] Error validating field ${losFieldId}:`, error.message);
      // Return true on error to not block - let sync fail if field is invalid
      return { exists: true, description: 'Could not validate - field may or may not exist' };
    }
  }

  /**
   * Check if a LOS field ID is already defined for a connection
   */
  async isFieldIdAlreadyDefined(connectionId: string, losFieldId: string, excludeId?: string): Promise<boolean> {
    const query = excludeId
      ? `SELECT COUNT(*) FROM additional_field_definitions WHERE los_connection_id = $1 AND los_field_id = $2 AND id != $3`
      : `SELECT COUNT(*) FROM additional_field_definitions WHERE los_connection_id = $1 AND los_field_id = $2`;
    
    const params = excludeId ? [connectionId, losFieldId, excludeId] : [connectionId, losFieldId];
    const result = await this.tenantPool.query(query, params);

    return parseInt(result.rows[0].count) > 0;
  }

  /**
   * Reconcile column_created with actual schema: for each definition with
   * column_created = TRUE, ensure the column exists on public.loans; if missing,
   * add it with ADD COLUMN IF NOT EXISTS; if creation fails, set column_created = FALSE.
   * Callable from admin tooling or after suspected schema drift.
   */
  async reconcileColumns(): Promise<ReconcileColumnsReport> {
    const report: ReconcileColumnsReport = {
      created: [],
      failed: [],
      setColumnCreatedFalse: [],
    };
    const allowedDbTypes = new Set([
      'TEXT', 'DECIMAL(15,4)', 'DECIMAL(15,2)', 'DECIMAL(8,4)',
      'DATE', 'BOOLEAN', 'timestamp with time zone', 'timestamp without time zone',
    ]);
    const dataTypeToDbType: Record<string, string> = {
      string: 'TEXT',
      number: 'DECIMAL(15,4)',
      date: 'DATE',
      boolean: 'BOOLEAN',
      currency: 'DECIMAL(15,2)',
      percentage: 'DECIMAL(8,4)',
    };
    const defsResult = await this.tenantPool.query(
      `SELECT id, column_name, db_column_type, data_type FROM additional_field_definitions WHERE column_created = TRUE`
    );
    for (const row of defsResult.rows) {
      const { id, column_name: columnName, data_type: dataType } = row;
      let dbColumnType: string | null = row.db_column_type?.trim() || null;

      // Fall back: derive from data_type if db_column_type is NULL/empty
      if (!dbColumnType && dataType && dataTypeToDbType[dataType]) {
        dbColumnType = dataTypeToDbType[dataType];
        await this.tenantPool.query(
          `UPDATE additional_field_definitions SET db_column_type = $1 WHERE id = $2`,
          [dbColumnType, id]
        );
      }

      if (!/^[a-z][a-z0-9_]*$/i.test(columnName) || !dbColumnType || !allowedDbTypes.has(dbColumnType)) {
        await this.tenantPool.query(
          `UPDATE additional_field_definitions SET column_created = FALSE WHERE id = $1`,
          [id]
        );
        report.setColumnCreatedFalse.push(columnName);
        continue;
      }
      const existsResult = await this.tenantPool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
        [columnName]
      );
      if (existsResult.rows.length > 0) continue;
      try {
        await this.tenantPool.query(
          `ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS ${columnName} ${dbColumnType}`
        );
        const verifyResult = await this.tenantPool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
          [columnName]
        );
        if (verifyResult.rows.length > 0) {
          report.created.push(columnName);
        } else {
          await this.tenantPool.query(
            `UPDATE additional_field_definitions SET column_created = FALSE WHERE id = $1`,
            [id]
          );
          report.setColumnCreatedFalse.push(columnName);
        }
      } catch (err: any) {
        await this.tenantPool.query(
          `UPDATE additional_field_definitions SET column_created = FALSE WHERE id = $1`,
          [id]
        );
        report.failed.push({ columnName, error: err.message || String(err) });
        report.setColumnCreatedFalse.push(columnName);
      }
    }
    return report;
  }

  // --------------------------------------------------------------------------
  // Audit Log
  // --------------------------------------------------------------------------

  /**
   * Get audit log for a field
   */
  async getAuditLog(fieldId?: string, limit: number = 100): Promise<AdditionalFieldAuditEntry[]> {
    const query = fieldId
      ? `SELECT * FROM additional_field_audit_log WHERE field_definition_id = $1 ORDER BY performed_at DESC LIMIT $2`
      : `SELECT * FROM additional_field_audit_log ORDER BY performed_at DESC LIMIT $1`;
    
    const params = fieldId ? [fieldId, limit] : [limit];
    const result = await this.tenantPool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      fieldDefinitionId: row.field_definition_id,
      action: row.action,
      previousValues: row.previous_values,
      newValues: row.new_values,
      performedBy: row.performed_by,
      performedAt: new Date(row.performed_at),
      notes: row.notes,
    }));
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private rowToDefinition(row: any): AdditionalFieldDefinition {
    return {
      id: row.id,
      losConnectionId: row.los_connection_id,
      losFieldId: row.los_field_id,
      columnName: row.column_name,
      displayName: row.display_name,
      dataType: row.data_type as DataType,
      dbColumnType: row.db_column_type,
      category: row.category,
      description: row.description,
      isEnabled: row.is_enabled,
      includeInRag: row.include_in_rag,
      sortOrder: row.sort_order,
      columnCreated: row.column_created,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// ============================================================================
// Export singleton factory
// ============================================================================

export function createAdditionalFieldService(tenantPool: pg.Pool): AdditionalFieldService {
  return new AdditionalFieldService(tenantPool);
}
