import { clearNewsCache, getIndustryNews } from "./newsService.js";

let nextRunTimer: NodeJS.Timeout | null = null;
const DAILY_REFRESH_HOURS = [5, 8, 10, 14, 16, 18];

function getNextRefreshTime(now = new Date()): Date {
  const candidates = DAILY_REFRESH_HOURS.map((hour) => {
    const candidate = new Date(now);
    candidate.setHours(hour, 0, 0, 0);
    return candidate;
  });

  const nextToday = candidates.find((candidate) => candidate > now);
  if (nextToday) return nextToday;

  const firstTomorrow = new Date(now);
  firstTomorrow.setDate(firstTomorrow.getDate() + 1);
  firstTomorrow.setHours(DAILY_REFRESH_HOURS[0], 0, 0, 0);
  return firstTomorrow;
}

async function refreshNewsCache(reason: string) {
  try {
    console.log(`[NewsScheduler] Refreshing news cache (${reason})...`);
    clearNewsCache();
    const result = await getIndustryNews();
    console.log(
      `[NewsScheduler] Refresh complete. Sources: ${result.newsFeed.length}, updated: ${result.lastUpdated}`
    );
  } catch (error) {
    console.warn("[NewsScheduler] Refresh failed:", error);
  }
}

export function startNewsRefreshScheduler() {
  if (nextRunTimer) return;

  // Prime cache shortly after startup for fast first request.
  setTimeout(() => {
    void refreshNewsCache("startup");
  }, 10_000);

  const scheduleNextRun = () => {
    const now = new Date();
    const nextRun = getNextRefreshTime(now);
    const delay = Math.max(0, nextRun.getTime() - now.getTime());
    console.log(
      `[NewsScheduler] Next refresh at ${nextRun.toLocaleString()} (in ${Math.round(
        delay / 60000
      )} minutes).`
    );

    nextRunTimer = setTimeout(() => {
      void refreshNewsCache(`scheduled-${nextRun.getHours()}:00`);
      scheduleNextRun();
    }, delay);
  };

  scheduleNextRun();
}

