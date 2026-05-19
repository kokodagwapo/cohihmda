import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    // When the URL has a hash (e.g. /insights#leaderboard), don't scroll to top so the page can scroll to that section.
    if (hash) return;

    const scrollTop = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    scrollTop();
    // Unified chat shell focus can scroll the page after route effects; reset again shortly after paint.
    const raf = requestAnimationFrame(scrollTop);
    const timeout =
      pathname === "/insights" ? window.setTimeout(scrollTop, 50) : undefined;

    return () => {
      cancelAnimationFrame(raf);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [pathname, hash]);

  return null;
}
