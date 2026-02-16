import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Loader2,
  Search,
  Database,
  Play,
  Calendar as CalendarIcon,
  X,
  Sparkles,
  MessageSquare,
  Lightbulb,
  Send,
  Bot,
  User,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { useMetrics, MetricResult } from "@/hooks/useMetrics";
import { PeriodValue, getPeriodRange } from "@/utils/closingFalloutFilters";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category:
    | "status"
    | "turn_time"
    | "revenue"
    | "pull_through"
    | "volume"
    | "count";
  sqlQuery?: string;
  defaultDateField?: string;
}

interface MetricExplanation {
  summary: string;
  howItWorks: string;
  timeframeLogic: string;
  interpretation: string;
  relatedMetrics: string[];
}

interface MetricResultExplanation {
  valueInterpretation: string;
  businessContext: string;
  recommendations: string[];
  benchmarkComparison?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface StaticDescription {
  fieldsUsed: string;
  timeframeInfo: string;
}

export const MetricsCatalogSection = () => {
  const [metrics, setMetrics] = useState<MetricDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodValue>("ytd");
  const [customDateRange, setCustomDateRange] = useState<{
    start: Date | null;
    end: Date | null;
  }>({ start: null, end: null });
  const [testingMetrics, setTestingMetrics] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, MetricResult>>(
    {}
  );
  const { toast } = useToast();

  // Use admin tenant context for tenant selection
  const { selectedTenantId, currentTenantName, isTenantAdmin } =
    useAdminTenant();
  const { queryMetric, loading: metricsLoading } = useMetrics(selectedTenantId);

  // AI Features State
  const [staticDescriptions, setStaticDescriptions] = useState<
    Record<string, StaticDescription>
  >({});
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [metricExplanations, setMetricExplanations] = useState<
    Record<string, MetricExplanation>
  >({});
  const [resultExplanations, setResultExplanations] = useState<
    Record<string, MetricResultExplanation>
  >({});
  const [loadingExplanation, setLoadingExplanation] = useState<string | null>(
    null
  );
  const [loadingResultExplanation, setLoadingResultExplanation] = useState<
    string | null
  >(null);

  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCatalog();
    loadStaticDescriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const result = await api.request<{ metrics: MetricDefinition[] }>(
        "/api/metrics/catalog"
      );
      setMetrics(result.metrics || []);
    } catch (error: unknown) {
      console.error("Error loading metrics catalog:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to load metrics catalog",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStaticDescriptions = async () => {
    try {
      const result = await api.request<{
        descriptions: Record<string, StaticDescription>;
      }>("/api/metrics/ai/descriptions");
      setStaticDescriptions(result.descriptions || {});
    } catch (error: unknown) {
      console.error("Error loading static descriptions:", error);
    }
  };

  const handleTestMetric = async (metric: MetricDefinition) => {
    if (!selectedTenantId) {
      toast({
        title: "Error",
        description: "Please select a tenant first",
        variant: "destructive",
      });
      return;
    }

    setTestingMetrics((prev) => new Set(prev).add(metric.id));
    try {
      let dateRange: { start: Date | null; end: Date | null };
      if (selectedPeriod === "custom") {
        dateRange = customDateRange;
      } else {
        dateRange = getPeriodRange(selectedPeriod);
      }

      let result: MetricResult;
      if (selectedPeriod === "custom") {
        if (!customDateRange.start || !customDateRange.end) {
          toast({
            title: "Error",
            description:
              "Please select both start and end dates for custom range",
            variant: "destructive",
          });
          return;
        }
        const params = new URLSearchParams();
        params.append(
          "startDate",
          customDateRange.start.toISOString().split("T")[0]
        );
        params.append(
          "endDate",
          customDateRange.end.toISOString().split("T")[0]
        );
        if (metric.defaultDateField)
          params.append("dateField", metric.defaultDateField);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);

        result = await api.request<MetricResult>(
          `/api/metrics/${metric.id}?${params.toString()}`
        );
      } else {
        result = await queryMetric(
          metric.id,
          selectedPeriod,
          metric.defaultDateField
        );
      }

      setTestResults((prev) => ({
        ...prev,
        [metric.id]: result,
      }));
    } catch (error: unknown) {
      console.error(`Error testing metric ${metric.id}:`, error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : `Failed to test metric: ${metric.name}`,
        variant: "destructive",
      });
    } finally {
      setTestingMetrics((prev) => {
        const next = new Set(prev);
        next.delete(metric.id);
        return next;
      });
    }
  };

  const handleExplainMetric = async (metricId: string) => {
    if (metricExplanations[metricId]) {
      setExpandedMetric(expandedMetric === metricId ? null : metricId);
      return;
    }

    // Require tenant selection for AI features (needed for API key retrieval)
    if (!selectedTenantId) {
      toast({
        title: "Select a Tenant",
        description:
          "Please select a tenant first. The OpenAI API key is retrieved from tenant RAG settings.",
        variant: "destructive",
      });
      return;
    }

    setLoadingExplanation(metricId);
    try {
      const params = new URLSearchParams();
      params.append("tenant_id", selectedTenantId);

      const result = await api.request<{ explanation: MetricExplanation }>(
        `/api/metrics/ai/explain?${params.toString()}`,
        {
          method: "POST",
          body: JSON.stringify({ metricId }),
        }
      );
      setMetricExplanations((prev) => ({
        ...prev,
        [metricId]: result.explanation,
      }));
      setExpandedMetric(metricId);
    } catch (error: unknown) {
      console.error("Error explaining metric:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to get AI explanation. Make sure OpenAI API key is configured in RAG settings for this tenant.",
        variant: "destructive",
      });
    } finally {
      setLoadingExplanation(null);
    }
  };

  const handleExplainResult = async (metricId: string) => {
    const result = testResults[metricId];
    if (!result) return;

    if (!selectedTenantId) {
      toast({
        title: "Select a Tenant",
        description: "Please select a tenant first.",
        variant: "destructive",
      });
      return;
    }

    setLoadingResultExplanation(metricId);
    try {
      const params = new URLSearchParams();
      params.append("tenant_id", selectedTenantId);

      const response = await api.request<{
        explanation: MetricResultExplanation;
      }>(`/api/metrics/ai/explain-result?${params.toString()}`, {
        method: "POST",
        body: JSON.stringify({
          metricId,
          value: result.value,
          metadata: result.metadata,
        }),
      });
      setResultExplanations((prev) => ({
        ...prev,
        [metricId]: response.explanation,
      }));
    } catch (error: unknown) {
      console.error("Error explaining result:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to get AI explanation",
        variant: "destructive",
      });
    } finally {
      setLoadingResultExplanation(null);
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    if (!selectedTenantId) {
      toast({
        title: "Select a Tenant",
        description: "Please select a tenant first to use the AI chat feature.",
        variant: "destructive",
      });
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: chatInput.trim(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const params = new URLSearchParams();
      params.append("tenant_id", selectedTenantId);

      const result = await api.request<{ response: string }>(
        `/api/metrics/ai/chat?${params.toString()}`,
        {
          method: "POST",
          body: JSON.stringify({
            messages: [...chatMessages, userMessage],
          }),
        }
      );

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.response },
      ]);
    } catch (error: unknown) {
      console.error("Error in chat:", error);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I encountered an error. Please make sure your OpenAI API key is configured in RAG settings.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Filter metrics based on search and category
  const filteredMetrics = metrics.filter((metric) => {
    const matchesSearch =
      metric.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      metric.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      metric.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (metric.sqlQuery &&
        metric.sqlQuery.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === "all" || metric.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(metrics.map((m) => m.category))).sort();

  const groupedMetrics = filteredMetrics.reduce((acc, metric) => {
    if (!acc[metric.category]) {
      acc[metric.category] = [];
    }
    acc[metric.category].push(metric);
    return acc;
  }, {} as Record<string, MetricDefinition[]>);

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      status:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      turn_time:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      revenue:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
      pull_through:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      volume:
        "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
      count: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    };
    return (
      colors[category] ||
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
    );
  };

  const formatCategory = (category: string) => {
    return category
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const periodOptions: Array<{ value: PeriodValue; label: string }> = [
    { value: "all", label: "All Time" },
    { value: "ytd", label: "Year to Date" },
    { value: "mtd", label: "Month to Date" },
    { value: "last_month", label: "Last Month" },
    { value: "last_year", label: "Last Year" },
    { value: "custom", label: "Custom Range" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {/* Header with AI Chat Button */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-light text-slate-900 dark:text-white mb-2">
            Metrics Catalog
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Browse all available metrics and their calculation logic. Click any
            metric to get an AI-powered explanation.
          </p>
        </div>
        <Button
          onClick={() => setChatOpen(!chatOpen)}
          variant={chatOpen ? "default" : "outline"}
          className="flex items-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Ask AI about Metrics
        </Button>
      </div>

      {/* AI Chat Panel */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/30 dark:to-slate-800/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <CardTitle className="text-lg font-light text-slate-900 dark:text-white">
                    Metrics AI Assistant
                  </CardTitle>
                </div>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                  Ask questions about any metric - what it measures, how to
                  interpret values, or which metrics to use for your analysis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Chat Messages */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 h-64 overflow-y-auto mb-3 p-3 space-y-3">
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 py-8">
                      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Ask me anything about metrics!</p>
                      <p className="text-xs mt-1 opacity-70">
                        Example: "What's the difference between pull-through and
                        conversion rate?"
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex gap-2 items-start",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        {msg.role === "assistant" && (
                          <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center flex-shrink-0">
                            <Bot className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                            msg.role === "user"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          )}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                        {msg.role === "user" && (
                          <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0">
                            <User className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex gap-2 items-start">
                      <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                        <Loader2 className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 animate-spin" />
                      </div>
                      <div className="bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                        <span className="text-sm text-slate-500">
                          Thinking...
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input */}
                <div className="flex gap-2">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about metrics..."
                    className="font-light"
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      handleSendChatMessage()
                    }
                    disabled={chatLoading}
                  />
                  <Button
                    onClick={handleSendChatMessage}
                    disabled={!chatInput.trim() || chatLoading}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Test Configuration */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-light text-slate-900 dark:text-white">
            Test Configuration
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            {selectedTenantId
              ? `Testing metrics for ${currentTenantName || "selected tenant"}`
              : "Select a tenant from the header to test metrics"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* No tenant selected warning */}
          {!selectedTenantId && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                {isTenantAdmin
                  ? "Your tenant data will be used for testing metrics."
                  : "Please select a tenant from the selector above to test metrics."}
              </span>
            </div>
          )}

          {/* Date Range Selector */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 min-w-[120px]">
              <CalendarIcon className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Period:
              </span>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <Select
                value={selectedPeriod.toString()}
                onValueChange={(value) =>
                  setSelectedPeriod(value as PeriodValue)
                }
              >
                <SelectTrigger className="w-full max-w-[200px] font-light">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((option) => (
                    <SelectItem
                      key={option.value.toString()}
                      value={option.value.toString()}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Custom Date Range Picker */}
              {selectedPeriod === "custom" && (
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[240px] justify-start text-left font-light",
                          !customDateRange.start && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customDateRange.start ? (
                          customDateRange.end ? (
                            <>
                              {format(customDateRange.start, "LLL dd, y")} -{" "}
                              {format(customDateRange.end, "LLL dd, y")}
                            </>
                          ) : (
                            format(customDateRange.start, "LLL dd, y")
                          )
                        ) : (
                          <span>Pick a date range</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={customDateRange.start || new Date()}
                        selected={{
                          from: customDateRange.start || undefined,
                          to: customDateRange.end || undefined,
                        }}
                        onSelect={(range) => {
                          setCustomDateRange({
                            start: range?.from || null,
                            end: range?.to || null,
                          });
                        }}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                  {(customDateRange.start || customDateRange.end) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setCustomDateRange({ start: null, end: null })
                      }
                      className="h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search metrics by name, ID, description, or SQL query..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 font-light"
              />
            </div>
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
            >
              <SelectTrigger className="w-full sm:w-[200px] font-light">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {formatCategory(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Showing {filteredMetrics.length} of {metrics.length} metrics
          </div>
        </CardContent>
      </Card>

      {/* Metrics List */}
      {filteredMetrics.length === 0 ? (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">
              No metrics found matching your search.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedMetrics).map(([category, categoryMetrics]) => (
            <Card
              key={category}
              className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-light text-slate-900 dark:text-white">
                    {formatCategory(category)}
                  </CardTitle>
                  <Badge className={getCategoryColor(category)}>
                    {categoryMetrics.length} metric
                    {categoryMetrics.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {categoryMetrics.map((metric) => {
                    const isTesting = testingMetrics.has(metric.id);
                    const result = testResults[metric.id];
                    const explanation = metricExplanations[metric.id];
                    const resultExplanation = resultExplanations[metric.id];
                    const staticDesc = staticDescriptions[metric.id];
                    const isExpanded = expandedMetric === metric.id;

                    return (
                      <div
                        key={metric.id}
                        className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium text-slate-900 dark:text-white">
                                {metric.name}
                              </h3>
                              <Badge
                                variant="outline"
                                className="text-xs font-mono"
                              >
                                {metric.id}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 font-light">
                              {metric.description}
                            </p>

                            {/* Static Field & Timeframe Info */}
                            {staticDesc && (
                              <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                                <div className="flex items-start gap-2">
                                  <Database className="h-4 w-4 text-blue-500 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                  <div className="space-y-1">
                                    <p className="text-xs text-blue-700 dark:text-blue-300">
                                      <span className="font-medium">
                                        Fields:
                                      </span>{" "}
                                      {staticDesc.fieldsUsed}
                                    </p>
                                    <p className="text-xs text-blue-600 dark:text-blue-400">
                                      <span className="font-medium">
                                        Timeframe:
                                      </span>{" "}
                                      {staticDesc.timeframeInfo}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleExplainMetric(metric.id)}
                              disabled={loadingExplanation === metric.id}
                              className="flex-shrink-0"
                            >
                              {loadingExplanation === metric.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Sparkles className="h-4 w-4 mr-1.5 text-purple-500" />
                                  {explanation
                                    ? isExpanded
                                      ? "Hide"
                                      : "Show"
                                    : "Explain"}
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleTestMetric(metric)}
                              disabled={
                                !selectedTenantId || isTesting || metricsLoading
                              }
                              className="flex-shrink-0"
                            >
                              {isTesting ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Testing...
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-2" />
                                  Test
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* AI Explanation Panel */}
                        <AnimatePresence>
                          {isExpanded && explanation && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                  <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                                    AI Explanation
                                  </span>
                                </div>
                                <div className="space-y-3 text-sm">
                                  <div>
                                    <div className="font-medium text-purple-800 dark:text-purple-200">
                                      Summary
                                    </div>
                                    <p className="text-purple-700 dark:text-purple-300">
                                      {explanation.summary}
                                    </p>
                                  </div>
                                  <div>
                                    <div className="font-medium text-purple-800 dark:text-purple-200">
                                      Fields & Calculation
                                    </div>
                                    <p className="text-purple-700 dark:text-purple-300">
                                      {explanation.howItWorks}
                                    </p>
                                  </div>
                                  <div>
                                    <div className="font-medium text-purple-800 dark:text-purple-200">
                                      Timeframe Filtering
                                    </div>
                                    <p className="text-purple-700 dark:text-purple-300">
                                      {explanation.timeframeLogic}
                                    </p>
                                  </div>
                                  <div>
                                    <div className="font-medium text-purple-800 dark:text-purple-200">
                                      Interpretation
                                    </div>
                                    <p className="text-purple-700 dark:text-purple-300">
                                      {explanation.interpretation}
                                    </p>
                                  </div>
                                  {explanation.relatedMetrics.length > 0 && (
                                    <div>
                                      <div className="font-medium text-purple-800 dark:text-purple-200">
                                        Related Metrics
                                      </div>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {explanation.relatedMetrics.map(
                                          (m, i) => (
                                            <Badge
                                              key={i}
                                              variant="secondary"
                                              className="text-xs"
                                            >
                                              {m}
                                            </Badge>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Test Result */}
                        {result && (
                          <div className="mt-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                                  Result:
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleExplainResult(metric.id)}
                                disabled={
                                  loadingResultExplanation === metric.id
                                }
                                className="text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                              >
                                {loadingResultExplanation === metric.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    Explain this value
                                  </>
                                )}
                              </Button>
                            </div>
                            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                              {typeof result.value === "number"
                                ? result.value.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })
                                : result.value}
                              {result.unit && (
                                <span className="text-sm font-normal text-emerald-600 dark:text-emerald-400 ml-2">
                                  {result.unit}
                                </span>
                              )}
                            </div>

                            {/* Result Explanation */}
                            {resultExplanation && (
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-700 space-y-2"
                              >
                                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                                  <Sparkles className="h-3.5 w-3.5" /> AI
                                  Insights
                                </div>
                                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                  {resultExplanation.valueInterpretation}
                                </p>
                                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                                  {resultExplanation.businessContext}
                                </p>
                                {resultExplanation.recommendations.length >
                                  0 && (
                                  <div>
                                    <div className="text-xs font-medium text-emerald-800 dark:text-emerald-200 mb-1">
                                      Recommendations:
                                    </div>
                                    <ul className="list-disc list-inside text-xs text-emerald-600 dark:text-emerald-400 space-y-0.5">
                                      {resultExplanation.recommendations.map(
                                        (rec, i) => (
                                          <li key={i}>{rec}</li>
                                        )
                                      )}
                                    </ul>
                                  </div>
                                )}
                              </motion.div>
                            )}

                            {result.metadata &&
                              Object.keys(result.metadata).length > 0 && (
                                <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                                  <pre className="whitespace-pre-wrap">
                                    {JSON.stringify(result.metadata, null, 2)}
                                  </pre>
                                </div>
                              )}
                          </div>
                        )}

                        <div className="mt-3 space-y-2">
                          {metric.sqlQuery && (
                            <div className="flex items-start gap-2">
                              <Database className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                  SQL Query:
                                </div>
                                <code className="text-xs font-mono bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 break-all whitespace-pre-wrap">
                                  {metric.sqlQuery}
                                </code>
                              </div>
                            </div>
                          )}

                          {metric.defaultDateField && (
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4 text-slate-400 flex-shrink-0" />
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-semibold">
                                  Default Date Field:
                                </span>{" "}
                                <code className="font-mono bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                  {metric.defaultDateField}
                                </code>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
