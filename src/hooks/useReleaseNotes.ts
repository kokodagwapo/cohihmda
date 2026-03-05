import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { WhatsNewEntry } from "@/data/whatsNew";

interface ReleaseNoteEntryApi {
  id: string;
  title: string;
  description: string;
  category: "feature" | "improvement" | "fix";
  link: string | null;
  linkLabel: string | null;
}

interface ReleaseNoteApi {
  id: string;
  version: string;
  title: string;
  publishedAt: string;
  entries: ReleaseNoteEntryApi[];
}

interface PublishedReleaseNotesResponse {
  notes: ReleaseNoteApi[];
}

export function useReleaseNotes() {
  const [notes, setNotes] = useState<ReleaseNoteApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.request<PublishedReleaseNotesResponse>(
          "/api/release-notes/published",
        );
        if (!cancelled) {
          setNotes(Array.isArray(response.notes) ? response.notes : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load release notes");
          setNotes([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const whatsNewEntries = useMemo<WhatsNewEntry[]>(() => {
    return notes.flatMap((note) =>
      note.entries.map((entry) => ({
        id: `release-note-${note.id}-${entry.id}`,
        title: entry.title,
        description: entry.description,
        date: note.publishedAt,
        category: entry.category,
        link: entry.link || undefined,
        linkLabel: entry.linkLabel || undefined,
      })),
    );
  }, [notes]);

  return { notes, whatsNewEntries, loading, error };
}
