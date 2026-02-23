import { clearNewsCache, getIndustryNews } from "../src/services/newsService.js";

async function run() {
  console.log("[NewsRefreshScript] Forcing news refresh...");
  clearNewsCache();
  const result = await getIndustryNews();
  console.log(
    `[NewsRefreshScript] Done. Sources: ${result.newsFeed.length}, updated: ${result.lastUpdated}`
  );
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[NewsRefreshScript] Failed:", error);
    process.exit(1);
  });

