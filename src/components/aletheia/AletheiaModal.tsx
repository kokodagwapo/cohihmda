import { useState, useEffect, useRef } from 'react';
import { X, Mic, MicOff, Send, Settings, Loader2, Phone, PhoneOff, MessageSquare, Users, TrendingUp, TrendingDown, Activity, Upload, FileText, BarChart2, PieChart as PieChartIcon } from 'lucide-react';
import { ParticleBackground } from '../maylin/ParticleBackground';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { getTodaysGreeting } from '@/utils/aletheiaGreetings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api } from '@/lib/api';

interface Message {
  role: 'Cohi' | 'User' | 'System';
  text: string;
  timestamp: Date;
  teamMembers?: TeamMember[];
  chartData?: ChartData;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie';
  data: any[];
  summary: string;
  fileName: string;
  insights: string[];
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  score: number;
  trend: 'up' | 'down' | 'stable';
  callsHandled: number;
  avgHandleTime: string;
  customerSatisfaction: number;
  qualityScore: number;
  sales?: number;
  conversionRate?: number;
}

interface PerformanceDetail {
  category: string;
  score: number;
  trend: 'up' | 'down' | 'stable';
  details: string;
}

interface AletheiaModalProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardContext?: any;
}

export function AletheiaModal({ isOpen, onClose, dashboardContext }: AletheiaModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showMemberDetail, setShowMemberDetail] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await api.getCurrentUser();
      } catch (error) {
        console.warn('User not authenticated:', error);
      }
    };
    checkAuth();
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize Audio Context
  useEffect(() => {
    if (isOpen && !audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return () => {
      if (!isOpen && audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      if (!isOpen && wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setIsConnected(false);
      }
    };
  }, [isOpen]);

  const generateSystemPrompt = () => {
    let contextString = "";
    if (dashboardContext) {
      contextString = `
CURRENT INTELLIGENCE:
- Top Talent: ${dashboardContext.topPerformers?.map((p: any) => `${p.name} (${p.score})`).join(', ')}
- Risks: ${dashboardContext.riskCases?.length} active cases.
- Volume: ${dashboardContext.stats?.callsToday} calls.
      `;
    }
    return `You are Cohi, an elite Executive Intelligence Agent. 
    You are warm, professional, and sharp. 
    ${contextString}
    Goal: Provide high-value executive insights with a human touch.`;
  };

  const connectToLiveAPI = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      // Use backend WebSocket endpoint
      let ws: WebSocket;
      try {
        ws = api.createBackendWebSocket('/ws/aletheia');
      } catch (error: any) {
        const msg = error?.message || 'Failed to create WebSocket connection.';
        const isSecurityError = msg.includes('wss://') || msg.includes('HTTPS listener') || msg.includes('SSL certificate');
        
        toast({
          title: isSecurityError ? 'HTTPS Required for WebSocket' : (msg.toLowerCase().includes('authentication required') ? 'Authentication Required' : 'WebSocket Configuration Required'),
          description: isSecurityError 
            ? 'The Application Load Balancer needs an HTTPS listener with an SSL certificate. See ALB_HTTPS_SETUP.md for setup instructions.'
            : msg,
          variant: 'destructive',
          duration: 15000, // Show longer for important security messages
        });
        console.error('WebSocket configuration error:', error);
        return;
      }

      ws.onopen = () => {
        setIsConnected(true);
        console.log('Connected to Cohi via backend WebSocket');
        toast({ title: 'Connected', description: 'Live voice activated' });
        
        if (!hasGreeted) {
          setHasGreeted(true);
        }
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

          console.log('Cohi message:', data);

          // Handle audio data from Gemini
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio')) {
                console.log('Playing Audio Chunk', part.inlineData.data.length);
                playPcmData(part.inlineData.data);
              }
            }
          }
          
          // Handle text responses
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                setMessages(prev => [...prev, {
                  role: 'Cohi',
                  text: part.text,
                  timestamp: new Date()
                }]);
              }
            }
          }
        } catch (e) {
          console.error('Error parsing WS message', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        console.log('Cohi WebSocket Disconnected', event.code, event.reason);
        if (event.code !== 1000) {
          toast({ 
            title: 'Connection Lost', 
            description: `Error code: ${event.code}. ${event.reason || 'Check console for details.'}`,
            variant: 'destructive' 
          });
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket Error', error);
        const backendUrl = localStorage.getItem('BACKEND_API_URL') || 'not configured';
        toast({ 
          title: 'Connection Error', 
          description: `Unable to connect to Cohi. Backend: ${backendUrl.includes('http') ? backendUrl.replace(/^https?:\/\//, '').split('/')[0] : 'not configured'}. Check console for details.`,
          variant: 'destructive',
          duration: 10000 // Show longer for debugging
        });
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Connection error:', e);
      toast({
        title: 'Connection Failed',
        description: 'Failed to establish WebSocket connection.',
        variant: 'destructive'
      });
    }
  };

  // Auto-connect when open and authenticated
  useEffect(() => {
    if (isOpen && isInCall) {
      connectToLiveAPI();
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isOpen, isInCall]);

  const playPcmData = (base64: string) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    try {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      
      const int16Data = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }
      
      const buffer = ctx.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      const now = ctx.currentTime;
      const startTime = Math.max(now, nextStartTimeRef.current);
      source.start(startTime);
      
      nextStartTimeRef.current = startTime + buffer.duration;
    } catch (e) {
      console.error('Error decoding audio', e);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
    
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast({ title: 'Connecting...', description: 'Please wait for connection' });
      connectToLiveAPI();
      // Wait for connection
      await new Promise(resolve => {
        const checkConnection = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve(true);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkConnection);
          resolve(false);
        }, 5000);
      });
      
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        toast({ 
          title: 'Connection Failed', 
          description: 'Could not establish connection',
          variant: 'destructive' 
        });
        return;
      }
    }

    setMessages(prev => [...prev, { role: 'User', text, timestamp: new Date() }]);
    setInputText('');
    setIsLoading(true);

    // Send message to backend WebSocket (which forwards to Gemini)
    try {
      wsRef.current.send(JSON.stringify({
        text: text
      }));
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Send Failed',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    }
    
    setTimeout(() => setIsLoading(false), 1000);
  };

  const startVoiceRecognition = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    
    // Do not suspend audio context anymore - we want to hear Cohi while talking
    // if (audioCtxRef.current) audioCtxRef.current.suspend();

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'en-US';

    recognitionRef.current.onstart = () => setIsListening(true);
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join('');
      setInputText(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        sendMessage(transcript);
      }
    };

    recognitionRef.current.start();
  };

  const stopVoiceRecognition = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
    // Audio context is no longer suspended during recognition
  };

  const toggleMute = () => {
    if (isListening) {
      stopVoiceRecognition();
      setIsMuted(true);
    } else {
      startVoiceRecognition();
      setIsMuted(false);
    }
  };
  
  // Settings removed - API key is managed on backend

  const handleClose = () => {
    stopVoiceRecognition();
    if (wsRef.current) wsRef.current.close();
    setIsInCall(false);
    onClose();
  };

  const startCall = async () => {
    try {
      // Verify authentication
      await api.getCurrentUser();
      setIsInCall(true);
      connectToLiveAPI();
      toast({ title: 'Call Started', description: 'Connecting to Cohi...' });
    } catch (error) {
      toast({
        title: 'Authentication Required',
        description: 'Please sign in to use Cohi',
        variant: 'destructive'
      });
    }
  };

  const endCall = () => {
    setIsInCall(false);
    stopVoiceRecognition();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Ensure audio stops
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      audioCtxRef.current.suspend();
    }
    nextStartTimeRef.current = 0;

    toast({ title: 'Call Ended', description: 'Disconnected' });
  };

  const toggleChat = () => {
    setShowChat(!showChat);
  };

  // Mock team members data
  const mockTeamMembers: TeamMember[] = [
    {
      id: '1',
      name: 'Sarah Johnson',
      role: 'Senior Agent',
      score: 94,
      trend: 'up',
      callsHandled: 156,
      avgHandleTime: '4:32',
      customerSatisfaction: 4.8,
      qualityScore: 96,
      sales: 45000,
      conversionRate: 28.5
    },
    {
      id: '2',
      name: 'Michael Chen',
      role: 'Agent',
      score: 87,
      trend: 'stable',
      callsHandled: 143,
      avgHandleTime: '5:12',
      customerSatisfaction: 4.5,
      qualityScore: 88,
      sales: 38000,
      conversionRate: 24.2
    },
    {
      id: '3',
      name: 'Emily Rodriguez',
      role: 'Team Lead',
      score: 91,
      trend: 'up',
      callsHandled: 98,
      avgHandleTime: '6:45',
      customerSatisfaction: 4.7,
      qualityScore: 93,
      sales: 52000,
      conversionRate: 31.8
    },
    {
      id: '4',
      name: 'James Wilson',
      role: 'Agent',
      score: 78,
      trend: 'down',
      callsHandled: 132,
      avgHandleTime: '6:20',
      customerSatisfaction: 4.1,
      qualityScore: 79,
      sales: 28000,
      conversionRate: 18.3
    },
    {
      id: '5',
      name: 'Lisa Anderson',
      role: 'Senior Agent',
      score: 89,
      trend: 'up',
      callsHandled: 167,
      avgHandleTime: '4:58',
      customerSatisfaction: 4.6,
      qualityScore: 90,
      sales: 41000,
      conversionRate: 26.7
    }
  ];

  const getPerformanceDetails = (member: TeamMember): PerformanceDetail[] => {
    return [
      {
        category: 'Call Quality',
        score: member.qualityScore,
        trend: member.trend,
        details: `Consistently maintains high quality standards with ${member.qualityScore}% quality score`
      },
      {
        category: 'Customer Satisfaction',
        score: member.customerSatisfaction * 20,
        trend: member.trend,
        details: `${member.customerSatisfaction}/5.0 average rating from customers`
      },
      {
        category: 'Efficiency',
        score: Math.round((1 / parseFloat(member.avgHandleTime.split(':')[0])) * 100),
        trend: member.trend,
        details: `Average handle time: ${member.avgHandleTime} minutes`
      },
      {
        category: 'Sales Performance',
        score: member.conversionRate || 0,
        trend: member.trend,
        details: `$${member.sales?.toLocaleString()} in sales, ${member.conversionRate}% conversion rate`
      },
      {
        category: 'Productivity',
        score: Math.min((member.callsHandled / 200) * 100, 100),
        trend: member.trend,
        details: `${member.callsHandled} calls handled this month`
      }
    ];
  };

  const handleMemberClick = (member: TeamMember) => {
    setSelectedMember(member);
    setShowMemberDetail(true);
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileType = file.name.split('.').pop()?.toLowerCase();
    
    if (!['xlsx', 'xls', 'pdf', 'doc', 'docx', 'csv'].includes(fileType || '')) {
      toast({ 
        title: 'Unsupported File Type', 
        description: 'Please upload Excel, PDF, Word, or CSV files',
        variant: 'destructive' 
      });
      return;
    }

    setIsProcessingFile(true);
    setUploadedFiles([file]);

    // Simulate file processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Generate mock data based on file type
    const chartData = generateMockChartData(file.name, fileType || '');
    
    const analysisMessage: Message = {
      role: 'Cohi',
      text: `I've analyzed your ${fileType?.toUpperCase()} file "${file.name}". Here's what I found:`,
      timestamp: new Date(),
      chartData
    };

    setMessages(prev => [...prev, analysisMessage]);
    setIsProcessingFile(false);
    
    toast({ 
      title: 'File Processed', 
      description: `${file.name} has been analyzed successfully` 
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Generate mock chart data based on file type
  const generateMockChartData = (fileName: string, fileType: string): ChartData => {
    const dataTypes = ['bar', 'line', 'pie'] as const;
    const randomType = dataTypes[Math.floor(Math.random() * dataTypes.length)];

    if (randomType === 'bar') {
      return {
        type: 'bar',
        fileName,
        data: [
          { month: 'Jan', value: 4200, target: 4000 },
          { month: 'Feb', value: 3800, target: 4000 },
          { month: 'Mar', value: 4500, target: 4000 },
          { month: 'Apr', value: 5100, target: 4000 },
          { month: 'May', value: 4800, target: 4000 },
          { month: 'Jun', value: 5400, target: 4000 }
        ],
        summary: 'Performance metrics show a 28% increase over the 6-month period',
        insights: [
          'Strong upward trend detected in Q2',
          'April exceeded targets by 27.5%',
          'Consistent growth momentum maintained',
          'Recommend scaling operations for continued growth'
        ]
      };
    } else if (randomType === 'line') {
      return {
        type: 'line',
        fileName,
        data: [
          { week: 'W1', sales: 12500, forecast: 12000 },
          { week: 'W2', sales: 13200, forecast: 12500 },
          { week: 'W3', sales: 14100, forecast: 13000 },
          { week: 'W4', sales: 13800, forecast: 13500 },
          { week: 'W5', sales: 15200, forecast: 14000 },
          { week: 'W6', sales: 16100, forecast: 14500 }
        ],
        summary: 'Sales trajectory exceeding forecasts by an average of 8.3%',
        insights: [
          'Week-over-week growth averaging 5.2%',
          'Outperforming forecasts consistently',
          'Peak performance in Week 6 at $16.1K',
          'Momentum suggests continued outperformance'
        ]
      };
    } else {
      return {
        type: 'pie',
        fileName,
        data: [
          { category: 'Operations', value: 35, color: '#3b82f6' },
          { category: 'Sales', value: 28, color: '#10b981' },
          { category: 'Support', value: 22, color: '#f59e0b' },
          { category: 'Admin', value: 15, color: '#8b5cf6' }
        ],
        summary: 'Resource allocation shows balanced distribution across departments',
        insights: [
          'Operations leading at 35% of total resources',
          'Sales and Support account for 50% combined',
          'Admin overhead maintained at efficient 15%',
          'Recommended: Increase Sales allocation by 5%'
        ]
      };
    }
  };

  // Initiate phone call with uploaded document context
  const handlePhoneCall = () => {
    if (!isInCall) {
      startCall();
      if (uploadedFiles.length > 0) {
        const contextMessage: Message = {
          role: 'System',
          text: `Call started with context from: ${uploadedFiles.map(f => f.name).join(', ')}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, contextMessage]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
      >
        <ParticleBackground speed={0.4} particleCount={120} />

        <button onClick={handleClose} className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50 p-2 sm:p-3 rounded-full bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 text-white transition-all">
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        <div className="relative z-10 flex flex-col sm:flex-row w-full h-full max-w-7xl mx-auto p-4 sm:p-6 md:p-8 gap-4 sm:gap-6 overflow-y-auto overscroll-contain max-h-screen">
          {/* Left Panel - Chat & Team Members */}
          {showChat && (
            <motion.div
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              className="w-full sm:w-96 flex flex-col gap-4 order-2 sm:order-1"
            >
              {/* Chat Messages */}
              <Card className="flex-1 bg-white/5 backdrop-blur-xl border-white/10 p-4 overflow-hidden flex flex-col">
                <h3 className="text-white font-light text-lg mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Conversation
                </h3>
                <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-4">
                    {messages.length === 0 && (
                      <div className="text-white/50 text-sm text-center py-8">
                        Start a conversation with Cohi
                      </div>
                    )}
                    {messages.map((msg, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex ${msg.role === 'User' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                            msg.role === 'User'
                              ? 'bg-blue-500/20 text-white'
                              : 'bg-white/10 text-white'
                          }`}
                        >
                          <div className="text-xs opacity-60 mb-1">{msg.role}</div>
                          <div className="text-sm">{msg.text}</div>
                          
                          {/* Chart Data Display */}
                          {msg.chartData && (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.2 }}
                              className="mt-4 space-y-3"
                            >
                              <div className="flex items-center gap-2 text-xs text-white/60">
                                <FileText className="w-3 h-3" />
                                {msg.chartData.fileName}
                              </div>
                              
                              {/* Chart Rendering */}
                              <div className="bg-white/5 rounded-lg p-3 h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                  {msg.chartData.type === 'bar' ? (
                                    <BarChart data={msg.chartData.data}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                                      <XAxis dataKey="month" stroke="#fff" style={{ fontSize: '10px' }} />
                                      <YAxis stroke="#fff" style={{ fontSize: '10px' }} />
                                      <ChartTooltip content={<ChartTooltipContent />} />
                                      <Bar dataKey="value" fill="#3b82f6">
                                        {msg.chartData.data.map((entry: any, index: number) => (
                                          <Cell key={`cell-${index}`} fill={`hsl(${210 + index * 10}, 70%, 50%)`} />
                                        ))}
                                      </Bar>
                                      <Bar dataKey="target" fill="#10b981" opacity={0.5} />
                                    </BarChart>
                                  ) : msg.chartData.type === 'line' ? (
                                    <LineChart data={msg.chartData.data}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                                      <XAxis dataKey="week" stroke="#fff" style={{ fontSize: '10px' }} />
                                      <YAxis stroke="#fff" style={{ fontSize: '10px' }} />
                                      <ChartTooltip content={<ChartTooltipContent />} />
                                      <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                                      <Line type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" />
                                    </LineChart>
                                  ) : (
                                    <PieChart>
                                      <Pie
                                        data={msg.chartData.data}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={(entry) => `${entry.category}: ${entry.value}%`}
                                        outerRadius={60}
                                        fill="#8884d8"
                                        dataKey="value"
                                      >
                                        {msg.chartData.data.map((entry: any, index: number) => (
                                          <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                      </Pie>
                                      <ChartTooltip content={<ChartTooltipContent />} />
                                    </PieChart>
                                  )}
                                </ResponsiveContainer>
                              </div>

                              {/* Summary & Insights */}
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-white/80">{msg.chartData.summary}</div>
                                <div className="space-y-1">
                                  {msg.chartData.insights.map((insight, i) => (
                                    <motion.div
                                      key={i}
                                      initial={{ opacity: 0, x: -10 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: 0.3 + i * 0.1 }}
                                      className="flex items-start gap-2 text-xs text-white/60"
                                    >
                                      <span className="text-blue-400 mt-0.5">•</span>
                                      <span>{insight}</span>
                                    </motion.div>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          )}

                          {msg.teamMembers && msg.teamMembers.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {msg.teamMembers.map((member) => (
                                <button
                                  key={member.id}
                                  onClick={() => handleMemberClick(member)}
                                  className="w-full text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium text-white">{member.name}</div>
                                      <div className="text-xs text-white/60">{member.role}</div>
                                    </div>
                                    <Badge className={`${
                                      member.score >= 90 ? 'bg-green-500/20 text-green-300' :
                                      member.score >= 80 ? 'bg-blue-500/20 text-blue-300' :
                                      'bg-yellow-500/20 text-yellow-300'
                                    }`}>
                                      {member.score}
                                    </Badge>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
                
                {/* Chat Input */}
                <div className="mt-4 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendMessage(inputText)}
                      placeholder="Type a message..."
                      className="bg-white/5 border-white/10 text-white placeholder-white/30"
                      disabled={isLoading || !isInCall}
                    />
                    <Button 
                      onClick={() => sendMessage(inputText)} 
                      disabled={!inputText.trim() || isLoading || !isInCall}
                      className="bg-blue-500/20 hover:bg-blue-500/30 text-white"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {/* Upload and Phone Controls */}
                  <div className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.pdf,.doc,.docx,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessingFile || !isInCall}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-white/5 hover:bg-white/10 border-white/10 text-white"
                    >
                      {isProcessingFile ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 mr-2" />
                      )}
                      {isProcessingFile ? 'Processing...' : 'Upload File'}
                    </Button>
                    <Button
                      onClick={handlePhoneCall}
                      disabled={isInCall}
                      variant="outline"
                      size="sm"
                      className="flex-1 bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-300"
                    >
                      <Phone className="w-4 h-4 mr-2" />
                      {isInCall ? 'In Call' : 'Start Call'}
                    </Button>
                  </div>

                  {/* File Upload Info */}
                  {uploadedFiles.length > 0 && (
                    <div className="text-xs text-white/60 flex items-center gap-2">
                      <FileText className="w-3 h-3" />
                      {uploadedFiles.map(f => f.name).join(', ')}
                    </div>
                  )}
                </div>
              </Card>

              {/* Team Performance Button */}
              <Button
                onClick={() => {
                  const teamMessage: Message = {
                    role: 'Cohi',
                    text: 'Here are your top team members and their current performance:',
                    timestamp: new Date(),
                    teamMembers: mockTeamMembers
                  };
                  setMessages(prev => [...prev, teamMessage]);
                }}
                className="bg-white/5 hover:bg-white/10 text-white border border-white/10"
                disabled={!isInCall}
              >
                <Users className="w-4 h-4 mr-2" />
                Show Team Performance
              </Button>
            </motion.div>
          )}

          {/* Center - Avatar & Controls */}
          <div className="flex-1 flex flex-col items-center justify-center order-1 sm:order-2 min-h-[50vh] sm:min-h-0">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative mb-4 sm:mb-6">
              <div className={`w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10 flex items-center justify-center shadow-2xl ${isListening || isInCall ? 'animate-pulse' : ''}`}>
                <div className="text-4xl sm:text-5xl md:text-6xl font-light text-white/90">A</div>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6 sm:mb-12 px-4">
              <h2 className="text-2xl sm:text-3xl font-light text-white tracking-wide">I'm Cohi</h2>
              <p className="text-white/60 text-xs sm:text-sm mt-2">
                {isInCall ? 'In Call' : 'Ready to assist'}
              </p>
            </motion.div>

            {/* Call Controls */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 sm:gap-4 mb-4 sm:mb-8 flex-wrap justify-center">
              {!isInCall ? (
                <button
                  onClick={startCall}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-300 transition-all duration-300 active:scale-95"
                >
                  <Phone className="w-6 h-6 sm:w-8 sm:h-8" />
                </button>
              ) : (
                <>
                  <button
                    onClick={toggleMute}
                    className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-all duration-300 backdrop-blur-xl border active:scale-95 ${
                      isListening ? "bg-blue-500/20 border-blue-500/30 text-blue-300 scale-105" : "bg-white/5 border-white/10 text-white/50"
                    }`}
                  >
                    {isListening ? <Mic className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
                  </button>
                  
                  <button
                    onClick={endCall}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 transition-all duration-300 active:scale-95"
                  >
                    <PhoneOff className="w-6 h-6 sm:w-8 sm:h-8" />
                  </button>

                  <button
                    onClick={toggleChat}
                    className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-all duration-300 backdrop-blur-xl border active:scale-95 ${
                      showChat ? "bg-blue-500/20 border-blue-500/30 text-blue-300" : "bg-white/5 border-white/10 text-white/50"
                    }`}
                  >
                    <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </>
              )}
            </motion.div>

            {/* Status Indicator */}
            {isLoading && (
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </div>
            )}
          </div>
        </div>


        {/* Team Member Detail Dialog */}
        <Dialog open={showMemberDetail} onOpenChange={setShowMemberDetail}>
          <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-3xl w-[95vw] sm:w-[92vw] md:w-[90vw] lg:w-full max-h-[95vh] sm:max-h-[90vh] md:max-h-[85vh] mx-2.5 sm:mx-4">
            <DialogHeader>
              <DialogTitle className="text-2xl">{selectedMember?.name}</DialogTitle>
              <DialogDescription className="text-white/60">
                {selectedMember?.role}
              </DialogDescription>
            </DialogHeader>
            
            {selectedMember && (
              <div className="space-y-6 py-4">
                {/* Overview Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-white/5 border-white/10 p-4">
                    <div className="text-white/60 text-xs mb-1">Overall Score</div>
                    <div className="text-3xl font-bold text-white flex items-center gap-2">
                      {selectedMember.score}
                      {selectedMember.trend === 'up' && <TrendingUp className="w-5 h-5 text-green-400" />}
                      {selectedMember.trend === 'down' && <TrendingDown className="w-5 h-5 text-red-400" />}
                      {selectedMember.trend === 'stable' && <Activity className="w-5 h-5 text-blue-400" />}
                    </div>
                  </Card>
                  <Card className="bg-white/5 border-white/10 p-4">
                    <div className="text-white/60 text-xs mb-1">Calls Handled</div>
                    <div className="text-3xl font-bold text-white">{selectedMember.callsHandled}</div>
                  </Card>
                  <Card className="bg-white/5 border-white/10 p-4">
                    <div className="text-white/60 text-xs mb-1">Sales</div>
                    <div className="text-3xl font-bold text-white">${(selectedMember.sales! / 1000).toFixed(0)}k</div>
                  </Card>
                </div>

                {/* Performance Breakdown */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-white">Performance Breakdown</h3>
                  {getPerformanceDetails(selectedMember).map((detail, idx) => (
                    <Card key={idx} className="bg-white/5 border-white/10 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="text-white font-medium">{detail.category}</div>
                          {detail.trend === 'up' && <TrendingUp className="w-4 h-4 text-green-400" />}
                          {detail.trend === 'down' && <TrendingDown className="w-4 h-4 text-red-400" />}
                          {detail.trend === 'stable' && <Activity className="w-4 h-4 text-blue-400" />}
                        </div>
                        <Badge className={`${
                          detail.score >= 90 ? 'bg-green-500/20 text-green-300' :
                          detail.score >= 70 ? 'bg-blue-500/20 text-blue-300' :
                          'bg-yellow-500/20 text-yellow-300'
                        }`}>
                          {detail.score.toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-2 mb-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            detail.score >= 90 ? 'bg-green-500' :
                            detail.score >= 70 ? 'bg-blue-500' :
                            'bg-yellow-500'
                          }`}
                          style={{ width: `${detail.score}%` }}
                        />
                      </div>
                      <div className="text-white/60 text-sm">{detail.details}</div>
                    </Card>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-white border border-blue-500/30">
                    View Full Report
                  </Button>
                  <Button className="flex-1 bg-white/5 hover:bg-white/10 text-white border border-white/10">
                    Schedule 1-on-1
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </motion.div>
    </AnimatePresence>
  );
}
