/**
 * UserSharePicker
 *
 * Reusable visibility selector + user list for in-app sharing.
 * Used by Workbench canvas and Research session sharing.
 */

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTenantStore } from "@/stores/tenantStore";

export interface TenantUser {
  id: string;
  email: string;
  full_name: string | null;
  role?: string;
}

export interface UserSharePickerProps {
  visibility: string;
  sharedWithUserIds: string[];
  onVisibilityChange: (visibility: "private" | "shared" | "global") => void;
  onSharedWithUserIdsChange: (ids: string[]) => void;
  /** Optional: use a different endpoint (e.g. for research). Default: workbench tenant-users */
  tenantUsersEndpoint?: string;
  /** When true, shows a "Global" option visible to all tenant users. Requires admin role. */
  allowGlobal?: boolean;
}

export function UserSharePicker({
  visibility,
  sharedWithUserIds,
  onVisibilityChange,
  onSharedWithUserIdsChange,
  tenantUsersEndpoint,
  allowGlobal,
}: UserSharePickerProps) {
  const effectiveTenantId = useTenantStore((s) => s.effectiveTenantId);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  const endpoint = tenantUsersEndpoint ?? "/api/workbench/canvases/tenant-users";
  const tenantQs = effectiveTenantId ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.request<{ users: TenantUser[] }>(`${endpoint}${tenantQs}`);
        if (!cancelled) {
          setTenantUsers(res?.users ?? []);
        }
      } catch {
        if (!cancelled) setTenantUsers([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint, tenantQs]);

  const toggleUser = (userId: string) => {
    if (sharedWithUserIds.includes(userId)) {
      onSharedWithUserIdsChange(sharedWithUserIds.filter((id) => id !== userId));
    } else {
      onSharedWithUserIdsChange([...sharedWithUserIds, userId]);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Visibility</label>
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => onVisibilityChange("private")}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              visibility === "private"
                ? "bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-slate-100"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            Private
          </button>
          <button
            type="button"
            onClick={() => onVisibilityChange("shared")}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              visibility === "shared"
                ? "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
            )}
          >
            Shared
          </button>
          {allowGlobal && (
            <button
              type="button"
              onClick={() => onVisibilityChange("global")}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                visibility === "global"
                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700",
              )}
            >
              Global
            </button>
          )}
        </div>
      </div>

      {visibility === "global" && (
        <p className="text-xs text-amber-600 dark:text-amber-400 py-1">
          All users in this tenant will be able to view this session.
        </p>
      )}

      {visibility === "shared" && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Share with</label>
          {loaded && tenantUsers.length > 0 ? (
            <div className="max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {tenantUsers.map((u) => {
                const selected = sharedWithUserIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-violet-50 dark:bg-violet-900/20"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                    )}
                    onClick={() => toggleUser(u.id)}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        selected
                          ? "bg-violet-600 border-violet-600 text-white"
                          : "border-slate-300 dark:border-slate-600",
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0 truncate">
                      <span className="text-slate-700 dark:text-slate-200">
                        {u.full_name || u.email}
                      </span>
                      {u.full_name && (
                        <span className="ml-1.5 text-xs text-slate-400">{u.email}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
              {loaded ? "No users found in this tenant." : "Loading users…"}
            </p>
          )}
          {sharedWithUserIds.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {sharedWithUserIds.length} user{sharedWithUserIds.length !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}
