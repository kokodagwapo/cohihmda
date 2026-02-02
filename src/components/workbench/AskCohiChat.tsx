import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconBadge } from '@/components/workbench/IconBadge';
import { cn } from '@/lib/utils';

export interface AskCohiChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  loading: boolean;
  onSend: (prompt: string) => void;
  className?: string;
}

export function AskCohiChat({ open, onOpenChange, messages, loading, onSend, className }: AskCohiChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const handleSubmit = () => {
    const t = input.trim();
    if (!t || loading) return;
    setInput('');
    onSend(t);
  };

  if (!open) {
    return (
      <div
        className={cn(
          'flex flex-col justify-center border-l border-slate-200/70 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-900/80 w-12 shrink-0',
          className
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 mx-auto rounded-xl hover:bg-sky-100/80 dark:hover:bg-sky-900/30 transition-colors"
          onClick={() => onOpenChange(true)}
          aria-label="Open Ask Cohi"
        >
          <MessageCircle className="h-5 w-5 text-sky-600 dark:text-sky-400" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div 
        className="fixed inset-0 bg-white/40 dark:bg-slate-900/40 backdrop-blur-[2px] z-[100]"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed right-0 top-0 bottom-0 flex flex-col border-l border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-900 w-[340px] sm:w-[380px] transition-all duration-200 shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.1)] dark:shadow-none z-[110]',
          className
        )}
      >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-3 border-b border-slate-200/70 dark:border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <IconBadge icon={MessageCircle} variant="sky" size="sm" rounded="lg" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">Ask Cohi</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5" ref={scrollRef}>
        <div className="space-y-4 pb-2">
          {messages.length === 0 && !loading && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Ask questions in plain language. Cohi can use connected dashboards, insights, and knowledge sources (news or policy docs if loaded) to explain metrics, suggest views, and recommend next steps.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                m.role === 'user'
                  ? 'bg-sky-100/90 dark:bg-sky-900/40 text-slate-900 dark:text-slate-100 ml-8'
                  : 'bg-slate-100/90 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 mr-2'
              )}
            >
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400 text-[13px]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40">
                <Loader2 className="h-4 w-4 animate-spin text-sky-600 dark:text-sky-400" />
              </span>
              <span>Cohi is thinking…</span>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="p-3.5 border-t border-slate-200/70 dark:border-slate-700/50 shrink-0">
        <div className="flex gap-2">
          <Input
            placeholder="Ask a follow-up…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            className="flex-1 h-10 text-sm rounded-xl border-slate-200/80 dark:border-slate-700/80 focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-800/60"
            disabled={loading}
          />
          <Button
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 hover:bg-sky-200/80 dark:hover:bg-sky-800/60 transition-colors"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      </div>
    </>
  );
}
