/**
 * InsightChat
 *
 * Inline chat for follow-up questions about an agent-generated insight.
 * Sends the insight's context (title, summary, keyMetrics, evidence SQL)
 * to the backend, which can run additional queries and return an LLM response.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, MessageSquare, User, Bot } from "lucide-react";
import { api } from "@/lib/api";
import { renderMarkdownText } from "@/utils/renderMarkdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface InsightChatProps {
  insightContext: {
    title: string;
    summary: string;
    confidence?: string;
    keyMetrics?: Record<string, string | number>;
    evidence?: Array<{
      sql: string;
      explanation: string;
      rowCount: number;
      fields?: string[];
    }>;
  };
  selectedTenantId?: string | null;
  starterQuestions?: string[];
}

export function InsightChat({ insightContext, selectedTenantId, starterQuestions }: InsightChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const data = await api.insightChat(insightContext, newMessages, selectedTenantId);
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Sorry, I encountered an error: ${err.message || "Unknown error"}` },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, messages, isLoading, insightContext, selectedTenantId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-blue-500" />
        <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          Ask about this insight
        </h4>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="space-y-3 max-h-64 overflow-y-auto mb-3 scroll-smooth"
      >
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">
              Ask a follow-up question — Cohi can run additional queries to dig deeper.
            </p>
            {starterQuestions && starterQuestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {starterQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:border-blue-800 dark:hover:text-blue-300 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mt-0.5">
                <Bot className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
            )}
            <div
              className={`rounded-xl px-3 py-2 text-sm max-w-[85%] ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="text-sm leading-relaxed">{renderMarkdownText(msg.content)}</div>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center mt-0.5">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2 items-center">
            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <div className="rounded-xl px-3 py-2 bg-slate-100 dark:bg-slate-800">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question..."
          disabled={isLoading}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          title="Send message"
          className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-blue-500"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
