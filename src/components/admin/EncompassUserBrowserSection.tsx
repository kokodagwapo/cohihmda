/**
 * Encompass User Browser Section
 * Allows admins to browse, sync, and invite Encompass users to Cohi
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Search,
  UserPlus,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Link2,
  Unlink,
  Mail,
  KeyRound,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface EncompassUser {
  id: string;
  los_connection_id: string;
  encompass_user_id: string;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  user_indicators: string[];
  is_enabled: boolean;
  cohi_user_id?: string;
  encompass_last_login?: string | null;
  last_synced_at: string;
}

interface LOSConnection {
  id: string;
  name: string;
  connection_type: string;
}

interface SyncHistory {
  id: string;
  status: string;
  users_fetched: number;
  users_added: number;
  users_updated: number;
  users_disabled: number;
  error_message?: string;
  duration_ms: number;
  started_at: string;
  completed_at?: string;
}

interface GroupOption {
  id: string;
  name: string;
}

/** Response from GET /api/admin/encompass-users/actor-reconciliation-summary */
interface LoanActorReportingCoverage {
  actorColumn: string;
  distinctLoanActors: number;
  totalActors: number;
  matchedActors: number;
  unmatchedActors: number;
  activeActors: number;
  inactiveActors: number;
  removedActors?: number;
  unknownActors: number;
}

interface EncompassUserBrowserSectionProps {
  losConnections: LOSConnection[];
  selectedConnectionId?: string;
  onConnectionChange?: (connectionId: string) => void;
}

function formatEncompassLastLogin(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EncompassUserBrowserSection({
  losConnections,
  selectedConnectionId,
  onConnectionChange,
}: EncompassUserBrowserSectionProps) {
  const { toast } = useToast();
  const { selectedTenantId, isPlatformAdmin } = useAdminTenant();
  const [connectionId, setConnectionId] = useState(selectedConnectionId || "");
  const [users, setUsers] = useState<EncompassUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(true);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);

  // Invite dialog state
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteUser, setInviteUser] = useState<EncompassUser | null>(null);
  const [invitePersona, setInvitePersona] = useState<"tenant_admin" | "tenant_user" | "tenant_canvas_only_user">("tenant_user");
  const [inviteMethod, setInviteMethod] = useState<"email" | "sso_only" | "manual">(
    "manual", // Default to manual for dev convenience
  );
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteGroupIds, setInviteGroupIds] = useState<string[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  // Bulk invite: shared profile/method and groups
  const [bulkInvitePersona, setBulkInvitePersona] = useState<"tenant_admin" | "tenant_user" | "tenant_canvas_only_user">("tenant_user");
  const [bulkInviteGroupIds, setBulkInviteGroupIds] = useState<string[]>([]);

  // Groups for invite dropdowns (tenant-scoped)
  const [groups, setGroups] = useState<GroupOption[]>([]);

  // Loan access sync state
  const [syncingLoanAccessUserId, setSyncingLoanAccessUserId] = useState<string | null>(null);

  const [actorReconciliation, setActorReconciliation] =
    useState<LoanActorReportingCoverage | null>(null);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    if (!connectionId) return;

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        los_connection_id: connectionId,
        enabled_only: enabledOnly.toString(),
        unlinked_only: unlinkedOnly.toString(),
        page: page.toString(),
        limit: limit.toString(),
      });

      if (search) {
        params.append("search", search);
      }
      
      // For platform admins, pass the selected tenant ID
      if (isPlatformAdmin && selectedTenantId) {
        params.append("tenant_id", selectedTenantId);
      }

      const data = await api.request<{ users?: EncompassUser[]; total?: number }>(
        `/api/admin/encompass-users?${params.toString()}`
      );
      setUsers(data.users || []);
      setTotalUsers(data.total || 0);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to fetch Encompass users",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, search, enabledOnly, unlinkedOnly, page, limit, toast, isPlatformAdmin, selectedTenantId]);

  // Fetch sync history
  const fetchSyncHistory = useCallback(async () => {
    if (!connectionId) return;

    try {
      const params = new URLSearchParams({
        los_connection_id: connectionId,
        limit: "5",
      });
      
      if (isPlatformAdmin && selectedTenantId) {
        params.append("tenant_id", selectedTenantId);
      }
      
      const data = await api.request<{ history?: SyncHistory[] }>(
        `/api/admin/encompass-users/sync-history?${params.toString()}`
      );
      setSyncHistory(data.history || []);
    } catch (error) {
      // Non-critical, silently fail
    }
  }, [connectionId, isPlatformAdmin, selectedTenantId]);

  // Fetch groups for invite (tenant-scoped)
  const fetchGroups = useCallback(async () => {
    if (!selectedTenantId) {
      setGroups([]);
      return;
    }
    try {
      const data = await api.request<{ groups?: GroupOption[] }>(
        `/api/groups?tenant_id=${encodeURIComponent(selectedTenantId)}`
      );
      setGroups(data?.groups ?? []);
    } catch {
      setGroups([]);
    }
  }, [selectedTenantId]);

  // Initial fetch
  useEffect(() => {
    fetchUsers();
    fetchSyncHistory();
  }, [fetchUsers, fetchSyncHistory]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    let cancelled = false;
    const loadReconciliation = async () => {
      if (isPlatformAdmin && !selectedTenantId) {
        setActorReconciliation(null);
        return;
      }
      try {
        const params = new URLSearchParams();
        if (isPlatformAdmin && selectedTenantId) {
          params.set("tenant_id", selectedTenantId);
        }
        const qs = params.toString();
        const url = qs
          ? `/api/admin/encompass-users/actor-reconciliation-summary?${qs}`
          : `/api/admin/encompass-users/actor-reconciliation-summary`;
        const data = await api.request<LoanActorReportingCoverage>(url);
        if (!cancelled) setActorReconciliation(data);
      } catch {
        if (!cancelled) setActorReconciliation(null);
      }
    };
    void loadReconciliation();
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin, selectedTenantId]);

  // Sync users from Encompass
  const handleSync = async () => {
    if (!connectionId) return;

    setIsSyncing(true);
    try {
      const body: Record<string, string> = { los_connection_id: connectionId };
      
      // For platform admins, include tenant_id
      if (isPlatformAdmin && selectedTenantId) {
        body.tenant_id = selectedTenantId;
      }
      
      const data = await api.request<{
        users_fetched: number;
        users_added: number;
        users_updated: number;
      }>("/api/admin/encompass-users/sync", {
        method: "POST",
        body: JSON.stringify(body),
      });

      toast({
        title: "Sync Complete",
        description: `Fetched ${data.users_fetched} users. Added: ${data.users_added}, Updated: ${data.users_updated}`,
      });

      // Refresh data
      fetchUsers();
      fetchSyncHistory();
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Invite single user
  const handleInvite = async () => {
    if (!inviteUser || !connectionId) return;

    // Validate password for manual method
    if (inviteMethod === "manual" && invitePassword.length < 8) {
      toast({
        title: "Password Required",
        description: "Password must be at least 8 characters for manual invite",
        variant: "destructive",
      });
      return;
    }

    setIsInviting(true);
    try {
      const requestBody: Record<string, unknown> = {
        los_connection_id: connectionId,
        persona: invitePersona,
        invite_method: inviteMethod,
        group_ids: inviteGroupIds.length > 0 ? inviteGroupIds : undefined,
      };

      // Include password for manual invites
      if (inviteMethod === "manual" && invitePassword) {
        requestBody.password = invitePassword;
      }
      
      // For platform admins, include tenant_id
      if (isPlatformAdmin && selectedTenantId) {
        requestBody.tenant_id = selectedTenantId;
      }

      const data = await api.request<{ invite_sent?: boolean }>(
        `/api/admin/encompass-users/${inviteUser.encompass_user_id}/invite`,
        {
          method: "POST",
          body: JSON.stringify(requestBody),
        },
      );

      toast({
        title: "User Invited",
        description: inviteMethod === "manual"
          ? `User account created. They can log in with email: ${inviteUser.email}`
          : data.invite_sent
          ? `Invitation email sent to ${inviteUser.email}`
          : `User account created successfully`,
      });

      setInviteDialogOpen(false);
      setInviteUser(null);
      setInvitePassword("");
      setInvitePersona("tenant_user");
      setInviteGroupIds([]);
      fetchUsers();
    } catch (error: any) {
      toast({
        title: "Invite Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsInviting(false);
    }
  };

  // Bulk invite
  const handleBulkInvite = async () => {
    if (selectedUsers.size === 0 || !connectionId) return;

    setIsInviting(true);
    try {
      const body: Record<string, unknown> = {
        los_connection_id: connectionId,
        encompass_user_ids: Array.from(selectedUsers),
        persona: bulkInvitePersona,
        invite_method: inviteMethod,
        group_ids: bulkInviteGroupIds.length > 0 ? bulkInviteGroupIds : undefined,
      };
      
      // For platform admins, include tenant_id
      if (isPlatformAdmin && selectedTenantId) {
        body.tenant_id = selectedTenantId;
      }
      
      const data = await api.request<{ success_count: number; failed_count: number }>(
        "/api/admin/encompass-users/bulk-invite",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      toast({
        title: "Bulk Invite Complete",
        description: `Successfully invited ${data.success_count} of ${selectedUsers.size} users`,
        variant: data.failed_count > 0 ? "destructive" : "default",
      });

      setSelectedUsers(new Set());
      fetchUsers();
    } catch (error: any) {
      toast({
        title: "Bulk Invite Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsInviting(false);
    }
  };

  // Toggle user selection
  const toggleUserSelection = (userId: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  // Select all visible unlinked users
  const selectAllUnlinked = () => {
    const unlinked = users
      .filter((u) => !u.cohi_user_id)
      .map((u) => u.encompass_user_id);
    setSelectedUsers(new Set(unlinked));
  };

  const totalPages = Math.ceil(totalUsers / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Encompass Directory
              </CardTitle>
              <CardDescription>
                Browse and invite Encompass users to create Cohi accounts
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={connectionId}
                onValueChange={(value) => {
                  setConnectionId(value);
                  onConnectionChange?.(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select LOS Connection" />
                </SelectTrigger>
                <SelectContent>
                  {losConnections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={!connectionId || isSyncing}
              >
                <RefreshCw
                  className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")}
                />
                {isSyncing ? "Syncing..." : "Sync Users"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Sync History */}
          {syncHistory.length > 0 && (
            <div className="mb-4 text-sm text-muted-foreground">
              Last sync: {new Date(syncHistory[0].started_at).toLocaleString()}{" "}
              -
              {syncHistory[0].status === "completed" ? (
                <span className="text-green-600">
                  {" "}
                  {syncHistory[0].users_fetched} users
                </span>
              ) : (
                <span className="text-red-600"> Failed</span>
              )}
            </div>
          )}

          {actorReconciliation && actorReconciliation.distinctLoanActors > 0 && (
            <Alert
              className="mb-4"
              data-testid="actor-reconciliation-summary"
            >
              <Link2 className="h-4 w-4" />
              <AlertTitle>Reporting actor coverage</AlertTitle>
              <AlertDescription className="text-sm">
                {actorReconciliation.matchedActors} of{" "}
                {actorReconciliation.distinctLoanActors} distinct{" "}
                {actorReconciliation.actorColumn === "account_executive"
                  ? "account executives"
                  : "loan officers"}{" "}
                on loans matched an Encompass user;{" "}
                {actorReconciliation.unmatchedActors} unmatched. Status mix on
                loan actors: {actorReconciliation.activeActors} active,{" "}
                {actorReconciliation.inactiveActors} inactive,{" "}
                {actorReconciliation.removedActors ?? 0} removed,{" "}
                {actorReconciliation.unknownActors} unknown.
              </AlertDescription>
            </Alert>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or username..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="enabledOnly"
                  checked={enabledOnly}
                  onCheckedChange={(checked) => {
                    setEnabledOnly(checked === true);
                    setPage(1);
                  }}
                />
                <Label htmlFor="enabledOnly" className="text-sm">
                  Enabled only
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="unlinkedOnly"
                  checked={unlinkedOnly}
                  onCheckedChange={(checked) => {
                    setUnlinkedOnly(checked === true);
                    setPage(1);
                  }}
                />
                <Label htmlFor="unlinkedOnly" className="text-sm">
                  Unlinked only
                </Label>
              </div>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedUsers.size > 0 && (
            <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <span className="text-sm font-medium">
                {selectedUsers.size} user{selectedUsers.size > 1 ? "s" : ""}{" "}
                selected
              </span>
              <Select value={bulkInvitePersona} onValueChange={(v) => setBulkInvitePersona(v as any)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant_user">Full user</SelectItem>
                  <SelectItem value="tenant_admin">Tenant admin</SelectItem>
                  <SelectItem value="tenant_canvas_only_user">Canvas-only user</SelectItem>
                </SelectContent>
              </Select>
              {groups.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Label className="text-sm whitespace-nowrap">Groups:</Label>
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-1">
                      <Checkbox
                        id={`bulk-group-${g.id}`}
                        checked={bulkInviteGroupIds.includes(g.id)}
                        onCheckedChange={(checked) => {
                          setBulkInviteGroupIds((prev) =>
                            checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                          );
                        }}
                      />
                      <label htmlFor={`bulk-group-${g.id}`} className="text-sm cursor-pointer whitespace-nowrap">
                        {g.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <Button onClick={handleBulkInvite} disabled={isInviting}>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite Selected
              </Button>
              <Button
                variant="ghost"
                onClick={() => setSelectedUsers(new Set())}
              >
                Clear Selection
              </Button>
            </div>
          )}

          {/* User Table */}
          {!connectionId ? (
            <div className="text-center py-8 text-muted-foreground">
              Select an LOS connection to view Encompass users
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No users found. Try syncing users from Encompass.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={
                          selectedUsers.size ===
                            users.filter((u) => !u.cohi_user_id).length &&
                          users.filter((u) => !u.cohi_user_id).length > 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            selectAllUnlinked();
                          } else {
                            setSelectedUsers(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Linked</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUsers.has(user.encompass_user_id)}
                          disabled={!!user.cohi_user_id}
                          onCheckedChange={() =>
                            toggleUserSelection(user.encompass_user_id)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {user.full_name ||
                          `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                          user.username}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.username}
                      </TableCell>
                      <TableCell>
                        {user.is_enabled ? (
                          <Badge
                            variant="outline"
                            className="bg-green-50 text-green-700 border-green-200"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Enabled
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-gray-50 text-gray-700 border-gray-200"
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatEncompassLastLogin(user.encompass_last_login)}
                      </TableCell>
                      <TableCell>
                        {user.cohi_user_id ? (
                          <Badge
                            variant="outline"
                            className="bg-blue-50 text-blue-700 border-blue-200"
                          >
                            <Link2 className="h-3 w-3 mr-1" />
                            Linked
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200"
                          >
                            <Unlink className="h-3 w-3 mr-1" />
                            Not Linked
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!user.cohi_user_id && user.email && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setInviteUser(user);
                              setInviteDialogOpen(true);
                            }}
                          >
                            <UserPlus className="h-4 w-4 mr-1" />
                            Invite
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {(page - 1) * limit + 1} to{" "}
                  {Math.min(page * limit, totalUsers)} of {totalUsers} users
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User to Cohi</DialogTitle>
            <DialogDescription>
              Send an invitation to {inviteUser?.full_name || inviteUser?.email}{" "}
              to join Cohi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Name</Label>
              <div className="col-span-3 font-medium">
                {inviteUser?.full_name ||
                  `${inviteUser?.first_name || ""} ${inviteUser?.last_name || ""}`.trim()}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Email</Label>
              <div className="col-span-3">{inviteUser?.email}</div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">User Type</Label>
              <Select value={invitePersona} onValueChange={(v) => setInvitePersona(v as any)}>
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant_user">Full user</SelectItem>
                  <SelectItem value="tenant_admin">Tenant admin</SelectItem>
                  <SelectItem value="tenant_canvas_only_user">Canvas-only user</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Method</Label>
              <div className="col-span-3 flex flex-wrap gap-2">
                <Button
                  variant={inviteMethod === "manual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInviteMethod("manual")}
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  Set Password
                </Button>
                <Button
                  variant={inviteMethod === "email" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInviteMethod("email")}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Email Invite
                </Button>
                <Button
                  variant={inviteMethod === "sso_only" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInviteMethod("sso_only")}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  SSO Only
                </Button>
              </div>
            </div>
            {groups.length > 0 && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Groups</Label>
                <div className="col-span-3 space-y-2 max-h-32 overflow-y-auto rounded-md border p-2">
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`invite-group-${g.id}`}
                        checked={inviteGroupIds.includes(g.id)}
                        onCheckedChange={(checked) => {
                          setInviteGroupIds((prev) =>
                            checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                          );
                        }}
                      />
                      <label htmlFor={`invite-group-${g.id}`} className="text-sm cursor-pointer">
                        {g.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {inviteMethod === "manual" && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Password</Label>
                <Input
                  type="password"
                  placeholder="Enter password (min 8 chars)"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  className="col-span-3"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={isInviting}>
              {isInviting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Send Invite
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EncompassUserBrowserSection;
