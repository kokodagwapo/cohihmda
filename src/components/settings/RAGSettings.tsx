import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Brain, Database, FileText, Shield, Save, Mic, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';

interface RAGSettingsData {
  embedding_model: string;
  vector_database: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  similarity_threshold: number;
  enable_reranking: boolean;
  reranking_model: string;
  context_window: number;
  chat_model: string;
  voice_model: string;
  temperature: number;
  custom_system_prompt: string | null;
  enable_pii_sanitization: boolean;
  redact_ssn: boolean;
  redact_dob: boolean;
  redact_account_numbers: boolean;
  allow_employee_names: boolean;
  log_ai_interactions: boolean;
  // API Keys
  openai_api_key: string | null;
  gemini_api_key: string | null;
  // Ailethia Voice Agentic specific settings
  voice_agentic_enabled: boolean;
  voice_name: string;
  voice_top_k: number;
  voice_similarity_threshold: number;
  voice_context_window: number;
  voice_temperature: number;
  voice_response_max_length: number;
  voice_conversation_memory: number;
  voice_rag_enabled: boolean;
  voice_system_prompt: string | null;
  voice_enable_reranking: boolean;
  voice_real_time_mode: boolean;
}

// Default settings to show UI immediately
const DEFAULT_SETTINGS: Partial<RAGSettingsData> = {
  embedding_model: 'openai/text-embedding-3-large',
  vector_database: 'pinecone',
  chunk_size: 512,
  chunk_overlap: 50,
  top_k: 5,
  similarity_threshold: 0.75,
  enable_reranking: false,
  reranking_model: 'cohere/rerank-english-v3.0',
  context_window: 8000,
  chat_model: 'openai/gpt-4o',
  voice_model: 'google/gemini-2.0-flash-live',
  temperature: 0.3,
  custom_system_prompt: null,
  enable_pii_sanitization: false,
  redact_ssn: false,
  redact_dob: false,
  redact_account_numbers: false,
  allow_employee_names: false,
  log_ai_interactions: false,
  openai_api_key: null,
  gemini_api_key: null,
  voice_agentic_enabled: false,
  voice_name: 'Aoede',
  voice_top_k: 3,
  voice_similarity_threshold: 0.8,
  voice_context_window: 4000,
  voice_temperature: 0.4,
  voice_response_max_length: 90,
  voice_conversation_memory: 20,
  voice_rag_enabled: false,
  voice_system_prompt: null,
  voice_enable_reranking: false,
  voice_real_time_mode: false,
};

interface RAGSettingsProps {
  activeSection?: 'settings' | 'voice-agentic';
}

export const RAGSettings = memo(function RAGSettings({ activeSection = 'settings' }: RAGSettingsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false); // Start with false to show UI immediately
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Partial<RAGSettingsData>>(DEFAULT_SETTINGS);

  // Cache key for sessionStorage
  const CACHE_KEY = 'rag_settings_cache';
  const CACHE_TIMESTAMP_KEY = 'rag_settings_cache_timestamp';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  const loadSettings = useCallback(async (cancelled: boolean = false, silent: boolean = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await api.request<{ settings: RAGSettingsData }>('/api/rag/settings');
      if (!cancelled) {
        // Merge with defaults to ensure all fields are present
        // Filter out empty strings from response to prevent overriding defaults
        const cleanedSettings = Object.fromEntries(
          Object.entries(response.settings || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined)
        ) as Partial<RAGSettingsData>;
        const mergedSettings = { ...DEFAULT_SETTINGS, ...cleanedSettings };
        setSettings(mergedSettings);
        
        // Cache the settings
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(response.settings));
        sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      }
    } catch (error: any) {
      if (!cancelled && !silent) {
        console.error('Error loading RAG settings:', error);
        toast({
          title: 'Error',
          description: 'Failed to load RAG settings. Using defaults.',
          variant: 'destructive',
        });
        // Keep defaults on error
        setSettings(DEFAULT_SETTINGS);
      }
    } finally {
      if (!cancelled && !silent) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    
    // Check cache first
    const cached = sessionStorage.getItem(CACHE_KEY);
    const cacheTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
    const now = Date.now();
    
    if (cached && cacheTimestamp && (now - parseInt(cacheTimestamp)) < CACHE_TTL) {
      try {
        const cachedSettings = JSON.parse(cached);
        setSettings({ ...DEFAULT_SETTINGS, ...cachedSettings });
        setLoading(false);
        // Still fetch in background to update cache
        loadSettings(cancelled, true);
        return;
      } catch (e) {
        // Cache corrupted, clear it
        sessionStorage.removeItem(CACHE_KEY);
        sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
      }
    }
    
    loadSettings(cancelled, false);
    return () => {
      cancelled = true;
    };
  }, [loadSettings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const response = await api.request<{ settings: RAGSettingsData }>('/api/rag/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      
      // Update cache after successful save
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(response.settings || settings));
      sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
      
      toast({
        title: 'Success',
        description: 'RAG settings saved successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save RAG settings.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [settings, toast]);

  // Memoize update handler to prevent unnecessary re-renders
  const updateSetting = useCallback((key: keyof RAGSettingsData, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Show loading overlay instead of blocking the entire UI
  const showLoadingOverlay = loading;

  // Filter sections based on activeSection prop - show all sections for now
  // Both 'settings' and 'voice-agentic' show all content since they're in the same component

  return (
    <div className="space-y-6 relative">
      {showLoadingOverlay && (
        <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}
      
      {/* Embedding Model Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-blue-600" />
            <CardTitle>Embedding Model</CardTitle>
          </div>
          <CardDescription>Configure the embedding model for document vectorization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="embedding_model">Embedding Model</Label>
            <Select
              value={(settings.embedding_model && settings.embedding_model !== '') ? settings.embedding_model : 'openai/text-embedding-3-large'}
              onValueChange={(value) => updateSetting('embedding_model', value)}
            >
              <SelectTrigger id="embedding_model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai/text-embedding-3-small">OpenAI text-embedding-3-small ($0.00002/1K tokens)</SelectItem>
                <SelectItem value="openai/text-embedding-3-large">OpenAI text-embedding-3-large ($0.00013/1K tokens)</SelectItem>
                <SelectItem value="cohere/embed-english-v3.0">Cohere embed-english-v3.0 ($0.0001/1K tokens)</SelectItem>
                <SelectItem value="aws/titan-embeddings">AWS Titan Embeddings ($0.0001/1K tokens)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vector_database">Vector Database</Label>
            <Select
              value={(settings.vector_database && settings.vector_database !== '') ? settings.vector_database : 'pinecone'}
              onValueChange={(value) => updateSetting('vector_database', value)}
            >
              <SelectTrigger id="vector_database">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pinecone">Pinecone (Managed) - $70/mo per 1M vectors</SelectItem>
                <SelectItem value="pgvector">pgvector (Self-hosted) - Included</SelectItem>
                <SelectItem value="opensearch">AWS OpenSearch - Pay-as-you-go</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="chunk_size">Chunk Size (tokens)</Label>
              <Input
                id="chunk_size"
                type="number"
                min="1"
                max="8192"
                value={settings.chunk_size || 512}
                onChange={(e) => updateSetting('chunk_size', parseInt(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chunk_overlap">Chunk Overlap (tokens)</Label>
              <Input
                id="chunk_overlap"
                type="number"
                min="0"
                value={settings.chunk_overlap || 50}
                onChange={(e) => updateSetting('chunk_overlap', parseInt(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Retrieval Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-purple-600" />
            <CardTitle>Retrieval Settings</CardTitle>
          </div>
          <CardDescription>Configure how documents are retrieved and ranked</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="top_k">Top-K Results</Label>
              <Input
                id="top_k"
                type="number"
                min="1"
                max="50"
                value={settings.top_k || 5}
                onChange={(e) => updateSetting('top_k', parseInt(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="similarity_threshold">Similarity Threshold</Label>
              <Input
                id="similarity_threshold"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={settings.similarity_threshold || 0.75}
                onChange={(e) => updateSetting('similarity_threshold', parseFloat(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable_reranking">Enable Reranking</Label>
              <p className="text-sm text-muted-foreground">Use Cohere Rerank for better results ($0.002/search)</p>
            </div>
            <Switch
              id="enable_reranking"
              checked={settings.enable_reranking !== false}
              onCheckedChange={(checked) => updateSetting('enable_reranking', checked)}
            />
          </div>

          {settings.enable_reranking && (
            <div className="space-y-2">
              <Label htmlFor="reranking_model">Reranking Model</Label>
              <Select
                value={(settings.reranking_model && settings.reranking_model !== '') ? settings.reranking_model : 'cohere/rerank-english-v3.0'}
                onValueChange={(value) => updateSetting('reranking_model', value)}
              >
                <SelectTrigger id="reranking_model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cohere/rerank-english-v3.0">Cohere Rerank English v3.0</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="context_window">Context Window (tokens)</Label>
            <Input
              id="context_window"
              type="number"
              min="1"
              max="200000"
              value={settings.context_window || 8000}
              onChange={(e) => updateSetting('context_window', parseInt(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">Maximum context sent to LLM</p>
          </div>
        </CardContent>
      </Card>

      {/* AI Model Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-green-600" />
            <CardTitle>AI Model Settings</CardTitle>
          </div>
          <CardDescription>Configure the AI models for chat and voice interactions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat_model">Chat/Dialogue Model</Label>
            <Select
              value={(settings.chat_model && settings.chat_model !== '') ? settings.chat_model : 'openai/gpt-4o'}
              onValueChange={(value) => updateSetting('chat_model', value)}
            >
              <SelectTrigger id="chat_model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai/gpt-4o">GPT-4o ($5/1M input, $15/1M output)</SelectItem>
                <SelectItem value="openai/gpt-4o-mini">GPT-4o-mini ($0.15/1M input, $0.60/1M output)</SelectItem>
                <SelectItem value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet ($3/1M input, $15/1M output)</SelectItem>
                <SelectItem value="google/gemini-1.5-pro">Gemini 1.5 Pro ($1.25/1M input, $5/1M output)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="voice_model">Voice AI Model</Label>
            <Select
              value={(settings.voice_model && settings.voice_model !== '') ? settings.voice_model : 'google/gemini-2.0-flash-live'}
              onValueChange={(value) => updateSetting('voice_model', value)}
            >
              <SelectTrigger id="voice_model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google/gemini-2.0-flash-live">Gemini 2.0 Flash Live ($0.035/min input, $0.07/min output)</SelectItem>
                <SelectItem value="openai/realtime-api">OpenAI Realtime API ($0.06/min input, $0.24/min output)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="temperature">Temperature (0-2)</Label>
            <Input
              id="temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature || 0.3}
              onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">Lower = more consistent, Higher = more creative</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom_system_prompt">Custom System Prompt</Label>
            <Textarea
              id="custom_system_prompt"
              value={settings.custom_system_prompt || ''}
              onChange={(e) => updateSetting('custom_system_prompt', e.target.value)}
              placeholder="Enter custom system prompt..."
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-600" />
            <CardTitle>API Keys</CardTitle>
          </div>
          <CardDescription>Configure API keys for OpenAI and Google Gemini services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="openai_api_key">OpenAI API Key</Label>
            <Input
              id="openai_api_key"
              type="password"
              value={settings.openai_api_key || ''}
              onChange={(e) => updateSetting('openai_api_key', e.target.value)}
              placeholder="sk-..."
              className="font-mono text-sm"
            />
            <p className="text-sm text-muted-foreground">
              Required for OpenAI embeddings and chat models. Get your key from{' '}
              <a 
                href="https://platform.openai.com/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                platform.openai.com
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gemini_api_key">Google Gemini API Key</Label>
            <Input
              id="gemini_api_key"
              type="password"
              value={settings.gemini_api_key || ''}
              onChange={(e) => updateSetting('gemini_api_key', e.target.value)}
              placeholder="AIza..."
              className="font-mono text-sm"
            />
            <p className="text-sm text-muted-foreground">
              Required for Gemini voice agentic models. Get your key from{' '}
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                aistudio.google.com
              </a>
            </p>
          </div>
          
          <div className="pt-2">
            <Button
              onClick={async () => {
                try {
                  await api.request('/api/rag/settings', {
                    method: 'PUT',
                    body: JSON.stringify({
                      openai_api_key: settings.openai_api_key || null,
                      gemini_api_key: settings.gemini_api_key || null,
                    }),
                  });
                  toast({
                    title: 'Success',
                    description: 'API keys saved successfully.',
                  });
                } catch (error: any) {
                  toast({
                    title: 'Error',
                    description: error.message || 'Failed to save API keys.',
                    variant: 'destructive',
                  });
                }
              }}
              className="font-light"
            >
              <Save className="h-4 w-4 mr-2" />
              Save API Keys
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Ailethia Voice Agentic Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-orange-600" />
            <CardTitle>Ailethia Voice Agentic Settings</CardTitle>
          </div>
          <CardDescription>Configure RAG and AI settings specifically for Ailethia voice conversations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="voice_agentic_enabled">Enable Voice Agentic</Label>
              <p className="text-sm text-muted-foreground">Enable Ailethia voice agentic with RAG-powered conversations</p>
            </div>
            <Switch
              id="voice_agentic_enabled"
              checked={settings.voice_agentic_enabled !== false}
              onCheckedChange={(checked) => updateSetting('voice_agentic_enabled', checked)}
            />
          </div>

          {settings.voice_agentic_enabled !== false && (
            <>
              <div className="space-y-2">
                <Label htmlFor="voice_name">Voice Name</Label>
                <Select
                  value={(settings.voice_name && settings.voice_name !== '') ? settings.voice_name : 'Aoede'}
                  onValueChange={(value) => updateSetting('voice_name', value)}
                >
                  <SelectTrigger id="voice_name">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Aoede">Aoede (Gemini - Female, Professional)</SelectItem>
                    <SelectItem value="shimmer">Shimmer (OpenAI - Female, Warm)</SelectItem>
                    <SelectItem value="alloy">Alloy (OpenAI - Neutral, Clear)</SelectItem>
                    <SelectItem value="echo">Echo (OpenAI - Male, Confident)</SelectItem>
                    <SelectItem value="fable">Fable (OpenAI - Male, Energetic)</SelectItem>
                    <SelectItem value="onyx">Onyx (OpenAI - Male, Deep)</SelectItem>
                    <SelectItem value="nova">Nova (OpenAI - Female, Bright)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">Voice personality for Ailethia conversations</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="voice_rag_enabled">Enable RAG for Voice</Label>
                  <p className="text-sm text-muted-foreground">Use knowledge base retrieval during voice conversations</p>
                </div>
                <Switch
                  id="voice_rag_enabled"
                  checked={settings.voice_rag_enabled !== false}
                  onCheckedChange={(checked) => updateSetting('voice_rag_enabled', checked)}
                />
              </div>

              {settings.voice_rag_enabled !== false && (
                <div className="space-y-4 pl-4 border-l-2 border-orange-200 dark:border-orange-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="voice_top_k">Voice Top-K Results</Label>
                      <Input
                        id="voice_top_k"
                        type="number"
                        min="1"
                        max="20"
                        value={settings.voice_top_k || 3}
                        onChange={(e) => updateSetting('voice_top_k', parseInt(e.target.value))}
                      />
                      <p className="text-sm text-muted-foreground">Fewer results for faster voice responses</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="voice_similarity_threshold">Voice Similarity Threshold</Label>
                      <Input
                        id="voice_similarity_threshold"
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={settings.voice_similarity_threshold || 0.8}
                        onChange={(e) => updateSetting('voice_similarity_threshold', parseFloat(e.target.value))}
                      />
                      <p className="text-sm text-muted-foreground">Higher threshold for more relevant results</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="voice_enable_reranking">Enable Reranking for Voice</Label>
                      <p className="text-sm text-muted-foreground">Use reranking to improve voice response quality</p>
                    </div>
                    <Switch
                      id="voice_enable_reranking"
                      checked={settings.voice_enable_reranking === true}
                      onCheckedChange={(checked) => updateSetting('voice_enable_reranking', checked)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="voice_context_window">Voice Context Window (tokens)</Label>
                <Input
                  id="voice_context_window"
                  type="number"
                  min="1000"
                  max="32000"
                  value={settings.voice_context_window || 4000}
                  onChange={(e) => updateSetting('voice_context_window', parseInt(e.target.value))}
                />
                <p className="text-sm text-muted-foreground">Shorter context for faster voice responses (recommended: 2000-8000)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice_temperature">Voice Temperature (0-2)</Label>
                <Input
                  id="voice_temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.voice_temperature || 0.4}
                  onChange={(e) => updateSetting('voice_temperature', parseFloat(e.target.value))}
                />
                <p className="text-sm text-muted-foreground">Slightly higher for more natural voice conversations</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice_response_max_length">Max Response Length (seconds)</Label>
                <Input
                  id="voice_response_max_length"
                  type="number"
                  min="10"
                  max="180"
                  value={settings.voice_response_max_length || 90}
                  onChange={(e) => updateSetting('voice_response_max_length', parseInt(e.target.value))}
                />
                <p className="text-sm text-muted-foreground">Maximum length for voice responses (30-90 seconds recommended)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice_conversation_memory">Conversation Memory (turns)</Label>
                <Input
                  id="voice_conversation_memory"
                  type="number"
                  min="5"
                  max="50"
                  value={settings.voice_conversation_memory || 20}
                  onChange={(e) => updateSetting('voice_conversation_memory', parseInt(e.target.value))}
                />
                <p className="text-sm text-muted-foreground">Number of previous conversation turns to remember</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="voice_real_time_mode">Real-time Mode</Label>
                  <p className="text-sm text-muted-foreground">Enable real-time streaming for faster voice responses</p>
                </div>
                <Switch
                  id="voice_real_time_mode"
                  checked={settings.voice_real_time_mode !== false}
                  onCheckedChange={(checked) => updateSetting('voice_real_time_mode', checked)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="voice_system_prompt">Voice System Prompt (Optional)</Label>
                <Textarea
                  id="voice_system_prompt"
                  value={settings.voice_system_prompt || ''}
                  onChange={(e) => updateSetting('voice_system_prompt', e.target.value)}
                  placeholder="Custom system prompt for Ailethia voice conversations. Leave empty to use default executive intelligence prompt."
                  rows={6}
                />
                <p className="text-sm text-muted-foreground">
                  Override the default Ailethia system prompt. The default includes executive intelligence, mortgage industry knowledge, and proactive insights.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-red-600" />
            <CardTitle>Data Privacy Settings</CardTitle>
          </div>
          <CardDescription>Configure PII sanitization and data protection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enable_pii_sanitization">Enable PII Sanitization</Label>
              <p className="text-sm text-muted-foreground">Redact sensitive data before LLM calls</p>
            </div>
            <Switch
              id="enable_pii_sanitization"
              checked={settings.enable_pii_sanitization !== false}
              onCheckedChange={(checked) => updateSetting('enable_pii_sanitization', checked)}
            />
          </div>

          {settings.enable_pii_sanitization && (
            <div className="space-y-3 pl-4 border-l-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="redact_ssn">Redact SSN</Label>
                <Switch
                  id="redact_ssn"
                  checked={settings.redact_ssn !== false}
                  onCheckedChange={(checked) => updateSetting('redact_ssn', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="redact_dob">Redact Date of Birth</Label>
                <Switch
                  id="redact_dob"
                  checked={settings.redact_dob !== false}
                  onCheckedChange={(checked) => updateSetting('redact_dob', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="redact_account_numbers">Redact Account Numbers</Label>
                <Switch
                  id="redact_account_numbers"
                  checked={settings.redact_account_numbers !== false}
                  onCheckedChange={(checked) => updateSetting('redact_account_numbers', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="allow_employee_names">Allow Employee Names in Context</Label>
                <Switch
                  id="allow_employee_names"
                  checked={settings.allow_employee_names === true}
                  onCheckedChange={(checked) => updateSetting('allow_employee_names', checked)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="log_ai_interactions">Log AI Interactions</Label>
              <p className="text-sm text-muted-foreground">Store all AI interactions for audit purposes</p>
            </div>
            <Switch
              id="log_ai_interactions"
              checked={settings.log_ai_interactions !== false}
              onCheckedChange={(checked) => updateSetting('log_ai_interactions', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
});

