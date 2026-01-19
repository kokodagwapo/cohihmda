'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Calendar,
  GripVertical,
  MessageCircle,
  Paperclip,
  Plus,
  X,
  Share2,
  Download,
  FileText,
  Image as ImageIcon,
  Mail,
  Link as LinkIcon,
  Edit,
  Trash2,
  MoreVertical,
  Lock,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatInTimezone, parseDateInTimezone } from '@/utils/timezone';
import { toast } from '@/hooks/use-toast';

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'document';
  url: string;
  size?: number;
}

export interface Comment {
  id: string;
  text: string;
  author: string;
  authorAvatar?: string;
  createdAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  assignee?: {
    name: string;
    avatar: string;
  };
  tags?: string[];
  dueDate?: string;
  attachments?: Attachment[];
  comments?: Comment[];
  week?: string;
  dateRange?: string;
}

export interface Column {
  id: string;
  title: string;
  tasks: Task[];
  color?: string;
}

interface KanbanBoardProps {
  columns: Column[];
  onColumnsChange: (columns: Column[]) => void;
  onTaskUpdate?: (task: Task) => void;
  onActivityLog?: (activity: {
    type: string;
    description: string;
    taskTitle?: string;
    fromColumn?: string;
    toColumn?: string;
    user: string;
    timestamp: Date;
  }) => void;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
}

export default function KanbanBoard({ columns, onColumnsChange, onTaskUpdate, onActivityLog, isAuthenticated = false, onAuthRequired }: KanbanBoardProps) {
  const [draggedTask, setDraggedTask] = useState<{ task: Task; sourceColumnId: string } | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState('');
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  // Helper to check authentication before allowing actions
  // Note: Currently allowing all actions without auth for development ease
  const requireAuth = (): boolean => {
    // Allow all actions without authentication for now
    // To re-enable auth requirement, uncomment the block below:
    /*
    if (!isAuthenticated) {
      onAuthRequired?.();
      toast({
        title: "Authentication Required",
        description: "Please sign in with PIN to perform this action.",
        variant: "destructive",
      });
      return false;
    }
    */
    return true;
  };

  const handleDragStart = (e: React.DragEvent, task: Task, columnId: string) => {
    // Allow drag without auth for development ease
    setDraggedTask({ task, sourceColumnId: columnId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverWithFeedback = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    if (!draggedTask) return;

    const { task, sourceColumnId } = draggedTask;

    if (sourceColumnId === targetColumnId) {
      setDraggedTask(null);
      setDraggedOverColumn(null);
      return;
    }

    const sourceColumn = columns.find((col) => col.id === sourceColumnId);
    const targetColumn = columns.find((col) => col.id === targetColumnId);

    const updatedColumns = columns.map((col) => {
      if (col.id === sourceColumnId) {
        return { ...col, tasks: col.tasks.filter((t) => t.id !== task.id) };
      }
      if (col.id === targetColumnId) {
        return { ...col, tasks: [...col.tasks, task] };
      }
      return col;
    });

    onColumnsChange(updatedColumns);
    
    // Log activity
    if (onActivityLog) {
      onActivityLog({
        type: 'task_moved',
        description: `Task moved from ${sourceColumn?.title || 'Unknown'} to ${targetColumn?.title || 'Unknown'}`,
        taskTitle: task.title,
        fromColumn: sourceColumn?.title,
        toColumn: targetColumn?.title,
        user: 'User',
        timestamp: new Date(),
      });
    }
    
    setDraggedTask(null);
    setDraggedOverColumn(null);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsTaskDialogOpen(true);
  };

  const handleAddComment = () => {
    if (!requireAuth()) return;
    if (!selectedTask || !newComment.trim()) return;

    const comment: Comment = {
      id: `comment-${Date.now()}`,
      text: newComment,
      author: 'Current User',
      createdAt: new Date(),
    };

    const updatedTask = {
      ...selectedTask,
      comments: [...(selectedTask.comments || []), comment],
    };

    updateTaskInColumns(updatedTask);
    setNewComment('');

    // Log activity for comment
    if (onActivityLog) {
      onActivityLog({
        type: 'comment_added',
        description: `Comment added: "${newComment.substring(0, 50)}${newComment.length > 50 ? '...' : ''}"`,
        taskTitle: selectedTask.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleAddAttachment = () => {
    if (!requireAuth()) return;
    if (!selectedTask || !newAttachment) return;

    const attachment: Attachment = {
      id: `attachment-${Date.now()}`,
      name: newAttachment.name,
      type: newAttachment.type.startsWith('image/') ? 'image' : 'document',
      url: URL.createObjectURL(newAttachment),
      size: newAttachment.size,
    };

    const updatedTask = {
      ...selectedTask,
      attachments: [...(selectedTask.attachments || []), attachment],
    };

    updateTaskInColumns(updatedTask);
    setNewAttachment(null);

    // Log activity for attachment
    if (onActivityLog) {
      onActivityLog({
        type: 'attachment_added',
        description: `Attachment added: ${newAttachment.name}`,
        taskTitle: selectedTask.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const updateTaskInColumns = (updatedTask: Task) => {
    const updatedColumns = columns.map((col) => ({
      ...col,
      tasks: col.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    }));

    onColumnsChange(updatedColumns);
    setSelectedTask(updatedTask);
    if (onTaskUpdate) {
      onTaskUpdate(updatedTask);
    }
  };

  const handleShareLink = async (task: Task) => {
    const url = `${window.location.origin}/v2/agileplan?task=${task.id}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: "Link Copied",
      description: "Task link has been copied to clipboard.",
    });

    // Log activity for share
    if (onActivityLog) {
      onActivityLog({
        type: 'task_shared',
        description: `Task link copied to clipboard`,
        taskTitle: task.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleShareEmail = (task: Task) => {
    const subject = encodeURIComponent(`Task: ${task.title}`);
    const body = encodeURIComponent(
      `Task: ${task.title}\n\n${task.description || ''}\n\nView at: ${window.location.origin}/v2/agileplan?task=${task.id}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;

    // Log activity for email share
    if (onActivityLog) {
      onActivityLog({
        type: 'task_shared',
        description: `Task shared via email`,
        taskTitle: task.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleExportPDF = (task: Task) => {
    // This will be implemented with jspdf
    import('jspdf').then((jsPDF) => {
      const { jsPDF: PDF } = jsPDF;
      const doc = new PDF();
      doc.text(`Task: ${task.title}`, 10, 10);
      if (task.description) {
        doc.text(`Description: ${task.description}`, 10, 20);
      }
      if (task.dueDate) {
        doc.text(`Due Date: ${task.dueDate}`, 10, 30);
      }
      if (task.priority) {
        doc.text(`Priority: ${task.priority}`, 10, 40);
      }
      doc.save(`${task.title.replace(/\s+/g, '_')}.pdf`);

      // Log activity for PDF export
      if (onActivityLog) {
        onActivityLog({
          type: 'task_exported',
          description: `Task exported as PDF`,
          taskTitle: task.title,
          user: 'Current User',
          timestamp: new Date(),
        });
      }
    });
  };

  const handleExportWord = (task: Task) => {
    // Simple Word export using blob
    const content = `
Task: ${task.title}

${task.description || ''}

Priority: ${task.priority || 'Not set'}
Due Date: ${task.dueDate || 'Not set'}
Assignee: ${task.assignee?.name || 'Unassigned'}

Tags: ${task.tags?.join(', ') || 'None'}
    `.trim();

    const blob = new Blob([content], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${task.title.replace(/\s+/g, '_')}.doc`;
    a.click();
    URL.revokeObjectURL(url);

    // Log activity for Word export
    if (onActivityLog) {
      onActivityLog({
        type: 'task_exported',
        description: `Task exported as Word document`,
        taskTitle: task.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleDeleteComment = (commentId: string) => {
    if (!requireAuth()) return;
    if (!selectedTask) return;

    const deletedComment = selectedTask.comments?.find((c) => c.id === commentId);
    const updatedTask = {
      ...selectedTask,
      comments: selectedTask.comments?.filter((c) => c.id !== commentId) || [],
    };

    updateTaskInColumns(updatedTask);

    // Log activity for comment deletion
    if (onActivityLog && deletedComment) {
      onActivityLog({
        type: 'comment_deleted',
        description: `Comment deleted`,
        taskTitle: selectedTask.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (!requireAuth()) return;
    if (!selectedTask) return;

    const deletedAttachment = selectedTask.attachments?.find((a) => a.id === attachmentId);
    const updatedTask = {
      ...selectedTask,
      attachments: selectedTask.attachments?.filter((a) => a.id !== attachmentId) || [],
    };

    updateTaskInColumns(updatedTask);

    // Log activity for attachment deletion
    if (onActivityLog && deletedAttachment) {
      onActivityLog({
        type: 'attachment_deleted',
        description: `Attachment deleted: ${deletedAttachment.name}`,
        taskTitle: selectedTask.title,
        user: 'Current User',
        timestamp: new Date(),
      });
    }
  };

  const handleDeleteTask = (taskId: string, columnId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the task dialog
    if (!requireAuth()) return;
    
    const task = columns.find((col) => col.id === columnId)?.tasks.find((t) => t.id === taskId);
    const column = columns.find((col) => col.id === columnId);
    
    // Delete immediately without confirmation for easier workflow
    const updatedColumns = columns.map((col) => {
      if (col.id === columnId) {
        return { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) };
      }
      return col;
    });
    onColumnsChange(updatedColumns);
    
    // Show toast notification
    toast({
      title: "Task Deleted",
      description: task?.title ? `"${task.title}" has been removed.` : "Task removed.",
    });
    
    // Log activity
    if (onActivityLog && task) {
      onActivityLog({
        type: 'task_updated',
        description: `Task deleted: ${task.title}`,
        taskTitle: task.title,
        fromColumn: column?.title,
        user: 'User',
        timestamp: new Date(),
      });
    }
  };

  const handleAddColumn = () => {
    if (!requireAuth()) return;
    
    const columnColors = ['#8B7355', '#6B8E23', '#CD853F', '#556B2F', '#228B22', '#4169E1', '#FF6347', '#32CD32', '#FFD700', '#FF69B4'];
    const usedColors = columns.map((c) => c.color).filter(Boolean);
    const availableColor = columnColors.find((c) => !usedColors.includes(c)) || '#6B7280';
    
    const newColumn: Column = {
      id: `column-${Date.now()}`,
      title: 'New Column',
      tasks: [],
      color: availableColor,
    };
    
    onColumnsChange([...columns, newColumn]);
  };

  const handleDeleteColumn = (columnId: string) => {
    if (!requireAuth()) return;
    
    if (columns.length <= 1) {
      toast({
        title: "Cannot Delete",
        description: "You must have at least one column.",
        variant: "destructive",
      });
      return;
    }
    
    const column = columns.find((c) => c.id === columnId);
    if (column && column.tasks.length > 0) {
      if (!confirm(`This column has ${column.tasks.length} task(s). Are you sure you want to delete it? All tasks will be lost.`)) {
        return;
      }
    }
    
    const updatedColumns = columns.filter((col) => col.id !== columnId);
    onColumnsChange(updatedColumns);
  };

  const handleColumnTitleEdit = (columnId: string, newTitle: string) => {
    if (!requireAuth()) return;
    
    const updatedColumns = columns.map((col) =>
      col.id === columnId ? { ...col, title: newTitle } : col
    );
    onColumnsChange(updatedColumns);
  };

  return (
    <div className="w-full">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-light text-neutral-900 dark:text-neutral-100 mb-2">Coheus by Teraverde</h1>
        <p className="text-neutral-700 dark:text-neutral-300">Drag and drop task management</p>
      </div>

      <div className="flex gap-4 sm:gap-6 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-neutral-300 dark:scrollbar-thumb-neutral-700 scrollbar-track-transparent">
        {columns.map((column) => (
          <div
            key={column.id}
            className={`bg-white/20 dark:bg-neutral-900/20 backdrop-blur-xl rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-border dark:border-neutral-700/50 min-h-[500px] sm:min-h-[600px] min-w-[260px] sm:min-w-[280px] transition-all duration-200 flex-shrink-0 ${
              draggedOverColumn === column.id ? 'ring-2 ring-blue-500 ring-opacity-50 bg-blue-50/30 dark:bg-blue-900/20' : ''
            }`}
            onDragOver={(e) => handleDragOverWithFeedback(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full flex-shrink-0" style={{ backgroundColor: column.color }} />
                {editingColumnId === column.id ? (
                  <Input
                    value={editingColumnTitle}
                    onChange={(e) => setEditingColumnTitle(e.target.value)}
                    onBlur={() => {
                      if (editingColumnTitle.trim()) {
                        handleColumnTitleEdit(column.id, editingColumnTitle.trim());
                      }
                      setEditingColumnId(null);
                      setEditingColumnTitle('');
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        if (editingColumnTitle.trim()) {
                          handleColumnTitleEdit(column.id, editingColumnTitle.trim());
                        }
                        setEditingColumnId(null);
                        setEditingColumnTitle('');
                      } else if (e.key === 'Escape') {
                        setEditingColumnId(null);
                        setEditingColumnTitle('');
                      }
                    }}
                    className="h-7 text-sm font-semibold"
                    autoFocus
                  />
                ) : (
                  <h3
                    className="font-semibold text-neutral-900 dark:text-neutral-100 truncate cursor-pointer hover:opacity-80"
                    onDoubleClick={() => {
                      setEditingColumnId(column.id);
                      setEditingColumnTitle(column.title);
                    }}
                    title="Double-click to edit"
                  >
                    {column.title}
                  </h3>
                )}
                <Badge className="bg-neutral-100/80 dark:bg-neutral-800/80 text-neutral-800 dark:text-neutral-200 border-neutral-200/50 dark:border-neutral-600/50 flex-shrink-0">
                  {column.tasks.length}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 rounded-full bg-white/30 dark:bg-neutral-800/30 hover:bg-white/50 dark:hover:bg-neutral-700/50 transition-colors"
                  onClick={() => {
                    if (!requireAuth()) return;
                    const newTask: Task = {
                      id: `task-${Date.now()}`,
                      title: 'New Task',
                      description: '',
                      priority: 'medium',
                    };
                    const updatedColumns = columns.map((col) =>
                      col.id === column.id ? { ...col, tasks: [...col.tasks, newTask] } : col
                    );
                    onColumnsChange(updatedColumns);
                  }}
                >
                  <Plus className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1 rounded-full bg-white/30 dark:bg-neutral-800/30 hover:bg-white/50 dark:hover:bg-neutral-700/50 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingColumnId(column.id);
                        setEditingColumnTitle(column.title);
                      }}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Title
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleDeleteColumn(column.id)}
                      className="text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Column
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="space-y-4">
              {column.tasks.map((task) => (
                <Card
                  key={task.id}
                  className="cursor-move transition-all duration-300 border bg-white/60 dark:bg-neutral-800/60 backdrop-blur-sm hover:bg-white/70 dark:hover:bg-neutral-700/70 hover:shadow-lg active:opacity-50"
                  draggable
                  onDragStart={(e) => handleDragStart(e, task, column.id)}
                  onClick={() => handleTaskClick(task)}
                >
                  <CardContent className="p-3 sm:p-5">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold text-neutral-900 dark:text-neutral-100 leading-tight flex-1">
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-1">
                          <GripVertical className="w-5 h-5 text-neutral-500 dark:text-neutral-400 cursor-move" />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                            onClick={(e) => handleDeleteTask(task.id, column.id, e)}
                            title="Delete task"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {task.description && (
                        <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
                          {task.description}
                        </p>
                      )}

                      {task.dueDate && (
                        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/50 backdrop-blur-sm">
                          <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                            {formatInTimezone(parseDateInTimezone(task.dueDate), 'MMMM d, yyyy')}
                          </span>
                        </div>
                      )}

                      {task.tags && task.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {task.tags
                            .filter((tag) => {
                              // Filter out date-related tags (like "December 2025", "Week 1", etc.)
                              const datePatterns = [
                                /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i,
                                /^Week\s+\d+/i,
                                /^Today$/i,
                                /^Month$/i,
                              ];
                              return !datePatterns.some((pattern) => pattern.test(tag));
                            })
                            .map((tag) => (
                              <Badge
                                key={tag}
                                className="text-xs bg-neutral-100/60 dark:bg-neutral-700/60 text-neutral-800 dark:text-neutral-200 border-neutral-200/50 dark:border-neutral-600/50 backdrop-blur-sm"
                              >
                                {tag}
                              </Badge>
                            ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-neutral-200/30 dark:border-neutral-700/30">
                        <div className="flex items-center gap-4 text-neutral-600 dark:text-neutral-400">
                          {task.comments && task.comments.length > 0 && (
                            <div className="flex items-center gap-1">
                              <MessageCircle className="w-4 h-4" />
                              <span className="text-xs font-medium">{task.comments.length}</span>
                            </div>
                          )}
                          {task.attachments && task.attachments.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Paperclip className="w-4 h-4" />
                              <span className="text-xs font-medium">{task.attachments.length}</span>
                            </div>
                          )}
                        </div>

                        {task.assignee && (
                          <Avatar className="w-8 h-8 ring-2 ring-white/50 dark:ring-neutral-700/50">
                            <AvatarImage src={task.assignee.avatar} />
                            <AvatarFallback className="bg-neutral-200 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 font-medium">
                              {task.assignee.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
        
        {/* Add Column Button */}
        <div className="min-w-[260px] sm:min-w-[280px] flex items-center justify-center flex-shrink-0">
          <Button
            variant="outline"
            onClick={handleAddColumn}
            className="w-full h-32 border-2 border-dashed border-neutral-300 dark:border-neutral-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <div className="flex flex-col items-center gap-2">
              <Plus className="w-6 h-6" />
              <span className="text-sm font-medium">Add Column</span>
            </div>
          </Button>
        </div>
      </div>

      {/* Task Detail Dialog */}
      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] bg-white dark:bg-slate-900 border-0 shadow-2xl rounded-2xl p-0 flex flex-col">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-slate-900 dark:text-white pr-8">
                {selectedTask?.title}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 dark:text-slate-400 font-light">
                {selectedTask?.description}
              </DialogDescription>
            </DialogHeader>
            
            {/* Task Meta */}
            {selectedTask && (
              <div className="flex items-center gap-3 mt-4">
                {selectedTask.priority && (
                  <Badge
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-full",
                      selectedTask.priority === 'high'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : selectedTask.priority === 'medium'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    )}
                  >
                    {selectedTask.priority}
                  </Badge>
                )}
                {selectedTask.dueDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Calendar className="w-4 h-4" />
                    <span className="font-light">{formatInTimezone(parseDateInTimezone(selectedTask.dueDate), 'MMMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedTask && (
            <div className="overflow-y-auto max-h-[calc(85vh-200px)] px-6 py-5 space-y-6">
              {/* Comments Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-slate-400" />
                  Comments ({selectedTask.comments?.length || 0})
                </h3>
                {selectedTask.comments && selectedTask.comments.length > 0 && (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {selectedTask.comments.map((comment) => (
                      <div key={comment.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-xs text-slate-700 dark:text-slate-300">{comment.author}</span>
                              <span className="text-[10px] text-slate-400">
                                {formatInTimezone(comment.createdAt, 'MMM d, h:mm a')}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">{comment.text}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={() => handleDeleteComment(comment.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddComment()}
                    className="flex-1 h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <Button 
                    onClick={handleAddComment}
                    className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium"
                  >
                    Add
                  </Button>
                </div>
              </div>

              {/* Attachments Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-slate-400" />
                  Attachments ({selectedTask.attachments?.length || 0})
                </h3>
                {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                  <div className="space-y-2">
                    {selectedTask.attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50"
                      >
                        <div className="flex items-center gap-2">
                          {attachment.type === 'image' ? (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                          ) : (
                            <FileText className="w-4 h-4 text-slate-400" />
                          )}
                          <span className="text-sm text-slate-600 dark:text-slate-400">{attachment.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                          >
                            View
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={() => handleDeleteAttachment(attachment.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="file"
                    onChange={(e) => setNewAttachment(e.target.files?.[0] || null)}
                    className="flex-1 h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-xl text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-200 file:text-slate-700 dark:file:bg-slate-700 dark:file:text-slate-300 hover:file:bg-slate-300 dark:hover:file:bg-slate-600"
                  />
                  <Button 
                    onClick={handleAddAttachment}
                    className="h-10 px-5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium"
                  >
                    Attach
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          {selectedTask && (
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 rounded-b-2xl">
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleShareLink(selectedTask)}
                  className="h-9 px-4 rounded-lg border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <LinkIcon className="w-4 h-4 mr-2" />
                  Share Link
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleShareEmail(selectedTask)}
                  className="h-9 px-4 rounded-lg border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Email
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleExportPDF(selectedTask)}
                  className="h-9 px-4 rounded-lg border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export PDF
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleExportWord(selectedTask)}
                  className="h-9 px-4 rounded-lg border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Export Word
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
