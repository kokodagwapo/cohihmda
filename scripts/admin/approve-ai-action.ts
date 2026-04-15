#!/usr/bin/env tsx
/**
 * CLI: Approve a pending AI action
 *
 * Human-on-the-loop approval checkpoint for COHI-106 Phase 1.
 * Before the action is approved, the script prints the redacted ledger row so
 * the operator can verify they are approving the correct action.
 *
 * Usage:
 *   tsx scripts/admin/approve-ai-action.ts \
 *     --action-id <uuid> \
 *     --human-user-id <string> \
 *     [--note "optional approval note"]
 *
 * Environment: requires the same DB_* / MANAGEMENT_DB_NAME variables used by
 * the rest of the backend.  Run from within the project root or inside the
 * VPC/ECS exec context for production Aurora.
 *
 * The script exits with code 1 if:
 *   - required arguments are missing
 *   - the action is not found
 *   - the action is not in pending_approval state
 *   - the operator declines the confirmation prompt
 *   - the DB update fails
 */

import pg from 'pg';
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../server/.env') });

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { actionId: string; humanUserId: string; note: string } {
  const args = process.argv.slice(2);
  let actionId = '';
  let humanUserId = '';
  let note = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--action-id' && args[i + 1]) actionId = args[++i];
    else if (args[i] === '--human-user-id' && args[i + 1]) humanUserId = args[++i];
    else if (args[i] === '--note' && args[i + 1]) note = args[++i];
  }

  if (!actionId || !humanUserId) {
    console.error('Usage: tsx scripts/admin/approve-ai-action.ts --action-id <uuid> --human-user-id <string> [--note "..."]');
    process.exit(1);
  }

  return { actionId, humanUserId, note };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function buildPool(): pg.Pool {
  const host = (process.env.DB_HOST || 'localhost').trim();
  const rawHost = host === 'localhost' || host === '127.0.0.1' ? '127.0.0.1' : host;
  const isRemote = rawHost !== '127.0.0.1';

  return new Pool({
    host: rawHost,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.MANAGEMENT_DB_NAME || 'coheus_management',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: isRemote ? { rejectUnauthorized: false } : false,
    max: 2,
    connectionTimeoutMillis: 10000,
  });
}

// Safe fields that can be printed without risk of leaking PII.
const DISPLAY_FIELDS = new Set([
  'id', 'action_id', 'request_id', 'agent_id', 'agent_sub_type',
  'tenant_id', 'action_type', 'status', 'created_at', 'updated_at',
]);

function redactForDisplay(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = DISPLAY_FIELDS.has(k) ? v : '[REDACTED]';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { actionId, humanUserId, note } = parseArgs();
  const pool = buildPool();

  try {
    // 1. Fetch ledger row
    const fetchResult = await pool.query(
      'SELECT * FROM ai_control_plane.audit_ledger WHERE action_id = $1 LIMIT 1',
      [actionId],
    );

    if (fetchResult.rows.length === 0) {
      console.error(`\nError: Action not found: ${actionId}`);
      process.exit(1);
    }

    const row = fetchResult.rows[0] as Record<string, unknown>;

    if (row['status'] !== 'pending_approval') {
      console.error(`\nError: Action ${actionId} is not in pending_approval state (current: ${row['status']}).`);
      console.error('Only actions awaiting human approval can be approved via this script.');
      process.exit(1);
    }

    // 2. Print redacted metadata so the operator can verify the right action
    console.log('\n--- AI Action Details (sensitive fields redacted) ---');
    console.log(JSON.stringify(redactForDisplay(row), null, 2));
    console.log('-----------------------------------------------------\n');

    // 3. Require explicit confirmation
    const confirmed = await promptConfirm(`Approve action ${actionId} as ${humanUserId}? [y/N] `);

    if (!confirmed) {
      console.log('\nApproval declined. No changes made.');
      process.exit(0);
    }

    // 4. Write approval
    await pool.query(
      `UPDATE ai_control_plane.audit_ledger
          SET status        = 'approved',
              approved_by   = $1,
              approved_at   = NOW(),
              approval_note = $2
        WHERE action_id = $3`,
      [humanUserId, note || null, actionId],
    );

    console.log(`\nApproved action ${actionId} by ${humanUserId}.`);
  } catch (err) {
    console.error('\nFatal error during approval:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
