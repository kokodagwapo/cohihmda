import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Radio, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

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
  useChannelGroups?: boolean;
}

export const ChannelSelector = ({ 
  selectedChannel, 
  onChannelChange, 
  selectedTenantId,
  compact = true,
  useChannelGroups = true 
}: ChannelSelectorProps) => {
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch channels when component mounts or tenant changes
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Build URL with tenant_id if provided
        let url = '/api/loans/channels';
        if (selectedTenantId) {
          url += `?tenant_id=${selectedTenantId}`;
        }
        
        const data = await api.request<{ 
          channels: ChannelData[]; 
          channelGroups: ChannelGroupData[] 
        }>(url);
        
        // Filter out any channels/groups with empty string values (breaks Radix Select)
        const validChannels = (data.channels || []).filter(c => c.channel && c.channel.trim() !== '');
        const validChannelGroups = (data.channelGroups || []).filter(g => g.group && g.group.trim() !== '');
        
        setChannels(validChannels);
        setChannelGroups(validChannelGroups);
        
        // Auto-select the most populated channel group as default if no channel is selected
        if (!selectedChannel && useChannelGroups && data.channelGroups && data.channelGroups.length > 0) {
          // Find the channel group with the most loans
          const mostPopulated = data.channelGroups.reduce((max, group) => 
            group.loanCount > max.loanCount ? group : max
          , data.channelGroups[0]);
          
          if (mostPopulated && mostPopulated.loanCount > 0) {
            console.log('[ChannelSelector] Auto-selecting most populated channel:', mostPopulated.group, 'with', mostPopulated.loanCount, 'loans');
            onChannelChange(mostPopulated.group);
          }
        }
      } catch (err: any) {
        console.error('[ChannelSelector] Error fetching channels:', err);
        setError(err.message || 'Failed to load channels');
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
    if (name === '99-Missing') return '99-Missing (No Channel)';
    return name;
  };

  // Get the display label for the selected channel
  const getSelectedLabel = () => {
    if (!selectedChannel || selectedChannel === 'All') return 'All Channels';
    
    if (useChannelGroups) {
      const group = channelGroups.find(g => g.group === selectedChannel);
      if (group) {
        return `${formatChannelName(group.group)} (${group.loanCount.toLocaleString()})`;
      }
    } else {
      const channel = channels.find(c => c.channel === selectedChannel);
      if (channel) {
        return `${formatChannelName(channel.channel)} (${channel.loanCount.toLocaleString()})`;
      }
    }
    
    return formatChannelName(selectedChannel);
  };

  // Total loan count across all channels
  const totalLoans = channelGroups.reduce((sum, g) => sum + g.loanCount, 0);

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Channel:</span>
        </div>
        <Select
          value={selectedChannel || 'All'}
          onValueChange={(value) => {
            if (value === 'All') {
              onChannelChange(null);
            } else {
              onChannelChange(value);
            }
          }}
          disabled={loading}
        >
          <SelectTrigger className="w-44 h-8 text-sm font-light">
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <SelectValue placeholder="Select channel..." />
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">
              All Channels {totalLoans > 0 && `(${totalLoans.toLocaleString()})`}
            </SelectItem>
            
            {useChannelGroups ? (
              // Show consolidated channel groups
              channelGroups.map((group) => (
                <SelectItem key={group.group} value={group.group}>
                  {formatChannelName(group.group)} ({group.loanCount.toLocaleString()})
                </SelectItem>
              ))
            ) : (
              // Show individual channels
              channels.map((channel) => (
                <SelectItem key={channel.channel} value={channel.channel}>
                  {formatChannelName(channel.channel)} ({channel.loanCount.toLocaleString()})
                </SelectItem>
              ))
            )}
            
            {!loading && channelGroups.length === 0 && channels.length === 0 && (
              <SelectItem value="__no_channels__" disabled>
                No channels found
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        
        {selectedChannel && selectedChannel !== 'All' && (
          <>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
              Filtered: {formatChannelName(selectedChannel)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChannelChange(null)}
              className="h-7 px-2 text-xs font-light text-slate-500 hover:text-slate-700"
            >
              Clear
            </Button>
          </>
        )}
        
        {error && (
          <span className="text-xs text-red-500">{error}</span>
        )}
      </div>
    );
  }

  // Full mode (not compact) - could be used in a card
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-slate-600 dark:text-slate-400" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Filter by Channel
        </span>
      </div>
      
      <Select
        value={selectedChannel || 'All'}
        onValueChange={(value) => {
          if (value === 'All') {
            onChannelChange(null);
          } else {
            onChannelChange(value);
          }
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
            All Channels {totalLoans > 0 && `(${totalLoans.toLocaleString()} loans)`}
          </SelectItem>
          
          {useChannelGroups ? (
            channelGroups.map((group) => (
              <SelectItem key={group.group} value={group.group}>
                {formatChannelName(group.group)} ({group.loanCount.toLocaleString()} loans)
              </SelectItem>
            ))
          ) : (
            channels.map((channel) => (
              <SelectItem key={channel.channel} value={channel.channel}>
                {formatChannelName(channel.channel)} ({channel.loanCount.toLocaleString()} loans)
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      
      {selectedChannel && selectedChannel !== 'All' && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-light">
            Showing data for: {getSelectedLabel()}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChannelChange(null)}
            className="h-7 text-xs"
          >
            Clear Filter
          </Button>
        </div>
      )}
      
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  );
};
