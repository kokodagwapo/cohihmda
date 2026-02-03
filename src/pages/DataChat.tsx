/**
 * Data Chat Page
 * Full-page AI-powered chat interface for querying loan data
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, 
  Save,
  RefreshCw,
  Sparkles,
  Loader2,
  AlertCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Table,
  PieChart,
  TrendingUp,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useCohiChat, ChatMessage, VisualizationConfig } from '@/hooks/useCohiChat';
import { DynamicVisualization } from '@/components/visualizations/DynamicVisualization';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTenants } from '@/hooks/admin/useTenants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Navigation } from '@/components/layout/Navigation';
import { Link } from 'react-router-dom';

// ============================================================================
// Types
// ============================================================================

interface SaveDialogState {
  isOpen: boolean;
  visualization: VisualizationConfig | null;
  question: string;
}

// ============================================================================
// Suggested Questions by Category
// ============================================================================

const QUESTION_CATEGORIES = [
  {
    title: 'Volume & Performance',
    icon: BarChart3,
    questions: [
      'Show me total loan volume by month for this year',
      'What is the average loan amount by loan type?',
      'Who are the top 10 loan officers by volume?',
      'Show me funded loans by branch',
    ],
  },
  {
    title: 'Pipeline & Status',
    icon: TrendingUp,
    questions: [
      'How many active loans are in the pipeline?',
      'Show me loans by current milestone',
      'What is the pull-through rate by loan officer?',
      'Show me loans that have been in processing for over 30 days',
    ],
  },
  {
    title: 'Regulations & Knowledge',
    icon: PieChart,
    questions: [
      'What are the FHA loan requirements?',
      'Explain DTI ratio guidelines',
      'What documentation is required for VA loans?',
      'What are the conforming loan limits?',
    ],
  },
  {
    title: 'Data + Knowledge',
    icon: Table,
    questions: [
      'How do our FHA loans compare to guidelines?',
      'Show me loans that might exceed DTI limits',
      'What percentage of our loans are government vs conventional?',
      'Analyze our VA loan volume trend',
    ],
  },
];

// ============================================================================
// Main Component
// ============================================================================

const DataChat: React.FC = () => {
  const { toast } = useToast();
  const { user, isPlatformStaff } = useAuth();
  const isPlatform = isPlatformStaff();
  const isDevMode = import.meta.env.DEV;
  const userTenantId = user?.tenant_id ?? null;
  const userTenantName = user?.tenant_name || 'My Tenant';
  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [saveDialog, setSaveDialog] = useState<SaveDialogState>({
    isOpen: false,
    visualization: null,
    question: '',
  });
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const { tenants, loading: tenantsLoading, loadTenants } = useTenants();
  const DEMO_TENANT_VALUE = 'demo-data';
  const [selectedTenantValue, setSelectedTenantValue] = useState<string | null>(userTenantId);
  const hasUserSelectedTenantRef = useRef(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousTenantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isPlatform) {
      loadTenants();
    }
  }, [isPlatform, loadTenants]);

  useEffect(() => {
    if (hasUserSelectedTenantRef.current) return;
    if (isPlatform && isDevMode) {
      setSelectedTenantValue(DEMO_TENANT_VALUE);
    } else if (userTenantId) {
      setSelectedTenantValue(userTenantId);
    }
  }, [isPlatform, isDevMode, userTenantId]);

  const demoTenantId = useMemo(() => {
    if (tenants.length === 0) return null;
    const demoTenant = tenants.find(tenant => /demo|sample/i.test(tenant.name));
    return demoTenant?.id ?? tenants[0]?.id ?? null;
  }, [tenants]);

  const resolvedTenantId = useMemo(() => {
    if (isPlatform) {
      if (selectedTenantValue === DEMO_TENANT_VALUE) {
        return demoTenantId;
      }
      return selectedTenantValue || null;
    }
    return userTenantId;
  }, [isPlatform, selectedTenantValue, demoTenantId, userTenantId]);

  const tenantReady = !isPlatform || !!resolvedTenantId;
  
  const {
    messages,
    isLoading,
    suggestedQuestions,
    sendMessage,
    saveVisualization,
    clearMessages,
    newSession,
  } = useCohiChat({ tenantId: resolvedTenantId || undefined });

  useEffect(() => {
    if (!resolvedTenantId) return;
    if (previousTenantIdRef.current && previousTenantIdRef.current !== resolvedTenantId) {
      newSession();
    }
    previousTenantIdRef.current = resolvedTenantId;
  }, [resolvedTenantId, newSession]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  /**
   * Handle send message
   */
  const handleSend = () => {
    if (!input.trim() || isLoading || !tenantReady) return;
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />
      
      <div className="pt-16 h-screen flex">
        {/* Sidebar with suggested questions */}
        <div 
          className={cn(
            "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 flex flex-col",
            showSidebar ? "w-80" : "w-0 overflow-hidden"
          )}
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-white">Explore Questions</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSidebar(false)}
              className="h-8 w-8"
            >
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {QUESTION_CATEGORIES.map((category, catIndex) => (
                <div key={catIndex}>
                  <div className="flex items-center gap-2 mb-3">
                    <category.icon className="w-4 h-4 text-blue-500" />
                    <h3 className="font-medium text-sm text-slate-700 dark:text-slate-300">
                      {category.title}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {category.questions.map((question, qIndex) => (
                      <button
                        key={qIndex}
                        onClick={() => handleSuggestionClick(question)}
                        disabled={isLoading}
                        className="block w-full text-left px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              {!showSidebar && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSidebar(true)}
                  className="h-8 w-8"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-blue-500" />
                <div>
                  <h1 className="font-semibold text-lg text-slate-900 dark:text-white">Cohi Chat</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Ask about data, regulations, or anything mortgage-related</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400" />
                <Select
                  value={selectedTenantValue ?? undefined}
                  onValueChange={(value) => {
                    hasUserSelectedTenantRef.current = true;
                    setSelectedTenantValue(value);
                  }}
                  disabled={!isPlatform || tenantsLoading}
                >
                  <SelectTrigger className="h-9 w-[180px] sm:w-[220px] text-sm font-light">
                    {tenantsLoading && isPlatform ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="text-xs">Loading tenants...</span>
                      </div>
                    ) : (
                      <SelectValue placeholder="Select tenant..." />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {isPlatform ? (
                      <>
                        <SelectItem value={DEMO_TENANT_VALUE}>Demo data (default)</SelectItem>
                        {tenants.map((tenant) => (
                          <SelectItem key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </SelectItem>
                        ))}
                      </>
                    ) : (
                      userTenantId && (
                        <SelectItem value={userTenantId}>{userTenantName}</SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={newSession}
                title="Start new conversation"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                New Chat
              </Button>
              <Link to="/my-dashboard">
                <Button variant="outline" size="sm">
                  My Dashboard
                </Button>
              </Link>
            </div>
          </div>

          {/* Messages area */}
          <ScrollArea className="flex-1 p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.length === 0 && (
                <div className="text-center py-16">
                  <Sparkles className="w-16 h-16 mx-auto mb-6 text-blue-500 opacity-50" />
                  <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-3">
                    Ask anything about your loans or mortgage knowledge
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-md mx-auto">
                    I can help you explore your loan data AND answer questions about regulations, 
                    guidelines, and policies. Get data-driven insights with knowledge context.
                  </p>
                  
                  {/* Quick suggestions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                    {suggestedQuestions.slice(0, 4).map((question, index) => (
                      <button
                        key={index}
                        onClick={() => handleSuggestionClick(question)}
                        className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all text-left"
                      >
                        <MessageSquare className="w-5 h-5 text-blue-500 shrink-0" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{question}</span>
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
                />
              ))}
              
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Suggested follow-ups */}
          {messages.length > 0 && suggestedQuestions.length > 0 && !isLoading && (
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center gap-3 overflow-x-auto pb-1">
                  <span className="text-xs text-slate-400 shrink-0">Try:</span>
                  {suggestedQuestions.slice(0, 4).map((question, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(question)}
                      className="shrink-0 text-sm px-3 py-1.5 bg-white dark:bg-slate-700 rounded-full border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors text-slate-600 dark:text-slate-300"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 p-6">
            <div className="max-w-4xl mx-auto">
              <div className="flex gap-3">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={tenantReady ? "Ask about loans, regulations, or mortgage knowledge... (e.g., 'Show me loan volume' or 'What are FHA requirements?')" : "Select a tenant to start chatting"}
                  disabled={isLoading || !tenantReady}
                  className="flex-1 h-12 text-base"
                />
                <Button 
                  onClick={handleSend} 
                  disabled={!input.trim() || isLoading || !tenantReady}
                  size="lg"
                  className="h-12 px-6"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Dialog */}
      <Dialog open={saveDialog.isOpen} onOpenChange={(open) => !open && setSaveDialog({ isOpen: false, visualization: null, question: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to My Dashboard</DialogTitle>
            <DialogDescription>
              Save this visualization to your custom dashboard for quick access.
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
              Save to Dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ============================================================================
// Message Bubble Component
// ============================================================================

interface ChatMessageBubbleProps {
  message: ChatMessage;
  onSave: (visualization: VisualizationConfig, question: string) => void;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message, onSave }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-xl",
          isUser
            ? "bg-blue-500 text-white px-5 py-3 max-w-[70%]"
            : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm w-full"
        )}
      >
        {message.isLoading ? (
          <div className="flex items-center gap-3 px-5 py-4">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-slate-600 dark:text-slate-300">Analyzing your data...</span>
          </div>
        ) : (
          <>
            {/* Text content */}
            {message.content && (
              <p className={cn(
                "whitespace-pre-wrap",
                isUser ? "text-base" : "px-5 py-4 text-slate-700 dark:text-slate-300 text-base leading-relaxed"
              )}>
                {message.content}
              </p>
            )}
            
            {/* Error */}
            {message.error && (
              <div className="px-5 py-3 flex items-center gap-2 text-red-500 bg-red-50 dark:bg-red-900/20">
                <AlertCircle className="w-5 h-5" />
                <span>{message.error}</span>
              </div>
            )}
            
            {/* Visualization */}
            {message.visualization && !message.error && (
              <div className="border-t border-slate-200 dark:border-slate-700">
                <div className="p-4">
                  <DynamicVisualization
                    config={message.visualization}
                    height={400}
                    showTitle
                  />
                </div>
                
                {/* Actions */}
                <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSave(message.visualization!, message.content)}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save to Dashboard
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

export default DataChat;
