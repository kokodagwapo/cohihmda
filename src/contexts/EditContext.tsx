/**
 * EditContext - Backward compatibility layer
 * 
 * DEPRECATED: This context is being phased out.
 * - For authentication: Use AuthContext (useAuth hook)
 * - For content editing: Use ContentContext (useContent hook)
 * 
 * This file maintains backward compatibility during migration.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';

interface EditableContent {
  [key: string]: string | number;
}

interface EditContextType {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  editableContent: EditableContent;
  updateContent: (key: string, value: string | number) => void;
  /** @deprecated Use useAuth() from AuthContext instead */
  isAuthenticated: boolean;
  /** @deprecated Use useAuth() from AuthContext instead */
  setIsAuthenticated: (value: boolean) => void;
  /** @deprecated Use useAuth().logout() from AuthContext instead */
  logout: () => void;
  isSaving: boolean;
  lastSaved: Date | null;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

const STORAGE_KEY = 'editable_dashboard_content';

export function EditProvider({ children }: { children: ReactNode }) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editableContent, setEditableContent] = useState<EditableContent>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn('Failed to load stored content:', error);
      return {};
    }
  });

  // Persist content changes to localStorage immediately
  useEffect(() => {
    if (Object.keys(editableContent).length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(editableContent));
      } catch (error) {
        console.warn('Failed to persist content to localStorage:', error);
      }
    }
  }, [editableContent]);

  const updateContent = useCallback((key: string, value: string | number) => {
    // Update local state immediately for instant UI feedback
    setEditableContent(prev => ({
      ...prev,
      [key]: value
    }));
    
    // Save to localStorage
    setIsSaving(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const current = stored ? JSON.parse(stored) : {};
      current[key] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save to localStorage:', err);
    } finally {
      setIsSaving(false);
    }
  }, []);

  return (
    <EditContext.Provider value={{
      isEditMode,
      setIsEditMode,
      editableContent,
      updateContent,
      // Deprecated auth properties - will be removed in future
      isAuthenticated: false, // Always false - use AuthContext
      setIsAuthenticated: () => {
        console.warn('setIsAuthenticated is deprecated. Use AuthContext instead.');
      },
      logout: () => {
        console.warn('logout is deprecated. Use AuthContext.logout() instead.');
      },
      isSaving,
      lastSaved
    }}>
      {children}
    </EditContext.Provider>
  );
}

/**
 * @deprecated Use useAuth() for authentication, useContent() for content editing
 */
export function useEdit() {
  const context = useContext(EditContext);
  if (context === undefined) {
    throw new Error('useEdit must be used within an EditProvider');
  }
  return context;
}
