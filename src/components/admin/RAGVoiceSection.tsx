import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Loader2, 
  Brain, 
  Mic, 
  Key, 
  RefreshCw, 
  Plus,
  Info,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface RAGVoiceSectionProps {
  ragVoiceSettings: any;
  ragVoiceCosts: any[];
  loading: boolean;
  isSuperAdmin: boolean;
  tenants: any[];
  onSave: (settings: any) => Promise<any>;
  onRefresh: (useCache?: boolean, tenantId?: string | null) => Promise<any>;
  onSaveApiKeys?: (openaiKey: string, geminiKey: string) => Promise<any>;
}

export const RAGVoiceSection = ({
  ragVoiceSettings,
  ragVoiceCosts,
  loading,
  isSuperAdmin,
  tenants,
  onRefresh,
}: RAGVoiceSectionProps) => {
  const { toast } = useToast();
  
  // Tenant Selection State (for Super Admin)
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  
  // API Keys Modal State
  const [apiKeysModalOpen, setApiKeysModalOpen] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);

  // Settings State
  const [settings, setSettings] = useState(ragVoiceSettings || {});

  const handleSaveApiKeys = async () => {
    setSavingKeys(true);
    try {
      const targetTenantId = selectedTenantId || undefined;
      const url = targetTenantId && isSuperAdmin
        ? `/api/rag/settings?tenant_id=${targetTenantId}`
        : '/api/rag/settings';
      await api.request(url, {
        method: 'PUT',
        body: JSON.stringify({
          openai_api_key: openaiKey || null,
          gemini_api_key: geminiKey || null,
        }),
      });
      toast({
        title: 'Success',
        description: selectedTenantId && isSuperAdmin
          ? `API keys saved successfully for ${tenants.find(t => t.id === selectedTenantId)?.name || 'selected tenant'}.`
          : 'API keys saved successfully. Ailethia voice agentic is now ready to use!',
      });
      setApiKeysModalOpen(false);
      await onRefresh(false, selectedTenantId);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save API keys.',
        variant: 'destructive',
      });
    } finally {
      setSavingKeys(false);
    }
  };

  const handleSaveTopicsAndRules = async () => {
    try {
      const targetTenantId = selectedTenantId || undefined;
      const url = targetTenantId && isSuperAdmin
        ? `/api/rag/settings?tenant_id=${targetTenantId}`
        : '/api/rag/settings';
      await api.request(url, {
        method: 'PUT',
        body: JSON.stringify({
          allowed_topics: settings?.allowed_topics || null,
          conversation_rules: settings?.conversation_rules || null,
          knowledge_base_links: settings?.knowledge_base_links || null,
          personality_custom: settings?.personality_custom || null,
        }),
      });
      toast({
        title: 'Settings Saved',
        description: 'Topics, rules, and knowledge base configuration saved successfully.',
      });
      await onRefresh(false, selectedTenantId);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings.',
        variant: 'destructive',
      });
    }
  };

  const loadDefaultContent = () => {
    const defaultAllowedTopics = `Loan origination
Underwriting
Compliance and regulatory requirements
Staff productivity and performance
TopTiering system and rankings
Fallout estimation and prediction
Market trends and industry news
Executive insights and strategic clarity
Company health signals
Profitability analysis
Cycle time optimization
Capacity management
Risk assessment
Operational bottlenecks
Performance metrics and benchmarks`;

    const defaultConversationRules = `Always ask for clarification when information is unclear
Never provide financial advice or make credit decisions
Always cite sources when referencing data or metrics
Be proactive and predictive - surface important information before being asked
Connect insights across different domains (market trends, staff performance, operational data)
Use executive-level language appropriate for leadership
Speak clearly and concisely - every word counts
Provide actionable insights that lead to decisions
Never include stage directions or bracketed text in responses
Read financial figures in full professional terms (e.g., "one point two million dollars" not "1.2M")
Stay current with mortgage industry trends and Fed announcements`;

    const defaultKnowledgeBaseLinks = `https://www.icemortgagetechnology.com/resources/encompass-developer-connect
https://www.icemortgagetechnology.com/resources/encompass-api-documentation
https://developers.meridianlink.com/consumer-docs
https://developers.meridianlink.com/consumer-docs/api-reference
https://www.consumerfinance.gov/compliance/compliance-resources/mortgage-resources/
https://www.hud.gov/program_offices/housing/sfh/lending
https://www.fanniemae.com/singlefamily/originating-underwriting
https://www.freddiemac.com/singlefamily/originate
https://www.mba.org/news-and-research
https://www.housingwire.com/
https://www.nationalmortgagenews.com/
https://www.mortgageorb.com/
https://www.lendingpatterns.com/use-cases
https://www.optimallending.com/executive-insights`;

    const defaultPersonalityCustom = `Be proactive and predictive - identify patterns before they become problems. Ask smart questions the CEO didn't even think of. Connect dots others might miss across market trends, staff performance, and operational data. Surface hidden opportunities and risks. Deliver insights like a trusted advisor, not just reporting data but providing strategic intelligence. Think like a Chief of Staff - every insight should matter to leadership and lead to actionable decisions.`;

    setSettings({
      ...settings,
      allowed_topics: settings?.allowed_topics || defaultAllowedTopics,
      conversation_rules: settings?.conversation_rules || defaultConversationRules,
      knowledge_base_links: settings?.knowledge_base_links || defaultKnowledgeBaseLinks,
      personality_custom: settings?.personality_custom || defaultPersonalityCustom,
    });
    
    toast({
      title: 'Default Content Loaded',
      description: 'Default Ailethia topics, rules, and knowledge base links have been loaded. You can edit them as needed.',
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Tenant Selector for Super Admin */}
      {isSuperAdmin && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
              Support Access
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Select a tenant to view or manage their RAG & Voice Agentic settings for support purposes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select
                value={selectedTenantId || '__super_admin__'}
                onValueChange={async (value) => {
                  const actualValue = value === '__super_admin__' ? null : value;
                  setSelectedTenantId(actualValue);
                  await onRefresh(false, actualValue);
                }}
              >
                <SelectTrigger className="w-full max-w-md font-light">
                  <SelectValue placeholder="Select tenant for support access..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__super_admin__">My Account (Super Admin)</SelectItem>
                  {tenants && Array.isArray(tenants) && tenants.length > 0 ? tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  )) : null}
                </SelectContent>
              </Select>
              {selectedTenantId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setSelectedTenantId(null);
                    await onRefresh(true, null);
                  }}
                  className="font-extralight"
                >
                  Clear Selection
                </Button>
              )}
            </div>
            {selectedTenantId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-light">
                ⚠️ You are viewing settings for: {tenants.find(t => t.id === selectedTenantId)?.name || 'Selected Tenant'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {loading && !ragVoiceSettings ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* API Keys Section */}
          <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                    API Keys {selectedTenantId && isSuperAdmin && <span className="text-xs text-amber-600">(Support Mode)</span>}
                  </CardTitle>
                  <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    Configure OpenAI and Gemini API keys for RAG and voice agentic features
                    {selectedTenantId && isSuperAdmin && ' - These keys are tenant-specific'}
                  </CardDescription>
                </div>
                <Dialog open={apiKeysModalOpen} onOpenChange={setApiKeysModalOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="default"
                      size="lg"
                      className="flex items-center gap-2 bg-gradient-to-r from-purple-100 to-pink-100 hover:from-purple-200 hover:to-pink-200 text-purple-700 border border-purple-200 shadow-sm hover:shadow-md transition-all font-medium whitespace-nowrap"
                      onClick={async () => {
                        try {
                          const targetTenantId = selectedTenantId || undefined;
                          const url = targetTenantId && isSuperAdmin
                            ? `/api/rag/settings?tenant_id=${targetTenantId}`
                            : '/api/rag/settings';
                          const response = await api.request<{ settings: any }>(url);
                          setOpenaiKey(response.settings?.openai_api_key || '');
                          setGeminiKey(response.settings?.gemini_api_key || '');
                        } catch (error) {
                          console.error('Error loading API keys:', error);
                        }
                      }}
                    >
                      <Key className="h-5 w-5 text-purple-600" strokeWidth={2.5} />
                      <span className="font-semibold text-purple-700">Manage API Keys</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto !bg-white !border-slate-200 text-slate-900 p-8">
                    <DialogHeader className="pb-6 border-b border-slate-200 px-0">
                      <DialogTitle className="flex items-center gap-2 text-xl font-semibold !text-slate-900">
                        <Key className="h-6 w-6 text-purple-600" />
                        API Keys Configuration for Ailethia Voice Agentic
                      </DialogTitle>
                      <DialogDescription className="pt-3 !text-slate-600 text-sm leading-relaxed">
                        Configure tenant-specific API keys for OpenAI and Google Gemini. These keys are used for RAG embeddings, chat models, and Ailethia's real-time voice agentic features.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-6 py-6 px-0">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-3">
                        <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                          <Info className="h-4 w-4" />
                          About Ailethia Voice Agentic
                        </h3>
                        <div className="text-xs text-blue-800 space-y-2 leading-relaxed pl-6">
                          <p>
                            <strong>Ailethia</strong> is an executive-intelligent AI voice assistant powered by <strong>Google Gemini 2.0 Flash Live</strong>. 
                            It provides real-time, bidirectional voice conversations with your team.
                          </p>
                          <div className="mt-3 space-y-1">
                            <p><strong>Features:</strong></p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                              <li><strong>Voice:</strong> Aoede (professional female voice)</li>
                              <li><strong>Model:</strong> Gemini 2.0 Flash Experimental</li>
                              <li><strong>Audio Format:</strong> PCM16, 24kHz</li>
                              <li><strong>Real-time:</strong> Bidirectional audio streaming</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 space-y-2">
                        <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" />
                          Important Notes
                        </h3>
                        <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside leading-relaxed pl-6">
                          <li>API keys are <strong>tenant-specific</strong> - each lender organization has their own keys</li>
                          <li>Super admins can view/manage any tenant's keys for support purposes</li>
                          <li>Keys are stored securely in the database and used for all AI operations</li>
                          <li>If keys are not set, the system will fall back to environment variables (if configured)</li>
                          <li>Changes take effect immediately - no server restart required</li>
                        </ul>
                      </div>

                      <div className="space-y-6">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="admin_openai_key" className="text-sm font-semibold !text-slate-900">
                              OpenAI API Key
                            </Label>
                            <Badge variant="outline" className="text-xs bg-slate-50 border-slate-200 text-slate-700">
                              Required
                            </Badge>
                          </div>
                          <Input
                            id="admin_openai_key"
                            type="password"
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            placeholder="sk-proj-..."
                            className="font-mono text-sm !bg-white !border-slate-300 !text-slate-900 py-2.5 px-4"
                          />
                          <div className="text-xs !text-slate-600 space-y-1 leading-relaxed pl-1">
                            <p>
                              <strong>Used for:</strong> OpenAI embeddings (text-embedding-3-large), chat models (GPT-4o), and RAG document processing.
                            </p>
                            <p>
                              Get your API key from{' '}
                              <a 
                                href="https://platform.openai.com/api-keys" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="!text-blue-600 hover:!underline font-medium"
                              >
                                platform.openai.com/api-keys
                              </a>
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="admin_gemini_key" className="text-sm font-semibold !text-slate-900">
                              Google Gemini API Key
                            </Label>
                            <Badge variant="outline" className="text-xs bg-slate-50 border-slate-200 text-slate-700">
                              Required for Voice
                            </Badge>
                          </div>
                          <Input
                            id="admin_gemini_key"
                            type="password"
                            value={geminiKey}
                            onChange={(e) => setGeminiKey(e.target.value)}
                            placeholder="AIzaSy..."
                            className="font-mono text-sm !bg-white !border-slate-300 !text-slate-900 py-2.5 px-4"
                          />
                          <div className="text-xs !text-slate-600 space-y-1 leading-relaxed pl-1">
                            <p>
                              <strong>Used for:</strong> Ailethia voice agentic conversations, real-time voice interactions, and Gemini 2.0 Flash Live model.
                            </p>
                            <p>
                              Get your API key from{' '}
                              <a 
                                href="https://aistudio.google.com/app/apikey" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="!text-blue-600 hover:!underline font-medium"
                              >
                                aistudio.google.com/app/apikey
                              </a>
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-purple-600" />
                          How These Keys Are Used
                        </h3>
                        <div className="text-xs text-slate-700 space-y-2 leading-relaxed pl-6">
                          <div>
                            <strong className="text-slate-900">OpenAI Key:</strong>
                            <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                              <li>Document embeddings for RAG knowledge base</li>
                              <li>Chat completions and text generation</li>
                              <li>Query embeddings for semantic search</li>
                            </ul>
                          </div>
                          <div>
                            <strong className="text-slate-900">Gemini Key:</strong>
                            <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                              <li>Real-time voice conversations with Ailethia</li>
                              <li>WebSocket-based bidirectional audio streaming</li>
                              <li>Voice agentic personality and behavior configuration</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>

                    <DialogFooter className="pt-6 mt-6 !border-t !border-slate-200 bg-slate-50 -mx-8 -mb-8 px-8 py-5">
                      <Button
                        variant="outline"
                        onClick={() => setApiKeysModalOpen(false)}
                        className="font-extralight !border-slate-300 !text-slate-700 hover:!bg-slate-100 px-6 py-2.5"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSaveApiKeys}
                        disabled={savingKeys}
                        className="font-extralight !bg-gradient-to-r !from-purple-600 !to-pink-600 hover:!from-purple-700 hover:!to-pink-700 !text-white shadow-md px-6 py-2.5"
                      >
                        {savingKeys ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          'Save API Keys'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
          </Card>

          {/* Topics and Rules */}
          <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                    Topics and Rules
                  </CardTitle>
                  <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                    Configure conversation topics and rules for Ailethia voice agentic. Current settings are loaded below and can be edited, added to, or deleted.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadDefaultContent}
                    className="font-extralight text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Load Defaults
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await onRefresh(false, selectedTenantId);
                      toast({
                        title: 'Refreshed',
                        description: 'Topics, rules, and knowledge base links reloaded from current settings.',
                      });
                    }}
                    className="font-extralight text-xs"
                    disabled={loading}
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="allowed_topics" className="text-sm font-semibold text-slate-900">Allowed Topics</Label>
                  {settings?.allowed_topics && (
                    <span className="text-xs text-slate-500">
                      {settings.allowed_topics.split('\n').filter((t: string) => t.trim()).length} topic(s)
                    </span>
                  )}
                </div>
                <Textarea
                  id="allowed_topics"
                  value={settings?.allowed_topics ?? ''}
                  onChange={(e) => setSettings({ ...settings, allowed_topics: e.target.value })}
                  placeholder="Enter allowed conversation topics, one per line (e.g., Loan origination, Underwriting, Compliance)"
                  rows={6}
                  className="font-extralight bg-white border-slate-200 text-slate-900 p-4 min-h-[120px] resize-y"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  List topics Ailethia can discuss. Leave empty to allow all topics. Current values are displayed above and can be edited, added to, or deleted.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="conversation_rules" className="text-sm font-semibold text-slate-900">Conversation Rules</Label>
                  {settings?.conversation_rules && (
                    <span className="text-xs text-slate-500">
                      {settings.conversation_rules.split('\n').filter((r: string) => r.trim()).length} rule(s)
                    </span>
                  )}
                </div>
                <Textarea
                  id="conversation_rules"
                  value={settings?.conversation_rules ?? ''}
                  onChange={(e) => setSettings({ ...settings, conversation_rules: e.target.value })}
                  placeholder="Enter conversation rules, one per line (e.g., Always ask for clarification, Never provide financial advice, Always cite sources)"
                  rows={6}
                  className="font-extralight bg-white border-slate-200 text-slate-900 p-4 min-h-[120px] resize-y"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Rules that Ailethia must follow during conversations. Current values are displayed above and can be edited, added to, or deleted.
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="knowledge_base_links" className="text-sm font-semibold text-slate-900">Knowledge Base Links</Label>
                  {settings?.knowledge_base_links && (
                    <span className="text-xs text-slate-500">
                      {settings.knowledge_base_links.split('\n').filter((l: string) => l.trim()).length} link(s)
                    </span>
                  )}
                </div>
                <Textarea
                  id="knowledge_base_links"
                  value={settings?.knowledge_base_links ?? ''}
                  onChange={(e) => setSettings({ ...settings, knowledge_base_links: e.target.value })}
                  placeholder="Enter knowledge base links, one per line (e.g., https://docs.example.com, https://wiki.company.com)"
                  rows={4}
                  className="font-extralight bg-white border-slate-200 text-slate-900 p-4 min-h-[100px] resize-y"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Links to knowledge base resources that Ailethia can reference during conversations. Current values are displayed above and can be edited, added to, or deleted.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="personality_custom" className="text-sm font-semibold text-slate-900">Personality Customization</Label>
                </div>
                <Textarea
                  id="personality_custom"
                  value={settings?.personality_custom ?? ''}
                  onChange={(e) => setSettings({ ...settings, personality_custom: e.target.value })}
                  placeholder="Describe how Ailethia should behave (e.g., Be proactive and predictive, Think like a Chief of Staff)"
                  rows={4}
                  className="font-extralight bg-white border-slate-200 text-slate-900 p-4 min-h-[100px] resize-y"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Define Ailethia's personality and behavior during conversations.
                </p>
              </div>
              
              <Button
                onClick={handleSaveTopicsAndRules}
                className="w-full font-light mt-4"
              >
                Save Topics, Rules & Configuration
              </Button>
            </CardContent>
          </Card>

          {/* Cost Breakdown */}
          <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CardHeader>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Usage & Costs
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Voice agentic conversation costs and usage statistics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card className="border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300">
                      Total Calls
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-extralight text-slate-900 dark:text-white">
                      {ragVoiceCosts.length}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300">
                      Total Cost
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-extralight text-slate-900 dark:text-white">
                      ${ragVoiceCosts.reduce((sum, cost) => sum + (cost.total_cost || 0), 0).toFixed(2)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-slate-200 dark:border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300">
                      Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-base font-extralight text-emerald-600 dark:text-emerald-400">
                      Active
                    </div>
                  </CardContent>
                </Card>
              </div>

              {ragVoiceCosts.length > 0 && (
                <div className="text-center text-xs text-slate-500 dark:text-slate-400 font-light mt-4">
                  Showing cost data for recent conversations
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </motion.div>
  );
};
