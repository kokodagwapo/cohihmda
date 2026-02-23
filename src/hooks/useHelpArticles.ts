import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  helpArticles as defaultArticles,
  helpCategories,
  type HelpArticle,
  type HelpCategory,
} from '@/data/helpArticles';

function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

interface ArticleOverride {
  article_id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

interface UseHelpArticlesReturn {
  articles: HelpArticle[];
  categories: HelpCategory[];
  getArticlesByCategory: (categorySlug: string) => HelpArticle[];
  getArticleBySlug: (categorySlug: string, articleSlug: string) => HelpArticle | undefined;
  searchArticles: (query: string) => HelpArticle[];
  isOverridden: (articleId: string) => boolean;
  saveOverride: (articleId: string, data: { title?: string; summary?: string; content?: string }) => Promise<void>;
  revertOverride: (articleId: string) => Promise<void>;
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
}

export function useHelpArticles(): UseHelpArticlesReturn {
  const { isPlatformStaff } = useAuth();
  const [overrides, setOverrides] = useState<Map<string, ArticleOverride>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = isPlatformStaff();

  useEffect(() => {
    if (!canEdit) return;
    const token = getAuthToken();
    if (!token) return;

    let cancelled = false;
    setLoading(true);

    fetch('/api/help/overrides', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch')))
      .then(data => {
        if (cancelled) return;
        const map = new Map<string, ArticleOverride>();
        for (const o of data.overrides || []) {
          map.set(o.article_id, o);
        }
        setOverrides(map);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [canEdit]);

  const articles = useMemo(() => {
    if (overrides.size === 0) return defaultArticles;

    return defaultArticles.map(article => {
      const override = overrides.get(article.id);
      if (!override) return article;
      return {
        ...article,
        title: override.title || article.title,
        summary: override.summary || article.summary,
        content: override.content || article.content,
      };
    });
  }, [overrides]);

  const getArticlesByCategory = useCallback(
    (categorySlug: string) => articles.filter(a => a.categorySlug === categorySlug),
    [articles]
  );

  const getArticleBySlug = useCallback(
    (categorySlug: string, articleSlug: string) =>
      articles.find(a => a.categorySlug === categorySlug && a.slug === articleSlug),
    [articles]
  );

  const searchArticles = useCallback(
    (query: string) => {
      const q = query.toLowerCase().trim();
      if (!q) return [];
      return articles.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    },
    [articles]
  );

  const isOverridden = useCallback(
    (articleId: string) => overrides.has(articleId),
    [overrides]
  );

  const saveOverride = useCallback(
    async (articleId: string, data: { title?: string; summary?: string; content?: string }) => {
      const token = getAuthToken();
      if (!token) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/help/overrides/${articleId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to save');

        setOverrides(prev => {
          const next = new Map(prev);
          next.set(articleId, {
            article_id: articleId,
            title: data.title || null,
            summary: data.summary || null,
            content: data.content || null,
            updated_by: null,
            updated_at: new Date().toISOString(),
          });
          return next;
        });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const revertOverride = useCallback(
    async (articleId: string) => {
      const token = getAuthToken();
      if (!token) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/help/overrides/${articleId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to revert');

        setOverrides(prev => {
          const next = new Map(prev);
          next.delete(articleId);
          return next;
        });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return {
    articles,
    categories: helpCategories,
    getArticlesByCategory,
    getArticleBySlug,
    searchArticles,
    isOverridden,
    saveOverride,
    revertOverride,
    loading,
    saving,
    canEdit,
  };
}
