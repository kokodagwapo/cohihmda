import { useState } from 'react';
import { Edit2, Trash2, Check, X, Plus, Search, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKnowledgeBase, KnowledgeBaseEntry } from '@/hooks/useKnowledgeBase';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RichTextEditor } from './RichTextEditor';

export function KnowledgeBaseEditor() {
  const {
    entries,
    categories,
    loading,
    fetchEntries,
    createEntry,
    updateEntry,
    deleteEntry,
  } = useKnowledgeBase();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<KnowledgeBaseEntry>>({
    title: '',
    category: 'General',
    priority: 100,
    content: '',
    keywords: [],
    is_active: true,
  });

  // Default categories from screenshot
  const defaultCategories = ['General', 'Policy', 'Product', 'Compliance', 'Market Intel', 'Guidelines', 'Fallout'];
  
  // Combine default categories with any categories from database
  const allCategories = [...new Set([...defaultCategories, ...categories])].sort();

  // Filter entries
  const filteredEntries = entries.filter(entry => {
    const matchesSearch = !searchQuery || 
      entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.keywords?.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'All Categories' || entry.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const handleEdit = (entry: KnowledgeBaseEntry) => {
    setEditingId(entry.id);
    setFormData({
      title: entry.title,
      category: entry.category,
      priority: entry.priority,
      content: entry.content,
      keywords: entry.keywords || [],
      is_active: entry.is_active,
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setCreating(false);
    setFormData({
      title: '',
      category: 'General',
      priority: 100,
      content: '',
      keywords: [],
      is_active: true,
    });
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await updateEntry(editingId, formData);
        setEditingId(null);
      } else if (creating) {
        await createEntry(formData as Omit<KnowledgeBaseEntry, 'id' | 'created_at' | 'updated_at'>);
        setCreating(false);
      }
      setFormData({
        title: '',
        category: 'General',
        priority: 100,
        content: '',
        keywords: [],
        is_active: true,
      });
    } catch (error) {
      console.error('Error saving entry:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      await deleteEntry(id);
    }
  };

  const handleNewEntry = () => {
    setCreating(true);
    setEditingId(null);
    setFormData({
      title: '',
      category: 'General',
      priority: 100,
      content: '',
      keywords: [],
      is_active: true,
    });
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-purple-600" />
              Knowledge Base
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Manage AI agent prompts and knowledge base entries
            </CardDescription>
          </div>
          <Button onClick={handleNewEntry} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="h-4 w-4 mr-2" />
            Add Knowledge
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search knowledge base..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All Categories">All Categories</SelectItem>
              {allCategories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Create New Entry Form */}
        <AnimatePresence mode="wait">
          {creating && (
            <motion.div
              key="create-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white dark:bg-slate-800 rounded-lg border border-purple-200 dark:border-purple-700 p-6 shadow-sm overflow-hidden"
            >
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="h-5 w-5 text-purple-600" />
                <h3 className="text-lg font-semibold">Creating Entry</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="new-title">Title</Label>
                  <Input
                    id="new-title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Enter title..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-category">Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({ ...formData, category: value })}
                    >
                      <SelectTrigger id="new-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allCategories.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="new-priority">Priority</Label>
                    <Input
                      id="new-priority"
                      type="number"
                      min="0"
                      max="1000"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 100 })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="new-content">Content</Label>
                  <RichTextEditor
                    value={formData.content || ''}
                    onChange={(value) => setFormData({ ...formData, content: value })}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCancel}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={!formData.title || !formData.content}>
                    <Check className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Entries List */}
        {loading && entries.length === 0 ? (
          <div className="text-center py-12 text-slate-500">Loading entries...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {searchQuery || selectedCategory !== 'All Categories' 
              ? 'No entries match your filters' 
              : 'No entries yet. Click "Add Knowledge" to create one.'}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEntries.map((entry) => (
              <div key={entry.id}>
                {editingId === entry.id ? (
                  // Edit View (Expanded)
                  <motion.div
                    key={`edit-${entry.id}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="bg-white dark:bg-slate-800 rounded-lg border border-purple-200 dark:border-purple-700 p-6 shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <Edit2 className="h-5 w-5 text-purple-600" />
                      <h3 className="text-lg font-semibold">Editing Entry</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor={`edit-title-${entry.id}`}>Title</Label>
                        <Input
                          id={`edit-title-${entry.id}`}
                          value={formData.title}
                          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor={`edit-category-${entry.id}`}>Category</Label>
                          <Select
                            value={formData.category}
                            onValueChange={(value) => setFormData({ ...formData, category: value })}
                          >
                            <SelectTrigger id={`edit-category-${entry.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {allCategories.map(cat => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`edit-priority-${entry.id}`}>Priority</Label>
                          <Input
                            id={`edit-priority-${entry.id}`}
                            type="number"
                            min="0"
                            max="1000"
                            value={formData.priority}
                            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 100 })}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`edit-content-${entry.id}`}>Content</Label>
                        <RichTextEditor
                          value={formData.content || ''}
                          onChange={(value) => setFormData({ ...formData, content: value })}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={handleCancel}>
                          <X className="h-4 w-4 mr-2" />
                          Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={!formData.title || !formData.content}>
                          <Check className="h-4 w-4 mr-2" />
                          Save
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  // List View (Collapsed)
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                            {entry.title}
                          </h3>
                          <Badge variant="outline" className="text-xs">
                            {entry.category}
                          </Badge>
                          <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200">
                            Priority: {entry.priority}
                          </Badge>
                        </div>
                        <div 
                          className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mb-2"
                          dangerouslySetInnerHTML={{ 
                            __html: entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '')
                          }}
                        />
                        {entry.keywords && entry.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {entry.keywords.slice(0, 5).map((keyword, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          className="h-8 w-8 p-0"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(entry.id)}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
