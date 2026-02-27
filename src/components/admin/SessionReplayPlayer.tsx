/**
 * Embeds rrweb-player to play back a session replay (array of rrweb events).
 */
import { useEffect, useRef } from "react";

interface SessionReplayPlayerProps {
  events: unknown[];
  width?: number;
  height?: number;
}

export function SessionReplayPlayer({
  events,
  width = 1024,
  height = 576,
}: SessionReplayPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{ $destroy?: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !events.length) return;

    let mounted = true;
    const container = containerRef.current;

    import("rrweb-player").then((mod) => {
      if (!mounted || !container) return;
      const rrwebPlayer = mod.default;
      import("rrweb-player/dist/style.css");
      try {
        playerRef.current = new rrwebPlayer({
          target: container,
          props: {
            events: events as { timestamp: number }[],
            width,
            height,
            autoPlay: false,
            showController: true,
          },
        });
      } catch (err) {
        console.warn("[SessionReplayPlayer] init failed", err);
      }
    });

    return () => {
      mounted = false;
      if (playerRef.current?.$destroy) {
        try {
          playerRef.current.$destroy();
        } catch (_) {}
        playerRef.current = null;
      }
      if (container?.firstChild) {
        container.innerHTML = "";
      }
    };
  }, [events, width, height]);

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
      <div ref={containerRef} className="rrweb-player-wrapper" />
    </div>
  );
}
