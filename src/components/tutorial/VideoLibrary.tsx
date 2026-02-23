import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { videoScripts, microVideoIdeas, type VideoScript } from '@/data/videoScripts';
import {
  Search,
  Play,
  Clock,
  ArrowLeft,
  Film,
  Monitor,
  Users,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const seriesOrder = [
  'Getting Started',
  'Insights & Analytics',
  'Workbench',
  'Research Lab',
  'Data Management',
  'Admin',
  'Masterclass',
];

const typeConfig = {
  short: { label: 'Tutorial', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  long: { label: 'Masterclass', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  micro: { label: 'Quick Tip', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

function VideoCard({ video }: { video: VideoScript }) {
  const [expanded, setExpanded] = useState(false);
  const config = typeConfig[video.type];

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
              <Play className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-tight">{video.title}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', config.color)}>
                  {config.label}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {video.duration}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {video.targetAudience.map((a) => (
            <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-muted-foreground">
              {a}
            </span>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide outline' : 'View outline'}
          <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-90')} />
        </Button>

        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Outline</h4>
              <ol className="space-y-1.5">
                {video.outline.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-2">
                    <span className="font-medium text-foreground min-w-[16px]">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Key Takeaways</h4>
              <ul className="space-y-1">
                {video.keyTakeaways.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-emerald-500 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VideoLibrary() {
  const [search, setSearch] = useState('');
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const navigate = useNavigate();

  const filteredVideos = useMemo(() => {
    let vids = videoScripts;
    if (selectedSeries) vids = vids.filter(v => v.series === selectedSeries);
    if (search.trim()) {
      const q = search.toLowerCase();
      vids = vids.filter(v =>
        v.title.toLowerCase().includes(q) ||
        v.outline.some(o => o.toLowerCase().includes(q)) ||
        v.targetAudience.some(a => a.toLowerCase().includes(q))
      );
    }
    return vids;
  }, [search, selectedSeries]);

  const groupedVideos = useMemo(() => {
    const groups: Record<string, VideoScript[]> = {};
    filteredVideos.forEach(v => {
      if (!groups[v.series]) groups[v.series] = [];
      groups[v.series].push(v);
    });
    return groups;
  }, [filteredVideos]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/help')} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>

      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Film className="w-6 h-6" />
          Video Tutorial Library
        </h2>
        <p className="text-muted-foreground mt-1">
          {videoScripts.length} tutorials covering every feature of Cohi. Each includes a detailed outline and key takeaways.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search videos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={selectedSeries === null ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setSelectedSeries(null)}
          >
            All
          </Button>
          {seriesOrder.map(s => (
            <Button
              key={s}
              variant={selectedSeries === s ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setSelectedSeries(selectedSeries === s ? null : s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          {seriesOrder.filter(s => groupedVideos[s]).map(series => (
            <div key={series}>
              <h3 className="text-lg font-semibold mb-3">{series}</h3>
              <div className="space-y-3">
                {groupedVideos[series].map(v => (
                  <VideoCard key={v.id} video={v} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Monitor className="w-4 h-4 text-emerald-500" />
                Micro-Videos & GIFs
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Quick 10-30 second clips embedded in help articles and tooltips.
              </p>
              <div className="space-y-2">
                {microVideoIdeas.map(mv => (
                  <div key={mv.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Play className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{mv.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{mv.description}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{mv.duration}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-blue-500" />
                Videos by Audience
              </h3>
              <div className="space-y-2">
                {['All Users', 'Executives', 'Branch Managers', 'Admins'].map(audience => {
                  const count = videoScripts.filter(v =>
                    v.targetAudience.includes(audience) || v.targetAudience.includes('All Users')
                  ).length;
                  return (
                    <button
                      key={audience}
                      onClick={() => {
                        setSearch(audience === 'All Users' ? '' : audience);
                        setSelectedSeries(null);
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <span className="text-sm font-medium">{audience}</span>
                      <Badge variant="secondary" className="text-xs">{count} videos</Badge>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
