import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export const useRAGSettings = () => {
  const { toast } = useToast();
  const [ragVoiceSettings, setRagVoiceSettings] = useState<any>(null);
  const [ragVoiceCosts, setRagVoiceCosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRagVoiceData = useCallback(
    async (useCache: boolean = true, tenantId?: string | null) => {
      // Check cache first if enabled (only if not switching tenants)
      if (useCache && !tenantId) {
        const cacheKey = "rag_voice_data_cache";
        const cacheTimestampKey = "rag_voice_data_cache_timestamp";
        const cacheTTL = 2 * 60 * 1000; // 2 minutes

        const cached = sessionStorage.getItem(cacheKey);
        const cacheTimestamp = sessionStorage.getItem(cacheTimestampKey);
        const now = Date.now();

        if (
          cached &&
          cacheTimestamp &&
          now - parseInt(cacheTimestamp) < cacheTTL
        ) {
          try {
            const cachedData = JSON.parse(cached);
            setRagVoiceSettings(cachedData.settings || {});
            setRagVoiceCosts(cachedData.costs || []);
            // Still fetch in background to update cache
            loadRagVoiceData(false).catch(() => {});
            return;
          } catch (e) {
            // Cache corrupted, clear it
            sessionStorage.removeItem(cacheKey);
            sessionStorage.removeItem(cacheTimestampKey);
          }
        }
      }

      setLoading(true);
      try {
        setError(null);
        const params = new URLSearchParams();
        if (tenantId) {
          params.append("tenant_id", tenantId);
        }

        const [settingsData, costsData] = await Promise.all([
          api.request<{ settings: any }>(
            `/api/rag/settings${
              params.toString() ? "?" + params.toString() : ""
            }`
          ),
          api.request<{ costs: any[] }>(
            `/api/rag/costs${params.toString() ? "?" + params.toString() : ""}`
          ),
        ]);

        setRagVoiceSettings(settingsData.settings || {});
        setRagVoiceCosts(costsData.costs || []);

        // Cache the data
        if (!tenantId) {
          const cacheKey = "rag_voice_data_cache";
          const cacheTimestampKey = "rag_voice_data_cache_timestamp";
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({
              settings: settingsData.settings,
              costs: costsData.costs,
            })
          );
          sessionStorage.setItem(cacheTimestampKey, Date.now().toString());
        }
      } catch (error: any) {
        console.error("Error loading RAG/Voice data:", error);
        setError(error.message || "Failed to load RAG/Voice settings");
        toast({
          title: "Error",
          description: error.message || "Failed to load RAG/Voice settings.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  const saveRagVoiceSettings = useCallback(
    async (settings: any) => {
      try {
        await api.request("/api/rag/settings", {
          method: "PUT",
          body: JSON.stringify(settings),
        });
        toast({
          title: "Success",
          description: "RAG/Voice settings saved successfully.",
        });
        // Clear cache and reload
        sessionStorage.removeItem("rag_voice_data_cache");
        sessionStorage.removeItem("rag_voice_data_cache_timestamp");
        await loadRagVoiceData(false);
      } catch (error: any) {
        console.error("Error saving RAG/Voice settings:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to save RAG/Voice settings.",
          variant: "destructive",
        });
        throw error;
      }
    },
    [loadRagVoiceData, toast]
  );

  const saveApiKeys = useCallback(
    async (openaiKey: string, geminiKey: string, tenantId?: string | null) => {
      try {
        const params = new URLSearchParams();
        if (tenantId) {
          params.append("tenant_id", tenantId);
        }

        // API keys are saved via the main settings endpoint
        await api.request(
          `/api/rag/settings${
            params.toString() ? "?" + params.toString() : ""
          }`,
          {
            method: "PUT",
            body: JSON.stringify({
              openai_api_key: openaiKey,
              gemini_api_key: geminiKey,
            }),
          }
        );
        toast({
          title: "Success",
          description: "API keys saved successfully.",
        });
        // Clear cache and reload
        sessionStorage.removeItem("rag_voice_data_cache");
        sessionStorage.removeItem("rag_voice_data_cache_timestamp");
      } catch (error: any) {
        console.error("Error saving API keys:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to save API keys.",
          variant: "destructive",
        });
        throw error;
      }
    },
    [toast]
  );

  return {
    ragVoiceSettings,
    ragVoiceCosts,
    loading,
    error,
    loadRagVoiceData,
    saveRagVoiceSettings,
    saveApiKeys,
  };
};
