/**
 * Data Chat Panel Component
 * AI-powered chat interface for querying loan data
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, 
  Send, 
  X, 
  Minimize2, 
  Maximize2,
  Save,
  RefreshCw,
  Trash2,
  Sparkles,
  ChevronDown,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useDataChat, ChatMessage, VisualizationConfig } from '@/hooks/useDataChat';
import { DynamicVisualization } from '@/components/visualizations/DynamicVisualization';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// ============================================================================
// Types
// ============================================================================

interface DataChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
  className?: string;
}

interface SaveDialogState {
  isOpen: boolean;
  visualization: VisualizationConfig | null;
  question: string;
}

// ============================================================================
// Main Component
// ============================================================================

export const DataChatPanel: React.FC<DataChatPanelProps> = ({
  isOpen,
  onClose,
  tenantId,
  className,
}) => {
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [saveDialog, setSaveDialog] = useState<SaveDialogState>({
    isOpen: false,
    visualization: null,
    question: '',
  });
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const {
    messages,
    isLoading,
    suggestedQuestions,
    sendMessage,
    saveVisualization,
    clearMessages,
    newSession,
  } = useDataChat({ tenantId });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  /**
   * Handle send message
   */
  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

  /**
   * Handle key press (Enter to send)
   */
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Handle suggested question click
   */
  const handleSuggestionClick = (question: string) => {
    setInput(question);
    sendMessage(question);
  };

  /**
   * Open save dialog
   */
  const handleOpenSaveDialog = (visualization: VisualizationConfig, question: string) => {
    setSaveTitle(visualization.title || 'My Visualization');
    setSaveDescription('');
    setSaveDialog({ isOpen: true, visualization, question });
  };

  /**
   * Handle save visualization
   */
  const handleSave = async () => {
    if (!saveDialog.visualization) return;
    
    try {
      await saveVisualization(
        saveDialog.visualization,
        saveDialog.question,
        saveTitle,
        saveDescription
      );
      
      toast({
        title: 'Saved!',
        description: 'Visualization saved to your dashboard.',
      });
      
      setSaveDialog({ isOpen: false, visualization: null, question: '' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save visualization',
        variant: 'destructive',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className={cn(
          "fixed right-0 top-0 h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-xl z-50 flex flex-col transition-all duration-300",
          isExpanded ? "w-[450px]" : "w-[350px]",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-slate-900 dark:text-white">Data Chat</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={newSession}
              title="New conversation"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Minimize" : "Expand"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Sparkles className="w-12 h-12 mx-auto mb-4 text-blue-500 opacity-50" />
                <h3 className="font-medium text-slate-900 dark:text-white mb-2">
                  Ask about your data
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                  I can help you explore your loan data with natural language questions.
                </p>
                
                {/* Suggested Questions */}
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Try asking:</p>
                  {suggestedQuestions.slice(0, 4).map((question, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(question)}
                      className="block w-full text-left px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-700 dark:text-slate-300"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessageBubble
                key={message.id}
                message={message}
                onSave={(viz, q) => handleOpenSaveDialog(viz, q)}
                isExpanded={isExpanded}
              />
            ))}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Suggestions */}
        {messages.length > 0 && suggestedQuestions.length > 0 && !isLoading && (
          <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs text-slate-400 shrink-0">Try:</span>
              {suggestedQuestions.slice(0, 3).map((question, index) => (
                <button
                  key={index}
                  onClick={() => handleSuggestionClick(question)}
                  className="shrink-0 text-xs px-2 py-1 bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors text-slate-600 dark:text-slate-300"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about your data..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button 
              onClick={handleSend} 
              disabled={!input.trim() || isLoading}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Save Dialog */}
      <Dialog open={saveDialog.isOpen} onOpenChange={(open) => !open && setSaveDialog({ isOpen: false, visualization: null, question: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to My Dashboard</DialogTitle>
            <DialogDescription>
              Save this visualization to your custom dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="My Visualization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="What does this visualization show?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialog({ isOpen: false, visualization: null, question: '' })}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!saveTitle.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ============================================================================
// Message Bubble Component
// ============================================================================

interface ChatMessageBubbleProps {
  message: ChatMessage;
  onSave: (visualization: VisualizationConfig, question: string) => void;
  isExpanded: boolean;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message, onSave, isExpanded }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[90%] rounded-lg",
          isUser
            ? "bg-blue-500 text-white px-4 py-2"
            : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white"
        )}
      >
        {message.isLoading ? (
          <div className="flex items-center gap-2 px-4 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Analyzing your data...</span>
          </div>
        ) : (
          <>
            {/* Text content */}
            {message.content && (
              <p className={cn(
                "text-sm whitespace-pre-wrap",
                !isUser && "px-4 py-2"
              )}>
                {message.content}
              </p>
            )}
            
            {/* Error */}
            {message.error && (
              <div className="px-4 py-2 flex items-center gap-2 text-red-500 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>Error: {message.error}</span>
              </div>
            )}
            
            {/* Visualization */}
            {message.visualization && !message.error && (
              <div className="mt-2">
                <DynamicVisualization
                  config={message.visualization}
                  height={isExpanded ? 250 : 180}
                  compact={!isExpanded}
                  showTitle
                />
                
                {/* Actions */}
                <div className="flex justify-end gap-2 px-4 py-2 border-t border-slate-200 dark:border-slate-700">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSave(message.visualization!, message.content)}
                    className="text-xs"
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DataChatPanel;
