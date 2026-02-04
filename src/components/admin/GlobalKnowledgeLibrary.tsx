/**
 * Global Knowledge Library - Platform Admin UI
 *
 * Allows platform admins to manage global documents that sync to all tenants.
 * Features: Upload, edit, publish, archive, restore, view sync status.
 */

import { useState, useRef } from "react";
import {
  Upload,
  Search,
  Filter,
  MoreVertical,
  FileText,
  Trash2,
  Archive,
  RotateCcw,
  Send,
  RefreshCw,
  Eye,
  Edit2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  BookOpen,
  Link2,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useGlobalKnowledge, GlobalDocument } from "@/hooks/useGlobalKnowledge";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

export function GlobalKnowledgeLibrary() {
  const {
    documents,
    categories,
    loading,
    pagination,
    fetchDocuments,
    uploadDocument,
    updateDocument,
    deleteDocument,
    processDocument,
    publishDocument,
    archiveDocument,
    restoreDocument,
    getSyncStatus,
    resyncDocument,
  } = useGlobalKnowledge();

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialogs
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [syncStatusDialogOpen, setSyncStatusDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Selected document
  const [selectedDoc, setSelectedDoc] = useState<GlobalDocument | null>(null);
  const [archiveReason, setArchiveReason] = useState("");

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("Regulations");
  const [uploadSourceUrl, setUploadSourceUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Sync status
  const [syncStatus, setSyncStatus] = useState<any[]>([]);
  const [loadingSyncStatus, setLoadingSyncStatus] = useState(false);

  // Action loading states
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!uploadFile) return;

    setIsUploading(true);
    try {
      await uploadDocument(uploadFile, {
        title: uploadTitle || uploadFile.name,
        category: uploadCategory,
        source_url: uploadSourceUrl || undefined,
      });
      toast({
        title: "Document uploaded",
        description:
          "Document is being processed. You can publish it once processing is complete.",
      });
      setUploadDialogOpen(false);
      setUploadFile(null);
      setUploadTitle("");
      setUploadSourceUrl("");
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle process
  const handleProcess = async (doc: GlobalDocument) => {
    setProcessingId(doc.id);
    try {
      const result = await processDocument(doc.id);
      toast({
        title: "Processing complete",
        description: `Created ${result?.chunkCount} chunks with ${result?.tokenCount} tokens.`,
      });
    } catch (err: any) {
      toast({
        title: "Processing failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Handle publish
  const handlePublish = async (doc: GlobalDocument) => {
    setPublishingId(doc.id);
    try {
      const result = await publishDocument(doc.id);
      toast({
        title: "Document published",
        description: `Synced to ${result?.syncResults.success}/${result?.syncResults.total} tenants.`,
      });
    } catch (err: any) {
      toast({
        title: "Publish failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setPublishingId(null);
    }
  };

  // Handle archive
  const handleArchive = async () => {
    if (!selectedDoc) return;

    try {
      const result = await archiveDocument(selectedDoc.id, archiveReason);
      toast({
        title: "Document archived",
        description: `Removed from ${result?.syncResults.success}/${result?.syncResults.total} tenants.`,
      });
      setArchiveDialogOpen(false);
      setArchiveReason("");
      setSelectedDoc(null);
    } catch (err: any) {
      toast({
        title: "Archive failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Handle restore
  const handleRestore = async (doc: GlobalDocument) => {
    try {
      const result = await restoreDocument(doc.id);
      toast({
        title: "Document restored",
        description: `Re-synced to ${result?.syncResults.success}/${result?.syncResults.total} tenants.`,
      });
    } catch (err: any) {
      toast({
        title: "Restore failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Handle resync
  const handleResync = async (doc: GlobalDocument) => {
    setResyncingId(doc.id);
    try {
      const result = await resyncDocument(doc.id);
      toast({
        title: "Resync complete",
        description: `Synced to ${result?.syncResults.success}/${result?.syncResults.total} tenants.`,
      });
    } catch (err: any) {
      toast({
        title: "Resync failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setResyncingId(null);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!selectedDoc) return;

    try {
      await deleteDocument(selectedDoc.id);
      toast({
        title: "Document deleted",
        description: "Document has been permanently deleted.",
      });
      setDeleteDialogOpen(false);
      setSelectedDoc(null);
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // View sync status
  const handleViewSyncStatus = async (doc: GlobalDocument) => {
    setSelectedDoc(doc);
    setLoadingSyncStatus(true);
    setSyncStatusDialogOpen(true);
    try {
      const status = await getSyncStatus(doc.id);
      setSyncStatus(status);
    } catch (err) {
      console.error("Failed to fetch sync status:", err);
    } finally {
      setLoadingSyncStatus(false);
    }
  };

  // Filter documents
  const filteredDocs = documents.filter((doc) => {
    if (statusFilter !== "all" && doc.status !== statusFilter) return false;
    if (categoryFilter !== "all" && doc.category !== categoryFilter)
      return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        doc.title.toLowerCase().includes(query) ||
        doc.filename?.toLowerCase().includes(query) ||
        doc.category.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Status badge
  const getStatusBadge = (doc: GlobalDocument) => {
    switch (doc.status) {
      case "draft":
        return (
          <Badge variant="secondary" className="bg-slate-100 text-slate-700">
            Draft
          </Badge>
        );
      case "published":
        return (
          <Badge variant="default" className="bg-green-100 text-green-700">
            Published
          </Badge>
        );
      case "archived":
        return (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200"
          >
            Archived
          </Badge>
        );
    }
  };

  // Processing badge
  const getProcessingBadge = (doc: GlobalDocument) => {
    switch (doc.processing_status) {
      case "pending":
        return (
          <Badge variant="outline" className="text-slate-500">
            Pending
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="text-blue-600">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="text-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {doc.chunk_count} chunks
          </Badge>
        );
      case "error":
        return (
          <Badge variant="outline" className="text-red-600">
            <XCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-indigo-600" />
              Global Knowledge Library
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Manage documents that sync to all tenant databases
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchDocuments()}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
            <Button
              onClick={() => setUploadDialogOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.name}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Document List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No documents found</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filteredDocs.map((doc) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-start gap-4 flex-1">
                    <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                      <FileText className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-slate-900 dark:text-white truncate">
                          {doc.title}
                        </h3>
                        {getStatusBadge(doc)}
                        {getProcessingBadge(doc)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            {doc.category}
                          </Badge>
                        </span>
                        {doc.filename && (
                          <span className="truncate max-w-[200px]">
                            {doc.filename}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(doc.updated_at), {
                            addSuffix: true,
                          })}
                        </span>
                        {doc.version > 1 && <span>v{doc.version}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Action buttons based on status */}
                    {doc.status === "draft" &&
                      doc.processing_status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleProcess(doc)}
                          disabled={processingId === doc.id}
                        >
                          {processingId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Process"
                          )}
                        </Button>
                      )}
                    {doc.status === "draft" &&
                      doc.processing_status === "completed" && (
                        <Button
                          size="sm"
                          onClick={() => handlePublish(doc)}
                          disabled={publishingId === doc.id}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {publishingId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <Send className="h-4 w-4 mr-1" />
                          )}
                          Publish
                        </Button>
                      )}
                    {doc.status === "published" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResync(doc)}
                        disabled={resyncingId === doc.id}
                      >
                        {resyncingId === doc.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {doc.status === "archived" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(doc)}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Restore
                      </Button>
                    )}

                    {/* More menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleViewSyncStatus(doc)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Sync Status
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedDoc(doc);
                            setEditDialogOpen(true);
                          }}
                        >
                          <Edit2 className="h-4 w-4 mr-2" />
                          Edit Details
                        </DropdownMenuItem>
                        {doc.status === "published" && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedDoc(doc);
                              setArchiveDialogOpen(true);
                            }}
                          >
                            <Archive className="h-4 w-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {doc.status !== "published" && (
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              setSelectedDoc(doc);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Pagination info */}
        {pagination.total > 0 && (
          <div className="text-sm text-slate-500 text-center">
            Showing {filteredDocs.length} of {pagination.total} documents
          </div>
        )}
      </CardContent>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document to the global knowledge library. Supported
              formats: PDF, DOCX, TXT, MD.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>File</Label>
              <div
                className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-5 w-5 text-indigo-600" />
                    <span className="text-sm font-medium">
                      {uploadFile.name}
                    </span>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                    <p className="text-sm text-slate-500">
                      Click to select a file
                    </p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,.html,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Document title"
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Source URL (optional)
              </Label>
              <Input
                value={uploadSourceUrl}
                onChange={(e) => setUploadSourceUrl(e.target.value)}
                placeholder="https://example.com/document-source"
                type="url"
              />
              <p className="text-xs text-slate-500">
                Link to the original source. This will be shown when the
                document is cited.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || isUploading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Document Details</DialogTitle>
            <DialogDescription>
              Update the document metadata. Changes to published documents will
              be synced to all tenants on next resync.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={selectedDoc?.title || ""}
                onChange={(e) =>
                  setSelectedDoc(
                    selectedDoc
                      ? { ...selectedDoc, title: e.target.value }
                      : null
                  )
                }
                placeholder="Document title"
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={selectedDoc?.category || ""}
                onValueChange={(value) =>
                  setSelectedDoc(
                    selectedDoc ? { ...selectedDoc, category: value } : null
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Source URL
              </Label>
              <Input
                value={selectedDoc?.source_url || ""}
                onChange={(e) =>
                  setSelectedDoc(
                    selectedDoc
                      ? { ...selectedDoc, source_url: e.target.value || null }
                      : null
                  )
                }
                placeholder="https://example.com/document-source"
                type="url"
              />
              <p className="text-xs text-slate-500">
                Link to the original source. This will be shown when the
                document is cited.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!selectedDoc) return;
                try {
                  await updateDocument(selectedDoc.id, {
                    title: selectedDoc.title,
                    category: selectedDoc.category,
                    source_url: selectedDoc.source_url,
                  });
                  toast({
                    title: "Document updated",
                    description:
                      selectedDoc.status === "published"
                        ? "Changes saved. Resync to update tenant copies."
                        : "Changes saved.",
                  });
                  setEditDialogOpen(false);
                } catch (err: any) {
                  toast({
                    title: "Update failed",
                    description: err.message,
                    variant: "destructive",
                  });
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Dialog */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Archive Document</DialogTitle>
            <DialogDescription>
              This will remove the document from all tenant knowledge bases. You
              can restore it later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Why is this document being archived?"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleArchive} variant="destructive">
              Archive Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Status Dialog */}
      <Dialog
        open={syncStatusDialogOpen}
        onOpenChange={setSyncStatusDialogOpen}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Sync Status</DialogTitle>
            <DialogDescription>{selectedDoc?.title}</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {loadingSyncStatus ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
              </div>
            ) : syncStatus.length === 0 ? (
              <p className="text-center text-slate-500 py-8">
                No sync history found
              </p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {syncStatus.map((status, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/30"
                  >
                    <div>
                      <p className="font-medium text-sm">{status.tenantName}</p>
                      <p className="text-xs text-slate-500">
                        {status.lastSyncedAt
                          ? `Last synced ${formatDistanceToNow(
                              new Date(status.lastSyncedAt),
                              { addSuffix: true }
                            )}`
                          : "Never synced"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {status.syncedVersion && (
                        <Badge variant="outline">v{status.syncedVersion}</Badge>
                      )}
                      {status.lastStatus === "success" ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : status.lastStatus === "failed" ? (
                        <XCircle className="h-5 w-5 text-red-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-slate-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{selectedDoc?.title}". This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default GlobalKnowledgeLibrary;
