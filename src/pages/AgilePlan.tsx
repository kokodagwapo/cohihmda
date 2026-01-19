import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import KanbanBoard, { Column, Task } from '@/components/ui/kanban-board';
import { AgilePlanNav, ActivityLog, SortOption } from '@/components/agileplan/AgilePlanNav';
import { HistoryPanel } from '@/components/agileplan/HistoryPanel';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { getNowInTimezone, isTodayInTimezone, parseDateInTimezone, startOfDayInTimezone, endOfDayInTimezone } from '@/utils/timezone';
import { exportTasksAsJSON, exportTasksAsCSV, downloadFile } from '@/utils/agileplanExport';
import { agileplanService, ChangeEvent } from '@/services/agileplanService';
import { ChevronRight, ChevronLeft, X, Kanban, Plug2, Shield, Network, Brain, Server, Cloud, UserCheck, Calendar } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
const AgilePlan = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>('month');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUserName, setAuthUserName] = useState('');

  const sidebarSections = [
    { id: 'agileplan', title: 'Epic Goals | Tasks', subtitle: 'Kanban board for project management', icon: Kanban, color: 'rgba(139, 115, 85, 0.1)', iconColor: '#8B7355', isRoute: true },
    { id: 'los-adapter', title: 'The LOS Adapter Pattern', subtitle: 'Supporting Encompass, Calyx, and beyond', icon: Plug2, color: 'rgba(139, 92, 246, 0.1)', iconColor: '#8b5cf6' },
    { id: 'security', title: 'Security: Beyond Checkboxes', subtitle: 'SOC 2 and HIPAA aren\'t afterthoughts', icon: Shield, color: 'rgba(236, 72, 153, 0.1)', iconColor: '#ec4899' },
    { id: 'vendor-connector', title: 'The Vendor Connector Layer', subtitle: 'Reaching every credit bureau, title company', icon: Network, color: 'rgba(59, 130, 246, 0.1)', iconColor: '#3b82f6' },
    { id: 'rag', title: 'RAG & Knowledge Base', subtitle: 'Teaching Ailethia about mortgage industry', icon: Brain, color: 'rgba(251, 146, 60, 0.1)', iconColor: '#fb923c' },
    { id: 'compute', title: 'Compute Architecture', subtitle: 'Why persistent connections require dedicated compute', icon: Server, color: 'rgba(34, 197, 94, 0.1)', iconColor: '#22c55e' },
    { id: 'deployment', title: 'Deployment Models', subtitle: 'SaaS, self-hosted, and per-vendor AWS accounts', icon: Cloud, color: 'rgba(168, 85, 247, 0.1)', iconColor: '#a855f7' },
    { id: 'onboarding', title: 'Onboarding: 30 Minutes', subtitle: 'From signup to productive', icon: UserCheck, color: 'rgba(14, 165, 233, 0.1)', iconColor: '#0ea5e9' },
    { id: 'build-timeline', title: 'The Build Timeline', subtitle: '6 weeks, 180 hours, one team', icon: Calendar, color: 'rgba(245, 158, 11, 0.1)', iconColor: '#f59e0b' },
  ];

  const handleSidebarClick = (section: typeof sidebarSections[0]) => {
    // Check if this is a route navigation
    if (section.isRoute) {
      // Already on agileplan, just close sidebar
      setSidebarOpen(false);
      return;
    }

    // Navigate to V2 page and scroll to section
    navigate('/v2');
    setSidebarOpen(false);
    
    // Wait for navigation, then scroll to section
    setTimeout(() => {
      const element = document.getElementById(section.id);
      if (element) {
        // Close all accordions first
        document.querySelectorAll('.v2-page-container .accordion-item.active').forEach((item) => {
          item.classList.remove('active');
        });
        
        // Open the target accordion
        element.classList.add('active');
        
        // Scroll to the section
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }, 100);
  };

  // Initialize tasks with real development work from last 10 days
  const initializeTasks = (): Column[] => {
    // Helper to create task
    const createTask = (
      id: string,
      title: string,
      description: string,
      week: string,
      dateRange: string,
      priority: 'low' | 'medium' | 'high' = 'medium',
      dueDate?: string,
      customTags?: string[]
    ): Task => ({
      id,
      title,
      description,
      week,
      dateRange,
      priority,
      dueDate,
      tags: customTags || [week],
      comments: [],
      attachments: [],
    });

    // ============================================
    // COMPLETED TASKS (Work done Dec 13-23, 2025)
    // ============================================
    const completedTasks: Task[] = [
      createTask('done-1', 'Light Theme Implementation', 'Force light theme on landing page and /insights route using ThemeProvider', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-14', ['UI/UX', 'Completed']),
      createTask('done-2', 'Business Overview Redesign', '6-card layout with modal drilldowns, synced with funnel data, count-up animations', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-15', ['Dashboard', 'Completed']),
      createTask('done-3', 'Leaderboard Styling', 'Modern minimalist style with translucent white cards, shadows, removed avatars', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-16', ['UI/UX', 'Completed']),
      createTask('done-4', 'Funnel Visualization Update', 'Light theme, minimalist style, swapped default/modal views, Summary button', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-17', ['Dashboard', 'Completed']),
      createTask('done-5', 'Timezone Detection', 'Auto-detect user timezone with localStorage caching and time-based greetings', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-18', ['Feature', 'Completed']),
      createTask('done-6', 'Mobile Responsiveness', 'Full mobile support for all dashboard sections, modals, navigation, and sidebar', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-19', ['Mobile', 'Completed']),
      createTask('done-7', 'Industry News Section', 'All 5 sources available, 3-column grid layout, card alignment fixes', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-19', ['Dashboard', 'Completed']),
      createTask('done-8', 'Sales/Ops Page Styling', 'Light theme and minimalist typography applied to SalesView and OpsView', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-20', ['UI/UX', 'Completed']),
      createTask('done-9', 'Company Details Page', 'Layout changes, Projected Closings fullscreen, removed Turn Time Analysis', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-20', ['Dashboard', 'Completed']),
      createTask('done-10', 'Ailethia Briefing Controls', 'Simplified call/end button toggle, fixed WebSocket handling and cleanup', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-21', ['Voice AI', 'Completed']),
      createTask('done-11', 'Dark Theme Fixes', 'Consistent dark theme across all dashboard components and modals', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-21', ['UI/UX', 'Completed']),
      createTask('done-12', 'GitHub Pages Deployment', 'Fixed base path configuration, deployed multiple updates to production', 'Sprint 1', 'Dec 13-23', 'high', '2025-12-22', ['DevOps', 'Completed']),
      createTask('done-13', 'Close Button Visibility', 'Fixed modal close button on mobile by lowering modal below navigation', 'Sprint 1', 'Dec 13-23', 'medium', '2025-12-23', ['Mobile', 'Completed']),
      createTask('done-14', 'Data Table Scrolling', 'Horizontal scroll for Business Overview tables with dynamic min-width', 'Sprint 1', 'Dec 13-23', 'low', '2025-12-23', ['UI/UX', 'Completed']),
    ];

    // ============================================
    // FOR REVIEW TASKS (Pending review)
    // ============================================
    const reviewTasks: Task[] = [
      createTask('review-1', 'Turn Time by Stage UI', 'Modern minimalist redesign in OpsView with status badges and progress bars', 'Sprint 1', 'Dec 20-23', 'medium', '2025-12-22', ['UI/UX', 'Review']),
      createTask('review-2', 'Funnel Modal Scaling', 'Reduced modal size and content scaling for better UX on all devices', 'Sprint 1', 'Dec 20-23', 'low', '2025-12-23', ['UI/UX', 'Review']),
      createTask('review-3', 'News Headline Consistency', 'Fixed card height alignment in Industry News with min-height', 'Sprint 1', 'Dec 20-23', 'low', '2025-12-23', ['UI/UX', 'Review']),
    ];

    // ============================================
    // DOING NOW TASKS (Current work - moved from backlog)
    // ============================================
    const doingNowTasks: Task[] = [
      createTask('doing-1', 'Backend Development Plan', '7-day sprint planning for Dashboard Data API with CSV import', 'Sprint 2', 'Dec 23-30', 'high', '2025-12-23', ['Backend', 'In Progress']),
      createTask('doing-2', 'AgilePlan Population', 'Add real development tasks to Kanban board reflecting actual work', 'Sprint 2', 'Dec 23-30', 'medium', '2025-12-23', ['DevOps', 'In Progress']),
      // Moved from backlog to doing now
      createTask('backlog-1', 'Dashboard Data API', 'Replace hardcoded frontend data with real API endpoints', 'Sprint 2', 'Dec 24-30', 'high', '2025-12-24', ['Backend', 'In Progress']),
      createTask('backlog-2', 'CSV Import Service', 'Import loan and employee data from CSV files with validation', 'Sprint 2', 'Dec 24-30', 'high', '2025-12-25', ['Backend', 'In Progress']),
      createTask('backlog-3', 'Loan Database Schema', 'Create loans, employees, and funnel_snapshots tables in PostgreSQL', 'Sprint 2', 'Dec 24-30', 'high', '2025-12-26', ['Database', 'In Progress']),
      createTask('backlog-4', 'LOS Adapter Framework', 'Base class pattern for Encompass, Calyx, MeridianLink connectors', 'Sprint 3', 'Dec 29-Jan 2', 'high', '2025-12-29', ['Backend', 'In Progress']),
      createTask('backlog-5', 'SSO Authentication', 'Okta and Azure AD integration with SAML/OIDC support', 'Sprint 3', 'Dec 29-Jan 2', 'medium', '2025-12-30', ['Security', 'In Progress']),
      createTask('backlog-6', 'PII Sanitization', 'AWS Comprehend integration for LLM data protection', 'Sprint 3', 'Dec 29-Jan 2', 'medium', '2025-12-31', ['Security', 'In Progress']),
      createTask('backlog-7', 'RAG Pipeline', 'Document processing, embeddings, and Pinecone vector search', 'Sprint 4', 'Jan 5-9', 'medium', '2026-01-05', ['AI', 'In Progress']),
    ];

    // ============================================
    // BACKLOG TASKS (Empty - all moved to Doing Now)
    // ============================================
    const backlogTasks: Task[] = [];

    return [
      {
        id: 'backlogs',
        title: 'Backlogs',
        color: '#8B7355',
        tasks: backlogTasks,
      },
      {
        id: 'doing-now',
        title: 'Doing Now',
        color: '#6B8E23',
        tasks: doingNowTasks,
      },
      {
        id: 'for-review',
        title: 'For Review',
        color: '#CD853F',
        tasks: reviewTasks,
      },
      {
        id: 'completed',
        title: 'Completed',
        color: '#228B22',
        tasks: completedTasks,
      },
    ];
  };

  const [columns, setColumns] = useState<Column[]>([]);

  // Load boards on mount
  useEffect(() => {
    loadBoards();
  }, []);

  // Subscribe to real-time changes
  useEffect(() => {
    const unsubscribe = agileplanService.subscribeToChanges((event: ChangeEvent) => {
      handleRemoteChange(event);
    });
    return unsubscribe;
  }, []);

  const loadBoards = async () => {
    setIsLoading(true);
    setSyncStatus('syncing');
    
    try {
      const loadedColumns = await agileplanService.loadBoards();
      
      if (loadedColumns.length === 0) {
        // Initialize with default tasks if no data exists
        const initialized = initializeTasks();
        setColumns(initialized);
        // Save to backend if available
        try {
          await agileplanService.saveBoard(initialized);
        } catch (error) {
          console.warn('Failed to save initial board to backend:', error);
        }
      } else {
        setColumns(loadedColumns);
      }
      
      setSyncStatus('synced');
    } catch (error) {
      console.error('Failed to load boards:', error);
      // Fallback to localStorage
      const saved = localStorage.getItem('agileplan-columns');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const updated = parsed.map((col: Column) => ({
            ...col,
            tasks: col.tasks.map((task: Task) => ({
              ...task,
              tags: task.tags?.map((tag: string) => 
                tag === 'December 2024' ? 'December 2025' : 
                tag === 'January 2025' ? 'January 2026' : tag
              ),
            })),
          }));
          setColumns(updated);
        } catch (e) {
          console.error('Failed to parse saved columns', e);
          setColumns(initializeTasks());
        }
      } else {
        setColumns(initializeTasks());
      }
      setSyncStatus('offline');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoteChange = useCallback((event: ChangeEvent) => {
    // Reload boards when remote changes occur
    loadBoards();
  }, []);

  const handleColumnsChange = async (newColumns: Column[]) => {
    setColumns(newColumns);
    
    // Save to backend (with localStorage fallback)
    try {
      setSyncStatus('syncing');
      await agileplanService.saveBoard(newColumns);
      setSyncStatus('synced');
    } catch (error) {
      console.warn('Failed to save to backend, using localStorage:', error);
      // Fallback to localStorage
      localStorage.setItem('agileplan-columns', JSON.stringify(newColumns));
      setSyncStatus('offline');
    }
  };

  const handleTaskUpdate = async (task: Task) => {
    // Update task in columns
    const updatedColumns = columns.map((col) => ({
      ...col,
      tasks: col.tasks.map((t) => (t.id === task.id ? task : t)),
    }));
    setColumns(updatedColumns);
    
    // Save to backend
    try {
      await agileplanService.saveBoard(updatedColumns);
    } catch (error) {
      console.warn('Failed to update task in backend:', error);
      // Save to localStorage as fallback
      localStorage.setItem('agileplan-columns', JSON.stringify(updatedColumns));
    }
  };

  // Load activities on mount
  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      // Load from Supabase
      const loadedActivities = await agileplanService.loadActivities();
      if (loadedActivities.length > 0) {
        setActivities(loadedActivities);
        return;
      }
    } catch (error) {
      console.warn('Failed to load activities from backend:', error);
    }
    
    // Fallback to localStorage
    const saved = localStorage.getItem('agileplan-activities');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setActivities(parsed.map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) })));
      } catch (e) {
        console.error('Failed to parse saved activities', e);
      }
    }
  };

  const handleActivityLog = async (activity: ActivityLog) => {
    setActivities((prev) => {
      const updated = [activity, ...prev];
      // Save to localStorage as backup
      localStorage.setItem('agileplan-activities', JSON.stringify(updated));
      return updated;
    });
    
    // Log to backend
    try {
      await agileplanService.logActivity({
        type: activity.type,
        description: activity.description,
        taskTitle: activity.taskTitle,
        fromColumn: activity.fromColumn,
        toColumn: activity.toColumn,
        user: activity.user,
      });
    } catch (error) {
      console.warn('Failed to log activity to backend:', error);
    }
  };

  // Filter tasks based on sort option
  const getFilteredColumns = (): Column[] => {
    if (sortOption === 'today') {
      const today = getNowInTimezone();
      const todayStart = startOfDayInTimezone(today);
      const todayEnd = endOfDayInTimezone(today);
      return columns.map((col) => ({
        ...col,
        tasks: col.tasks.filter((task) => {
          if (!task.dueDate) return false;
          const taskDate = parseDateInTimezone(task.dueDate);
          return isWithinInterval(taskDate, { start: todayStart, end: todayEnd });
        }),
      }));
    } else if (sortOption === 'week') {
      const now = getNowInTimezone();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
      return columns.map((col) => ({
        ...col,
        tasks: col.tasks.filter((task) => {
          if (!task.dueDate) return false;
          const taskDate = parseDateInTimezone(task.dueDate);
          return isWithinInterval(taskDate, { start: weekStart, end: weekEnd });
        }),
      }));
    } else {
      // Month
      const now = getNowInTimezone();
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      return columns.map((col) => ({
        ...col,
        tasks: col.tasks.filter((task) => {
          if (!task.dueDate) return false;
          const taskDate = parseDateInTimezone(task.dueDate);
          return isWithinInterval(taskDate, { start: monthStart, end: monthEnd });
        }),
      }));
    }
  };

  const filteredColumns = sortOption !== 'month' ? getFilteredColumns() : columns;

  const handleExport = (format: 'jira-json' | 'trello-json' | 'detailed-json' | 'jira-csv' | 'trello-csv' | 'detailed-csv') => {
    const exportColumns = sortOption === 'month' ? columns : filteredColumns;
    
    let content: string;
    let filename: string;
    let mimeType: string;

    switch (format) {
      case 'jira-json':
        content = exportTasksAsJSON(exportColumns, 'jira');
        filename = 'coheus-tasks-jira.json';
        mimeType = 'application/json';
        break;
      case 'trello-json':
        content = exportTasksAsJSON(exportColumns, 'trello');
        filename = 'coheus-tasks-trello.json';
        mimeType = 'application/json';
        break;
      case 'detailed-json':
        content = exportTasksAsJSON(exportColumns, 'generic');
        filename = 'coheus-tasks-detailed.json';
        mimeType = 'application/json';
        break;
      case 'jira-csv':
        content = exportTasksAsCSV(exportColumns, 'jira');
        filename = 'coheus-tasks-jira.csv';
        mimeType = 'text/csv';
        break;
      case 'trello-csv':
        content = exportTasksAsCSV(exportColumns, 'trello');
        filename = 'coheus-tasks-trello.csv';
        mimeType = 'text/csv';
        break;
      case 'detailed-csv':
        content = exportTasksAsCSV(exportColumns, 'generic');
        filename = 'coheus-tasks-detailed.csv';
        mimeType = 'text/csv';
        break;
      default:
        return;
    }

    downloadFile(content, filename, mimeType);
    
    handleActivityLog({
      id: `activity-${Date.now()}`,
      type: 'task_exported',
      description: `Exported tasks as ${format}`,
      user: 'User',
      timestamp: new Date(),
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-neutral-900 dark:border-neutral-100 mx-auto mb-4"></div>
          <p className="text-neutral-600 dark:text-neutral-400">Loading boards...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sidebar */}
      <div 
        className={`agileplan-sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{
          position: 'fixed',
          right: sidebarOpen ? '0' : (isMobile ? '-100%' : '-320px'),
          top: isMobile ? '0' : '50%',
          transform: isMobile ? 'none' : 'translateY(-50%)',
          width: isMobile ? '100%' : '320px',
          height: isMobile ? '100vh' : 'auto',
          maxHeight: isMobile ? '100vh' : '80vh',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          borderLeft: '1px solid rgba(0, 0, 0, 0.08)',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.08)',
          zIndex: 1000,
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY: 'auto',
          padding: '24px 0',
        }}
      >
        <div style={{ padding: '0 20px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1d29', margin: 0 }}>Deep Dives</h3>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                color: '#64748b',
              }}
            >
              <X size={18} />
            </button>
          </div>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
            Explore architecture decisions and implementation details
          </p>
        </div>
        <div style={{ padding: '12px 0' }}>
          {sidebarSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => handleSidebarClick(section)}
                className={`deep-dive-item ${section.id === 'agileplan' ? 'active' : ''}`}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  transition: 'all 0.2s ease',
                  borderLeft: section.id === 'agileplan' ? `3px solid ${section.iconColor}` : '3px solid transparent',
                  backgroundColor: section.id === 'agileplan' ? section.color : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (section.id !== 'agileplan') {
                    e.currentTarget.style.backgroundColor = section.color;
                  }
                }}
                onMouseLeave={(e) => {
                  if (section.id !== 'agileplan') {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: section.color,
                    color: section.iconColor,
                  }}
                >
                  <Icon size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ 
                    fontSize: '14px', 
                    fontWeight: 600, 
                    color: '#1a1d29', 
                    margin: '0 0 4px 0',
                    lineHeight: '1.3',
                  }}>
                    {section.title}
                  </h4>
                  <p style={{ 
                    fontSize: '12px', 
                    color: '#64748b', 
                    margin: 0,
                    lineHeight: '1.4',
                  }}>
                    {section.subtitle}
                  </p>
                </div>
                <ChevronRight 
                  size={16} 
                  style={{ 
                    flexShrink: 0, 
                    color: '#94a3b8',
                    marginTop: '2px',
                  }} 
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Sidebar Toggle Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          position: 'fixed',
          right: sidebarOpen ? (isMobile ? '100%' : '320px') : '0',
          top: isMobile ? '1rem' : '50%',
          transform: isMobile ? 'none' : 'translateY(-50%)',
          width: isMobile ? '40px' : '48px',
          height: isMobile ? '40px' : '64px',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          borderRight: 'none',
          borderTopLeftRadius: '12px',
          borderBottomLeftRadius: '12px',
          boxShadow: '-2px 0 12px rgba(0, 0, 0, 0.08)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          color: '#64748b',
        }}
        onMouseEnter={(e) => {
          if (!isMobile) {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)';
            e.currentTarget.style.color = '#1a1d29';
          }
        }}
        onMouseLeave={(e) => {
          if (!isMobile) {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
            e.currentTarget.style.color = '#64748b';
          }
        }}
      >
        {sidebarOpen ? <ChevronRight size={isMobile ? 18 : 20} /> : <ChevronLeft size={isMobile ? 18 : 20} />}
      </button>

      <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-900 dark:to-neutral-800">
        <AgilePlanNav
          onHistoryClick={() => setIsHistoryOpen(true)}
          onActivityLog={handleActivityLog}
          sortOption={sortOption}
          onSortChange={setSortOption}
          onExportClick={handleExport}
          syncStatus={syncStatus}
          onAuthChange={(authenticated, userName) => {
            setIsAuthenticated(authenticated);
            setAuthUserName(userName);
          }}
        />
        <div className="p-2 sm:p-4 md:p-6">
          <div className="max-w-[1800px] mx-auto">
            <KanbanBoard
              columns={filteredColumns}
              onColumnsChange={handleColumnsChange}
              onTaskUpdate={handleTaskUpdate}
              isAuthenticated={isAuthenticated}
              onActivityLog={(activity) => {
                handleActivityLog({
                  id: `activity-${Date.now()}`,
                  type: activity.type as ActivityLog['type'],
                  description: activity.description,
                  taskTitle: activity.taskTitle,
                  fromColumn: activity.fromColumn,
                  toColumn: activity.toColumn,
                  user: authUserName || activity.user,
                  timestamp: activity.timestamp,
                });
              }}
            />
          </div>
        </div>
        <HistoryPanel
          activities={activities}
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
        />
      </div>
    </>
  );
};

export default AgilePlan;
