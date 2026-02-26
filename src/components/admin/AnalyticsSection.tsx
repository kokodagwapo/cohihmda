/**
 * Admin Analytics section: overview, page analytics, sessions, user journeys,
 * funnels, heatmap, session replays, feature usage.
 */

import { useState, useEffect } from "react";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Play, HelpCircle } from "lucide-react";
import { SessionReplayPlayer } from "./SessionReplayPlayer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const dateRange = (days: number) => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

function useAnalyticsQuery<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  enabled: boolean
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selectedTenantId, isPlatformAdmin } = useAdminTenant();

  useEffect(() => {
    if (!enabled || !selectedTenantId) return;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (isPlatformAdmin) q.set("tenantId", selectedTenantId);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") q.set(k, String(v));
    });
    api
      .request<{ data?: T }>(`/api/analytics${path}?${q}`)
      .then((r) => setData((r as { data?: T }).data ?? (r as T)))
      .catch((e) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [path, enabled, selectedTenantId, isPlatformAdmin, JSON.stringify(params)]);

  return { data, loading, error };
}

export function AnalyticsSection() {
  const { selectedTenantId, isPlatformAdmin, currentTenantName } = useAdminTenant();
  const [rangeDays, setRangeDays] = useState(7);
  const { start, end } = dateRange(rangeDays);
  const [funnelSteps, setFunnelSteps] = useState("/insights,/loans,/loan-detail");
  const [heatmapPage, setHeatmapPage] = useState("/insights");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [replayEvents, setReplayEvents] = useState<unknown[]>([]);
  const [replayLoading, setReplayLoading] = useState(false);

  const hasTenant = !!selectedTenantId || !isPlatformAdmin;

  const { data: activeUsers, loading: activeUsersLoading } = useAnalyticsQuery<{ date: string; count: number }[]>(
    "/active-users",
    { period: "day" },
    hasTenant
  );
  const { data: topPages, loading: topPagesLoading } = useAnalyticsQuery<
    { page_path: string; views: number; avg_duration_ms: number | null }[]
  >("/top-pages", { start, end, limit: 15 }, hasTenant);
  const { data: sessions, loading: sessionsLoading } = useAnalyticsQuery<
    {
      id: string;
      user_id: string;
      started_at: string;
      page_count: number;
      event_count: number;
      has_replay: boolean;
    }[]
  >("/sessions", { start, end, limit: 30 }, hasTenant);
  const { data: featureUsage, loading: featureUsageLoading } = useAnalyticsQuery<
    { event_name: string | null; page_path: string | null; count: number }[]
  >("/feature-usage", { start, end, limit: 25 }, hasTenant);

  const steps = funnelSteps.split(",").map((s) => s.trim()).filter(Boolean);
  const { data: funnelData, loading: funnelLoading } = useAnalyticsQuery<
    { step: number; name: string; count: number; conversion_from_previous: number | null }[]
  >("/funnels", { start, end, steps: steps.join(",") }, hasTenant && steps.length > 0);

  const { data: heatmapData, loading: heatmapLoading } = useAnalyticsQuery<
    { x: number; y: number; count: number }[]
  >("/heatmap", { pagePath: heatmapPage, start, end }, hasTenant && !!heatmapPage);

  useEffect(() => {
    if (!selectedSessionId) {
      setReplayEvents([]);
      return;
    }
    setReplayLoading(true);
    const q = new URLSearchParams();
    if (isPlatformAdmin && selectedTenantId) q.set("tenantId", selectedTenantId);
    api
      .request<{ session: unknown; replayChunkIndices: number[] }>(
        `/api/analytics/sessions/${selectedSessionId}?${q}`
      )
      .then((res) => {
        const indices = (res as { replayChunkIndices?: number[] }).replayChunkIndices ?? [];
        if (indices.length === 0) {
          setReplayEvents([]);
          setReplayLoading(false);
          return;
        }
        return Promise.all(
          indices.map((i) =>
            api.request<{ events: unknown[] }>(
              `/api/analytics/sessions/${selectedSessionId}/replay/${i}?${q}`
            )
          )
        );
      })
      .then((chunks) => {
        if (!chunks) return;
        const all: unknown[] = [];
        (chunks as { events?: unknown[] }[]).forEach((c) => {
          const ev = Array.isArray(c) ? c : (c?.events ?? []);
          all.push(...ev);
        });
        // rrweb-player expects events in chronological order by timestamp
        all.sort((a: unknown, b: unknown) => {
          const tA = (a as { timestamp?: number })?.timestamp ?? 0;
          const tB = (b as { timestamp?: number })?.timestamp ?? 0;
          return tA - tB;
        });
        setReplayEvents(all);
      })
      .catch(() => setReplayEvents([]))
      .finally(() => setReplayLoading(false));
  }, [selectedSessionId, isPlatformAdmin, selectedTenantId]);

  if (!hasTenant && isPlatformAdmin) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-slate-600 dark:text-slate-400">
            Select a tenant above to view their analytics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-light text-slate-900 dark:text-white">
          User Analytics
        </h2>
        {currentTenantName && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {currentTenantName}
          </span>
        )}
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200">
          <HelpCircle className="h-4 w-4" />
          How to view logs and run a replay
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="pt-4 text-sm text-slate-600 dark:text-slate-400 space-y-3">
              <p className="font-medium text-slate-800 dark:text-slate-200">Step-by-step</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Select a tenant (if you’re a platform admin) using the tenant selector above.</li>
                <li>Open the <strong>Sessions</strong> tab to see recent sessions for the selected tenant.</li>
                <li>Sessions that have a replay show a <strong>Play</strong> button — click it to load that session.</li>
                <li>Open the <strong>Replays</strong> tab to watch the session: the player will appear with play/pause and speed controls.</li>
                <li>Use <strong>Overview</strong> for active users, <strong>Pages</strong> for top pages, <strong>Features</strong> for event usage, and <strong>Funnels</strong> / <strong>Heatmap</strong> for conversion and click data.</li>
              </ol>
              <p className="text-xs text-slate-500">
                Replays are only recorded for a sample of sessions (see VITE_REPLAY_SAMPLE_RATE). Events (page views, clicks) are tracked for all logged-in users.
              </p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="funnels">Funnels</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="replays">Replays</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Label>Last</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) || 7)}
              className="w-16"
            />
            <span>days</span>
          </div>
          {activeUsersLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : activeUsers && activeUsers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Active users (daily)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {activeUsers.slice(-14).map((row) => (
                    <div key={row.date} className="text-center">
                      <div className="text-2xl font-semibold">{row.count}</div>
                      <div className="text-xs text-slate-500">{row.date}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">No active user data for this period.</p>
          )}
        </TabsContent>

        <TabsContent value="pages" className="space-y-4">
          {topPagesLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : topPages && topPages.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top pages</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Path</th>
                      <th className="text-right py-2">Views</th>
                      <th className="text-right py-2">Avg time (s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPages.map((row) => (
                      <tr key={row.page_path} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 font-mono text-xs">{row.page_path || "(empty)"}</td>
                        <td className="text-right py-2">{row.views}</td>
                        <td className="text-right py-2">
                          {row.avg_duration_ms != null
                            ? (row.avg_duration_ms / 1000).toFixed(1)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">No page view data for this period.</p>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          {sessionsLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : sessions && sessions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800"
                    >
                      <span className="font-mono text-xs truncate max-w-[200px]" title={s.id}>
                        {s.id}
                      </span>
                      <span>{s.page_count} pages</span>
                      <span>{s.event_count} events</span>
                      <span className="text-slate-500 text-xs">
                        {new Date(s.started_at).toLocaleString()}
                      </span>
                      {s.has_replay && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedSessionId(s.id)}
                        >
                          <Play className="h-3 w-3 mr-1" /> Play
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">No sessions for this period.</p>
          )}
        </TabsContent>

        <TabsContent value="funnels" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Label>Steps (comma-separated paths or event names)</Label>
            <Input
              value={funnelSteps}
              onChange={(e) => setFunnelSteps(e.target.value)}
              placeholder="/insights,/loans,/loan-detail"
              className="max-w-md"
            />
          </div>
          {funnelLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : funnelData && funnelData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Step</th>
                      <th className="text-left py-2">Name</th>
                      <th className="text-right py-2">Sessions</th>
                      <th className="text-right py-2">Conversion %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnelData.map((row) => (
                      <tr key={row.step} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2">{row.step}</td>
                        <td className="py-2 font-mono text-xs">{row.name}</td>
                        <td className="text-right py-2">{row.count}</td>
                        <td className="text-right py-2">
                          {row.conversion_from_previous != null
                            ? `${row.conversion_from_previous}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">Enter steps and ensure there is data for the date range.</p>
          )}
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <Label>Page path</Label>
            <Input
              value={heatmapPage}
              onChange={(e) => setHeatmapPage(e.target.value)}
              placeholder="/insights"
              className="max-w-xs"
            />
          </div>
          {heatmapLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : heatmapData && heatmapData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Click coordinates (top 100)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500 mb-2">
                  x, y, count — overlay on a screenshot or use a heatmap library for visualization.
                </p>
                <pre className="text-xs bg-slate-100 dark:bg-slate-800 p-4 rounded overflow-auto max-h-96">
                  {JSON.stringify(heatmapData.slice(0, 100), null, 2)}
                </pre>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">No click data for this page and period.</p>
          )}
        </TabsContent>

        <TabsContent value="replays" className="space-y-4">
          <p className="text-sm text-slate-500">
            Select a session with replay from the Sessions tab, or load replay by session ID below.
          </p>
          {selectedSessionId && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono">{selectedSessionId}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelectedSessionId(null)}>
                Clear
              </Button>
            </div>
          )}
          {replayLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading replay…
            </div>
          ) : replayEvents.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">
                {replayEvents.length} events — use the player controls to play, pause, or change speed.
              </p>
              <SessionReplayPlayer events={replayEvents} width={960} height={540} />
            </div>
          ) : selectedSessionId ? (
            <p className="text-slate-500">No replay chunks for this session.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="features" className="space-y-4">
          {featureUsageLoading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : featureUsage && featureUsage.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Feature / event usage</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Event name</th>
                      <th className="text-left py-2">Page</th>
                      <th className="text-right py-2">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featureUsage.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-100 dark:border-slate-800"
                      >
                        <td className="py-2 font-mono text-xs">{row.event_name ?? "—"}</td>
                        <td className="py-2 font-mono text-xs">{row.page_path ?? "—"}</td>
                        <td className="text-right py-2">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : (
            <p className="text-slate-500">No feature usage data for this period.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
