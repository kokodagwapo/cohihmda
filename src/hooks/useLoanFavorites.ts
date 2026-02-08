import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface UseLoanFavoritesReturn {
  favoriteIds: Set<string>;
  isLoading: boolean;
  toggleFavorite: (loanId: string) => void;
  isFavorited: (loanId: string) => boolean;
}

/**
 * Hook for managing persistent loan favorites
 * Stores favorites in both API (for cross-device sync) and localStorage (for instant access)
 * Follows the same pattern as useDashboardVisibility
 */
export function useLoanFavorites(): UseLoanFavoritesReturn {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Convert Set to Array for storage
  const setToArray = (set: Set<string>): string[] => Array.from(set);
  
  // Convert Array to Set for component use
  const arrayToSet = (arr: string[]): Set<string> => {
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter(id => typeof id === 'string'));
  };

  // Load favorites from database
  const loadFavorites = async () => {
    try {
      try {
        const preference = await api.request<{ preference_value: string[] | null }>('/api/user/preferences/loanFavorites');
        if (preference?.preference_value && Array.isArray(preference.preference_value)) {
          const favoritesSet = arrayToSet(preference.preference_value);
          setFavoriteIds(favoritesSet);
          localStorage.setItem('loanFavorites', JSON.stringify(preference.preference_value));
        } else {
          // Fallback to localStorage
          const saved = localStorage.getItem('loanFavorites');
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed)) {
                const favoritesSet = arrayToSet(parsed);
                setFavoriteIds(favoritesSet);
                // Save to database for future use
                await saveFavorites(favoritesSet);
              } else {
                setFavoriteIds(new Set());
              }
            } catch {
              setFavoriteIds(new Set());
            }
          } else {
            setFavoriteIds(new Set());
          }
        }
      } catch (error: any) {
        // If API call fails, fall through to outer catch
        throw error;
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        // User not authenticated - fallback to localStorage without logging error
      } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        // For timeout errors, log as warning since we have localStorage fallback
        console.warn('Loan favorites request timed out, using localStorage fallback:', error.message);
      } else {
        console.error('Error loading loan favorites:', error);
      }
      // Fallback to localStorage
      const saved = localStorage.getItem('loanFavorites');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setFavoriteIds(arrayToSet(parsed));
          } else {
            setFavoriteIds(new Set());
          }
        } catch {
          // Use default empty set
          setFavoriteIds(new Set());
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Save favorites to database
  const saveFavorites = async (favoritesSet: Set<string>) => {
    try {
      const favoritesArray = setToArray(favoritesSet);
      
      // Save to localStorage immediately for instant access
      localStorage.setItem('loanFavorites', JSON.stringify(favoritesArray));

      // Save to database via API
      try {
        await api.request('/api/user/preferences/loanFavorites', {
          method: 'PUT',
          body: JSON.stringify({ preference_value: favoritesArray }),
        });
      } catch (error: any) {
        // If not authenticated, just use localStorage
        if (error.message?.includes('Unauthorized')) {
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('Error saving loan favorites:', error);
      // Still save to localStorage even if database save fails
      const favoritesArray = setToArray(favoritesSet);
      localStorage.setItem('loanFavorites', JSON.stringify(favoritesArray));
    }
  };

  // Load favorites on mount
  useEffect(() => {
    loadFavorites();
  }, []);

  // Toggle favorite and persist
  const toggleFavorite = useCallback((loanId: string) => {
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (next.has(loanId)) {
        next.delete(loanId);
      } else {
        next.add(loanId);
      }
      // Save to both localStorage and API
      saveFavorites(next);
      return next;
    });
  }, []);

  // Check if loan is favorited
  const isFavorited = useCallback((id: string) => favoriteIds.has(id), [favoriteIds]);

  return {
    favoriteIds,
    isLoading,
    toggleFavorite,
    isFavorited
  };
}
