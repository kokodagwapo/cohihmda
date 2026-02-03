/**
 * AI Prompt Manager - Platform Admin UI
 *
 * Allows platform admins to view, edit, and manage all AI prompts.
 * Features: List by category, edit prompts, version history, reset to default, export/import.
 */

import { useState, useEffect, useRef } from "react";
import {
  Search,
  Filter,
  Download,
  Upload,
  RotateCcw,
  History,
  Save,
  RefreshCw,
  Settings2,
  Sparkles,
  Code,
  Thermometer,
  Hash,
  FileJson,
  Eye,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Loader2,
  Braces,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useAIPrompts,
  PromptConfig,
  PromptVersion,
  PromptExport,
} from "@/hooks/admin/useAIPrompts";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

// Category icons
const categoryIcons: Record<string, React.ReactNode> = {
  data_chat: <Database className="h-4 w-4" />,
  insights: <Sparkles className="h-4 w-4" />,
  metrics: <Hash className="h-4 w-4" />,
  predictions: <AlertCircle className="h-4 w-4" />,
  recommendations: <CheckCircle2 className="h-4 w-4" />,
  voice: <Settings2 className="h-4 w-4" />,
  news: <FileJson className="h-4 w-4" />,
};

// Category colors
const categoryColors: Record<string, string> = {
  data_chat: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  insights: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  metrics: "bg-green-500/10 text-green-700 dark:text-green-400",
  predictions: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  recommendations: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  voice: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  news: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
};

export function AIPromptManager() {
  const {
    prompts,
    categories,
    selectedPrompt,
    versions,
    loading,
    saving,
    loadPrompts,
    loadCategories,
    getPrompt,
    loadVersionHistory,
    updatePrompt,
    resetPrompt,
    restoreVersion,
    setSelectedPrompt,
    testPrompt,
    exportPrompts,
    importPrompts,
    seedDefaults,
  } = useAIPrompts();

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog states
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Editor state
  const [editedPrompt, setEditedPrompt] = useState<Partial<PromptConfig>>({});
  const [changeSummary, setChangeSummary] = useState("");

  // Import state
  const [importData, setImportData] = useState<PromptExport | null>(null);
  const [importOverwrite, setImportOverwrite] = useState(false);

  // Preview state
  const [previewResult, setPreviewResult] = useState<any>(null);

  // Load data on mount
  useEffect(() => {
    loadPrompts();
    loadCategories();
  }, [loadPrompts, loadCategories]);

  // Filter prompts
  const filteredPrompts = prompts.filter((p) => {
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group prompts by category
  const groupedPrompts = filteredPrompts.reduce((acc, prompt) => {
    if (!acc[prompt.category]) {
      acc[prompt.category] = [];
    }
    acc[prompt.category].push(prompt);
    return acc;
  }, {} as Record<string, PromptConfig[]>);

  // Open editor for a prompt
  const handleEditPrompt = async (prompt: PromptConfig) => {
    setSelectedPrompt(prompt);
    setEditedPrompt({
      system_prompt: prompt.system_prompt,
      user_prompt_template: prompt.user_prompt_template,
      model: prompt.model,
      temperature: prompt.temperature,
      max_tokens: prompt.max_tokens,
      json_mode: prompt.json_mode,
    });
    setChangeSummary("");
    setEditorOpen(true);
  };

  // Save prompt changes
  const handleSavePrompt = async () => {
    if (!selectedPrompt) return;

    const result = await updatePrompt(selectedPrompt.id, {
      ...editedPrompt,
      change_summary: changeSummary || "Updated via admin panel",
    });

    if (result) {
      setEditorOpen(false);
    }
  };

  // Open version history
  const handleViewHistory = async (prompt: PromptConfig) => {
    setSelectedPrompt(prompt);
    await loadVersionHistory(prompt.id);
    setHistoryOpen(true);
  };

  // Restore a version
  const handleRestoreVersion = async (version: number) => {
    if (!selectedPrompt) return;

    const result = await restoreVersion(selectedPrompt.id, version);
    if (result) {
      setHistoryOpen(false);
      await loadVersionHistory(selectedPrompt.id);
    }
  };

  // Reset prompt
  const handleResetPrompt = async () => {
    if (!selectedPrompt) return;

    const result = await resetPrompt(selectedPrompt.id);
    if (result) {
      setResetDialogOpen(false);
      setEditorOpen(false);
    }
  };

  // Preview prompt
  const handlePreviewPrompt = async () => {
    if (!selectedPrompt) return;

    const result = await testPrompt(selectedPrompt.id, {}, "");
    if (result) {
      setPreviewResult(result);
      setPreviewOpen(true);
    }
  };

  // Handle file import
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.version && data.prompts) {
          setImportData(data);
          setImportDialogOpen(true);
        } else {
          toast({
            title: "Invalid file",
            description:
              "This doesn't appear to be a valid prompt export file.",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Invalid JSON",
          description: "Could not parse the file as JSON.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Execute import
  const handleImport = async () => {
    if (!importData) return;

    const result = await importPrompts(importData, {
      overwrite: importOverwrite,
    });
    if (result) {
      setImportDialogOpen(false);
      setImportData(null);
    }
  };

  // Copy prompt to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Prompt copied to clipboard",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI Prompts</h2>
          <p className="text-muted-foreground">
            Manage system prompts for all AI features
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileImport}
          />
          <Button variant="outline" size="sm" onClick={() => exportPrompts()}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              loadPrompts(categoryFilter === "all" ? undefined : categoryFilter)
            }
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                <span className="flex items-center gap-2">
                  {categoryIcons[cat]}
                  {cat
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Prompts List */}
      {loading && prompts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No prompts configured
            </h3>
            <p className="text-muted-foreground mb-4">
              Run the migration and seed default prompts to get started.
            </p>
            <Button onClick={() => seedDefaults()}>
              <Database className="h-4 w-4 mr-2" />
              Seed Default Prompts
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {Object.entries(groupedPrompts).map(([category, categoryPrompts]) => (
            <AccordionItem
              key={category}
              value={category}
              className="border rounded-lg"
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-3">
                  <Badge
                    variant="secondary"
                    className={cn("px-2 py-1", categoryColors[category])}
                  >
                    {categoryIcons[category]}
                    <span className="ml-1">
                      {category
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {categoryPrompts.length} prompt
                    {categoryPrompts.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  {categoryPrompts.map((prompt) => (
                    <Card
                      key={prompt.id}
                      className="hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => handleEditPrompt(prompt)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{prompt.name}</h4>
                              {prompt.current_version > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  v{prompt.current_version}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {prompt.description}
                            </p>
                            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Code className="h-3 w-3" />
                                {prompt.model}
                              </span>
                              <span className="flex items-center gap-1">
                                <Thermometer className="h-3 w-3" />
                                {prompt.temperature}
                              </span>
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {prompt.max_tokens} tokens
                              </span>
                              {prompt.json_mode && (
                                <Badge variant="outline" className="text-xs">
                                  <Braces className="h-3 w-3 mr-1" />
                                  JSON
                                </Badge>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Edit Prompt: {selectedPrompt?.name}
            </DialogTitle>
            <DialogDescription>{selectedPrompt?.id}</DialogDescription>
          </DialogHeader>

          <Tabs
            defaultValue="prompt"
            className="flex-1 overflow-hidden flex flex-col"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="prompt">System Prompt</TabsTrigger>
              <TabsTrigger value="template">User Template</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 pr-4">
              <TabsContent value="prompt" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>System Prompt</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(editedPrompt.system_prompt || "")
                      }
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <Textarea
                    value={editedPrompt.system_prompt || ""}
                    onChange={(e) =>
                      setEditedPrompt((prev) => ({
                        ...prev,
                        system_prompt: e.target.value,
                      }))
                    }
                    placeholder="Enter the system prompt..."
                    className="min-h-[400px] font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {(editedPrompt.system_prompt || "").length} characters • ~
                    {Math.ceil((editedPrompt.system_prompt || "").length / 4)}{" "}
                    tokens
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="template" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>User Prompt Template (Optional)</Label>
                  <p className="text-sm text-muted-foreground">
                    Use {"{{variableName}}"} syntax for dynamic values
                  </p>
                  <Textarea
                    value={editedPrompt.user_prompt_template || ""}
                    onChange={(e) =>
                      setEditedPrompt((prev) => ({
                        ...prev,
                        user_prompt_template: e.target.value,
                      }))
                    }
                    placeholder="Enter user prompt template (optional)..."
                    className="min-h-[300px] font-mono text-sm"
                  />
                </div>
                {selectedPrompt?.available_variables &&
                  selectedPrompt.available_variables.length > 0 && (
                    <div className="space-y-2">
                      <Label>Available Variables</Label>
                      <div className="flex flex-wrap gap-2">
                        {selectedPrompt.available_variables.map((v) => (
                          <Badge
                            key={v}
                            variant="secondary"
                            className="font-mono"
                          >
                            {`{{${v}}}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
              </TabsContent>

              <TabsContent value="settings" className="mt-4 space-y-6">
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Select
                    value={editedPrompt.model}
                    onValueChange={(v) =>
                      setEditedPrompt((prev) => ({ ...prev, model: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                      <SelectItem value="gpt-3.5-turbo">
                        GPT-3.5 Turbo
                      </SelectItem>
                      <SelectItem value="gemini-2.0-flash-exp">
                        Gemini 2.0 Flash
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Temperature: {editedPrompt.temperature}</Label>
                    <span className="text-sm text-muted-foreground">
                      {(editedPrompt.temperature || 0) < 0.3
                        ? "More focused"
                        : (editedPrompt.temperature || 0) > 0.7
                        ? "More creative"
                        : "Balanced"}
                    </span>
                  </div>
                  <Slider
                    value={[editedPrompt.temperature || 0.7]}
                    onValueChange={([v]) =>
                      setEditedPrompt((prev) => ({ ...prev, temperature: v }))
                    }
                    min={0}
                    max={2}
                    step={0.1}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={editedPrompt.max_tokens || 1000}
                    onChange={(e) =>
                      setEditedPrompt((prev) => ({
                        ...prev,
                        max_tokens: parseInt(e.target.value) || 1000,
                      }))
                    }
                    min={1}
                    max={128000}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>JSON Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Force the model to output valid JSON
                    </p>
                  </div>
                  <Switch
                    checked={editedPrompt.json_mode || false}
                    onCheckedChange={(checked) =>
                      setEditedPrompt((prev) => ({
                        ...prev,
                        json_mode: checked,
                      }))
                    }
                  />
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>

          <Separator className="my-4" />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Change Summary (required for version tracking)</Label>
              <Input
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Describe what you changed..."
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleViewHistory(selectedPrompt!)}
              >
                <History className="h-4 w-4 mr-2" />
                History
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetDialogOpen(true)}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button variant="outline" size="sm" onClick={handlePreviewPrompt}>
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSavePrompt}
                disabled={saving || !changeSummary.trim()}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History: {selectedPrompt?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {versions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No version history yet
              </p>
            ) : (
              <div className="space-y-3">
                {versions.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline">v{v.version}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(v.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          <p className="text-sm">
                            {v.change_summary || "No description"}
                          </p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                            <span>{v.model}</span>
                            <span>•</span>
                            <span>temp: {v.temperature}</span>
                            <span>•</span>
                            <span>{v.max_tokens} tokens</span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestoreVersion(v.version)}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset "{selectedPrompt?.name}" to its original default
              configuration. Your current changes will be saved as a new version
              before resetting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPrompt}>
              Reset to Default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Prompts
            </DialogTitle>
            <DialogDescription>
              Import {importData?.prompts.length || 0} prompt configurations
            </DialogDescription>
          </DialogHeader>
          {importData && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p>
                  Exported: {format(new Date(importData.exportedAt), "PPpp")}
                </p>
                {importData.exportedBy && <p>By: {importData.exportedBy}</p>}
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Overwrite existing prompts</Label>
                  <p className="text-sm text-muted-foreground">
                    Update prompts that already exist
                  </p>
                </div>
                <Switch
                  checked={importOverwrite}
                  onCheckedChange={setImportOverwrite}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Preview: {selectedPrompt?.name}
            </DialogTitle>
          </DialogHeader>
          {previewResult && (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Model:</span>{" "}
                    {previewResult.model}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Temperature:</span>{" "}
                    {previewResult.temperature}
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Estimated tokens:
                    </span>{" "}
                    ~{previewResult.estimated_tokens}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    Built System Prompt ({previewResult.system_prompt_chars}{" "}
                    chars)
                  </Label>
                  <pre className="p-4 bg-muted rounded-md text-sm whitespace-pre-wrap overflow-auto max-h-[300px]">
                    {previewResult.built_system_prompt}
                  </pre>
                </div>
                {previewResult.built_user_prompt && (
                  <div className="space-y-2">
                    <Label>
                      Built User Prompt ({previewResult.user_prompt_chars}{" "}
                      chars)
                    </Label>
                    <pre className="p-4 bg-muted rounded-md text-sm whitespace-pre-wrap overflow-auto max-h-[200px]">
                      {previewResult.built_user_prompt}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AIPromptManager;
