import pg from "pg";
import dotenv from "dotenv";
import { buildUnderstoryBullets } from "../src/services/insights/understoryBullets.js";

dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run bullet backfill.");
}

const pool = new Pool({ connectionString });

async function backfillGeneratedInsights(batchSize: number): Promise<number> {
  const result = await pool.query(
    `SELECT id, headline, understory, detail_data, generation_method
     FROM generated_insights
     WHERE understory_bullets IS NULL
     ORDER BY id ASC
     LIMIT $1`,
    [batchSize]
  );

  for (const row of result.rows) {
    const summary =
      row?.generation_method === "agent" &&
      row?.detail_data?.type === "agent_finding" &&
      typeof row?.detail_data?.summary === "string" &&
      row.detail_data.summary.trim()
        ? row.detail_data.summary
        : null;
    const sourceText = summary || String(row.understory || "");
    const sourceLabel = summary ? "summary" : "understory";
    const bullets = await buildUnderstoryBullets(sourceText, {
      headline: row.headline || "",
      sourceLabel,
    });
    await pool.query(
      `UPDATE generated_insights
       SET understory_bullets = $2::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify(bullets)]
    );
  }

  return result.rows.length;
}

async function backfillDashboardInsights(batchSize: number): Promise<number> {
  const result = await pool.query(
    `SELECT id, headline, understory
     FROM dashboard_generated_insights
     WHERE understory_bullets IS NULL
     ORDER BY id ASC
     LIMIT $1`,
    [batchSize]
  );

  for (const row of result.rows) {
    const bullets = await buildUnderstoryBullets(String(row.understory || ""), {
      headline: row.headline || "",
      sourceLabel: "understory",
    });
    await pool.query(
      `UPDATE dashboard_generated_insights
       SET understory_bullets = $2::jsonb
       WHERE id = $1`,
      [row.id, JSON.stringify(bullets)]
    );
  }

  return result.rows.length;
}

async function run(): Promise<void> {
  const batchSize = Number(process.env.BULLET_BACKFILL_BATCH_SIZE || 200);
  let totalGenerated = 0;
  let totalDashboard = 0;

  while (true) {
    const count = await backfillGeneratedInsights(batchSize);
    totalGenerated += count;
    if (count < batchSize) break;
  }

  while (true) {
    const count = await backfillDashboardInsights(batchSize);
    totalDashboard += count;
    if (count < batchSize) break;
  }

  console.log(
    `[Backfill] Completed. generated_insights=${totalGenerated}, dashboard_generated_insights=${totalDashboard}`
  );
}

run()
  .catch((err) => {
    console.error("[Backfill] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
