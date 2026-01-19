import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Newspaper, 
  Building2, 
  TrendingUp, 
  BarChart3, 
  Activity, 
  AlertTriangle,
  Settings,
  Check,
  X,
  Zap,
  ExternalLink
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';

/**
 * Industry News Card Component
 * Displays industry news from various sources (MBA, Fannie Mae, Freddie Mac, CFPB, FHFA)
 * with source selection, filtering, and detailed article views
 */
export const IndustryNewsCard = () => {
  const [newsFeed, setNewsFeed] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [lastNewsUpdate, setLastNewsUpdate] = useState<Date | null>(null);
  const [selectedNewsItem, setSelectedNewsItem] = useState<{
    item: any;
    source: any;
  } | null>(null);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  // Initialize with all available sources by default
  const defaultSources = ['MBA', 'Fannie Mae', 'Freddie Mac'];
  const [selectedSources, setSelectedSources] = useState<string[]>(defaultSources);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);

  // Load user preferences from database
  const loadUserPreferences = async () => {
    try {
      const preference = await api.request<{ preference_value: string[] }>('/api/user/preferences/selectedNewsSources');
      if (preference?.preference_value) {
        setSelectedSources(preference.preference_value);
        localStorage.setItem('selectedNewsSources', JSON.stringify(preference.preference_value));
      } else {
        // Fallback to localStorage
        const saved = localStorage.getItem('selectedNewsSources');
        if (saved) {
          const parsed = JSON.parse(saved);
          setSelectedSources(parsed);
          // Save to database for future use
          await saveUserPreferences(parsed);
        } else {
          // If no preferences exist, use all available sources
          setSelectedSources(defaultSources);
          await saveUserPreferences(defaultSources);
        }
      }
    } catch (error: any) {
      // For timeout errors, log as warning since we have localStorage fallback
      if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        console.warn('User preferences request timed out, using localStorage fallback:', error.message);
      } else {
        console.error('Error loading user preferences:', error);
      }
      // Fallback to localStorage if not authenticated or preference not found
      const saved = localStorage.getItem('selectedNewsSources');
      if (saved) {
        setSelectedSources(JSON.parse(saved));
      } else {
        setSelectedSources(defaultSources);
        localStorage.setItem('selectedNewsSources', JSON.stringify(defaultSources));
      }
    } finally {
      setIsLoadingPreferences(false);
    }
  };

  // Save user preferences to database
  const saveUserPreferences = async (sources: string[]) => {
    try {
      // Save to localStorage immediately for instant access
      localStorage.setItem('selectedNewsSources', JSON.stringify(sources));

      // Save to database via API
      try {
        await api.request('/api/user/preferences/selectedNewsSources', {
          method: 'PUT',
          body: JSON.stringify({ preference_value: sources }),
        });
      } catch (error: any) {
        // If not authenticated, just use localStorage
        if (error.message?.includes('Unauthorized')) {
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('Error saving user preferences:', error);
      // Still save to localStorage even if database save fails
      localStorage.setItem('selectedNewsSources', JSON.stringify(sources));
    }
  };

  // Load preferences on mount
  useEffect(() => {
    loadUserPreferences();
  }, []);

  // Available news sources
  const availableSources = [{
    source: 'MBA',
    icon: Building2,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    summary: 'The Mortgage Bankers Association (MBA) is the leading trade association representing the real estate finance industry. MBA provides market analysis, economic forecasts, and industry insights that help lenders make informed decisions about mortgage rates, application volumes, and market trends.',
    items: [{
      title: 'Mortgage applications rise 2.3% week-over-week as rates stabilize',
      time: '2h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.mba.org/news-and-research/newsroom'
    }, {
      title: 'Refinance activity increases 15% month-over-month',
      time: '5h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.mba.org/news-and-research/newsroom'
    }]
  }, {
    source: 'Fannie Mae',
    icon: TrendingUp,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950/20',
    summary: 'Fannie Mae provides comprehensive housing market research and economic forecasts. Their insights help lenders understand home price trends, housing supply dynamics, and consumer sentiment that directly impact mortgage origination strategies.',
    items: [{
      title: 'Home price expectations remain positive through Q1 2026',
      time: '3h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.fanniemae.com/newsroom'
    }, {
      title: 'Housing supply constraints easing in key markets',
      time: '6h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.fanniemae.com/newsroom'
    }]
  }, {
    source: 'Freddie Mac',
    icon: BarChart3,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-950/20',
    summary: 'Freddie Mac provides market insights, economic research, and policy updates critical for mortgage lenders. Stay informed about GSE guidelines, market trends, and regulatory changes affecting loan origination and servicing.',
    items: [{
      title: 'Mortgage rates continue to stabilize',
      time: '1h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.freddiemac.com/news'
    }, {
      title: 'Housing market outlook remains positive',
      time: '4h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.freddiemac.com/news'
    }]
  }, {
    source: 'CFPB',
    icon: AlertTriangle,
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/20',
    summary: 'The Consumer Financial Protection Bureau (CFPB) issues regulations and enforcement actions that directly impact mortgage lending operations. Critical for compliance and risk management.',
    items: [{
      title: 'New compliance guidelines released',
      time: '2h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.consumerfinance.gov/about-us/newsroom/'
    }, {
      title: 'Enforcement actions update',
      time: '5h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.consumerfinance.gov/about-us/newsroom/'
    }]
  }, {
    source: 'FHFA',
    icon: Activity,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
    summary: 'The Federal Housing Finance Agency (FHFA) regulates Fannie Mae, Freddie Mac, and the Federal Home Loan Banks. Their policy updates directly affect mortgage lending standards and market operations.',
    items: [{
      title: 'GSE policy updates announced',
      time: '3h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.fhfa.gov/Media'
    }, {
      title: 'Market analysis report published',
      time: '6h ago',
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      link: 'https://www.fhfa.gov/Media'
    }]
  }];

  // Default news feed structure (fallback) - filtered by selected sources
  const getDefaultNewsFeed = () => {
    return availableSources.filter(source => selectedSources.includes(source.source));
  };

  // Fetch news from API
  const fetchNews = async () => {
    // Check if user has a valid token before making API call
    const token = localStorage.getItem('auth_token');
    if (!token) {
      // No token - use default news feed without making API call
      setNewsFeed(getDefaultNewsFeed());
      setNewsLoading(false);
      return;
    }
    
    try {
      setNewsLoading(true);
      setNewsError(null);
      const response = await api.getNews();

      // Map icon strings to actual icon components
      const iconMap: Record<string, any> = {
        Building2,
        Newspaper,
        TrendingUp,
        BarChart3,
        Activity
      };
      const mappedNewsFeed = response.newsFeed.map((source: any) => ({
        ...source,
        icon: iconMap[source.icon] || Newspaper
      }));

      // Fetch ALL sources from API, not just selected ones
      // This ensures all sources are scraped and available
      const allSourcesFromAPI = mappedNewsFeed;
      
      // Merge with available sources to ensure all are present
      const defaultFeed = availableSources;
      const finalFeed = availableSources.map(defaultSource => {
        const apiSource = allSourcesFromAPI.find((s: any) => s.source === defaultSource.source);
        // Use API data if available, otherwise use default
        return apiSource || defaultSource;
      });
      
      // Set all sources in feed (not just selected ones)
      setNewsFeed(finalFeed);
      setLastNewsUpdate(new Date());
      if (response.error) {
        setNewsError(response.error);
        // Silently handle error - no toast notification
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        // User not authenticated - use default news feed without logging error
        setNewsFeed(getDefaultNewsFeed());
      } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        // For timeout errors, log as warning since we have default news feed fallback
        console.warn('News request timed out, using default news feed fallback:', error.message);
        setNewsError(error.message || 'Failed to fetch news');
        setNewsFeed(getDefaultNewsFeed());
      } else {
        console.error('Error fetching news:', error);
        setNewsError(error.message || 'Failed to fetch news');
        setNewsFeed(getDefaultNewsFeed());
      }
      // Silently fall back to default news - no toast notification
    } finally {
      setNewsLoading(false);
    }
  };

  // Fetch news on mount, when selected sources change, and every 30 minutes
  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => {
      fetchNews();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedSources]);

  // Initialize news feed with default if empty
  useEffect(() => {
    if (newsFeed.length === 0 && !newsLoading) {
      setNewsFeed(getDefaultNewsFeed());
    }
  }, [newsLoading]);

  // Filter news feed based on selected sources
  const filteredNewsFeed = useMemo(() => {
    if (newsFeed.length === 0) {
      return getDefaultNewsFeed();
    }
    return newsFeed.filter((source: any) => selectedSources.includes(source.source));
  }, [newsFeed, selectedSources]);

  // Handle source selection - Allow all sources to be selected
  const handleSourceToggle = (sourceName: string) => {
    setSelectedSources(prev => {
      if (prev.includes(sourceName)) {
        // Remove if already selected (but keep at least 1 source)
        if (prev.length > 1) {
          const updated = prev.filter(s => s !== sourceName);
          saveUserPreferences(updated);
          return updated;
        }
        return prev;
      } else {
        // Add if not selected - no maximum limit, allow all sources
        const updated = [...prev, sourceName];
        saveUserPreferences(updated);
        return updated;
      }
    });
  };

  // Update news feed when selected sources change
  useEffect(() => {
    // Filter existing news feed by selected sources
    const filtered = newsFeed.filter((source: any) => selectedSources.includes(source.source));

    // Add any missing sources from availableSources
    const missingSources = selectedSources.filter(sourceName => !filtered.some((s: any) => s.source === sourceName));
    if (missingSources.length > 0) {
      const newSources = availableSources.filter(s => missingSources.includes(s.source));
      setNewsFeed([...filtered, ...newSources]);
    } else if (filtered.length !== newsFeed.length) {
      // Only update if the filtered result is different
      setNewsFeed(filtered.length > 0 ? filtered : getDefaultNewsFeed());
    }
  }, [selectedSources]);

  return (
    <div className="mb-6 sm:mb-10">
      {/* Refined Preview Card - Enhanced Typography & Layout */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-xl sm:rounded-2xl md:rounded-3xl bg-white dark:bg-slate-900/95 p-4 sm:p-5 md:p-7 lg:p-9 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_4px_12px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_0_rgba(0,0,0,0.3),0_4px_12px_0_rgba(0,0,0,0.2)] border border-slate-200/60 dark:border-slate-700/50"
      >
        {/* Enhanced Header - Mobile First */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 md:gap-4 lg:gap-5 mb-4 sm:mb-5 md:mb-6 lg:mb-7">
          <div className="flex items-center gap-2.5 sm:gap-3 md:gap-4 lg:gap-5 flex-1 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_4px_12px_rgba(59,130,246,0.25)] dark:shadow-[0_4px_12px_rgba(59,130,246,0.15)]">
                <Newspaper className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-white" strokeWidth={1.5} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-extralight text-slate-900 dark:text-white mb-0.5 sm:mb-1 tracking-[-0.02em] leading-[1.05] truncate">
                Industry News
              </h3>
              <p className="text-[10px] sm:text-xs md:text-sm lg:text-base text-slate-600 dark:text-slate-400 font-light tracking-tight truncate">
                Market Intelligence Updates
              </p>
            </div>
          </div>
          {/* Source Selector Button - Mobile First */}
          <button
            onClick={() => setShowSourceSelector(true)}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 md:px-4 py-1.5 sm:py-2 md:py-2.5 rounded-lg sm:rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 active:scale-95 border border-slate-200 dark:border-slate-700 touch-manipulation"
            aria-label="Select news sources"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 text-slate-700 dark:text-slate-300" strokeWidth={1.5} />
            <span className="text-[10px] sm:text-xs md:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight whitespace-nowrap">
              Sources ({selectedSources.length}/{availableSources.length})
            </span>
          </button>
        </div>

        {/* Enhanced Multi-column Layout - Display All Sources - Mobile First with Perfect Alignment */}
        <div
          className={`${
            selectedSources.length >= 4
              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          } gap-2.5 sm:gap-3 md:gap-4 lg:gap-6 xl:gap-8 items-start`}
        >
          {filteredNewsFeed.map((source: any, sourceIdx: number) => {
            const SourceIcon = source.icon;
            return (
              <div key={source.source} className="min-w-0 w-full flex flex-col h-full">
                {/* Header - Fixed height for alignment */}
                <div className="flex items-center gap-2 sm:gap-2.5 md:gap-3 mb-3 sm:mb-4 md:mb-5 h-8 sm:h-9 md:h-10">
                  <div
                    className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 lg:w-9 lg:h-9 rounded-lg sm:rounded-xl ${source.bg} flex items-center justify-center flex-shrink-0 shadow-sm border border-slate-200/40 dark:border-slate-700/40`}
                  >
                    <SourceIcon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-4.5 md:h-4.5 lg:w-5 lg:h-5 ${source.color}`} strokeWidth={1.5} />
                  </div>
                  <h4 className="text-xs sm:text-sm md:text-base lg:text-lg font-light text-slate-800 dark:text-slate-200 tracking-tight truncate flex-1 min-w-0 leading-tight">
                    {source.source}
                  </h4>
                </div>
                {/* News Items - Consistent spacing */}
                <div className="space-y-2.5 sm:space-y-3 md:space-y-3.5 lg:space-y-4 xl:space-y-5 flex-1">
                  {source.items?.slice(0, 2).map((item: any, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedNewsItem({ item, source });
                      }}
                      className="group cursor-pointer p-2.5 sm:p-3 md:p-4 lg:p-5 xl:p-6 rounded-md sm:rounded-lg md:rounded-xl lg:rounded-2xl bg-slate-50/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800/50 transition-all duration-300 active:scale-[0.98] border border-slate-200/60 dark:border-slate-700/40 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md dark:hover:shadow-lg touch-manipulation w-full flex flex-col"
                    >
                      <p className="text-[11px] sm:text-xs md:text-sm lg:text-base xl:text-lg text-slate-900 dark:text-slate-100 leading-[1.4] sm:leading-[1.5] mb-1.5 sm:mb-2 md:mb-2.5 lg:mb-3 group-hover:text-slate-950 dark:group-hover:text-white transition-colors font-light tracking-tight line-clamp-2 break-words min-h-[2.8em] sm:min-h-[3em] md:min-h-[3.2em]">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 text-[9px] sm:text-[10px] md:text-xs lg:text-sm text-slate-500 dark:text-slate-400 font-light flex-wrap mt-auto">
                        <span className="truncate">{item.date}</span>
                        <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">•</span>
                        <span className="whitespace-nowrap">{item.time}</span>
                      </div>
                    </div>
                  )) || <p className="text-[9px] sm:text-[10px] md:text-xs lg:text-sm text-slate-500 dark:text-slate-400 font-light">Loading news...</p>}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Source Selector Dialog */}
      <Dialog open={showSourceSelector} onOpenChange={setShowSourceSelector}>
        <DialogContent className="max-w-2xl w-full sm:w-[90vw] md:w-[95vw] max-h-[90vh] sm:max-h-[85vh] p-0 gap-0 overflow-hidden bg-white dark:bg-slate-900 rounded-none sm:rounded-xl md:rounded-2xl border-0 sm:border border-slate-200/60 dark:border-slate-700/50 shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)] [&>button]:hidden">
          <div className="flex flex-col h-full">
            {/* Header - Mobile First */}
            <div className="flex items-center justify-between px-3 sm:px-4 md:px-5 lg:px-6 py-3 sm:py-4 md:py-5 border-b border-slate-200/60 dark:border-slate-700/50 bg-slate-50/30 dark:bg-slate-800/30 sticky top-0 z-10">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm flex-shrink-0">
                  <Newspaper className="w-4 h-4 sm:w-5 sm:h-5 text-white" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base sm:text-lg md:text-xl font-extralight text-slate-900 dark:text-white tracking-tight truncate">
                    Select News Sources
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light mt-0.5">
                    Select sources to display in your Industry News feed
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Source List - Mobile First */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-4 md:px-5 lg:px-6 py-3 sm:py-4 md:py-5 lg:py-6">
              <div className="space-y-2 sm:space-y-3">
                {availableSources.map(source => {
                  const SourceIcon = source.icon;
                  const isSelected = selectedSources.includes(source.source);
                  const isDisabled = !isSelected && selectedSources.length >= 5;
                  return (
                    <button
                      key={source.source}
                      onClick={() => handleSourceToggle(source.source)}
                      disabled={isDisabled}
                      className={`w-full flex items-start gap-2.5 sm:gap-3 md:gap-4 p-3 sm:p-4 rounded-lg sm:rounded-xl border transition-all duration-200 text-left touch-manipulation ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40 shadow-sm'
                          : isDisabled
                          ? 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed'
                          : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className={`w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-lg ${source.bg} flex items-center justify-center flex-shrink-0 border border-slate-200/40 dark:border-slate-700/40`}>
                        <SourceIcon className={`w-4 h-4 sm:w-4.5 sm:h-4.5 md:w-5 md:h-5 ${source.color}`} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1">
                          <h4 className="text-xs sm:text-sm md:text-base font-light text-slate-900 dark:text-slate-200 tracking-tight truncate">
                            {source.source}
                          </h4>
                          {isSelected && <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" strokeWidth={2} />}
                        </div>
                        <p className="text-[10px] sm:text-xs md:text-sm text-slate-600 dark:text-slate-400 font-light leading-relaxed line-clamp-2 sm:line-clamp-3">
                          {source.summary}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50 bg-slate-50/30 dark:bg-slate-800/30">
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                  {selectedSources.length} of 5 sources selected
                </p>
                <button
                  onClick={() => setShowSourceSelector(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-light text-sm tracking-tight hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedNewsItem} onOpenChange={open => !open && setSelectedNewsItem(null)}>
        <DialogContent
          className="
            /* Mobile: true fullscreen, perfectly aligned */
            inset-0 top-0 bottom-0 left-0 right-0
            translate-x-0 translate-y-0
            w-screen max-w-none
            h-[100dvh] max-h-none
            rounded-none

            /* Desktop/tablet: centered modal */
            sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto
            sm:w-[min(95vw,42rem)] sm:max-w-2xl
            sm:h-auto sm:max-h-[90vh]
            sm:translate-x-[-50%] sm:translate-y-[-50%]
            sm:rounded-2xl

            p-0 gap-0
            overflow-hidden
            bg-white dark:bg-slate-900
            border-0 sm:border border-slate-200/60 dark:border-slate-700/50
            shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:sm:shadow-[0_20px_60px_rgba(0,0,0,0.5)]
            [&>button]:hidden
            safe-area-inset
          "
        >
          {selectedNewsItem && (
            <div className="flex flex-col h-full sm:max-h-[90vh] md:max-h-[85vh]">
              {/* Enhanced Header - Sticky with safe area */}
              <div
                className="
                  sticky top-0 z-10 
                  flex items-center justify-between 
                  px-4 sm:px-5 md:px-6 
                  py-4 sm:py-4 md:py-5 
                  pt-safe
                  border-b border-slate-200/60 dark:border-slate-700/50 
                  bg-white/95 dark:bg-slate-900/95 
                  backdrop-blur-md 
                  flex-shrink-0 
                  shadow-sm sm:shadow-none
                "
              >
                <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
                  <div
                    className={`
                      w-10 h-10 sm:w-11 sm:h-11 
                      rounded-xl 
                      ${selectedNewsItem.source.bg} 
                      flex items-center justify-center 
                      flex-shrink-0 
                      shadow-sm 
                      border border-slate-200/40 dark:border-slate-700/40
                    `}
                  >
                    {(() => {
                      const Icon = selectedNewsItem.source.icon;
                      return <Icon className={`w-5 h-5 sm:w-5.5 sm:h-5.5 ${selectedNewsItem.source.color}`} strokeWidth={1.5} />;
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm sm:text-sm font-normal text-slate-700 dark:text-slate-300 truncate tracking-tight">
                      {selectedNewsItem.source.source}
                    </p>
                    <p className="text-xs sm:text-xs text-slate-500 dark:text-slate-400 truncate font-light mt-0.5">
                      {selectedNewsItem.item.date} • {selectedNewsItem.item.time}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNewsItem(null)}
                  className="
                    min-w-[44px] min-h-[44px] w-11 h-11 sm:w-9 sm:h-9
                    rounded-full 
                    bg-white/90 dark:bg-slate-800/90 
                    border border-slate-200 dark:border-slate-700 
                    shadow-sm 
                    hover:bg-slate-50 dark:hover:bg-slate-700 
                    active:bg-slate-100 dark:active:bg-slate-600
                    backdrop-blur-sm 
                    flex items-center justify-center 
                    transition-all duration-200 
                    flex-shrink-0 
                    ml-3 
                    focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1
                    touch-manipulation
                  "
                  aria-label="Close"
                >
                  <X className="w-5 h-5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
                </button>
              </div>

              {/* Enhanced Content - Scrollable with safe area */}
              <div
                className="
                  flex-1 
                  overflow-y-auto 
                  px-4 sm:px-5 md:px-6 
                  py-5 sm:py-5 md:py-6 
                  pb-safe
                  overscroll-contain
                  -webkit-overflow-scrolling-touch
                "
              >
                {/* Title */}
                <h1
                  className="
                    text-[1.375rem] leading-[1.25] sm:text-2xl sm:leading-[1.2] md:text-3xl md:leading-[1.15] 
                    font-extralight 
                    text-slate-900 dark:text-white 
                    tracking-[-0.02em] 
                    mb-4 sm:mb-4 md:mb-5 
                    pr-2
                    break-words
                  "
                >
                  {selectedNewsItem.item.title}
                </h1>

                {/* Brief Summary */}
                <p
                  className="
                    text-[0.9375rem] leading-[1.6] sm:text-base sm:leading-[1.6] md:text-base md:leading-[1.6] 
                    text-slate-700 dark:text-slate-300 
                    mb-5 sm:mb-5 md:mb-6 
                    font-light 
                    tracking-tight
                    break-words
                  "
                >
                  {selectedNewsItem.source.summary}
                </p>

                {/* Enhanced Ailethia Executive Insights */}
                <div
                  className="
                    rounded-xl sm:rounded-2xl 
                    bg-gradient-to-br from-slate-50 to-slate-100/60 
                    dark:from-slate-800/50 dark:to-slate-800/40 
                    p-4 sm:p-4 md:p-5 
                    mb-5 sm:mb-5 md:mb-6 
                    border border-slate-200/50 dark:border-slate-700/40 
                    shadow-sm
                  "
                >
                  <div className="flex items-center gap-2.5 sm:gap-2.5 mb-4 sm:mb-3.5 md:mb-4">
                    <div
                      className="
                        w-7 h-7 sm:w-7 sm:h-7 
                        rounded-lg 
                        bg-gradient-to-br from-blue-500 to-indigo-600 
                        flex items-center justify-center 
                        flex-shrink-0 
                        shadow-sm
                      "
                    >
                      <Zap className="w-4 h-4 sm:w-4 sm:h-4 text-white" strokeWidth={1.5} />
                    </div>
                    <span
                      className="
                        text-[0.9375rem] sm:text-sm md:text-base 
                        font-medium 
                        text-slate-700 dark:text-slate-300 
                        tracking-tight
                      "
                    >
                      Ailethia Insights
                    </span>
                  </div>

                  <div className="space-y-3 sm:space-y-3 md:space-y-3.5">
                    {/* Dynamic insights based on article type */}
                    {selectedNewsItem.item.title.toLowerCase().includes('rate') ||
                    selectedNewsItem.item.title.toLowerCase().includes('mortgage') ? (
                      <>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Pipeline Impact:</span> Rising application volume signals increased demand—ensure capacity to handle 15-20% uptick.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Competitive Edge:</span> Early movers capturing refi volume. Consider targeted outreach to existing borrowers.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Margin Watch:</span> Rate volatility may compress margins. Lock discipline critical this week.
                          </p>
                        </div>
                      </>
                    ) : selectedNewsItem.item.title.toLowerCase().includes('compliance') ||
                      selectedNewsItem.item.title.toLowerCase().includes('regulation') ||
                      selectedNewsItem.item.title.toLowerCase().includes('guideline') ? (
                      <>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Compliance Alert:</span> New guidelines require immediate ops review. Estimated 30-day implementation window.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Risk Mitigation:</span> Schedule compliance team briefing—non-conforming loans face rejection risk.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Opportunity:</span> Early adopters gain competitive advantage. Position as compliance leader.
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Market Signal:</span> Industry trend aligns with your Q1 growth targets. Leverage momentum.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Strategic Fit:</span> Consider board-level discussion on market positioning strategy.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">Action Item:</span> Brief ops team on implications. Response window: 48 hours.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Enhanced Read Full Article CTA */}
                <a
                  href={selectedNewsItem.item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    sessionStorage.setItem('returnToAdmin', 'true');
                    sessionStorage.setItem('dashboardUrl', window.location.href);
                  }}
                  className="
                    flex items-center justify-center gap-2.5 
                    w-full 
                    min-h-[52px] sm:min-h-[48px]
                    py-4 sm:py-4 md:py-4 
                    rounded-xl sm:rounded-2xl 
                    bg-gradient-to-r from-slate-900 to-slate-800 
                    dark:from-white dark:to-slate-50 
                    hover:from-slate-800 hover:to-slate-700 
                    dark:hover:from-slate-50 dark:hover:to-slate-100 
                    active:from-slate-700 active:to-slate-600
                    dark:active:from-slate-100 dark:active:to-slate-200
                    text-white dark:text-slate-900 
                    font-medium 
                    text-base sm:text-base md:text-lg 
                    tracking-tight 
                    transition-all 
                    active:scale-[0.98] 
                    shadow-lg hover:shadow-xl 
                    border border-slate-700 dark:border-slate-200
                    touch-manipulation
                    no-underline
                  "
                >
                  <ExternalLink className="w-5 h-5 sm:w-5 sm:h-5" strokeWidth={2} />
                  <span>Read Full Article</span>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

