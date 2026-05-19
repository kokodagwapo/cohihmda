/**
 * Persists unified Cohi Chat session state across shell layout remounts
 * (compact / tall / split / full) so in-flight research streams survive resize.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { useCohiChat } from "@/hooks/useCohiChat";

export type CohiChatSessionContextValue = ReturnType<typeof useCohiChat> & {
  chatType: UnifiedChatType;
  setChatType: (type: UnifiedChatType) => void;
  researchDeepAnalysis: boolean;
  setResearchDeepAnalysis: (enabled: boolean) => void;
};

const CohiChatSessionContext =
  createContext<CohiChatSessionContextValue | null>(null);

export function CohiChatSessionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || user?.tenant_id || undefined;
  const unified = isUnifiedChatClientEnabled();

  const [chatType, setChatType] = useState<UnifiedChatType>("chat");
  const [researchDeepAnalysis, setResearchDeepAnalysis] = useState(false);

  const chat = useCohiChat({
    tenantId,
    enabled: unified && isAuthenticated,
    chatType,
    researchDeepAnalysis,
  });

  const value = useMemo(
    () => ({
      ...chat,
      chatType,
      setChatType,
      researchDeepAnalysis,
      setResearchDeepAnalysis,
    }),
    [chat, chatType, researchDeepAnalysis],
  );

  if (!unified) {
    return <>{children}</>;
  }

  return (
    <CohiChatSessionContext.Provider value={value}>
      {children}
    </CohiChatSessionContext.Provider>
  );
}

export function useCohiChatSession(): CohiChatSessionContextValue {
  const ctx = useContext(CohiChatSessionContext);
  if (!ctx) {
    throw new Error("useCohiChatSession requires CohiChatSessionProvider");
  }
  return ctx;
}

export function useOptionalCohiChatSession(): CohiChatSessionContextValue | null {
  return useContext(CohiChatSessionContext);
}
