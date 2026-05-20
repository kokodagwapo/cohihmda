/**
 * Research report tab — chat-style user / Cohi transcript.
 */

import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { renderMarkdownText } from "@/utils/renderMarkdown";
import type { ChatMessage } from "@/hooks/useCohiChat";

export interface ResearchChatTranscriptProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  className?: string;
}

export function ResearchChatTranscript({
  messages,
  isLoading = false,
  className,
}: ResearchChatTranscriptProps) {
  if (messages.length === 0 && !isLoading) {
    return (
      <p className="text-xs text-slate-500 py-4 px-1">
        Your question and Cohi&apos;s answer will appear here.
      </p>
    );
  }

  return (
    <div className={cn("space-y-4 min-w-0", className)}>
      {messages.map((message) => {
        const isUser = message.role === "user";
        return (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex w-full min-w-0", isUser ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "rounded-2xl min-w-0 text-sm leading-relaxed",
                isUser
                  ? "max-w-[88%] bg-gradient-to-br from-blue-100 to-blue-200 text-blue-900 dark:from-blue-900/40 dark:to-indigo-900/40 dark:text-blue-100 px-4 py-2.5 shadow-sm"
                  : "w-full border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/60 shadow-sm px-4 py-3",
              )}
            >
              {message.isLoading ? (
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
                  <span>Analyzing your data…</span>
                </div>
              ) : (
                <div
                  className={cn(
                    "prose prose-sm dark:prose-invert max-w-none break-words",
                    isUser && "prose-p:my-0 prose-headings:my-1",
                  )}
                >
                  {renderMarkdownText(message.content || "")}
                </div>
              )}
              {message.error && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {message.error}
                </p>
              )}
            </div>
          </motion.div>
        );
      })}
      {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
        <div className="flex justify-start">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
              <span>Research in progress…</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
