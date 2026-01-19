import { useState, useEffect, useMemo, lazy, Suspense, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { Loader2, Brain, Mic, Database, Settings as SettingsIcon, ChevronRight, Key } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { useTheme } from '@/components/theme-provider';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

// Lazy load RAGSettings for better performance
const RAGSettings = lazy(() => {
  return import('@/components/settings/RAGSettings').then(module => {
    return { default: module.RAGSettings };
  });
});

type RAGSection = 'settings' | 'voice-agentic';

export const RAG = () => {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<RAGSection>('settings');
  const [apiKeysModalOpen, setApiKeysModalOpen] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);


  // Force light theme for RAG page
  useEffect(() => {
    setTheme('light');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }, [setTheme]);

  useEffect(() => {
    // Optimize auth check - use cached session if available
    const checkAuth = async () => {
      try {
        // Check if we have a cached session first
        const cachedSession = sessionStorage.getItem('auth_session');
        if (cachedSession === 'true') {
          setLoading(false);
          // Verify session is still valid in background (non-blocking)
          api.getCurrentUser().then(({ user }) => {
            if (!user) {
              sessionStorage.removeItem('auth_session');
              navigate('/');
            }
          }).catch(() => {
            // Ignore errors in background check
          });
          return;
        }
        
        const { user } = await api.getCurrentUser();
        if (!user) {
          navigate('/');
          return;
        }
        // Cache the session check result
        sessionStorage.setItem('auth_session', 'true');
      } catch (error) {
        console.error('Auth check failed:', error);
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    
    checkAuth();
  }, [navigate]);

  const ragSections = useMemo(() => [
    { 
      id: 'settings' as RAGSection, 
      label: 'RAG Settings', 
      icon: Brain, 
      description: 'General RAG configuration', 
      color: 'text-blue-300 dark:text-blue-400/70' 
    },
    { 
      id: 'voice-agentic' as RAGSection, 
      label: 'Voice Agentic', 
      icon: Mic, 
      description: 'Ailethia voice settings', 
      color: 'text-orange-300 dark:text-orange-400/70' 
    },
  ], []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto mb-4" />
          <p className="text-sm text-slate-500 font-light">Loading RAG settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-4xl font-bold mb-2">RAG for Ailethia</h1>
            <p className="text-muted-foreground">
              Configure Retrieval-Augmented Generation settings for Ailethia's knowledge base
            </p>
          </div>
          
          {/* API Keys Icon Button - Prominent and Visible */}
          <Dialog open={apiKeysModalOpen} onOpenChange={setApiKeysModalOpen}>
            <DialogTrigger asChild>
              <Button
                variant="default"
                size="lg"
                className="flex items-center gap-2 bg-gradient-to-r from-purple-100 to-pink-100 hover:from-purple-200 hover:to-pink-200 text-purple-700 border border-purple-200 shadow-sm hover:shadow-md transition-all font-medium text-base whitespace-nowrap"
                onClick={async () => {
                  // Load current API keys when opening modal
                  try {
                    const response = await api.request<{ settings: any }>('/api/rag/settings');
                    setOpenaiKey(response.settings?.openai_api_key || '');
                    setGeminiKey(response.settings?.gemini_api_key || '');
                  } catch (error) {
                    console.error('Error loading API keys:', error);
                  }
                }}
              >
                <Key className="h-5 w-5 text-purple-600" strokeWidth={2.5} />
                <span className="font-semibold text-purple-700">API Keys</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-purple-600" />
                  API Keys Configuration
                </DialogTitle>
                <DialogDescription>
                  Configure your OpenAI and Google Gemini API keys for RAG and voice agentic features
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="modal_openai_key">OpenAI API Key</Label>
                  <Input
                    id="modal_openai_key"
                    type="password"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
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
                  <Label htmlFor="modal_gemini_key">Google Gemini API Key</Label>
                  <Input
                    id="modal_gemini_key"
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
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

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setApiKeysModalOpen(false)}
                    className="font-light"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      setSavingKeys(true);
                      try {
                        await api.request('/api/rag/settings', {
                          method: 'PUT',
                          body: JSON.stringify({
                            openai_api_key: openaiKey || null,
                            gemini_api_key: geminiKey || null,
                          }),
                        });
                        toast({
                          title: 'Success',
                          description: 'API keys saved successfully.',
                        });
                        setApiKeysModalOpen(false);
                      } catch (error: any) {
                        toast({
                          title: 'Error',
                          description: error.message || 'Failed to save API keys.',
                          variant: 'destructive',
                        });
                      } finally {
                        setSavingKeys(false);
                      }
                    }}
                    disabled={savingKeys}
                    className="font-light bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
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
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1">
            <Card className="sticky top-24 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-light text-slate-900 dark:text-white tracking-tight">
                  RAG Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-0">
                {ragSections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <motion.button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-slate-50 dark:bg-slate-700/50 border-l-2 border-slate-900 dark:border-slate-100'
                          : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/30'
                      }`}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Icon 
                        className={`h-4 w-4 flex-shrink-0 ${
                          isActive 
                            ? section.color
                            : section.color
                        }`} 
                        strokeWidth={1.5}
                      />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-light tracking-tight ${
                          isActive
                            ? 'text-slate-900 dark:text-white'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}>
                          {section.label}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5 font-light truncate">
                          {section.description}
                        </div>
                      </div>
                      {isActive && (
                        <ChevronRight className="h-4 w-4 text-slate-900 dark:text-white flex-shrink-0" />
                      )}
                    </motion.button>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            <Suspense fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            }>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                key={activeSection}
              >
                <RAGSettings activeSection={activeSection} />
              </motion.div>
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RAG;
