/**
 * Data Chat Hook
 * Manages chat state, API calls, and conversation history
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export interface VisualizationConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'table' | 'kpi' | 'donut' | 'horizontal_bar';
  title: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  kpiConfig?: {
    value: number | string;
    label: string;
    change?: number;
    changeLabel?: string;
    format?: 'number' | 'currency' | 'percent';
  };
  tableConfig?: {
    columns: { key: string; label: string; format?: string }[];
    sortable?: boolean;
    pageSize?: number;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  visualization?: VisualizationConfig;
  data?: any[];
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
}

export interface DataChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
}

export interface UseChatOptions {
  tenantId?: string;
  onError?: (error: Error) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useDataChat(options: UseChatOptions = {}) {
  const { tenantId, onError } = options;
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([
    'Show me loans by branch',
    'What is the average loan amount by loan type?',
    'Show me loan volume over time',
    'Who are the top 10 loan officers by volume?'
  ]);
  
  const messageIdCounter = useRef(0);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const response = await api.request<{ sessionId: string }>('/api/data-chat/new-session', {
          method: 'POST',
        });
        if (response.sessionId) {
          setSessionId(response.sessionId);
        }
      } catch (error) {
        console.error('[DataChat] Failed to create session:', error);
      }
    };
    initSession();
  }, []);

  /**
   * Generate unique message ID
   */
  const generateMessageId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${Date.now()}-${messageIdCounter.current}`;
  }, []);

  /**
   * Send a question and get AI response
   */
  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMessageId = generateMessageId();
    const assistantMessageId = generateMessageId();

    // Add user message
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    // Add loading assistant message
    const loadingMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setIsLoading(true);

    try {
      const response = await api.request<DataChatResponse>('/api/data-chat/ask', {
        method: 'POST',
        body: JSON.stringify({
          question: question.trim(),
          sessionId,
          conversationHistory: messages.slice(-6).map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
          tenant_id: tenantId,
        }),
      });

      // Update assistant message with response
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: response.message,
        visualization: response.visualization,
        data: response.data,
        timestamp: new Date(),
        error: response.error,
      };

      setMessages(prev => 
        prev.map(m => m.id === assistantMessageId ? assistantMessage : m)
      );

      if (response.suggestedQuestions) {
        setSuggestedQuestions(response.suggestedQuestions);
      }
    } catch (error: any) {
      console.error('[DataChat] Error sending message:', error);
      
      const errorMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: 'I encountered an error processing your question. Please try again.',
        timestamp: new Date(),
        error: error.message,
      };

      setMessages(prev => 
        prev.map(m => m.id === assistantMessageId ? errorMessage : m)
      );

      if (onError) {
        onError(error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [generateMessageId, isLoading, messages, onError, sessionId, tenantId]);

  /**
   * Refine the last query
   */
  const refineQuery = useCallback(async (refinement: string) => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');

    if (!lastUserMessage || !lastAssistantMessage) return;

    const userMessageId = generateMessageId();
    const assistantMessageId = generateMessageId();

    // Add refinement as user message
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: refinement,
      timestamp: new Date(),
    };

    const loadingMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);
    setIsLoading(true);

    try {
      const response = await api.request<DataChatResponse>('/api/data-chat/refine', {
        method: 'POST',
        body: JSON.stringify({
          originalQuestion: lastUserMessage.content,
          refinement,
          previousResult: {
            message: lastAssistantMessage.content,
            visualization: lastAssistantMessage.visualization,
          },
          sessionId,
          tenant_id: tenantId,
        }),
      });

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: response.message,
        visualization: response.visualization,
        data: response.data,
        timestamp: new Date(),
        error: response.error,
      };

      setMessages(prev => 
        prev.map(m => m.id === assistantMessageId ? assistantMessage : m)
      );

      if (response.suggestedQuestions) {
        setSuggestedQuestions(response.suggestedQuestions);
      }
    } catch (error: any) {
      console.error('[DataChat] Error refining query:', error);
      
      const errorMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: 'I encountered an error refining your query. Please try again.',
        timestamp: new Date(),
        error: error.message,
      };

      setMessages(prev => 
        prev.map(m => m.id === assistantMessageId ? errorMessage : m)
      );

      if (onError) {
        onError(error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [generateMessageId, messages, onError, sessionId, tenantId]);

  /**
   * Save a visualization to custom dashboard
   */
  const saveVisualization = useCallback(async (
    visualization: VisualizationConfig,
    question: string,
    title?: string,
    description?: string
  ) => {
    try {
      const response = await api.request('/api/data-chat/save-visualization', {
        method: 'POST',
        body: JSON.stringify({
          title: title || visualization.title,
          description,
          question,
          visualization,
          queryConfig: {},
          tenant_id: tenantId,
        }),
      });
      return response;
    } catch (error: any) {
      console.error('[DataChat] Error saving visualization:', error);
      throw error;
    }
  }, [tenantId]);

  /**
   * Clear chat history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSuggestedQuestions([
      'Show me loans by branch',
      'What is the average loan amount by loan type?',
      'Show me loan volume over time',
      'Who are the top 10 loan officers by volume?'
    ]);
  }, []);

  /**
   * Start a new session
   */
  const newSession = useCallback(async () => {
    clearMessages();
    try {
      const response = await api.request<{ sessionId: string }>('/api/data-chat/new-session', {
        method: 'POST',
      });
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }
    } catch (error) {
      console.error('[DataChat] Failed to create new session:', error);
    }
  }, [clearMessages]);

  return {
    messages,
    isLoading,
    sessionId,
    suggestedQuestions,
    sendMessage,
    refineQuery,
    saveVisualization,
    clearMessages,
    newSession,
  };
}
