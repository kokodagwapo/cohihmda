/**
 * useResearchUploads
 *
 * React hook for managing user-uploaded datasets in the Research Lab / Data Explorer.
 * Handles upload, listing, column editing, deletion, and session attachment.
 */

import { useState, useCallback } from "react";
import { api } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

export type InferredColumnType =
  | "string"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "boolean";

export interface ColumnMeta {
  name: string;
  displayName: string;
  inferredType: InferredColumnType;
  userOverrideType?: InferredColumnType;
  description?: string;
  nullRate: number;
  sampleValues: (string | number | boolean | null)[];
  isNumeric: boolean;
  isDate: boolean;
  isCategorical: boolean;
  uniqueCount?: number;
  minVal?: number | string;
  maxVal?: number | string;
  isPotentialPii?: boolean;
}

export type StorageStrategy = "context" | "table";
export type UploadStatus = "processing" | "ready" | "error" | "expired";

export interface QuickInsightConfig {
  title: string;
  chartType: "bar" | "line" | "histogram" | "scatter" | "pie";
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  description: string;
}

export interface ResearchUpload {
  id: string;
  fileName: string;
  originalFileName: string;
  fileSizeBytes: number;
  rowCount: number;
  columnCount: number;
  columns: ColumnMeta[];
  storageStrategy: StorageStrategy;
  tableName?: string;
  sampleRows: Record<string, any>[];
  quickInsights: QuickInsightConfig[];
  status: UploadStatus;
  expiresAt?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  /** Only present on upload response */
  piiWarnings?: string[];
}

// ============================================================================
// Hook
// ============================================================================

export function useResearchUploads(tenantId?: string | null) {
  const [uploads, setUploads] = useState<ResearchUpload[]>([]);
  const [activeUpload, setActiveUpload] = useState<ResearchUpload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";

  // ── List uploads ──
  const listUploads = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.fetchWithAuth(`/api/research/uploads${tenantParam}`);
      if (!res.ok) throw new Error(`Failed to list uploads: ${res.status}`);
      const data: ResearchUpload[] = await res.json();
      setUploads(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantParam]);

  // ── Upload a file ──
  const uploadFile = useCallback(async (file: File): Promise<ResearchUpload | null> => {
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Use XMLHttpRequest for progress tracking
      const upload = await new Promise<ResearchUpload>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const token = localStorage.getItem("auth_token") || sessionStorage.getItem("auth_token") || "";

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Invalid response from server"));
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || `Upload failed: ${xhr.status}`));
            } catch {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

        const apiBase = (window as any).__API_URL__ || "";
        const url = `${apiBase}/api/research/uploads${tenantParam}`;
        xhr.open("POST", url);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(formData);
      });

      setUploads((prev) => [upload, ...prev]);
      setActiveUpload(upload);
      return upload;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [tenantParam]);

  // ── Get single upload ──
  const getUpload = useCallback(async (id: string): Promise<ResearchUpload | null> => {
    try {
      const res = await api.fetchWithAuth(`/api/research/uploads/${id}${tenantParam}`);
      if (!res.ok) throw new Error(`Upload not found: ${res.status}`);
      const data: ResearchUpload = await res.json();
      setActiveUpload(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [tenantParam]);

  // ── Update column metadata ──
  const updateColumns = useCallback(async (
    id: string,
    columns: Partial<ColumnMeta>[]
  ): Promise<ColumnMeta[] | null> => {
    try {
      const res = await api.fetchWithAuth(`/api/research/uploads/${id}/columns${tenantParam}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns }),
      });
      if (!res.ok) throw new Error(`Failed to update columns: ${res.status}`);
      const data = await res.json();

      // Update local state
      setUploads((prev) => prev.map((u) =>
        u.id === id ? { ...u, columns: data.columns } : u
      ));
      setActiveUpload((prev) =>
        prev?.id === id ? { ...prev, columns: data.columns } : prev
      );
      return data.columns;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [tenantParam]);

  // ── Delete upload ──
  const deleteUpload = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await api.fetchWithAuth(`/api/research/uploads/${id}${tenantParam}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete upload: ${res.status}`);
      setUploads((prev) => prev.filter((u) => u.id !== id));
      if (activeUpload?.id === id) setActiveUpload(null);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }, [activeUpload, tenantParam]);

  // ── Attach upload to session ──
  const attachToSession = useCallback(async (
    uploadId: string,
    sessionId: string
  ): Promise<boolean> => {
    try {
      const res = await api.fetchWithAuth(
        `/api/research/uploads/${uploadId}/attach${tenantParam}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }
      );
      if (!res.ok) throw new Error(`Failed to attach upload: ${res.status}`);
      setUploads((prev) => prev.map((u) =>
        u.id === uploadId ? { ...u, sessionId } : u
      ));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }, [tenantParam]);

  return {
    uploads,
    activeUpload,
    setActiveUpload,
    isLoading,
    isUploading,
    uploadProgress,
    error,
    setError,
    listUploads,
    uploadFile,
    getUpload,
    updateColumns,
    deleteUpload,
    attachToSession,
  };
}
