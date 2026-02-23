import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { learningPaths, getLearningPathForRole, type LearningPath } from '@/data/learningPaths';
import {
  GraduationCap,
  ChevronRight,
  Play,
  BookOpen,
  Zap,
  Check,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function PathCard({ path, isRecommended }: { path: LearningPath; isRecommended: boolean }) {
  const [expandedWeek, setExpandedWeek] = useState<number | null>(isRecommended ? 1 : null);
  const navigate = useNavigate();
  const { isTourCompleted, isMissionCompleted, startTour } = useTutorial();

  const totalSteps = path.weeks.reduce((sum, w) => sum + w.steps.length, 0);
  const completedSteps = path.weeks.reduce((sum, w) => {
    return sum + w.steps.filter(s => {
      if (s.type === 'tour' && s.resourceId) return isTourCompleted(s.resourceId);
      if (s.type === 'action' && s.resourceId) return isMissionCompleted(s.resourceId);
      return false;
    }).length;
  }, 0);
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <Card className={cn(
      'transition-shadow',
      isRecommended && 'border-blue-300 dark:border-blue-700 ring-1 ring-blue-200 dark:ring-blue-800'
    )}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">{path.title}</CardTitle>
              <CardDescription>{path.description}</CardDescription>
            </div>
          </div>
          {isRecommended && (
            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Recommended for you
            </Badge>
          )}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-muted-foreground">{completedSteps}/{totalSteps} steps</span>
            <span className="font-medium">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {path.weeks.map((week) => (
          <div key={week.week} className="border rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedWeek(expandedWeek === week.week ? null : week.week)}
              className="w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">Week {week.week}</Badge>
                <span className="text-sm font-medium">{week.title}</span>
              </div>
              <ChevronRight className={cn(
                'w-4 h-4 text-muted-foreground transition-transform',
                expandedWeek === week.week && 'rotate-90'
              )} />
            </button>
            {expandedWeek === week.week && (
              <div className="px-3 pb-3 space-y-2 border-t">
                <p className="text-xs text-muted-foreground py-2">{week.focus}</p>
                {week.steps.map((step) => {
                  const isComplete = (step.type === 'tour' && step.resourceId && isTourCompleted(step.resourceId)) ||
                    (step.type === 'action' && step.resourceId && isMissionCompleted(step.resourceId));
                  return (
                    <button
                      key={step.id}
                      onClick={() => {
                        if (step.type === 'tour' && step.resourceId) {
                          navigate('/insights');
                          setTimeout(() => startTour(step.resourceId as any), 500);
                        } else if (step.link) {
                          navigate(step.link);
                        }
                      }}
                      className="w-full flex items-center gap-2 p-2 rounded-md text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border',
                        isComplete
                          ? 'bg-emerald-500 border-emerald-500'
                          : 'border-slate-300 dark:border-slate-600'
                      )}>
                        {isComplete && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {step.type === 'tour' && <Play className="w-3 h-3 text-blue-500 flex-shrink-0" />}
                        {step.type === 'article' && <BookOpen className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                        {step.type === 'action' && <Zap className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                        <span className={cn(
                          'text-sm truncate',
                          isComplete && 'line-through text-muted-foreground'
                        )}>
                          {step.title}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function LearningPathView() {
  const { user } = useAuth();

  const recommendedPath = useMemo(
    () => getLearningPathForRole(user?.role || 'user'),
    [user?.role]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Learning Paths</h2>
        <p className="text-muted-foreground mt-1">
          Structured learning paths tailored to your role. Follow the weekly plan to master Cohi.
        </p>
      </div>

      {recommendedPath && (
        <PathCard path={recommendedPath} isRecommended />
      )}

      {learningPaths
        .filter(p => p.id !== recommendedPath?.id)
        .map(path => (
          <PathCard key={path.id} path={path} isRecommended={false} />
        ))
      }
    </div>
  );
}
