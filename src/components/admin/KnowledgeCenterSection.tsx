/**
 * Knowledge Center Section - Tenant Admin UI
 *
 * Allows tenant admins to view synced global docs, see updates,
 * upload tenant-specific documents, and search the knowledge base.
 */

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import {
  Search,
  FileText,
  Upload,
  Trash2,
  Globe,
  Building2,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  BookOpen,
  ChevronDown,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  useKnowledgeCenter,
  KnowledgeDocument,
  KnowledgeUpdate,
  SearchResult,
} from "@/hooks/useKnowledgeCenter";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

export function KnowledgeCenterSection() {
  const { selectedTenantId } = useAdminTenant();
  const {
    documents,
    updates,
    unreadCount,
    categories,
    loading,
    fetchDocuments,
    fetchUpdates,
    uploadDocument,
    deleteDocument,
    acknowledgeUpdate,
    acknowledgeAllUpdates,
    searchKnowledge,
  } = useKnowledgeCenter(selectedTenantId || undefined);

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Platform-level categories from global knowledge catalog (includes empty categories as upload targets)
  const [platformCategories, setPlatformCategories] = useState<string[]>([]);

  // Merged upload category list: platform taxonomy (always shown) + any tenant-only categories not in the platform list
  const uploadCategoryOptions = [
    ...platformCategories,
    ...categories
      .map((c) => c.category)
      .filter((c) => !platformCategories.includes(c)),
  ];

  // Tab state
  const [activeTab, setActiveTab] = useState("documents");

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Search results
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Dialogs
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [updatesExpanded, setUpdatesExpanded] = useState(true);

  // Selected document
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(
    null
  );

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("General");
  const [isUploading, setIsUploading] = useState(false);

  // Fetch platform-level category taxonomy from admin API on mount
  useEffect(() => {
    api
      .request<{ categories: Array<{ name: string }> }>(
        "/api/admin/global-knowledge/categories"
      )
      .then((res) => {
        setPlatformCategories(res.categories.map((c) => c.name));
      })
      .catch(() => {
        // Fallback to sensible defaults if admin endpoint unavailable
        setPlatformCategories([
          "General",
          "Regulations",
          "Guidelines",
          "Compliance",
          "Products",
          "Training",
          "Market Intel",
          "Best Practices",
          "Policy",
          "Analytics",
        ]);
      });
  }, []);

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
      });
      toast({
        title: "Document uploaded",
        description:
          "Your document is being processed and will be available shortly.",
      });
      setUploadDialogOpen(false);
      setUploadFile(null);
      setUploadTitle("");
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

  // Handle delete
  const handleDelete = async () => {
    if (!selectedDoc) return;

    try {
      await deleteDocument(selectedDoc.id);
      toast({
        title: "Document deleted",
        description: "Document has been removed.",
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

  // Handle search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchKnowledge(searchQuery);
      setSearchResults(results);
      setActiveTab("search");
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle acknowledge update
  const handleAcknowledgeUpdate = async (update: KnowledgeUpdate) => {
    await acknowledgeUpdate(update.id);
    toast({
      title: "Update acknowledged",
    });
  };

  // Handle acknowledge all
  const handleAcknowledgeAll = async () => {
    const count = await acknowledgeAllUpdates();
    toast({
      title: "All updates acknowledged",
      description: `${count} updates marked as read.`,
    });
  };

  // Filter documents
  const filteredDocs = documents.filter((doc) => {
    if (categoryFilter !== "all" && doc.category !== categoryFilter)
      return false;
    if (typeFilter === "global" && !doc.is_global) return false;
    if (typeFilter === "tenant" && doc.is_global) return false;
    return true;
  });

  // Get action badge for updates
  const getActionBadge = (action: string) => {
    switch (action) {
      case "added":
        return <Badge className="bg-green-100 text-green-700">New</Badge>;
      case "updated":
        return <Badge className="bg-blue-100 text-blue-700">Updated</Badge>;
      case "removed":
        return <Badge className="bg-red-100 text-red-700">Removed</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-indigo-600" />
              Knowledge Center
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Browse and search your organization's knowledge base
            </CardDescription>
          </div>
          <Button onClick={() => setUploadDialogOpen(true)} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Updates Banner */}
        {unreadCount > 0 && (
          <Collapsible open={updatesExpanded} onOpenChange={setUpdatesExpanded}>
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 transition-colors rounded-t-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-indigo-100 dark:bg-indigo-900/50">
                      <Bell className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-indigo-900 dark:text-indigo-100">
                        {unreadCount} Knowledge Base Update
                        {unreadCount !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400">
                        Click to {updatesExpanded ? "collapse" : "expand"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAcknowledgeAll();
                      }}
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      Mark all read
                    </Button>
                    <ChevronDown
                      className={`h-4 w-4 text-indigo-600 transition-transform ${
                        updatesExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-indigo-200 dark:border-indigo-800 p-4 space-y-2 max-h-[300px] overflow-y-auto">
                  {updates
                    .filter((u) => !u.acknowledged_at)
                    .map((update) => (
                      <div
                        key={update.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-slate-800/50"
                      >
                        <div className="flex items-center gap-3">
                          {getActionBadge(update.action)}
                          <div>
                            <p className="font-medium text-sm">
                              {update.title}
                            </p>
                            <p className="text-xs text-slate-500">
                              {update.change_summary ||
                                `Document ${update.action}`}{" "}
                              •{" "}
                              {formatDistanceToNow(new Date(update.synced_at), {
                                addSuffix: true,
                              })}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAcknowledgeUpdate(update)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search knowledge base..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button onClick={handleSearch} disabled={isSearching}>
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Search"
            )}
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="documents">All Documents</TabsTrigger>
            <TabsTrigger value="search" disabled={searchResults.length === 0}>
              Search Results{" "}
              {searchResults.length > 0 && `(${searchResults.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-4">
            {/* Filters */}
            <div className="flex gap-4">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Documents</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.category} value={cat.category}>
                      {cat.category} ({cat.doc_count})
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
              <div className="space-y-2">
                <AnimatePresence>
                  {filteredDocs.map((doc) => (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`p-2 rounded-lg ${
                            doc.is_global
                              ? "bg-blue-100 dark:bg-blue-900/30"
                              : "bg-green-100 dark:bg-green-900/30"
                          }`}
                        >
                          {doc.is_global ? (
                            <Globe className="h-5 w-5 text-blue-600" />
                          ) : (
                            <Building2 className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-slate-900 dark:text-white">
                              {doc.title || doc.filename}
                            </h3>
                            <Badge variant="outline" className="text-xs">
                              {doc.is_global ? "Global" : "Tenant"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            {doc.category && (
                              <Badge variant="secondary" className="text-xs">
                                {doc.category}
                              </Badge>
                            )}
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {doc.chunk_count} chunks
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(doc.updated_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      {!doc.is_global && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setSelectedDoc(doc);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            {searchResults.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No search results</p>
              </div>
            ) : (
              <div className="space-y-3">
                {searchResults.map((result, idx) => (
                  <div
                    key={`${result.document_id}-${result.chunk_index}`}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-sm">{result.title}</h3>
                        <Badge variant="outline" className="text-xs">
                          {result.is_global ? "Global" : "Tenant"}
                        </Badge>
                        {result.category && (
                          <Badge variant="secondary" className="text-xs">
                            {result.category}
                          </Badge>
                        )}
                      </div>
                      <Badge className="bg-indigo-100 text-indigo-700">
                        {(result.similarity * 100).toFixed(1)}% match
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3">
                      {result.chunk_text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document to your organization's knowledge base. Supported
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
                  {uploadCategoryOptions.length > 0 ? (
                    uploadCategoryOptions.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="General">General</SelectItem>
                  )}
                </SelectContent>
              </Select>
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

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "
              {selectedDoc?.title || selectedDoc?.filename}". This action cannot
              be undone.
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

export default KnowledgeCenterSection;
