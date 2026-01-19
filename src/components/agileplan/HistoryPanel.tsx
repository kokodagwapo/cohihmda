import { X, ArrowRight, Plus, MessageSquare, Paperclip, Share2, Download, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatInTimezone } from '@/utils/timezone';
import { ActivityLog } from './AgilePlanNav';

interface HistoryPanelProps {
  activities: ActivityLog[];
  isOpen: boolean;
  onClose: () => void;
}

const getActivityIcon = (type: ActivityLog['type']) => {
  switch (type) {
    case 'task_moved':
      return <ArrowRight className="w-4 h-4" />;
    case 'task_created':
      return <Plus className="w-4 h-4" />;
    case 'task_updated':
      return <FileText className="w-4 h-4" />;
    case 'comment_added':
      return <MessageSquare className="w-4 h-4" />;
    case 'comment_deleted':
      return <Trash2 className="w-4 h-4" />;
    case 'attachment_added':
      return <Paperclip className="w-4 h-4" />;
    case 'attachment_deleted':
      return <Trash2 className="w-4 h-4" />;
    case 'task_shared':
      return <Share2 className="w-4 h-4" />;
    case 'task_exported':
      return <Download className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

const getActivityColor = (type: ActivityLog['type']) => {
  switch (type) {
    case 'task_moved':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    case 'task_created':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    case 'task_updated':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    case 'comment_added':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    case 'comment_deleted':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'attachment_added':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    case 'attachment_deleted':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    case 'task_shared':
      return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300';
    case 'task_exported':
      return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300';
    default:
      return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300';
  }
};

export function HistoryPanel({ activities, isOpen, onClose }: HistoryPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-neutral-900 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-200 dark:border-neutral-700">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
              Activity History
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Audit trail and monitoring
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Activities List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activities.length === 0 ? (
            <div className="text-center py-12 text-neutral-500 dark:text-neutral-400">
              <p>No activities yet</p>
              <p className="text-sm mt-2">Activities will appear here as you use the board</p>
            </div>
          ) : (
            activities
              .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
              .map((activity) => (
                <div
                  key={activity.id}
                  className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg ${getActivityColor(activity.type)} flex-shrink-0`}
                    >
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                          {activity.description}
                        </p>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                            {formatInTimezone(activity.timestamp, 'h:mm a')}
                          </span>
                      </div>
                      {activity.taskTitle && (
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                          Task: {activity.taskTitle}
                        </p>
                      )}
                      {activity.fromColumn && activity.toColumn && (
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                          {activity.fromColumn} → {activity.toColumn}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          {formatInTimezone(activity.timestamp, 'MMM d, yyyy')}
                        </span>
                        <span className="text-xs text-neutral-400 dark:text-neutral-500">•</span>
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          {activity.user}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
