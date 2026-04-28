import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { tenantDbManager } from "../src/config/tenantDatabaseManager.js";
import {
  buildChannelWhereClause,
  buildFundedFilter,
  getActorColumnForChannel,
  getTenantRevenueExpression,
  getVMaxDate,
  isActorMissing,
} from "../src/utils/scorecard-utils.js";
import {
  buildActorStatusSummary,
  enrichActorsWithStatus,
} from "../src/services/actorStatusService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const slug = process.argv[2] || "hfm";
  const dateRange = process.argv[3] || "last-year";
  const channelGroup = process.argv[4] === "All" ? undefined : process.argv[4];

  const tenantPool = await tenantDbManager.getTenantPool(slug);
  if (!tenantPool) throw new Error(`No pool for ${slug}`);

  const revenueExpression = await getTenantRevenueExpression(tenantPool);
  const vMaxDate = await getVMaxDate(tenantPool);
  let effectiveStartDate: Date;
  let effectiveEndDate = new Date(vMaxDate);

  switch (dateRange) {
    case "last-year":
      effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 0, 1);
      effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
      break;
    case "ytd":
      effectiveStartDate = new Date(vMaxDate.getFullYear(), 0, 1);
      break;
    case "qtd":
      effectiveStartDate = new Date(vMaxDate.getFullYear(), Math.floor(vMaxDate.getMonth() / 3) * 3, 1);
      break;
    case "mtd":
      effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth(), 1);
      break;
    case "last-quarter": {
      const currentQuarter = Math.floor(vMaxDate.getMonth() / 3);
      const lastQuarter = currentQuarter - 1;
      if (lastQuarter < 0) {
        effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 9, 1);
        effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
      } else {
        effectiveStartDate = new Date(vMaxDate.getFullYear(), lastQuarter * 3, 1);
        effectiveEndDate = new Date(vMaxDate.getFullYear(), (lastQuarter + 1) * 3, 0);
      }
      break;
    }
    case "last-month": {
      const lastMonth = new Date(vMaxDate);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      effectiveStartDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
      effectiveEndDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
      break;
    }
    case "trailing-12":
      effectiveStartDate = new Date(vMaxDate);
      effectiveStartDate.setFullYear(effectiveStartDate.getFullYear() - 1);
      break;
    default:
      throw new Error(`Unsupported date range for one-off script: ${dateRange}`);
  }

  const actorColumn = getActorColumnForChannel(channelGroup);
  const actorIdColumn = actorColumn === "account_executive" ? "account_executive" : "loan_officer_id";
  const channelCondition = buildChannelWhereClause(channelGroup);
  const fundedFilter = buildFundedFilter(channelGroup);
  const params = [
    effectiveStartDate.toISOString().split("T")[0],
    effectiveEndDate.toISOString().split("T")[0],
  ];

  const query = `
    WITH funded_loans AS (
      SELECT
        ${actorColumn} AS actor_name,
        ${actorIdColumn} AS actor_id,
        loan_id,
        COALESCE(loan_number, loan_id::text) AS loan_number,
        loan_amount,
        (${revenueExpression}) AS revenue
      FROM public.loans
      WHERE ${fundedFilter}
        AND funding_date >= $1
        AND funding_date <= $2
        ${channelCondition}
    ),
    actor_aggregates AS (
      SELECT
        actor_name,
        actor_id,
        COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS units,
        SUM(loan_amount) AS volume,
        SUM(revenue) AS revenue,
        CASE WHEN SUM(loan_amount) > 0 THEN (SUM(revenue) / SUM(loan_amount)) * 10000 ELSE 0 END AS revenue_bps,
        CASE WHEN COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) > 0
          THEN SUM(revenue) / COUNT(DISTINCT COALESCE(loan_number, loan_id::text))
          ELSE 0 END AS revenue_per_loan
      FROM funded_loans
      WHERE actor_name IS NOT NULL
        AND actor_name != ''
        AND actor_name NOT ILIKE '99-%'
        AND actor_name NOT ILIKE 'Missing'
        AND actor_name NOT ILIKE 'No LO Found'
        AND actor_name NOT ILIKE 'No Loan Officer'
        AND actor_name NOT ILIKE 'No Branch Found'
        AND actor_name NOT ILIKE 'Unknown'
      GROUP BY actor_name, actor_id
      HAVING SUM(revenue) > 0
    )
    SELECT * FROM actor_aggregates
    ORDER BY revenue DESC
  `;

  const { rows } = await tenantPool.query(query, params);
  const actors = rows
    .filter((row) => !isActorMissing(row.actor_name))
    .map((actor) => ({
      id: actor.actor_id || actor.actor_name,
      name: actor.actor_name,
      revenue: Number(actor.revenue || 0),
      units: Number(actor.units || 0),
      volume: Number(actor.volume || 0),
    }));
  const enriched = await enrichActorsWithStatus(tenantPool, actors, {
    actorKind: actorColumn,
    getActorId: (row) => row.id,
    getActorName: (row) => row.name,
  });

  console.log(JSON.stringify({
    slug,
    dateRange,
    channelGroup: channelGroup || "All",
    vMaxDate: vMaxDate.toISOString().split("T")[0],
    start: params[0],
    end: params[1],
    summary: buildActorStatusSummary(enriched),
    actors: enriched.map((a) => ({
      id: a.id,
      name: a.name,
      units: a.units,
      revenue: Math.round(a.revenue),
      actorStatus: a.actorStatus,
      matchType: a.actorStatusMatchType,
      lastLogin: a.lastLogin,
      encompassUserId: a.encompassUserId,
    })),
  }, null, 2));

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
