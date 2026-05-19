/**
 * Load allowed chat types from GET /api/chat/v1/permissions (COHI-406).
 */

import { useEffect, useState } from "react";
import {
  createUnifiedChatClient,
  type UnifiedChatType,
} from "@/lib/unifiedChatClient";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";

const DEFAULT_TYPES: UnifiedChatType[] = [
  "chat",
  "research",
  "insight_builder",
  "workbench",
];

export function useUnifiedChatPermissions(tenantId?: string) {
  const [allowedTypes, setAllowedTypes] =
    useState<UnifiedChatType[]>(DEFAULT_TYPES);

  useEffect(() => {
    if (!isUnifiedChatClientEnabled()) {
      setAllowedTypes(DEFAULT_TYPES);
      return;
    }
    let cancelled = false;
    void createUnifiedChatClient(tenantId)
      .getPermissions()
      .then((p) => {
        if (cancelled) return;
        const types = p.chatTypes?.filter((t): t is UnifiedChatType =>
          DEFAULT_TYPES.includes(t as UnifiedChatType),
        );
        setAllowedTypes(types?.length ? types : DEFAULT_TYPES);
      })
      .catch(() => {
        if (!cancelled) setAllowedTypes(DEFAULT_TYPES);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return allowedTypes;
}
