import React, { useState, useRef, useEffect } from 'react';
import { useEdit } from '@/contexts/EditContext';
import { Pencil, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditableTextProps {
  id: string;
  defaultValue: string | number;
  className?: string;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';
  type?: 'text' | 'number';
  prefix?: string;
  suffix?: string;
  onChange?: (value: string | number) => void;
}

export function EditableText({
  id,
  defaultValue,
  className = '',
  as: Component = 'span',
  type = 'text',
  prefix = '',
  suffix = '',
  onChange
}: EditableTextProps) {
  const { isEditMode, editableContent, updateContent, isAuthenticated } = useEdit();
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const currentValue = editableContent[id] ?? defaultValue;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEdit = () => {
    if (!isAuthenticated || !isEditMode) return;
    setTempValue(String(currentValue));
    setIsEditing(true);
  };

  const handleSave = () => {
    const newValue = type === 'number' ? parseFloat(tempValue) || 0 : tempValue;
    updateContent(id, newValue);
    onChange?.(newValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  // Not in edit mode or not authenticated - just render the text
  if (!isAuthenticated || !isEditMode) {
    return (
      <Component className={className}>
        {prefix}{currentValue}{suffix}
      </Component>
    );
  }

  // In edit mode but not currently editing this field
  if (!isEditing) {
    return (
      <Component
        className={cn(
          className,
          'group relative cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded px-1 -mx-1 transition-colors ring-1 ring-transparent hover:ring-blue-200 dark:hover:ring-blue-800'
        )}
        onClick={handleEdit}
      >
        {prefix}{currentValue}{suffix}
        <Pencil className="inline-block w-3 h-3 ml-1.5 opacity-0 group-hover:opacity-60 text-blue-500 transition-opacity" />
      </Component>
    );
  }

  // Currently editing this field
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        ref={inputRef}
        type={type}
        value={tempValue}
        onChange={(e) => setTempValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className={cn(
          'bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-600',
          type === 'number' ? 'w-24' : 'min-w-[100px]',
          className
        )}
        style={{ fontSize: 'inherit', fontWeight: 'inherit' }}
      />
      <button
        onClick={handleSave}
        className="p-1 rounded bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900 transition-colors"
      >
        <Check className="w-3 h-3" />
      </button>
      <button
        onClick={handleCancel}
        className="p-1 rounded bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// Simplified version for numbers with formatting
interface EditableNumberProps {
  id: string;
  defaultValue: number;
  className?: string;
  format?: (value: number) => string;
  onChange?: (value: number) => void;
}

export function EditableNumber({
  id,
  defaultValue,
  className = '',
  format = (v) => String(v),
  onChange
}: EditableNumberProps) {
  const { isEditMode, editableContent, updateContent, isAuthenticated } = useEdit();
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const currentValue = (editableContent[id] as number) ?? defaultValue;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEdit = () => {
    if (!isAuthenticated || !isEditMode) return;
    setTempValue(String(currentValue));
    setIsEditing(true);
  };

  const handleSave = () => {
    const newValue = parseFloat(tempValue) || 0;
    updateContent(id, newValue);
    onChange?.(newValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setTempValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (!isAuthenticated || !isEditMode) {
    return <span className={className}>{format(currentValue)}</span>;
  }

  if (!isEditing) {
    return (
      <span
        className={cn(
          className,
          'group relative cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded px-1 -mx-1 transition-colors ring-1 ring-transparent hover:ring-blue-200 dark:hover:ring-blue-800'
        )}
        onClick={handleEdit}
      >
        {format(currentValue)}
        <Pencil className="inline-block w-3 h-3 ml-1.5 opacity-0 group-hover:opacity-60 text-blue-500 transition-opacity" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="number"
        value={tempValue}
        onChange={(e) => setTempValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className="bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded px-2 py-0.5 w-24 outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-600"
        style={{ fontSize: 'inherit', fontWeight: 'inherit' }}
      />
      <button
        onClick={handleSave}
        className="p-1 rounded bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900 transition-colors"
      >
        <Check className="w-3 h-3" />
      </button>
      <button
        onClick={handleCancel}
        className="p-1 rounded bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

