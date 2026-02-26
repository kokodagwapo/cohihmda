import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Radio, Loader2, Layers, List } from "lucide-react";
import { api } from "@/lib/api";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChannelData {
  channel: string;
  channelGroup: string;
  loanCount: number;
}

interface ChannelGroupData {
  group: string;
  loanCount: number;
}

interface ChannelSelectorProps {
  selectedChannel: string | null;
  onChannelChange: (channel: string | null) => void;
  selectedTenantId?: string | null;
  compact?: boolean;
  // If true, use consolidated channel groups (Retail, TPO, etc.) instead of individual channels
  // Can be overridden by user toggle
  useChannelGroups?: boolean;
  // If true, show toggle to switch between grouped and individual views
  allowViewToggle?: boolean;
}

export const ChannelSelector = ({
  selectedChannel,
  onChannelChange,
  selectedTenantId,
  compact = true,
  useChannelGroups: initialUseChannelGroups = true,
  allowViewToggle = true,
}: ChannelSelectorProps) => {
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local state for grouped vs individual view toggle
  const [useGroupedView, setUseGroupedView] = useState(initialUseChannelGroups);

  // Fetch channels when component mounts or tenant changes
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        setLoading(true);
        setError(null);

        // Build URL with tenant_id if provided
        let url = "/api/loans/channels";
        if (selectedTenantId) {
          url += `?tenant_id=${selectedTenantId}`;
        }

        const data = await api.request<{
          channels: ChannelData[];
          channelGroups: ChannelGroupData[];
        }>(url);

        // Filter out any channels/groups with empty string values (breaks Radix Select)
        const validChannels = (data.channels || []).filter(
          (c) => c.channel && c.channel.trim() !== ""
        );
        const validChannelGroups = (data.channelGroups || []).filter(
          (g) => g.group && g.group.trim() !== ""
        );

        setChannels(validChannels);
        setChannelGroups(validChannelGroups);

        // Default to "All Channels" on first visit (when selectedChannel is null)
        if (selectedChannel === null) {
          onChannelChange("All");
        }
      } catch (err: any) {
        console.error("[ChannelSelector] Error fetching channels:", err);
        setError(err.message || "Failed to load channels");
        setChannels([]);
        setChannelGroups([]);
      } finally {
        setLoading(false);
      }
    };

    fetchChannels();
  }, [selectedTenantId]);

  // Format channel name for display (handle 99-Missing)
  const formatChannelName = (name: string) => {
    if (name === "99-Missing") return "99-Missing (No Channel)";
    return name;
  };

  // Get the display label for the selected channel
  const getSelectedLabel = () => {
    if (!selectedChannel || selectedChannel === "All") return "All Channels";

    if (useGroupedView) {
      const group = channelGroups.find((g) => g.group === selectedChannel);
      if (group) {
        return `${formatChannelName(
          group.group
        )} (${group.loanCount.toLocaleString()})`;
      }
    } else {
      const channel = channels.find((c) => c.channel === selectedChannel);
      if (channel) {
        return `${formatChannelName(
          channel.channel
        )} (${channel.loanCount.toLocaleString()})`;
      }
    }

    return formatChannelName(selectedChannel);
  };

  // Handle view mode toggle
  const handleViewToggle = () => {
    setUseGroupedView(!useGroupedView);
    // Reset selection to "All" when switching views to avoid mismatched values
    onChannelChange("All");
  };

  // Total loan count across all channels
  const totalLoans = channelGroups.reduce((sum, g) => sum + g.loanCount, 0);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <Select
          value={selectedChannel || "All"}
          onValueChange={(value) => {
            // Keep "All" as the actual value (don't convert to null)
            // This allows us to distinguish "user selected All" from "never selected"
            onChannelChange(value);
          }}
          disabled={loading}
        >
          <SelectTrigger data-track="filter_channel" className="w-[160px] h-8 rounded-lg border-slate-200/80 dark:border-slate-600/80 bg-white/80 dark:bg-slate-800/80 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors duration-200 focus:ring-2 focus:ring-slate-400/20">
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <SelectValue placeholder="Channel" />
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">
              All Channels{" "}
              {totalLoans > 0 && `(${totalLoans.toLocaleString()})`}
            </SelectItem>

            {useGroupedView
              ? // Show consolidated channel groups
                channelGroups.map((group) => (
                  <SelectItem key={group.group} value={group.group}>
                    {formatChannelName(group.group)} (
                    {group.loanCount.toLocaleString()})
                  </SelectItem>
                ))
              : // Show individual channels
                channels.map((channel) => (
                  <SelectItem key={channel.channel} value={channel.channel}>
                    {formatChannelName(channel.channel)} (
                    {channel.loanCount.toLocaleString()})
                  </SelectItem>
                ))}

            {!loading &&
              channelGroups.length === 0 &&
              channels.length === 0 && (
                <SelectItem value="__no_channels__" disabled>
                  No channels found
                </SelectItem>
              )}
          </SelectContent>
        </Select>

        {/* View toggle button */}
        {allowViewToggle &&
          !loading &&
          (channels.length > 1 || channelGroups.length > 1) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-track="filter_channel_view_toggle"
                    variant="ghost"
                    size="sm"
                    onClick={handleViewToggle}
                    className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {useGroupedView ? (
                      <List className="h-4 w-4" />
                    ) : (
                      <Layers className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {useGroupedView
                      ? "Show individual channels"
                      : "Show grouped channels"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  // Full mode (not compact) - could be used in a card
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Filter by Channel
          </span>
        </div>

        {/* View toggle button */}
        {allowViewToggle &&
          !loading &&
          (channels.length > 1 || channelGroups.length > 1) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleViewToggle}
                    className="h-7 text-xs gap-1.5"
                  >
                    {useGroupedView ? (
                      <>
                        <List className="h-3.5 w-3.5" />
                        <span>Show Individual</span>
                      </>
                    ) : (
                      <>
                        <Layers className="h-3.5 w-3.5" />
                        <span>Show Grouped</span>
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {useGroupedView
                      ? "Switch to individual channel values from your data"
                      : "Switch to consolidated channel groups (Retail, TPO, etc.)"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
      </div>

      <Select
        value={selectedChannel || "All"}
        onValueChange={(value) => {
          // Keep "All" as the actual value (don't convert to null)
          onChannelChange(value);
        }}
        disabled={loading}
      >
        <SelectTrigger className="w-full font-light">
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading channels...</span>
            </div>
          ) : (
            <SelectValue placeholder="Select channel..." />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">
            All Channels{" "}
            {totalLoans > 0 && `(${totalLoans.toLocaleString()} loans)`}
          </SelectItem>

          {useGroupedView
            ? channelGroups.map((group) => (
                <SelectItem key={group.group} value={group.group}>
                  {formatChannelName(group.group)} (
                  {group.loanCount.toLocaleString()} loans)
                </SelectItem>
              ))
            : channels.map((channel) => (
                <SelectItem key={channel.channel} value={channel.channel}>
                  {formatChannelName(channel.channel)} (
                  {channel.loanCount.toLocaleString()} loans)
                </SelectItem>
              ))}
        </SelectContent>
      </Select>

      {selectedChannel && selectedChannel !== "All" && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-light">
            Showing data for: {getSelectedLabel()}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChannelChange("All")}
            className="h-7 text-xs"
          >
            Clear Filter
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
};
