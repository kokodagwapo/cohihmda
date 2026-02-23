import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { helpArticles } from '@/data/helpArticles';

export function useSeedHelpContent() {
  const [isSeeding, setIsSeeding] = useState(false);
  const [result, setResult] = useState<{ inserted: number; updated: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seedKnowledgeBase = useCallback(async () => {
    setIsSeeding(true);
    setError(null);
    setResult(null);

    try {
      const articles = helpArticles.map(a => ({
        id: a.id,
        title: a.title,
        category: a.category,
        content: a.content,
        summary: a.summary,
      }));

      const data = await api.request<{ inserted: number; updated: number; total: number }>(
        '/api/help/seed-knowledge-base',
        {
          method: 'POST',
          body: JSON.stringify({ articles }),
        }
      );

      setResult(data);
      return data;
    } catch (err: any) {
      setError(err.message || 'Failed to seed knowledge base');
      throw err;
    } finally {
      setIsSeeding(false);
    }
  }, []);

  return { seedKnowledgeBase, isSeeding, result, error };
}
