import { Button } from '@/components/ui/button';
import { Pencil, PencilOff } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useEdit } from '@/contexts/EditContext';
import { cn } from '@/lib/utils';

export interface FooterProps {
  /** Compact footer at the end of page content in split chat layout. */
  variant?: 'default' | 'splitPane';
  className?: string;
}

export function Footer({ variant = 'default', className }: FooterProps) {
  const location = useLocation();
  const { isEditMode, setIsEditMode, isAuthenticated } = useEdit();
  const isDashboard = location.pathname === '/insights';
  const isLandingPage = location.pathname === '/';
  const isSplitPane = variant === 'splitPane';

  if (isSplitPane) {
    return (
      <footer
        className={cn(
          'shrink-0 w-full bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl border-t border-slate-200/30 dark:border-slate-800/30',
          className,
        )}
      >
        <div className="flex h-8 items-center justify-between gap-2 px-3 sm:px-6 md:px-8 lg:px-12 min-w-0 w-full">
          <span className="truncate text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">
            © 2026 Coheus
          </span>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 text-[10px] sm:text-[11px]">
            <a
              href="https://www.coheus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
            >
              coheus.com
            </a>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <a
              href="mailto:support@terraverde.com"
              className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
            >
              Support
            </a>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <a
              href="#"
              className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap"
              onClick={(e) => e.preventDefault()}
            >
              Terms
            </a>
          </div>
        </div>
      </footer>
    );
  }

  // Only show default footer on dashboard and landing page
  if (!isDashboard && !isLandingPage) {
    return null;
  }

  return (
    <footer className={cn('w-full bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl border-t border-slate-200/30 dark:border-slate-800/30', className)}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-12 items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          {/* Left: Copyright */}
          <div className="flex items-center text-[11px] sm:text-[12px]">
            <span className="text-slate-500 dark:text-slate-400">© 2026 Coheus. All Rights Reserved</span>
          </div>
          
          {/* Center: Brand/Website */}
          <a
            href="https://www.coheus.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] sm:text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
          >
            www.coheus.com
          </a>
          
          {/* Right: Action Links + Edit Mode */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-[12px]">
              <a
                href="mailto:support@terraverde.com"
                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap font-medium"
              >
                Support
              </a>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <a
                href="#"
                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap font-medium"
                onClick={(e) => {
                  e.preventDefault();
                  // You can add terms/agreements modal or navigation here
                }}
              >
                Terms
              </a>
            </div>
          {false && isAuthenticated && (
            <Button 
              variant={isEditMode ? "default" : "ghost"}
              size="sm" 
              onClick={() => setIsEditMode(!isEditMode)} 
                className={`text-[12px] sm:text-[13px] font-medium tracking-wide px-3 sm:px-4 rounded-lg transition-all whitespace-nowrap ${
                isEditMode 
                  ? 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900' 
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {isEditMode ? (
                <>
                    <PencilOff className="h-3.5 w-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Exit Edit</span>
                </>
              ) : (
                <>
                    <Pencil className="h-3.5 w-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Edit</span>
                </>
              )}
            </Button>
          )}
          </div>
        </div>
      </div>
    </footer>
  );
}
