/**
 * Hook for managing global knowledge library
 * Used by platform admins to manage documents that sync to all tenants
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface GlobalDocument {
  id: string;
  title: string;
  filename: string | null;
  file_type: string | null;
  category: string;
  tags: string[];
  version: number;
  status: "draft" | "published" | "archived";
  chunk_count: number;
  token_count: number;
  processing_status: "pending" | "processing" | "completed" | "error";
  processing_error: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_by_email: string | null;
  published_by_email: string | null;
  archived_by_email: string | null;
  content?: string;
}

export interface GlobalCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

export interface SyncResult {
  tenantId: string;
  tenantName?: string;
  success: boolean;
  chunksCreated?: number;
  error?: string;
}

export interface SyncStatus {
  tenantId: string;
  tenantName: string;
  lastSyncedAt: string | null;
  lastAction: string | null;
  lastStatus: string | null;
  syncedVersion: number | null;
}

export function useGlobalKnowledge() {
  const [documents, setDocuments] = useState<GlobalDocument[]>([]);
  const [categories, setCategories] = useState<GlobalCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
  });

  // Fetch documents
  const fetchDocuments = useCallback(
    async (
      params: {
        status?: string;
        category?: string;
        search?: string;
        limit?: number;
        offset?: number;
      } = {}
    ) => {
      try {
        setLoading(true);
        setError(null);

        const queryParams = new URLSearchParams();
        if (params.status) queryParams.append("status", params.status);
        if (params.category) queryParams.append("category", params.category);
        if (params.search) queryParams.append("search", params.search);
        queryParams.append("limit", String(params.limit || 50));
        queryParams.append("offset", String(params.offset || 0));

        const response = await api.request<{
          documents: GlobalDocument[];
          pagination: typeof pagination;
        }>(`/api/admin/global-knowledge?${queryParams.toString()}`);

        setDocuments(response.documents);
        setPagination(response.pagination);
      } catch (err: any) {
        setError(err.message || "Failed to fetch documents");
        console.error("Error fetching global documents:", err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const response = await api.request<{ categories: GlobalCategory[] }>(
        "/api/admin/global-knowledge/categories"
      );
      console.log(
        "[useGlobalKnowledge] Fetched categories:",
        response.categories?.length || 0
      );
      setCategories(response.categories || []);
    } catch (err: any) {
      console.error("[useGlobalKnowledge] Error fetching categories:", err);
      setError("Failed to fetch categories");
    }
  }, []);

  // Get single document
  const getDocument = useCallback(
    async (id: string): Promise<GlobalDocument | null> => {
      try {
        const response = await api.request<{ document: GlobalDocument }>(
          `/api/admin/global-knowledge/${id}`
        );
        return response.document;
      } catch (err: any) {
        console.error("Error fetching document:", err);
        return null;
      }
    },
    []
  );

  // Create document
  const createDocument = useCallback(
    async (data: {
      title: string;
      category: string;
      content?: string;
      tags?: string[];
    }): Promise<GlobalDocument | null> => {
      try {
        const response = await api.request<{ document: GlobalDocument }>(
          "/api/admin/global-knowledge",
          { method: "POST", body: JSON.stringify(data) }
        );
        await fetchDocuments();
        return response.document;
      } catch (err: any) {
        console.error("Error creating document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Upload document
  const uploadDocument = useCallback(
    async (
      file: File,
      metadata: { title?: string; category?: string; tags?: string[] }
    ): Promise<GlobalDocument | null> => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (metadata.title) formData.append("title", metadata.title);
        if (metadata.category) formData.append("category", metadata.category);
        if (metadata.tags)
          formData.append("tags", JSON.stringify(metadata.tags));

        const response = await fetch("/api/admin/global-knowledge/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to upload document");
        }

        const data = await response.json();
        await fetchDocuments();
        return data.document;
      } catch (err: any) {
        console.error("Error uploading document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Update document
  const updateDocument = useCallback(
    async (
      id: string,
      data: Partial<{
        title: string;
        category: string;
        content: string;
        tags: string[];
      }>
    ): Promise<GlobalDocument | null> => {
      try {
        const response = await api.request<{ document: GlobalDocument }>(
          `/api/admin/global-knowledge/${id}`,
          { method: "PUT", body: JSON.stringify(data) }
        );
        await fetchDocuments();
        return response.document;
      } catch (err: any) {
        console.error("Error updating document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Delete document
  const deleteDocument = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.request(`/api/admin/global-knowledge/${id}`, {
          method: "DELETE",
        });
        await fetchDocuments();
        return true;
      } catch (err: any) {
        console.error("Error deleting document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Process document (generate embeddings)
  const processDocument = useCallback(
    async (
      id: string
    ): Promise<{ chunkCount: number; tokenCount: number } | null> => {
      try {
        const response = await api.request<{
          chunkCount: number;
          tokenCount: number;
        }>(`/api/admin/global-knowledge/${id}/process`, { method: "POST" });
        await fetchDocuments();
        return response;
      } catch (err: any) {
        console.error("Error processing document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Publish document
  const publishDocument = useCallback(
    async (
      id: string
    ): Promise<{
      syncResults: {
        total: number;
        success: number;
        failed: number;
        details: SyncResult[];
      };
    } | null> => {
      try {
        const response = await api.request<{
          syncResults: {
            total: number;
            success: number;
            failed: number;
            details: SyncResult[];
          };
        }>(`/api/admin/global-knowledge/${id}/publish`, { method: "POST" });
        await fetchDocuments();
        return response;
      } catch (err: any) {
        console.error("Error publishing document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Archive document
  const archiveDocument = useCallback(
    async (
      id: string,
      reason?: string
    ): Promise<{
      syncResults: {
        total: number;
        success: number;
        failed: number;
        details: SyncResult[];
      };
    } | null> => {
      try {
        const response = await api.request<{
          syncResults: {
            total: number;
            success: number;
            failed: number;
            details: SyncResult[];
          };
        }>(`/api/admin/global-knowledge/${id}/archive`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        await fetchDocuments();
        return response;
      } catch (err: any) {
        console.error("Error archiving document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Restore document
  const restoreDocument = useCallback(
    async (
      id: string
    ): Promise<{
      syncResults: {
        total: number;
        success: number;
        failed: number;
        details: SyncResult[];
      };
    } | null> => {
      try {
        const response = await api.request<{
          syncResults: {
            total: number;
            success: number;
            failed: number;
            details: SyncResult[];
          };
        }>(`/api/admin/global-knowledge/${id}/restore`, { method: "POST" });
        await fetchDocuments();
        return response;
      } catch (err: any) {
        console.error("Error restoring document:", err);
        throw err;
      }
    },
    [fetchDocuments]
  );

  // Get sync status
  const getSyncStatus = useCallback(
    async (id: string): Promise<SyncStatus[]> => {
      try {
        const response = await api.request<{ syncStatus: SyncStatus[] }>(
          `/api/admin/global-knowledge/${id}/sync-status`
        );
        return response.syncStatus;
      } catch (err: any) {
        console.error("Error fetching sync status:", err);
        return [];
      }
    },
    []
  );

  // Resync document
  const resyncDocument = useCallback(
    async (
      id: string
    ): Promise<{
      syncResults: {
        total: number;
        success: number;
        failed: number;
        details: SyncResult[];
      };
    } | null> => {
      try {
        const response = await api.request<{
          syncResults: {
            total: number;
            success: number;
            failed: number;
            details: SyncResult[];
          };
        }>(`/api/admin/global-knowledge/${id}/resync`, { method: "POST" });
        return response;
      } catch (err: any) {
        console.error("Error resyncing document:", err);
        throw err;
      }
    },
    []
  );

  // Initial fetch
  useEffect(() => {
    fetchDocuments();
    fetchCategories();
  }, [fetchDocuments, fetchCategories]);

  return {
    documents,
    categories,
    loading,
    error,
    pagination,
    fetchDocuments,
    fetchCategories,
    getDocument,
    createDocument,
    uploadDocument,
    updateDocument,
    deleteDocument,
    processDocument,
    publishDocument,
    archiveDocument,
    restoreDocument,
    getSyncStatus,
    resyncDocument,
  };
}
