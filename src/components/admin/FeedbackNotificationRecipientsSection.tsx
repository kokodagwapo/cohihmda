import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

type FeedbackNotificationUser = {
  id: string;
  user_name: string;
  email: string;
};

type FeedbackNotificationRecipient = {
  id: string;
  user_name: string;
  email: string;
  created_by: string;
};

export function FeedbackNotificationRecipientsSection() {
  const [users, setUsers] = useState<FeedbackNotificationUser[]>([]);
  const [recipients, setRecipients] = useState<FeedbackNotificationRecipient[]>([]);
  const [source, setSource] = useState<"existing_user" | "new_user">("existing_user");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedUser = users.find((user) => user.id === selectedUserId) || null;

  const resetForm = () => {
    setSelectedUserId("");
    setNewUserName("");
    setNewEmail("");
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [usersResult, recipientsResult] = await Promise.all([
        api.getFeedbackNotificationUsers(),
        api.getFeedbackNotificationRecipients(),
      ]);
      setUsers(usersResult.users || []);
      setRecipients(recipientsResult.recipients || []);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to load feedback notification recipients.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAdd = async () => {
    try {
      setBusy(true);
      if (source === "existing_user") {
        if (!selectedUserId) {
          toast({
            title: "User required",
            description: "Please select an existing user.",
            variant: "destructive",
          });
          return;
        }
        await api.createFeedbackNotificationRecipient({
          source: "existing_user",
          user_id: selectedUserId,
        });
      } else {
        const nextName = newUserName.trim();
        const nextEmail = newEmail.trim();
        if (!nextName || !nextEmail) {
          toast({
            title: "Missing fields",
            description: "User name and email are required for a new user.",
            variant: "destructive",
          });
          return;
        }
        await api.createFeedbackNotificationRecipient({
          source: "new_user",
          user_name: nextName,
          email: nextEmail,
        });
      }

      toast({
        title: "Recipient added",
        description: "Feedback notification recipient added successfully.",
      });
      resetForm();
      await loadData();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to add recipient.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      setBusy(true);
      await api.deleteFeedbackNotificationRecipient(id);
      setRecipients((prev) => prev.filter((item) => item.id !== id));
      toast({
        title: "Recipient removed",
        description: "Recipient removed from feedback notifications.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to remove recipient.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-blue-500" />
          <div>
            <CardTitle className="text-base">Feedback Notification Recipients</CardTitle>
            <CardDescription className="text-sm mt-0.5">
              Manage who receives new feedback submission emails.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading recipients...
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Recipient Type</Label>
                <Select
                  value={source}
                  onValueChange={(value) => {
                    setSource(value as "existing_user" | "new_user");
                    resetForm();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="existing_user">Existing User</SelectItem>
                    <SelectItem value="new_user">New User</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {source === "existing_user" ? (
                <>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select user..." />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.user_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Email (auto-filled)</Label>
                    <Input
                      value={selectedUser?.email || ""}
                      readOnly
                      disabled
                      placeholder="Select an existing user"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>User Name</Label>
                    <Input
                      value={newUserName}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setNewUserName(e.target.value)}
                      placeholder="Enter full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value)}
                      placeholder="Enter email"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAdd()}
                disabled={
                  busy ||
                  (source === "existing_user" && !selectedUserId) ||
                  (source === "new_user" && (!newUserName.trim() || !newEmail.trim()))
                }
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add Recipient
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Current recipients</p>
              {recipients.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No recipients configured yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {recipients.map((recipient) => (
                    <span
                      key={recipient.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 pl-3 pr-1.5 py-1 text-sm"
                    >
                      <span className="font-medium">{recipient.user_name}</span>
                      <span className="text-slate-400">|</span>
                      <span className="font-mono">{recipient.email}</span>
                      <button
                        type="button"
                        onClick={() => void handleRemove(recipient.id)}
                        disabled={busy}
                        className="rounded-full p-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                        title={`Remove ${recipient.email}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

