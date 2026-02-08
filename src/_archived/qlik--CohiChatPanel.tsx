import { useState, useEffect, useRef } from 'react';
import { Send, Mic, MicOff, Loader2, Brain, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  role: 'Cohi' | 'User' | 'System';
  text: string;
  timestamp: Date;
  chartData?: ChartData;
  htmlContent?: string;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'area';
  data: Array<{
    [key: string]: string | number;
  }>;
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  colors?: string[];
}

interface CohiChatPanelProps {
  qlikContext?: {
    totalFields: number;
    implementedFields: number;
    currentCategory?: string | null;
    searchQuery?: string;
    dataDictionary?: Record<string, string[]>;
  };
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function CohiChatPanel({ qlikContext }: CohiChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openai' | 'gemini'>('openai');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load AI provider preference from localStorage
  useEffect(() => {
    const savedProvider = localStorage.getItem('cohi_ai_provider') as 'openai' | 'gemini' | null;
    if (savedProvider) {
      setAiProvider(savedProvider);
    }
  }, []);

  // Save AI provider preference
  useEffect(() => {
    localStorage.setItem('cohi_ai_provider', aiProvider);
  }, [aiProvider]);

  // Connect to WebSocket
  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const endpoint = aiProvider === 'openai' ? '/ws/aletheia?context=qlik&qlik=true' : '/ws/gemini?context=qlik&qlik=true';
      const ws = api.createBackendWebSocket(endpoint);
      
      ws.onopen = () => {
        setIsConnected(true);
        toast({
          title: 'Connected',
          description: `Connected to Cohi via ${aiProvider === 'openai' ? 'OpenAI' : 'Gemini'}`,
        });
      };

      ws.onmessage = async (event) => {
        try {
          let data;
          if (event.data instanceof Blob) {
            data = JSON.parse(await event.data.text());
          } else if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else {
            data = event.data;
          }

          // Handle function call responses
          if (data.functionCall) {
            handleFunctionCall(data.functionCall);
            return;
          }

          // Handle chart data in response
          if (data.chartData) {
            setMessages(prev => [...prev, {
              role: 'Cohi',
              text: data.text || '',
              timestamp: new Date(),
              chartData: data.chartData,
              htmlContent: data.htmlContent
            }]);
            return;
          }

          // Handle text responses
          if (data.text || data.serverContent?.modelTurn?.parts) {
            const text = data.text || data.serverContent?.modelTurn?.parts?.find((p: any) => p.text)?.text || '';
            if (text) {
              setMessages(prev => [...prev, {
                role: 'Cohi',
                text,
                timestamp: new Date(),
                htmlContent: data.htmlContent
              }]);
            }
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({
          title: 'Connection Error',
          description: 'Failed to connect to Cohi. Please try again.',
          variant: 'destructive',
        });
        setIsConnected(false);
        setIsLoading(false);
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        setIsLoading(false);
        if (event.code !== 1000) {
          // Unexpected close
          toast({
            title: 'Connection Closed',
            description: event.reason || 'Connection was closed unexpectedly',
            variant: 'destructive',
          });
        }
      };

      wsRef.current = ws;
    } catch (error: any) {
      console.error('WebSocket connection error:', error);
      toast({
        title: 'Connection Failed',
        description: error.message || 'Failed to establish connection',
        variant: 'destructive',
      });
    }
  };

  // Handle function calls
  const handleFunctionCall = async (functionCall: any) => {
    const { name, arguments: args } = functionCall;
    
    try {
      let result;
      
      switch (name) {
        case 'getFieldDetails':
          if (!args?.fieldName) {
            result = { error: 'Field name is required' };
            break;
          }
          result = await getFieldDetails(args.fieldName);
          break;
        case 'getAnalyticsData':
          if (!args?.endpoint) {
            result = { error: 'Endpoint is required' };
            break;
          }
          try {
            result = await getAnalyticsData(args.endpoint, args.params || {});
          } catch (error: any) {
            result = { error: error.message || 'Failed to fetch analytics data' };
          }
          break;
        case 'generateChart':
          if (!args?.data || !args?.type) {
            result = { error: 'Chart data and type are required' };
            break;
          }
          result = { chartData: args };
          break;
        case 'searchFields':
          if (!args?.query) {
            result = { error: 'Search query is required' };
            break;
          }
          result = await searchFields(args.query);
          break;
        default:
          result = { error: `Unknown function: ${name}` };
      }

      // Send result back via WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          functionResult: {
            name,
            result
          }
        }));
      } else {
        console.error('WebSocket not open, cannot send function result');
      }
    } catch (error: any) {
      console.error('Function call error:', error);
      const errorResult = { error: error.message || 'Function call failed' };
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          functionResult: {
            name,
            result: errorResult
          }
        }));
      }
    }
  };

  // Function implementations
  const getFieldDetails = async (fieldName: string) => {
    // This would query the data dictionary
    return {
      fieldName,
      description: `Details for ${fieldName}`,
      implemented: qlikContext?.dataDictionary ? 
        Object.values(qlikContext.dataDictionary).some(fields => fields.includes(fieldName)) : false
    };
  };

  const getAnalyticsData = async (endpoint: string, params: any) => {
    try {
      const validEndpoints = ['insights', 'business-overview', 'leaderboard', 'top-tiering', 'closing-fallout-forecast', 'funnel'];
      if (!validEndpoints.includes(endpoint)) {
        throw new Error(`Invalid endpoint: ${endpoint}. Valid endpoints: ${validEndpoints.join(', ')}`);
      }
      
      const response = await api.request(`/api/dashboard/${endpoint}`, {
        method: 'GET',
        params: params || {}
      });
      return response;
    } catch (error: any) {
      console.error('Analytics data error:', error);
      throw new Error(error.message || 'Failed to fetch analytics data');
    }
  };

  const searchFields = async (query: string) => {
    if (!qlikContext?.dataDictionary) return { fields: [] };
    
    const results: string[] = [];
    Object.entries(qlikContext.dataDictionary).forEach(([category, fields]) => {
      fields.forEach(field => {
        if (field.toLowerCase().includes(query.toLowerCase())) {
          results.push(field);
        }
      });
    });
    
    return { fields: results };
  };

  // Send message
  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'User',
      text: inputText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    // Connect if not connected
    if (!isConnected) {
      connectWebSocket();
      // Wait a bit for connection
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Send message via WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          text: inputText,
          context: qlikContext
        }));
      } catch (error: any) {
        console.error('Error sending message:', error);
        toast({
          title: 'Send Error',
          description: error.message || 'Failed to send message',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }
    } else {
      toast({
        title: 'Not Connected',
        description: 'Please wait for connection to establish. Trying to reconnect...',
        variant: 'destructive',
      });
      setIsLoading(false);
      // Try to reconnect
      connectWebSocket();
      return;
    }

    setIsLoading(false);
  };

  // Voice input
  const startVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: 'Voice Input Not Supported',
        description: 'Your browser does not support voice input',
        variant: 'destructive',
      });
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      toast({
        title: 'Voice Input Error',
        description: event.error,
        variant: 'destructive',
      });
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  // Render chart
  const renderChart = (chartData: ChartData) => {
    const commonProps = {
      width: '100%',
      height: 300,
      margin: { top: 5, right: 30, left: 20, bottom: 5 }
    };

    switch (chartData.type) {
      case 'bar':
        return (
          <ResponsiveContainer {...commonProps}>
            <BarChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={Object.keys(chartData.data[0] || {})[0]} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <ChartTooltip content={<ChartTooltipContent />} />
              {Object.keys(chartData.data[0] || {}).slice(1).map((key, i) => (
                <Bar key={key} dataKey={key} fill={chartData.colors?.[i] || COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer {...commonProps}>
            <LineChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={Object.keys(chartData.data[0] || {})[0]} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <ChartTooltip content={<ChartTooltipContent />} />
              {Object.keys(chartData.data[0] || {}).slice(1).map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={chartData.colors?.[i] || COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer {...commonProps}>
            <PieChart>
              <Pie
                data={chartData.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry: any) => `${entry.name}: ${entry.value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.data.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={chartData.colors?.[index] || COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <ChartTooltip content={<ChartTooltipContent />} />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer {...commonProps}>
            <AreaChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={Object.keys(chartData.data[0] || {})[0]} stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <ChartTooltip content={<ChartTooltipContent />} />
              {Object.keys(chartData.data[0] || {}).slice(1).map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={chartData.colors?.[i] || COLORS[i % COLORS.length]}
                  fill={chartData.colors?.[i] || COLORS[i % COLORS.length]}
                  fillOpacity={0.3}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Brain className="h-5 w-5 text-blue-500" />
            Ask Cohi
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="ai-provider" className="text-xs text-slate-600 dark:text-slate-400">
                {aiProvider === 'openai' ? 'OpenAI' : 'Gemini'}
              </Label>
              <Switch
                id="ai-provider"
                checked={aiProvider === 'gemini'}
                onCheckedChange={(checked) => {
                  setAiProvider(checked ? 'gemini' : 'openai');
                  if (wsRef.current) {
                    wsRef.current.close();
                    wsRef.current = null;
                    setIsConnected(false);
                    setTimeout(connectWebSocket, 500);
                  }
                }}
              />
            </div>
            <Badge variant={isConnected ? 'default' : 'secondary'} className="text-xs">
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0">
        {/* Messages Area */}
        <ScrollArea className="flex-1 px-4 pb-4">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <Sparkles className="h-12 w-12 mx-auto mb-3 text-blue-500 opacity-50" />
                <p className="text-sm">Ask Cohi about Qlik migration data, field mappings, formulas, or analytics</p>
              </div>
            )}
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex ${msg.role === 'User' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2 rounded-lg ${
                      msg.role === 'User'
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                    }`}
                  >
                    <div className="text-xs opacity-70 mb-1">{msg.role}</div>
                    {msg.htmlContent ? (
                      <div 
                        className="text-sm prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: msg.htmlContent }}
                      />
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">{msg.text}</div>
                    )}
                    {msg.chartData && (
                      <div className="mt-3 bg-white dark:bg-slate-800 rounded p-2">
                        <div className="text-xs font-semibold mb-2 text-slate-700 dark:text-slate-300">
                          {msg.chartData.title}
                        </div>
                        {renderChart(msg.chartData)}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-4">
          <div className="flex gap-2">
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask Cohi about Qlik migration..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={isListening ? stopVoiceInput : startVoiceInput}
              disabled={isLoading}
            >
              {isListening ? (
                <MicOff className="h-4 w-4 text-red-500" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              onClick={sendMessage}
              disabled={!inputText.trim() || isLoading || !isConnected}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
