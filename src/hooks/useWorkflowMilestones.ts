import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface WorkflowMilestoneOption {
  id: string;
  label: string;
  column: string;
}

interface WorkflowMilestonesResponse {
  milestones: WorkflowMilestoneOption[];
}

export function useWorkflowMilestones(selectedTenantId?: string | null): {
  milestones: WorkflowMilestoneOption[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [milestones, setMilestones] = useState<WorkflowMilestoneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMilestones = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      const url = `/api/dashboard/workflow-conversion/milestones${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await api.request<WorkflowMilestonesResponse>(url);
      setMilestones(res.milestones ?? []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load workflow milestones";
      setError(message);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  return { milestones, loading, error, refetch: fetchMilestones };
}
