import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { History, LogIn, X, Download, FileJson, FileSpreadsheet, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';

export type SortOption = 'today' | 'week' | 'month';

interface AgilePlanNavProps {
  onHistoryClick: () => void;
  onActivityLog: (activity: ActivityLog) => void;
  sortOption: SortOption;
  onSortChange: (option: SortOption) => void;
  onExportClick?: (format: 'jira-json' | 'trello-json' | 'detailed-json' | 'jira-csv' | 'trello-csv' | 'detailed-csv') => void;
  syncStatus?: 'synced' | 'syncing' | 'offline';
  onAuthChange?: (isAuthenticated: boolean, userName: string) => void;
}

export interface ActivityLog {
  id: string;
  type: 'task_moved' | 'task_created' | 'task_updated' | 'comment_added' | 'comment_deleted' | 'attachment_added' | 'attachment_deleted' | 'task_shared' | 'task_exported';
  description: string;
  taskTitle?: string;
  fromColumn?: string;
  toColumn?: string;
  user: string;
  timestamp: Date;
}

export function AgilePlanNav({ onHistoryClick, onActivityLog, sortOption, onSortChange, onExportClick, syncStatus = 'synced', onAuthChange }: AgilePlanNavProps) {
  const navigate = useNavigate();
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Check auth state on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user } = await api.getCurrentUser();
        const authenticated = !!user;
        setIsAuthenticated(authenticated);
        const name = user?.email?.split('@')[0] || 'User';
        setUserName(authenticated ? name : '');
        onAuthChange?.(authenticated, authenticated ? name : '');
      } catch (error) {
        setIsAuthenticated(false);
        setUserName('');
        onAuthChange?.(false, '');
      }
    };
    checkAuth();
  }, [onAuthChange]);

  const handleSignIn = async () => {
    setIsLoading(true);
    setAuthError('');
    
    try {
      const { user } = await api.signIn(email, password);
      
      // Detect and save user timezone on sign-in
      try {
        const { detectUserTimezone, setUserTimezone } = await import('@/utils/timezone');
        const timezone = detectUserTimezone();
        setUserTimezone(timezone);
      } catch (tzError) {
        console.warn('Failed to save timezone:', tzError);
      }
      
      setIsAuthenticated(true);
      setUserName(user?.email?.split('@')[0] || 'User');
      setIsSignInOpen(false);
      setEmail('');
      setPassword('');
      onActivityLog({
        id: `activity-${Date.now()}`,
        type: 'task_updated',
        description: 'User signed in',
        user: user?.email?.split('@')[0] || 'User',
        timestamp: new Date(),
      });
    } catch (error: any) {
      setAuthError(error.message || 'Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    const currentUserName = userName;
    await api.signOut();
    setIsAuthenticated(false);
    setUserName('');
    onActivityLog({
      id: `activity-${Date.now()}`,
      type: 'task_updated',
      description: 'User signed out',
      user: currentUserName,
      timestamp: new Date(),
    });
  };

  return (
    <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-700 shadow-sm">
      <div className="max-w-[1800px] mx-auto px-4 md:px-6 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Logo */}
          <div className="flex items-center">
            <button
              onClick={() => window.location.href = '/'}
              className="hover:opacity-80 transition-opacity cursor-pointer"
              aria-label="Go to home page"
            >
              <CoheusLogo className="h-10 sm:h-12" height={48} />
            </button>
          </div>

          {/* Center: Sort Options */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              variant={sortOption === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSortChange('today')}
              className={cn(
                'text-xs px-2 sm:px-3',
                sortOption === 'today' && 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
            >
              <span className="hidden sm:inline">Today</span>
              <span className="sm:hidden">T</span>
            </Button>
            <Button
              variant={sortOption === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSortChange('week')}
              className={cn(
                'text-xs px-2 sm:px-3',
                sortOption === 'week' && 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
            >
              <span className="hidden sm:inline">Week</span>
              <span className="sm:hidden">W</span>
            </Button>
            <Button
              variant={sortOption === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSortChange('month')}
              className={cn(
                'text-xs px-2 sm:px-3',
                sortOption === 'month' && 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
            >
              <span className="hidden sm:inline">Month</span>
              <span className="sm:hidden">M</span>
            </Button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1 sm:gap-3">
            {/* Sync Status Indicator */}
            {syncStatus && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                {syncStatus === 'synced' && (
                  <>
                    <Wifi className="w-4 h-4 text-green-500" />
                    <span>Synced</span>
                  </>
                )}
                {syncStatus === 'syncing' && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <span>Syncing...</span>
                  </>
                )}
                {syncStatus === 'offline' && (
                  <>
                    <WifiOff className="w-4 h-4 text-orange-500" />
                    <span>Offline</span>
                  </>
                )}
              </div>
            )}
            
            {/* BArch Button - Next to Synced */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/v2')}
              className="text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400"
            >
              BArch
            </Button>
            
            {/* Export Button */}
            {onExportClick && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1 sm:gap-2 p-2"
                  >
                    <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden md:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onExportClick?.('jira-json')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Jira JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportClick?.('trello-json')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Trello JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportClick?.('detailed-json')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Detailed JSON
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onExportClick?.('jira-csv')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Jira CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportClick?.('trello-csv')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Trello CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExportClick?.('detailed-csv')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Detailed CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            
            {/* History Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onHistoryClick}
              className="flex items-center gap-1 sm:gap-2 p-2"
            >
              <History className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden md:inline">History</span>
            </Button>

            {/* Sign In Button */}
            {!isAuthenticated ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsSignInOpen(true)}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3"
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Sign In</span>
              </Button>
            ) : (
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="hidden sm:inline text-sm text-neutral-700 dark:text-neutral-300">
                  {userName}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="p-2"
                >
                  <span className="hidden sm:inline">Sign Out</span>
                  <X className="w-4 h-4 sm:hidden" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sign In Dialog */}
      <Dialog open={isSignInOpen} onOpenChange={(open) => {
        setIsSignInOpen(open);
        if (!open) {
          setEmail('');
          setPassword('');
          setAuthError('');
        }
      }}>
        <DialogContent className="sm:max-w-sm bg-white dark:bg-slate-900 border-0 shadow-2xl rounded-2xl p-0">
          {/* Header */}
          <div className="px-6 pt-8 pb-6 text-center">
            <div className="mx-auto w-14 h-14 bg-blue-500 rounded-xl flex items-center justify-center mb-5 shadow-lg shadow-blue-500/20">
              <LogIn className="w-7 h-7 text-white" />
            </div>
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-slate-900 dark:text-white">
                Welcome Back
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 dark:text-slate-400 font-light">
                Sign in to manage tasks and collaborate
              </DialogDescription>
            </DialogHeader>
          </div>
          
          {/* Form */}
          <div className="px-6 pb-8 space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAuthError('');
                }}
                className="h-11 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setAuthError('');
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSignIn();
                  }
                }}
                className="h-11 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl">
                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{authError}</p>
              </div>
            )}
            <Button 
              onClick={handleSignIn} 
              className="w-full h-11 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl shadow-lg shadow-blue-500/20 transition-all"
              disabled={!email || !password || isLoading}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
