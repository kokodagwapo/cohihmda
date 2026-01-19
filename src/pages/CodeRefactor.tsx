import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UpdatesHero } from '@/components/updates/UpdatesHero';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { 
  ChevronRight, ChevronLeft, X, Code2, LogIn, Loader2, 
  Package, Layers, CheckCircle2, TrendingDown, Zap,
  DollarSign, Clock, Activity, Award, Table, FileDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContainerScroll } from '@/components/ui/cards-stack';
import { api } from '@/lib/api';
import { CodeComparisonSlider } from '@/components/refactoring/CodeComparisonSlider';
import { ROICalculator } from '@/components/refactoring/ROICalculator';
import { ComplexityGraph } from '@/components/refactoring/ComplexityGraph';
import { RefactoringTimeline } from '@/components/refactoring/RefactoringTimeline';
import { DXScoreCard } from '@/components/refactoring/DXScoreCard';
import { TechnicalDebtSavings } from '@/components/refactoring/TechnicalDebtSavings';
import { InteractiveFileTree } from '@/components/refactoring/InteractiveFileTree';
import { ComparisonMatrix } from '@/components/refactoring/ComparisonMatrix';
import { IndustryBadges } from '@/components/refactoring/IndustryBadges';
import { ExportPDFButton } from '@/components/refactoring/ExportPDFButton';

const CodeRefactor = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Auto-hide sidebar after 8 seconds on initial load, or immediately on mobile
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const delay = isMobile ? 0 : 8000;
    
    const timer = setTimeout(() => {
      setSidebarOpen(false);
    }, delay);

    return () => clearTimeout(timer);
  }, []);

  // Check auth state on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user } = await api.getCurrentUser();
        setIsAuthenticated(!!user);
        setUserName(user?.email?.split('@')[0] || 'User');
      } catch (error) {
        setIsAuthenticated(false);
        setUserName('');
      }
    };
    checkAuth();
  }, []);

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
    } catch (error: any) {
      setAuthError(error.message || 'Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await api.signOut();
    setIsAuthenticated(false);
    setUserName('');
  };

  const refactoringSections = [
    { 
      id: 'refactoring-highlights', 
      title: 'Refactoring Highlights', 
      subtitle: 'Click cards for details', 
      icon: CheckCircle2, 
      color: 'rgba(139, 92, 246, 0.1)', 
      iconColor: '#8b5cf6' 
    },
    { 
      id: 'code-comparison', 
      title: 'Code Comparison', 
      subtitle: 'Before vs After', 
      icon: Code2, 
      color: 'rgba(16, 185, 129, 0.1)', 
      iconColor: '#10b981' 
    },
    { 
      id: 'roi-calculator', 
      title: 'ROI Calculator', 
      subtitle: 'Calculate savings', 
      icon: DollarSign, 
      color: 'rgba(245, 158, 11, 0.1)', 
      iconColor: '#f59e0b' 
    },
    { 
      id: 'technical-debt', 
      title: 'Technical Debt', 
      subtitle: '$500K prevented', 
      icon: TrendingDown, 
      color: 'rgba(239, 68, 68, 0.1)', 
      iconColor: '#ef4444' 
    },
    { 
      id: 'timeline', 
      title: 'Timeline', 
      subtitle: '6-week journey', 
      icon: Clock, 
      color: 'rgba(99, 102, 241, 0.1)', 
      iconColor: '#6366f1' 
    },
    { 
      id: 'complexity-graph', 
      title: 'Quality Metrics', 
      subtitle: 'Code quality scores', 
      icon: Activity, 
      color: 'rgba(14, 165, 233, 0.1)', 
      iconColor: '#0ea5e9' 
    },
    { 
      id: 'dx-scorecard', 
      title: 'Developer Experience', 
      subtitle: 'Team satisfaction', 
      icon: Zap, 
      color: 'rgba(168, 85, 247, 0.1)', 
      iconColor: '#a855f7' 
    },
    { 
      id: 'file-tree', 
      title: 'Architecture Explorer', 
      subtitle: 'New structure', 
      icon: Layers, 
      color: 'rgba(20, 184, 166, 0.1)', 
      iconColor: '#14b8a6' 
    },
    { 
      id: 'comparison-matrix', 
      title: 'Comparison Matrix', 
      subtitle: 'All metrics', 
      icon: Table, 
      color: 'rgba(59, 130, 246, 0.1)', 
      iconColor: '#3b82f6' 
    },
    { 
      id: 'industry-badges', 
      title: 'Industry Standards', 
      subtitle: 'Recognition', 
      icon: Award, 
      color: 'rgba(234, 179, 8, 0.1)', 
      iconColor: '#eab308' 
    },
    { 
      id: 'pdf-export', 
      title: 'Download PDF', 
      subtitle: 'Executive summary', 
      icon: FileDown, 
      color: 'rgba(139, 92, 246, 0.1)', 
      iconColor: '#8b5cf6' 
    },
  ];

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      // Scroll to the section
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      setActiveSection(sectionId);
      setSidebarOpen(false);
    }
  };


  useEffect(() => {
    // Load premium fonts
    const link1 = document.createElement('link');
    link1.rel = 'preconnect';
    link1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(link1);

    const link2 = document.createElement('link');
    link2.rel = 'preconnect';
    link2.href = 'https://fonts.gstatic.com';
    link2.crossOrigin = 'anonymous';
    document.head.appendChild(link2);

    // Use Inter for body, Space Grotesk for headings, and IBM Plex Mono for code
    const link3 = document.createElement('link');
    link3.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@700&display=swap';
    link3.rel = 'stylesheet';
    document.head.appendChild(link3);

    // Inject styles
    const styleId = 'updates-page-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@700&display=swap');

        .updates-page-container * {
          box-sizing: border-box;
        }

        .updates-page-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #0f172a;
          background: linear-gradient(to bottom, #ffffff 0%, #f8fafc 100%);
          width: 100%;
          overflow-x: hidden;
        }

        .updates-page-container h2 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 1rem;
          line-height: 1.2;
        }

        .updates-page-container h3 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: clamp(1.5rem, 3vw, 2rem);
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 0.75rem;
          line-height: 1.3;
        }

        .updates-page-container h4 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: clamp(1.125rem, 2vw, 1.375rem);
          font-weight: 600;
          color: #1e293b;
          margin-bottom: 0.5rem;
          line-height: 1.4;
        }

        .updates-page-container p {
          font-family: 'Inter', sans-serif;
          font-size: clamp(0.9375rem, 1.5vw, 1.0625rem);
          line-height: 1.7;
          color: #475569;
          margin-bottom: 1rem;
        }

        .updates-page-container code {
          font-family: 'IBM Plex Mono', monospace;
          background: rgba(139, 92, 246, 0.08);
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-size: 0.875em;
          color: #8b5cf6;
        }

        .updates-page-container section {
          width: 100vw;
          position: relative;
          left: 50%;
          right: 50%;
          margin-left: -50vw;
          margin-right: -50vw;
          padding: 5rem 0;
        }

        .updates-page-container section > div {
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 clamp(2rem, 5vw, 4rem);
        }

        /* Accordion Styles */
        .accordion-wrapper {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 2rem;
        }

        .accordion-item {
          background: white;
          border: 1px solid rgba(226, 232, 240, 0.8);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .accordion-item:hover {
          box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04);
          border-color: rgba(139, 92, 246, 0.4);
        }

        .accordion-header {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          padding: 2rem;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .accordion-header:hover {
          background: rgba(139, 92, 246, 0.02);
        }

        .accordion-item.active .accordion-header {
          border-bottom: 1px solid rgba(226, 232, 240, 0.8);
        }

        .section-number {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 2rem;
          font-weight: 700;
          color: #8b5cf6;
          min-width: 3rem;
          text-align: center;
        }

        .section-title h3 {
          margin-bottom: 0.25rem;
        }

        .section-title p {
          font-size: 0.9375rem;
          color: #64748b;
          margin-bottom: 0;
        }

        .accordion-toggle {
          margin-left: auto;
          font-size: 1.5rem;
          color: #64748b;
          transition: transform 0.3s ease;
        }

        .accordion-item.active .accordion-toggle {
          transform: rotate(180deg);
        }

        .accordion-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }

        .accordion-item.active .accordion-content {
          max-height: 10000px;
        }

        .accordion-content-inner {
          padding: 2rem;
          padding-top: 2rem;
        }

        /* Stat Cards */
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
          gap: 1.5rem;
          margin: 2rem 0;
        }

        .stat-card {
          background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
          border: 1px solid rgba(226, 232, 240, 0.8);
          padding: 1.5rem;
          border-radius: 12px;
          box-shadow: 0 2px 4px rgba(15, 23, 42, 0.04);
        }

        .stat-card h4 {
          font-size: 1rem;
          color: #64748b;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stat-card .stat-value {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 2rem;
          font-weight: 700;
          color: #8b5cf6;
          margin-bottom: 0.5rem;
        }

        .stat-card p {
          font-size: 0.875rem;
          color: #64748b;
          margin-bottom: 0;
        }

        /* Highlight boxes */
        .highlight-box {
          background: rgba(139, 92, 246, 0.08);
          border-left: 3px solid #8b5cf6;
          padding: 1.25rem;
          border-radius: 8px;
          margin: 1.5rem 0;
        }

        .highlight-box strong {
          color: #6d28d9;
        }

        .highlight-box.success {
          background: rgba(16, 185, 129, 0.08);
          border-left-color: #10b981;
        }

        .highlight-box.success strong {
          color: #059669;
        }

        .highlight-box.info {
          background: rgba(59, 130, 246, 0.08);
          border-left-color: #3b82f6;
        }

        .highlight-box.info strong {
          color: #2563eb;
        }

        /* Lists */
        .updates-page-container ul {
          list-style: none;
          margin: 1.5rem 0;
          padding: 0;
        }

        .updates-page-container li {
          position: relative;
          padding-left: 2rem;
          margin-bottom: 0.75rem;
          line-height: 1.7;
          color: #475569;
        }

        .updates-page-container li::before {
          content: '→';
          position: absolute;
          left: 0;
          color: #8b5cf6;
          font-weight: 700;
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .updates-page-container section {
            padding: 3rem 0;
          }

          .accordion-header {
            padding: 1.5rem;
          }

          .accordion-content-inner {
            padding: 0 1.5rem 2rem 1.5rem;
            padding-top: 2rem;
          }
        }

        .refactoring-sidebar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
        }

        .refactoring-sidebar::-webkit-scrollbar {
          width: 6px;
        }

        .refactoring-sidebar::-webkit-scrollbar-track {
          background: transparent;
        }

        .refactoring-sidebar::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.1);
          border-radius: 3px;
        }

        .refactoring-sidebar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0, 0, 0, 0.2);
        }

        .refactoring-item.active {
          font-weight: 500;
        }

        /* Scroll padding for sections */
        .updates-page-container .accordion-item {
          scroll-margin-top: 100px;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <>
      {/* Navigation Bar */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '70px',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        zIndex: 1001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 clamp(1.5rem, 4vw, 3rem)',
      }}>
        <div
          onClick={() => navigate('/')}
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <CoheusLogo className="h-8 w-auto" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 flex items-center justify-center text-white font-semibold">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{userName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/insights')}>
                  Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="default"
              onClick={() => setIsSignInOpen(true)}
              className="flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">Sign In</span>
            </Button>
          )}
        </div>

        {/* Sign In Dialog */}
        <Dialog open={isSignInOpen} onOpenChange={setIsSignInOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sign In</DialogTitle>
              <DialogDescription>
                Enter your credentials to access your account
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="code-refactor-email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="code-refactor-email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthError('');
                  }}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="code-refactor-password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="code-refactor-password"
                  type="password"
                  placeholder="Enter your password"
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
                />
              </div>
              {authError && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <X className="w-3 h-3" />
                  {authError}
                </p>
              )}
              <Button onClick={handleSignIn} className="w-full" disabled={!email || !password || isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </nav>

      {/* Refactoring Sections Sidebar */}
      <div 
        className={`refactoring-sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{
          position: 'fixed',
          right: sidebarOpen ? '0' : '-320px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 'min(320px, 85vw)',
          maxHeight: '80vh',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          borderLeft: '1px solid rgba(0, 0, 0, 0.08)',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.08)',
          zIndex: 1000,
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY: 'auto',
          padding: '24px 0',
        }}
      >
        <div style={{ padding: '0 20px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1d29', margin: 0 }}>Refactoring Updates</h3>
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
            Explore our code transformation journey
          </p>
        </div>
        <div style={{ padding: '12px 0' }}>
          {refactoringSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`refactoring-item ${activeSection === section.id ? 'active' : ''}`}
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
                  borderLeft: activeSection === section.id ? `3px solid ${section.iconColor}` : '3px solid transparent',
                  backgroundColor: activeSection === section.id ? section.color : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (activeSection !== section.id) {
                    e.currentTarget.style.backgroundColor = section.color;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeSection !== section.id) {
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
          right: sidebarOpen ? 'min(320px, 85vw)' : '0',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '48px',
          height: '64px',
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
          transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          color: '#64748b',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)';
          e.currentTarget.style.color = '#1a1d29';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
          e.currentTarget.style.color = '#64748b';
        }}
      >
        {sidebarOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      <div className="updates-page-container">
        <UpdatesHero />
        <ContainerScroll className="min-h-[400vh]">
          
          {/* NEW: Code Comparison Section */}
          <section id="code-comparison" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)' }}>
            <div>
              <CodeComparisonSlider />
            </div>
          </section>

          {/* NEW: ROI Calculator & Technical Debt Section */}
          <section id="roi-calculator" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)' }}>
            <div>
              <ROICalculator />
            </div>
          </section>

          <section id="technical-debt" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)' }}>
            <div>
              <TechnicalDebtSavings />
            </div>
          </section>

          {/* NEW: Timeline Section */}
          <section id="timeline" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)' }}>
            <div>
              <RefactoringTimeline />
            </div>
          </section>

          {/* NEW: Complexity Graph Section */}
          <section id="complexity-graph" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)' }}>
            <div>
              <ComplexityGraph />
            </div>
          </section>

          {/* NEW: Developer Experience Section */}
          <section id="dx-scorecard" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)' }}>
            <div>
              <DXScoreCard />
            </div>
          </section>

          {/* NEW: File Structure Explorer Section */}
          <section id="file-tree" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)' }}>
            <div>
              <InteractiveFileTree />
            </div>
          </section>

          {/* NEW: Comparison Matrix Section */}
          <section id="comparison-matrix" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)' }}>
            <div>
              <ComparisonMatrix />
            </div>
          </section>

          {/* NEW: Industry Recognition Section */}
          <section id="industry-badges" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)' }}>
            <div>
              <IndustryBadges />
            </div>
          </section>

          {/* NEW: PDF Export Section */}
          <section id="pdf-export" style={{ background: 'linear-gradient(135deg, #fafafa 0%, #ffffff 100%)' }}>
            <div>
              <ExportPDFButton />
            </div>
          </section>

        </ContainerScroll>
      </div>
    </>
  );
};

export default CodeRefactor;

