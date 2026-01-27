import { useRef, useEffect } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link,
  Code,
  Minus,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder = 'Enter content...' }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  };

  const ToolbarButton = ({ 
    onClick, 
    icon: Icon, 
    title 
  }: { 
    onClick: () => void; 
    icon: any; 
    title: string;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-8 w-8 p-0"
      title={title}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-wrap">
        <ToolbarButton onClick={() => execCommand('formatBlock', 'h1')} icon={Heading1} title="Heading 1" />
        <ToolbarButton onClick={() => execCommand('formatBlock', 'h2')} icon={Heading2} title="Heading 2" />
        <ToolbarButton onClick={() => execCommand('formatBlock', 'h3')} icon={Heading3} title="Heading 3" />
        <ToolbarButton onClick={() => execCommand('formatBlock', 'h4')} icon={Heading4} title="Heading 4" />
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
        <ToolbarButton onClick={() => execCommand('bold')} icon={Bold} title="Bold" />
        <ToolbarButton onClick={() => execCommand('italic')} icon={Italic} title="Italic" />
        <ToolbarButton onClick={() => execCommand('underline')} icon={Underline} title="Underline" />
        <ToolbarButton onClick={() => execCommand('strikeThrough')} icon={Strikethrough} title="Strikethrough" />
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
        <ToolbarButton onClick={() => execCommand('insertUnorderedList')} icon={List} title="Bullet List" />
        <ToolbarButton onClick={() => execCommand('insertOrderedList')} icon={ListOrdered} title="Numbered List" />
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
        <ToolbarButton onClick={() => execCommand('justifyLeft')} icon={AlignLeft} title="Align Left" />
        <ToolbarButton onClick={() => execCommand('justifyCenter')} icon={AlignCenter} title="Align Center" />
        <ToolbarButton onClick={() => execCommand('justifyRight')} icon={AlignRight} title="Align Right" />
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
        <ToolbarButton onClick={insertLink} icon={Link} title="Insert Link" />
        <ToolbarButton onClick={() => execCommand('formatBlock', 'pre')} icon={Code} title="Code Block" />
        <ToolbarButton onClick={() => execCommand('insertHorizontalRule')} icon={Minus} title="Horizontal Rule" />
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        className="p-4 focus:outline-none prose prose-sm max-w-none dark:prose-invert overflow-y-auto resize-y"
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          height: '400px',
          minHeight: '400px',
          maxHeight: '2000px',
        }}
        data-placeholder={placeholder}
        suppressContentEditableWarning
      />

      <style>{`
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        
        /* Heading Styles */
        [contenteditable] h1 {
          font-size: 2rem !important;
          font-weight: 700 !important;
          line-height: 1.2 !important;
          margin-top: 1.5rem !important;
          margin-bottom: 1rem !important;
          color: inherit;
        }
        
        [contenteditable] h2 {
          font-size: 1.625rem !important;
          font-weight: 700 !important;
          line-height: 1.3 !important;
          margin-top: 1.25rem !important;
          margin-bottom: 0.75rem !important;
          color: inherit;
        }
        
        [contenteditable] h3 {
          font-size: 1.375rem !important;
          font-weight: 700 !important;
          line-height: 1.4 !important;
          margin-top: 1rem !important;
          margin-bottom: 0.5rem !important;
          color: inherit;
        }
        
        [contenteditable] h4 {
          font-size: 1rem !important;
          font-weight: 700 !important;
          line-height: 1.4 !important;
          margin-top: 0.75rem !important;
          margin-bottom: 0.5rem !important;
          color: inherit;
        }
      `}</style>
    </div>
  );
}
