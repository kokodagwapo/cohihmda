import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnFilterState } from "@/utils/loanDetailFilters";

const PREFERENCE_KEY = "loanDetailFilterBookmarksV1";
const LOCAL_STORAGE_KEY = "cohi-loan-detail-filter-bookmarks-v1";

export interface LoanDetailFilterBookmark {
  id: string;
  name: string;
  filters: ColumnFilterState;
  createdAt: string;
  updatedAt: string;
}

interface PreferenceResponse {
  preference_value: LoanDetailFilterBookmark[] | null;
}

function isBookmarkArray(value: unknown): value is LoanDetailFilterBookmark[] {
  return Array.isArray(value);
}

function safeReadLocal(): LoanDetailFilterBookmark[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return isBookmarkArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWriteLocal(bookmarks: LoanDetailFilterBookmark[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // ignore localStorage errors
  }
}

export function useLoanDetailFilterBookmarks(): {
  bookmarks: LoanDetailFilterBookmark[];
  isLoading: boolean;
  saveAll: (bookmarks: LoanDetailFilterBookmark[]) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [bookmarks, setBookmarks] = useState<LoanDetailFilterBookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${PREFERENCE_KEY}`);
      const fromApi = response?.preference_value;
      if (Array.isArray(fromApi)) {
        setBookmarks(fromApi);
        safeWriteLocal(fromApi);
        return;
      }
      const fromLocal = safeReadLocal();
      setBookmarks(fromLocal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load loan detail bookmarks:", error);
      }
      const fromLocal = safeReadLocal();
      setBookmarks(fromLocal);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveAll = useCallback(async (nextBookmarks: LoanDetailFilterBookmark[]) => {
    setBookmarks(nextBookmarks);
    safeWriteLocal(nextBookmarks);
    try {
      await api.request(`/api/user/preferences/${PREFERENCE_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ preference_value: nextBookmarks }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to persist loan detail bookmarks:", error);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      bookmarks,
      isLoading,
      saveAll,
      refresh,
    }),
    [bookmarks, isLoading, saveAll, refresh],
  );
}

