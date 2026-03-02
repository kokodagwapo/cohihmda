import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SidebarRouteSearchTarget =
  | {
      id: string;
      label: string;
      group: string;
      kind: "route";
      path: string;
      keywords?: string[];
    }
  | {
      id: string;
      label: string;
      group: string;
      kind: "section";
      sectionId: string;
      keywords?: string[];
    };

type Props = {
  targets: SidebarRouteSearchTarget[];
  collapsed: boolean;
};

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function scoreMatch(query: string, target: SidebarRouteSearchTarget) {
  const q = normalize(query);
  if (!q) return -1;
  const label = normalize(target.label);

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;

  const keywords = (target.keywords ?? []).map(normalize);
  if (keywords.some((k) => k === q)) return 55;
  if (keywords.some((k) => k.startsWith(q))) return 45;
  if (keywords.some((k) => k.includes(q))) return 35;

  return -1;
}

function defaultGroupOrder(groups: string[]) {
  const preferred = ["Insights", "Dashboards", "TopTiering", "Pages"];
  const set = new Set(preferred);
  return [
    ...preferred.filter((g) => groups.includes(g)),
    ...groups.filter((g) => !set.has(g)).sort(),
  ];
}

export function SidebarRouteSearch({ targets, collapsed }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pendingSectionRef = useRef<string | null>(null);

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return [] as SidebarRouteSearchTarget[];
    const ranked = targets
      .map((t) => ({ t, score: scoreMatch(q, t) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.t.label.localeCompare(b.t.label),
      )
      .map((x) => x.t);

    return ranked.slice(0, 40);
  }, [query, targets]);

  const grouped = useMemo(() => {
    const map = new Map<string, SidebarRouteSearchTarget[]>();
    for (const r of results) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    const groupNames = Array.from(map.keys());
    const order = defaultGroupOrder(groupNames);
    return { map, order };
  }, [results]);

  const tryScrollToSection = useCallback((sectionId: string) => {
    const headerOffset = 80;
    const maxAttempts = 30;
    const delayMs = 100;

    const attempt = (n: number) => {
      const el = document.getElementById(sectionId);
      if (!el) {
        if (n < maxAttempts) {
          window.setTimeout(() => attempt(n + 1), delayMs);
        }
        return;
      }
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({ top: offsetPosition, behavior: "smooth" });
      pendingSectionRef.current = null;
    };

    attempt(0);
  }, []);

  // If we navigated to /insights to reach a section, scroll once the page is ready.
  useEffect(() => {
    const pending = pendingSectionRef.current;
    if (!pending) return;
    if (location.pathname !== "/insights") return;
    tryScrollToSection(pending);
  }, [location.pathname, tryScrollToSection]);

  const handleSelect = useCallback(
    (target: SidebarRouteSearchTarget) => {
      if (target.kind === "route") {
        navigate(target.path);
        setOpen(false);
        setQuery("");
        return;
      }

      // section
      const sectionId = target.sectionId;
      if (location.pathname !== "/insights") {
        pendingSectionRef.current = sectionId;
        navigate("/insights");
        setOpen(false);
        setQuery("");
        return;
      }

      tryScrollToSection(sectionId);
      setOpen(false);
      setQuery("");
    },
    [location.pathname, navigate, tryScrollToSection],
  );

  const onInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      // Let cmdk handle Enter when an item is selected.
      const selected = document.querySelector(
        '[cmdk-item][data-selected="true"]',
      );
      if (selected) return;
      if ((e.nativeEvent as any)?.isComposing) return;
      if (results.length === 0) return;
      e.preventDefault();
      handleSelect(results[0]);
    },
    [handleSelect, results],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const trigger = collapsed ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-10 w-10 rounded-lg"
      aria-label="Search routes"
      onClick={() => setOpen(true)}
    >
      <Search className="h-4 w-4" />
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn(
        "w-full justify-start gap-2 font-normal h-10 px-3",
        !query ? "text-slate-500 dark:text-slate-400" : "text-slate-900 dark:text-slate-100",
      )}
      onClick={() => setOpen(true)}
    >
      <Search className="h-4 w-4 opacity-70" />
      <span className="truncate">
        {query ? query : "Search dashboards and pages…"}
      </span>
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className={cn("p-0", collapsed ? "w-72" : "w-[320px]")}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          window.setTimeout(() => {
            const input = document.querySelector("[cmdk-input]") as
              | HTMLInputElement
              | null;
            input?.focus();
          }, 50);
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to search…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={onInputKeyDown}
          />
          <CommandList className="max-h-[320px]">
            {!normalize(query) ? (
              <CommandEmpty>Start typing to see suggestions.</CommandEmpty>
            ) : results.length === 0 ? (
              <CommandEmpty>No matches found.</CommandEmpty>
            ) : (
              grouped.order.map((group) => {
                const items = grouped.map.get(group) ?? [];
                if (items.length === 0) return null;
                return (
                  <CommandGroup key={group} heading={group}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => handleSelect(item)}
                        className="flex items-center gap-2"
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        <CommandShortcut>
                          {item.kind === "route" ? "Go" : "Open"}
                        </CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

