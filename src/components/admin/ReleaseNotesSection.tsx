import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Loader2,
  Sparkles,
  Trash2,
  Send,
  Upload,
  Pencil,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

type ReleaseNoteCategory = "feature" | "improvement" | "fix";

type ReleaseNoteListItem = {
  id: string;
  version: string;
  title: string;
  is_draft: boolean;
  published_at: string | null;
  email_sent_at: string | null;
  entry_count: number;
};

type ReleaseNoteEntry = {
  id?: string;
  title: string;
  description: string;
  category: ReleaseNoteCategory;
  link?: string | null;
  linkLabel?: string | null;
  sortOrder: number;
};

type ReleaseNoteDetail = {
  id: string;
  version: string;
  title: string;
  is_draft: boolean;
  published_at: string | null;
  email_sent_at: string | null;
};

const categoryLabel: Record<ReleaseNoteCategory, string> = {
  feature: "New",
  improvement: "Improved",
  fix: "Fixed",
};

const newEntry = (): ReleaseNoteEntry => ({
  title: "",
  description: "",
  category: "improvement",
  link: "",
  linkLabel: "",
  sortOrder: 0,
});

function sortEntries(entries: ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return entries
    .map((entry, idx) => ({ ...entry, sortOrder: idx }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function ReleaseNotesSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ReleaseNoteListItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    version: "",
    title: "",
    entries: [newEntry()],
  });

  const groupedPreview = useMemo(() => {
    const groups: Record<ReleaseNoteCategory, ReleaseNoteEntry[]> = {
      feature: [],
      improvement: [],
      fix: [],
    };
    for (const entry of form.entries) {
      groups[entry.category].push(entry);
    }
    return groups;
  }, [form.entries]);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const result = await api.request<{ notes: ReleaseNoteListItem[] }>(
        "/api/admin/release-notes",
      );
      setItems(result.notes || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load release notes.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNotes();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      version: "",
      title: "",
      entries: [newEntry()],
    });
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    setLoading(true);
    try {
      const result = await api.request<{
        note: ReleaseNoteDetail;
        entries: Array<{
          id: string;
          title: string;
          description: string;
          category: ReleaseNoteCategory;
          link: string | null;
          linkLabel?: string | null;
          link_label?: string | null;
          sortOrder?: number;
          sort_order?: number;
        }>;
      }>(`/api/admin/release-notes/${id}`);
      setForm({
        version: result.note.version,
        title: result.note.title,
        entries: sortEntries(
          (result.entries || []).map((entry, idx) => ({
            id: entry.id,
            title: entry.title,
            description: entry.description,
            category: entry.category,
            link: entry.link || "",
            linkLabel: entry.linkLabel ?? entry.link_label ?? "",
            sortOrder: entry.sortOrder ?? entry.sort_order ?? idx,
          })),
        ),
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load release note.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateEntry = (
    index: number,
    field: keyof ReleaseNoteEntry,
    value: string,
  ) => {
    setForm((prev) => {
      const next = [...prev.entries];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, entries: next };
    });
  };

  const moveEntry = (index: number, dir: -1 | 1) => {
    setForm((prev) => {
      const next = [...prev.entries];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const current = next[index];
      next[index] = next[target];
      next[target] = current;
      return { ...prev, entries: sortEntries(next) };
    });
  };

  const removeEntry = (index: number) => {
    setForm((prev) => {
      const next = prev.entries.filter((_, idx) => idx !== index);
      return { ...prev, entries: next.length ? sortEntries(next) : [newEntry()] };
    });
  };

  const addEntry = () => {
    setForm((prev) => ({
      ...prev,
      entries: sortEntries([...prev.entries, newEntry()]),
    }));
  };

  const save = async () => {
    const cleanEntries = form.entries
      .map((entry, idx) => ({
        ...entry,
        title: entry.title.trim(),
        description: entry.description.trim(),
        link: (entry.link || "").trim(),
        linkLabel: (entry.linkLabel || "").trim(),
        sortOrder: idx,
      }))
      .filter((entry) => entry.title && entry.description);

    if (!form.version.trim() || !form.title.trim()) {
      toast({
        title: "Validation",
        description: "Version and title are required.",
        variant: "destructive",
      });
      return;
    }

    if (cleanEntries.length === 0) {
      toast({
        title: "Validation",
        description: "Add at least one valid release note entry.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        version: form.version.trim(),
        title: form.title.trim(),
        entries: cleanEntries,
      };
      if (editingId) {
        await api.request(`/api/admin/release-notes/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api.request(`/api/admin/release-notes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      toast({
        title: "Saved",
        description: "Release note saved successfully.",
      });
      setDialogOpen(false);
      await loadNotes();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save release note.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const generateDraft = async () => {
    setGenerating(true);
    try {
      const result = await api.request<{
        entries: Array<{
          title: string;
          description: string;
          category: ReleaseNoteCategory;
        }>;
        warning?: string | null;
        aiGrounded?: boolean;
      }>("/api/admin/release-notes/generate-draft", { method: "POST", body: "{}" });
      const generated = (result.entries || []).map((entry, idx) => ({
        ...entry,
        sortOrder: idx,
      }));
      if (generated.length > 0) {
        setForm((prev) => ({ ...prev, entries: generated }));
      }
      toast({
        title: "Draft generated",
        description:
          generated.length > 0
            ? result.aiGrounded === false
              ? result.warning || "Commit-based draft generated. Review before publishing."
              : "AI draft populated. Review before publishing."
            : "No qualifying commits found for the selected range.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate draft.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const publish = async (id: string) => {
    if (!window.confirm("Publish this release note?")) return;
    try {
      await api.request(`/api/admin/release-notes/${id}/publish`, {
        method: "POST",
        body: "{}",
      });
      toast({ title: "Published", description: "Release note is now published." });
      await loadNotes();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to publish release note.",
        variant: "destructive",
      });
    }
  };

  const sendEmail = async (id: string, resend = false) => {
    if (!window.confirm(resend ? "Resend this release note email now?" : "Send this release note email now?")) return;
    try {
      const result = await api.request<{
        result?: { attempted: number; sent: number; failed: number };
      }>(`/api/admin/release-notes/${id}/send-email`, {
        method: "POST",
        body: JSON.stringify({ forceResend: resend }),
      });
      const stats = result.result;
      toast({
        title: resend ? "Email resend complete" : "Email send complete",
        description: stats
          ? `Attempted ${stats.attempted}, sent ${stats.sent}, failed ${stats.failed}.`
          : "Release note email sent.",
      });
      await loadNotes();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send email.",
        variant: "destructive",
      });
    }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm("Delete this draft release note?")) return;
    try {
      await api.request(`/api/admin/release-notes/${id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: "Draft release note deleted." });
      await loadNotes();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete draft.",
        variant: "destructive",
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-violet-200/40 dark:border-slate-700/50">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Release Notes
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Create, publish, and distribute release notes to active users.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New Release Note
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-light">All Release Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No release notes yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.version}</TableCell>
                      <TableCell>{item.title}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_draft ? "secondary" : "default"}>
                          {item.is_draft ? "Draft" : "Published"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.email_sent_at ? (
                          <Badge variant="outline">Sent</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Not sent</span>
                        )}
                      </TableCell>
                      <TableCell>{item.entry_count}</TableCell>
                      <TableCell className="space-x-2">
                        {item.is_draft ? (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void openEdit(item.id)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void publish(item.id)}>
                              <Upload className="h-3.5 w-3.5 mr-1" />
                              Publish
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => void deleteDraft(item.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" />
                              Delete
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void sendEmail(item.id, !!item.email_sent_at)}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            {item.email_sent_at ? "Resend Email" : "Send Email"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Release Note" : "Create Release Note"}</DialogTitle>
            <DialogDescription>
              Build entries for in-app "What's New" and email distribution.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Version</label>
                  <Input
                    value={form.version}
                    onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
                    placeholder="e.g. 2026.03.04"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Title</label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="March Product Update"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void generateDraft()} disabled={generating}>
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Generate Draft
                </Button>
                <Button type="button" variant="outline" onClick={addEntry}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entry
                </Button>
              </div>

              <div className="space-y-4 max-h-[50vh] overflow-auto pr-2">
                {form.entries.map((entry, idx) => (
                  <Card key={`${entry.id || "new"}-${idx}`}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">Entry {idx + 1}</Badge>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => moveEntry(idx, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => moveEntry(idx, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeEntry(idx)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <Input
                        placeholder="Entry title"
                        value={entry.title}
                        onChange={(e) => updateEntry(idx, "title", e.target.value)}
                      />
                      <Textarea
                        placeholder="Entry description"
                        value={entry.description}
                        onChange={(e) => updateEntry(idx, "description", e.target.value)}
                        rows={3}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={entry.category}
                          onChange={(e) =>
                            updateEntry(idx, "category", e.target.value as ReleaseNoteCategory)
                          }
                        >
                          <option value="feature">New</option>
                          <option value="improvement">Improved</option>
                          <option value="fix">Fixed</option>
                        </select>
                        <Input
                          placeholder="Optional link"
                          value={entry.link || ""}
                          onChange={(e) => updateEntry(idx, "link", e.target.value)}
                        />
                        <Input
                          placeholder="Optional link label"
                          value={entry.linkLabel || ""}
                          onChange={(e) => updateEntry(idx, "linkLabel", e.target.value)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base font-medium">Preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-h-[60vh] overflow-auto">
                <div>
                  <div className="text-sm text-muted-foreground">Version</div>
                  <div className="font-medium">{form.version || "—"}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Title</div>
                  <div className="font-medium">{form.title || "—"}</div>
                </div>
                {(["feature", "improvement", "fix"] as ReleaseNoteCategory[]).map((category) => {
                  const entries = groupedPreview[category].filter(
                    (entry) => entry.title.trim() && entry.description.trim(),
                  );
                  if (entries.length === 0) return null;
                  return (
                    <div key={category} className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {categoryLabel[category]}
                      </div>
                      {entries.map((entry, idx) => (
                        <div key={`${category}-${idx}`} className="border rounded-md p-3">
                          <div className="font-medium text-sm">{entry.title}</div>
                          <div className="text-sm text-muted-foreground mt-1">{entry.description}</div>
                          {entry.link ? (
                            <div className="text-xs text-blue-600 mt-2">
                              {entry.linkLabel || "Learn more"}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
