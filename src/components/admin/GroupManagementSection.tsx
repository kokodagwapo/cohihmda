import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Folder, Plus, MoreHorizontal, Trash2, Edit2, Users, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";

type Group = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  member_count?: number;
};

type GroupMember = {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
};

function tenantQs(tenantId: string | null): string {
  return tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
}

export function GroupManagementSection() {
  const { toast } = useToast();
  const { selectedTenantId } = useAdminTenant();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [membersGroup, setMembersGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!selectedTenantId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.request<{ groups: Group[] }>(`/api/groups${tenantQs(selectedTenantId)}`);
      setGroups(res?.groups ?? []);
    } catch {
      setGroups([]);
      toast({ title: "Failed to load groups", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId, toast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const fetchMembers = useCallback(
    async (groupId: string) => {
      setMembersLoading(true);
      try {
        const res = await api.request<{ members: GroupMember[] }>(
          `/api/groups/${groupId}/members${tenantQs(selectedTenantId)}`
        );
        setMembers(res?.members ?? []);
      } catch {
        setMembers([]);
      } finally {
        setMembersLoading(false);
      }
    },
    [selectedTenantId]
  );

  useEffect(() => {
    if (membersGroup) fetchMembers(membersGroup.id);
  }, [membersGroup?.id, fetchMembers]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.request(`/api/groups${tenantQs(selectedTenantId)}`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || undefined }),
      });
      toast({ title: "Group created" });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
      fetchGroups();
    } catch (e: any) {
      toast({ title: e?.message || "Failed to create group", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editGroup || !newName.trim()) return;
    setSaving(true);
    try {
      await api.request(`/api/groups/${editGroup.id}${tenantQs(selectedTenantId)}`, {
        method: "PUT",
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || undefined }),
      });
      toast({ title: "Group updated" });
      setEditGroup(null);
      setNewName("");
      setNewDescription("");
      fetchGroups();
    } catch (e: any) {
      toast({ title: e?.message || "Failed to update group", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: Group) => {
    if (!confirm(`Delete group "${group.name}"? This will remove it from all canvas shares.`)) return;
    try {
      await api.request(`/api/groups/${group.id}${tenantQs(selectedTenantId)}`, { method: "DELETE" });
      toast({ title: "Group deleted" });
      if (membersGroup?.id === group.id) setMembersGroup(null);
      fetchGroups();
    } catch {
      toast({ title: "Failed to delete group", variant: "destructive" });
    }
  };

  const openEdit = (g: Group) => {
    setEditGroup(g);
    setNewName(g.name);
    setNewDescription(g.description ?? "");
  };

  if (!selectedTenantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Groups
          </CardTitle>
          <CardDescription>Select a tenant to manage user groups for canvas sharing.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5" />
              Groups
            </CardTitle>
            <CardDescription>
              Create groups and add members. Use groups when sharing canvases to grant access to multiple users at once.
            </CardDescription>
          </div>
          <Button onClick={() => { setCreateOpen(true); setNewName(""); setNewDescription(""); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add group
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
              No groups yet. Create a group to share canvases with multiple users at once.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-slate-500">{g.description || "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => setMembersGroup(g)}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {g.member_count ?? 0}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(g)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMembersGroup(g)}>
                            <Users className="h-4 w-4 mr-2" />
                            Manage members
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => handleDelete(g)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Create a group to share canvases with multiple users at once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Sales Team"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-desc">Description (optional)</Label>
              <Input
                id="create-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editGroup} onOpenChange={(open) => !open && setEditGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name" />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving || !newName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members dialog - simplified: just list members. Add/remove could be a follow-up. */}
      <Dialog open={!!membersGroup} onOpenChange={(open) => !open && setMembersGroup(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{membersGroup?.name} – Members</DialogTitle>
            <DialogDescription>
              {membersLoading ? "Loading…" : `${members.length} member(s). Add or remove users in a future update.`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[240px] overflow-y-auto">
            {membersLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <ul className="space-y-1.5">
                {members.map((m) => (
                  <li key={m.id} className="text-sm text-slate-700 dark:text-slate-300">
                    {m.full_name || m.email}
                    {m.full_name && <span className="text-slate-500 ml-1">({m.email})</span>}
                  </li>
                ))}
                {members.length === 0 && !membersLoading && (
                  <li className="text-slate-500 text-sm">No members in this group.</li>
                )}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
