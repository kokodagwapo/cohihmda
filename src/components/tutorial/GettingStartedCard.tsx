import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTutorial } from '@/contexts/TutorialContext';
import { useAuth } from '@/contexts/AuthContext';
import { missions } from '@/data/learningPaths';
import { getLearningPathForRole } from '@/data/learningPaths';
import {
  Rocket,
  Bookmark,
  LayoutPanelLeft,
  MessageSquare,
  FileDown,
  FlaskConical,
  Check,
  ChevronRight,
  X,
  BookOpen,
  GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const missionIcons: Record<string, React.ElementType> = {
  Bookmark,
  LayoutPanelLeft,
  MessageSquare,
  FileDown,
  FlaskConical,
};

export function GettingStartedCard() {
  const { prefs, isMissionCompleted, completeMission, dismissHelp } = useTutorial();
  const { user } = useAuth();
  const navigate = useNavigate();

  const completedCount = useMemo(
    () => missions.filter(m => isMissionCompleted(m.id)).length,
    [isMissionCompleted]
  );

  const progressPercent = Math.round((completedCount / missions.length) * 100);
  const learningPath = useMemo(
    () => getLearningPathForRole(user?.role || 'user'),
    [user?.role]
  );

  if (prefs.help_dismissed) return null;

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Rocket className="w-4 h-4 text-white" />
            </div>
            Getting Started with Cohi
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={dismissHelp}
            aria-label="Dismiss getting started"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {completedCount} of {missions.length} missions complete
            </span>
            <span className="text-sm text-muted-foreground">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        <div className="space-y-2">
          {missions.map((mission) => {
            const completed = isMissionCompleted(mission.id);
            const Icon = missionIcons[mission.icon] || Rocket;
            return (
              <button
                key={mission.id}
                onClick={() => {
                  if (!completed && mission.verifyRoute) {
                    navigate(mission.verifyRoute);
                  }
                }}
                disabled={completed}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
                  completed
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm cursor-pointer'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                  completed
                    ? 'bg-emerald-500/10 dark:bg-emerald-500/20'
                    : 'bg-blue-500/10 dark:bg-blue-500/20'
                )}>
                  {completed ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Icon className="w-4 h-4 text-blue-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm font-medium',
                    completed && 'line-through text-muted-foreground'
                  )}>
                    {mission.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{mission.description}</p>
                </div>
                {!completed && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2">
          {learningPath && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 flex-1"
              onClick={() => navigate('/help/getting-started/first-steps')}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              {learningPath.title}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 flex-1"
            onClick={() => navigate('/help')}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Help Center
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
