import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  normalizeWorkflowBookmarks,
  type WorkflowConversionBookmark,
} from "@/utils/workflowConversionBookmarks";

const PREFERENCE_KEY = "workflowConversionBookmarksV1";
const LOCAL_STORAGE_KEY = "cohi-workflow-conversion-bookmarks-v1";

interface PreferenceResponse {
  preference_value: unknown;
}

function safeReadLocal(): WorkflowConversionBookmark[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return normalizeWorkflowBookmarks(JSON.parse(raw));
  } catch {
    return [];
  }
}

function safeWriteLocal(bookmarks: WorkflowConversionBookmark[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // ignore localStorage errors
  }
}

export function useWorkflowConversionBookmarks(): {
  bookmarks: WorkflowConversionBookmark[];
  isLoading: boolean;
  saveAll: (bookmarks: WorkflowConversionBookmark[]) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [bookmarks, setBookmarks] = useState<WorkflowConversionBookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${PREFERENCE_KEY}`);
      const fromApi = normalizeWorkflowBookmarks(response?.preference_value);
      if (fromApi.length > 0 || Array.isArray(response?.preference_value)) {
        setBookmarks(fromApi);
        safeWriteLocal(fromApi);
        return;
      }
      setBookmarks(safeReadLocal());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load workflow conversion bookmarks:", error);
      }
      setBookmarks(safeReadLocal());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveAll = useCallback(async (nextBookmarks: WorkflowConversionBookmark[]) => {
    const normalized = normalizeWorkflowBookmarks(nextBookmarks);
    setBookmarks(normalized);
    safeWriteLocal(normalized);
    try {
      await api.request(`/api/user/preferences/${PREFERENCE_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ preference_value: normalized }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to persist workflow conversion bookmarks:", error);
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
