import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

interface EditableContent {
  [key: string]: string | number;
}

interface EditContextType {
  isEditMode: boolean;
  setIsEditMode: (value: boolean) => void;
  editableContent: EditableContent;
  updateContent: (key: string, value: string | number) => void;
  isAuthenticated: boolean;
  setIsAuthenticated: (value: boolean) => void;
  logout: () => void;
  isSaving: boolean;
  lastSaved: Date | null;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

const STORAGE_KEY = 'editable_dashboard_content';
const AUTH_KEY = 'dashboard_auth';

export function EditProvider({ children }: { children: ReactNode }) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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

  // Check authentication on mount
  useEffect(() => {
    try {
      const storedAuth = sessionStorage.getItem(AUTH_KEY);
      if (storedAuth === 'authenticated') {
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.warn('Failed to check authentication:', error);
    }
  }, []);

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

  const logout = () => {
    setIsAuthenticated(false);
    setIsEditMode(false);
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch (error) {
      console.warn('Failed to remove auth from sessionStorage:', error);
    }
  };

  return (
    <EditContext.Provider value={{
      isEditMode,
      setIsEditMode,
      editableContent,
      updateContent,
      isAuthenticated,
      setIsAuthenticated,
      logout,
      isSaving,
      lastSaved
    }}>
      {children}
    </EditContext.Provider>
  );
}

export function useEdit() {
  const context = useContext(EditContext);
  if (context === undefined) {
    throw new Error('useEdit must be used within an EditProvider');
  }
  return context;
}
