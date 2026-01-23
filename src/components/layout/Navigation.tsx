import { Button } from '@/components/ui/button';
import { Settings, LayoutDashboard, ArrowRight, Home, LogOut, Menu, X, Brain } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/contexts/AuthContext';

export interface NavigationProps {
  onMenuToggle?: () => void;
  menuOpen?: boolean;
}

export function Navigation({ onMenuToggle, menuOpen }: NavigationProps = {} as NavigationProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [userName, setUserName] = useState<string | null>(null);
  
  const isDashboard = location.pathname === '/insights';
  const isLandingPage = location.pathname === '/';
  const isAdminPage = location.pathname.startsWith('/admin');

  // Get user display name from auth context
  useEffect(() => {
    if (user) {
      // Extract first name from full_name or use email prefix
      if (user.full_name) {
        const firstName = user.full_name.split(' ')[0];
        setUserName(firstName);
      } else if (user.email) {
        const emailPrefix = user.email.split('@')[0];
        const capitalizedName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
        setUserName(capitalizedName);
      }
    } else {
      setUserName(null);
    }
  }, [user]);

  // Fallback for display name
  useEffect(() => {
    if (isAuthenticated && !userName) {
      // Check localStorage for stored name preference
      const storedName = localStorage.getItem('user_display_name');
      if (storedName) {
        setUserName(storedName);
      }
    }
  }, [isAuthenticated, userName]);

  const handleLogout = async () => {
    await logout();
    
    // Redirect to admin login if logging out from admin page
    if (isAdminPage) {
      navigate('/login?returnTo=/admin');
    } else {
      navigate('/');
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-100 dark:bg-slate-950/90 dark:border-slate-800/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between relative">
          {/* Left: Logo */}
          <div className="flex items-center min-w-0 flex-shrink-0">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer flex-shrink-0"
              aria-label="Go to home page"
            >
              <CoheusLogo className="h-10 sm:h-12 md:h-14" height={56} />
            </button>
          </div>

          {/* Center: Personalized Greeting */}
          {isAuthenticated && (
            <div className="flex-1 flex justify-center md:relative md:flex-1">
              {/* Mobile: Centered greeting with proper spacing from logo */}
              <div className="flex sm:hidden items-center justify-center ml-4">
                <span className="text-base font-extralight text-slate-800 dark:text-slate-100 whitespace-nowrap tracking-tight leading-[1.05]">
                  {userName ? `Hi ${userName}!` : 'Hi there!'}
                </span>
              </div>
              {/* Tablet: Medium greeting */}
              <div className="hidden sm:flex md:hidden items-center justify-center -ml-4">
                <span className="text-lg font-extralight text-slate-700 dark:text-slate-200 whitespace-nowrap tracking-tight leading-[1.05]">
                  {userName 
                    ? `Hi ${userName.length > 10 ? userName.substring(0, 8) + '...' : userName}!`
                    : 'Hi there!'
                  }
                </span>
              </div>
              {/* Desktop: Full greeting */}
              <div className="hidden md:flex items-center justify-center">
                <span className="text-base md:text-lg font-extralight text-slate-700 dark:text-slate-200 whitespace-nowrap tracking-tight leading-[1.05]">
                  {userName ? `Hi ${userName}!` : 'Hi there!'}
                </span>
              </div>
            </div>
          )}

          <div className="hidden md:flex items-center gap-2">
            <ThemeToggle />
            {isAuthenticated ? (
              <>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigate('/')} 
                  className="text-[13px] font-light tracking-wide px-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-colors"
                  aria-label="Home"
                >
                  <Home className="h-3.5 w-3.5 text-pink-300 dark:text-pink-400/70" />
                </Button>
                {!isAdminPage && isAdmin() && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate('/admin')} 
                    className="text-[13px] font-light tracking-wide px-3 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-colors"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 mr-1.5 text-blue-300 dark:text-blue-400/70" />
                    Admin
                  </Button>
                )}
                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleLogout} 
                  className="text-[13px] font-light tracking-wide px-3 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5 mr-1.5 text-rose-300 dark:text-rose-400/70" />
                  Logout
                </Button>
              </>
            ) : (
              <>
                {isDashboard && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate('/')} 
                    className="text-[13px] font-light tracking-wide px-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-colors"
                    aria-label="Home"
                  >
                    <Home className="h-3.5 w-3.5 text-pink-300 dark:text-pink-400/70" />
                  </Button>
                )}
                {!isDashboard && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate('/insights')} 
                    className="text-[13px] font-light tracking-wide px-3 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-colors"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 mr-1 text-blue-300 dark:text-blue-400/70" />
                    Insights
                  </Button>
                )}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigate('/login')} 
                  className="text-[13px] font-light tracking-wide px-3 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5 mr-1 text-emerald-300 dark:text-emerald-400/70" />
                  Sign In
                </Button>
              </>
            )}
          </div>

          {/* Mobile Navigation */}
          <div className="flex md:hidden items-center gap-1.5 sm:gap-2">
            {/* Hamburger Menu Button - Only show on dashboard */}
            {isDashboard && onMenuToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMenuToggle}
                className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg h-9 w-9 sm:h-10 sm:w-10 p-0 flex-shrink-0 touch-manipulation"
                aria-label="Toggle menu"
              >
                {menuOpen ? (
                  <X className="h-5 w-5 sm:h-5 sm:w-5" strokeWidth={2} />
                ) : (
                  <Menu className="h-5 w-5 sm:h-5 sm:w-5" strokeWidth={2} />
                )}
              </Button>
            )}
            <ThemeToggle />
            {isAuthenticated ? (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleLogout}
                className="text-[12px] font-light tracking-wide px-2.5 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg h-8"
              >
                <LogOut className="h-3.5 w-3.5 mr-1 text-rose-300 dark:text-rose-400/70" />
                Logout
              </Button>
            ) : (
              <>
                {!isDashboard && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => navigate('/insights')}
                    className="text-[12px] font-light tracking-wide px-2.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg h-8"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 mr-1 text-blue-300 dark:text-blue-400/70" />
                    Insights
                  </Button>
                )}
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => navigate('/login')}
                  className="text-[12px] font-light tracking-wide px-2.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg h-8"
                >
                  Sign In
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
