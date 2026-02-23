import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Routes, Route } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { useHelpArticles } from '@/hooks/useHelpArticles';
import { helpCategories, type HelpCategory } from '@/data/helpArticles';
import { type TourId } from '@/data/tourSteps';
import { LearningPathView } from '@/components/tutorial/LearningPathView';
import {
  Search,
  ChevronRight,
  ArrowLeft,
  Rocket,
  Zap,
  LayoutPanelLeft,
  FlaskConical,
  TrendingUp,
  MessageSquare,
  Settings,
  Shield,
  HelpCircle,
  BookOpen,
  Play,
  GraduationCap,
  Pencil,
  RotateCcw,
  Save,
  Loader2,
} from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  Rocket, Zap, LayoutPanelLeft, FlaskConical,
  TrendingUp, MessageSquare, Settings, Shield, HelpCircle, BookOpen,
};

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`list-${elements.length}`} className="list-disc pl-6 space-y-1 mb-4">{listItems}</ul>);
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trimEnd();

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h1 key={i} className="text-2xl font-bold mb-4 text-foreground">{trimmed.slice(2)}</h1>);
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h2 key={i} className="text-xl font-semibold mt-6 mb-3 text-foreground">{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h3 key={i} className="text-lg font-semibold mt-4 mb-2 text-foreground">{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith('- **')) {
      inList = true;
      const match = trimmed.match(/^- \*\*(.+?)\*\*\s*[-—]?\s*(.*)/);
      if (match) {
        listItems.push(
          <li key={i} className="text-muted-foreground">
            <strong className="text-foreground">{match[1]}</strong>
            {match[2] ? ` — ${match[2]}` : ''}
          </li>
        );
      } else {
        const text = trimmed.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        listItems.push(<li key={i} className="text-muted-foreground" dangerouslySetInnerHTML={{ __html: text }} />);
      }
    } else if (trimmed.startsWith('- ')) {
      inList = true;
      const text = trimmed.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      listItems.push(<li key={i} className="text-muted-foreground" dangerouslySetInnerHTML={{ __html: text }} />);
    } else if (/^\d+\.\s/.test(trimmed)) {
      flushList();
      const text = trimmed.replace(/^\d+\.\s/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (!inList) {
        elements.push(<ol key={`ol-start-${i}`} className="list-decimal pl-6 space-y-1 mb-4" />);
      }
      elements.push(
        <div key={i} className="flex gap-2 pl-6 mb-1">
          <span className="text-muted-foreground font-medium min-w-[20px]">{trimmed.match(/^(\d+)\./)?.[1]}.</span>
          <span className="text-muted-foreground" dangerouslySetInnerHTML={{ __html: text }} />
        </div>
      );
    } else if (trimmed === '') {
      flushList();
    } else {
      flushList();
      const text = trimmed
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">$1</code>');
      elements.push(<p key={i} className="text-muted-foreground mb-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: text }} />);
    }
  });
  flushList();

  return <div className="prose-sm max-w-none">{elements}</div>;
}

function HelpHome() {
  const [search, setSearch] = useState('');
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { searchArticles, getArticlesByCategory, canEdit } = useHelpArticles();

  const results = useMemo(() => searchArticles(search), [searchArticles, search]);
  const visibleCategories = useMemo(
    () => helpCategories.filter(c => !c.adminOnly || isAdmin()),
    [isAdmin]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground text-lg">Find answers, learn features, and get the most out of Cohi.</p>
        {canEdit && (
          <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 dark:text-amber-400">
            <Pencil className="w-3 h-3 mr-1" />
            Editor Mode — click any article to edit
          </Badge>
        )}
      </div>

      <div className="relative max-w-xl mx-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="Search help articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-12 text-base"
        />
      </div>

      {!search.trim() && (
        <div className="max-w-md mx-auto">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow group border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20"
            onClick={() => navigate('/help/learning-paths')}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Learning Paths</h3>
                <p className="text-sm text-muted-foreground">Role-based weekly learning plans</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {search.trim() ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{results.length} result{results.length !== 1 ? 's' : ''}</p>
          {results.map((article) => (
            <Card
              key={article.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/help/${article.categorySlug}/${article.slug}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant="secondary" className="mb-2 text-xs">{article.category}</Badge>
                    <h3 className="font-semibold">{article.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{article.summary}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
          {results.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No articles found. Try a different search term or browse categories below.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleCategories.map((cat) => {
            const Icon = iconMap[cat.icon] || HelpCircle;
            const articleCount = getArticlesByCategory(cat.slug).length;
            return (
              <Card
                key={cat.slug}
                className="cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/help/${cat.slug}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {cat.label}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CardDescription>{cat.description}</CardDescription>
                  <p className="text-xs text-muted-foreground mt-2">{articleCount} article{articleCount !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { getArticlesByCategory, isOverridden } = useHelpArticles();

  const category = helpCategories.find(c => c.slug === categorySlug);
  if (!category) return <div className="text-center py-12">Category not found</div>;
  if (category.adminOnly && !isAdmin()) return <div className="text-center py-12">Access denied</div>;

  const articles = getArticlesByCategory(categorySlug!).filter(a => !a.adminOnly || isAdmin());
  const Icon = iconMap[category.icon] || HelpCircle;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/help')} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
          <Icon className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{category.label}</h1>
          <p className="text-muted-foreground">{category.description}</p>
        </div>
      </div>

      <div className="space-y-3">
        {articles.map((article) => (
          <Card
            key={article.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/help/${categorySlug}/${article.slug}`)}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{article.title}</h3>
                    {isOverridden(article.id) && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-600 dark:text-amber-400">
                        Edited
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{article.summary}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ArticleEditor({
  open,
  onOpenChange,
  articleId,
  initialTitle,
  initialSummary,
  initialContent,
  isOverridden,
  onSave,
  onRevert,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string;
  initialTitle: string;
  initialSummary: string;
  initialContent: string;
  isOverridden: boolean;
  onSave: (data: { title: string; summary: string; content: string }) => Promise<void>;
  onRevert: () => Promise<void>;
  saving: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [content, setContent] = useState(initialContent);
  const [previewTab, setPreviewTab] = useState<string>('edit');

  const handleSave = useCallback(async () => {
    await onSave({ title, summary, content });
    onOpenChange(false);
  }, [title, summary, content, onSave, onOpenChange]);

  const handleRevert = useCallback(async () => {
    await onRevert();
    onOpenChange(false);
  }, [onRevert, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Edit Article
            {isOverridden && (
              <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 dark:text-amber-400">
                Has overrides
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Edit the help article content. Changes are saved to the database and override the built-in defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Summary</label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Brief summary shown in article lists"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Content (Markdown)</label>
            <Tabs value={previewTab} onValueChange={setPreviewTab}>
              <TabsList className="mb-2">
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="mt-0">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Article content in markdown..."
                  className="min-h-[400px] font-mono text-sm"
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-0">
                <Card>
                  <CardContent className="p-6 max-h-[400px] overflow-y-auto">
                    <SimpleMarkdown content={content} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-4 border-t">
          <div>
            {isOverridden && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevert}
                disabled={saving}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Revert to Default
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArticlePage() {
  const { categorySlug, articleSlug } = useParams<{ categorySlug: string; articleSlug: string }>();
  const navigate = useNavigate();
  const { startTour } = useTutorial();
  const { getArticleBySlug, getArticlesByCategory, isOverridden, saveOverride, revertOverride, saving, canEdit } = useHelpArticles();
  const [editorOpen, setEditorOpen] = useState(false);

  const article = getArticleBySlug(categorySlug!, articleSlug!);
  if (!article) return <div className="text-center py-12">Article not found</div>;

  const category = helpCategories.find(c => c.slug === categorySlug);
  const relatedArticles = getArticlesByCategory(categorySlug!).filter(a => a.id !== article.id).slice(0, 3);
  const articleIsOverridden = isOverridden(article.id);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" onClick={() => navigate('/help')} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            Help Center
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <Button variant="ghost" size="sm" onClick={() => navigate(`/help/${categorySlug}`)}>
            {category?.label}
          </Button>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            {articleIsOverridden && (
              <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 dark:text-amber-400">
                Edited
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditorOpen(true)}
              className="gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Article
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-6 md:p-8">
          {article.relatedTour && (
            <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 flex items-center justify-between">
              <span className="text-sm text-blue-700 dark:text-blue-300">
                Want a hands-on walkthrough? Take the interactive tour.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigate(article.relatedTour === 'workbench' ? '/my-dashboard' :
                    article.relatedTour === 'research' ? '/research' :
                    article.relatedTour === 'admin' ? '/admin' :
                    '/insights');
                  setTimeout(() => startTour(article.relatedTour as TourId), 500);
                }}
                className="gap-1"
              >
                <Play className="w-3.5 h-3.5" />
                Start Tour
              </Button>
            </div>
          )}

          <SimpleMarkdown content={article.content} />
        </CardContent>
      </Card>

      {relatedArticles.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Related Articles</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {relatedArticles.map((a) => (
              <Card
                key={a.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/help/${a.categorySlug}/${a.slug}`)}
              >
                <CardContent className="p-4">
                  <h4 className="font-medium text-sm">{a.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{a.summary}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <ArticleEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          articleId={article.id}
          initialTitle={article.title}
          initialSummary={article.summary}
          initialContent={article.content}
          isOverridden={articleIsOverridden}
          onSave={(data) => saveOverride(article.id, data)}
          onRevert={() => revertOverride(article.id)}
          saving={saving}
        />
      )}
    </div>
  );
}

export default function HelpCenter() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
        <Routes>
          <Route index element={<HelpHome />} />
          <Route path="learning-paths" element={<LearningPathView />} />
          <Route path=":categorySlug" element={<CategoryPage />} />
          <Route path=":categorySlug/:articleSlug" element={<ArticlePage />} />
        </Routes>
      </div>
    </div>
  );
}
