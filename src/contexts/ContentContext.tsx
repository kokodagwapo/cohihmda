import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

/**
 * ContentContext - Manages editable content state for the dashboard
 * 
 * Note: Authentication has been moved to AuthContext.
 * This context now only handles content editing functionality.
 */

interface EditableContent {
  [key: string]: string | number;
}

interface ContentContextType {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  editableContent: EditableContent;
  updateContent: (key: string, value: string | number) => void;
  isSaving: boolean;
  lastSaved: Date | null;
}

const ContentContext = createContext<ContentContextType | undefined>(undefined);

const STORAGE_KEY = 'editable_dashboard_content';

export function ContentProvider({ children }: { children: ReactNode }) {
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
    <ContentContext.Provider value={{
      isEditMode,
      setIsEditMode,
      editableContent,
      updateContent,
      isSaving,
      lastSaved
    }}>
      {children}
    </ContentContext.Provider>
  );
}

export function useContent() {
  const context = useContext(ContentContext);
  if (context === undefined) {
    throw new Error('useContent must be used within a ContentProvider');
  }
  return context;
}

// Backward compatibility - deprecated, use useContent instead
export const useEdit = useContent;
