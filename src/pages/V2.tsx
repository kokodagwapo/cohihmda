import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AletheiaV2Assistant } from '@/components/aletheia/AletheiaV2Assistant';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { Button } from '@/components/ui/button';
import { V2Hero } from '@/components/v2/V2Hero';
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
  Plug2, Shield, Network, Brain, Server, Cloud, UserCheck, Calendar, Settings, BarChart3,
  ChevronRight, ChevronLeft, X, Kanban, History, LogIn, Download, FileJson, FileSpreadsheet, Wifi, WifiOff, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContainerScroll } from '@/components/ui/cards-stack';
import { api } from '@/lib/api';

const V2 = () => {
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

  const deepDiveSections = [
    { id: 'admin-panel', title: 'Admin Panel & User Management', subtitle: 'Complete control center for system administration', icon: Settings, color: 'rgba(99, 102, 241, 0.1)', iconColor: '#6366f1' },
    { id: 'insights-dashboard', title: 'Insights Dashboard', subtitle: 'Executive intelligence and analytics', icon: BarChart3, color: 'rgba(16, 185, 129, 0.1)', iconColor: '#10b981' },
    { id: 'los-adapter', title: 'The LOS Adapter Pattern', subtitle: 'Supporting Encompass, Calyx, and beyond', icon: Plug2, color: 'rgba(139, 92, 246, 0.1)', iconColor: '#8b5cf6' },
    { id: 'security', title: 'Security: Beyond Checkboxes', subtitle: 'SOC 2 and HIPAA aren\'t afterthoughts', icon: Shield, color: 'rgba(236, 72, 153, 0.1)', iconColor: '#ec4899' },
    { id: 'vendor-connector', title: 'The Vendor Connector Layer', subtitle: 'Reaching every credit bureau, title company', icon: Network, color: 'rgba(59, 130, 246, 0.1)', iconColor: '#3b82f6' },
    { id: 'rag', title: 'RAG & Knowledge Base', subtitle: 'Teaching Ailethia about mortgage industry', icon: Brain, color: 'rgba(251, 146, 60, 0.1)', iconColor: '#fb923c' },
    { id: 'compute', title: 'Compute Architecture', subtitle: 'Why persistent connections require dedicated compute', icon: Server, color: 'rgba(34, 197, 94, 0.1)', iconColor: '#22c55e' },
    { id: 'deployment', title: 'Deployment Models', subtitle: 'On-premise, AWS private per-lender, hybrid', icon: Cloud, color: 'rgba(168, 85, 247, 0.1)', iconColor: '#a855f7' },
    { id: 'onboarding', title: 'Onboarding: 30 Minutes', subtitle: 'From signup to productive', icon: UserCheck, color: 'rgba(14, 165, 233, 0.1)', iconColor: '#0ea5e9' },
    { id: 'build-timeline', title: 'The Build Timeline', subtitle: '2.5 weeks, rapid AI-assisted development', icon: Calendar, color: 'rgba(245, 158, 11, 0.1)', iconColor: '#f59e0b' },
    { id: 'agileplan', title: 'Epic Goal | Tasks', subtitle: 'Kanban board for project management', icon: Kanban, color: 'rgba(139, 115, 85, 0.1)', iconColor: '#8B7355', isRoute: true },
  ];

  const scrollToSection = (sectionId: string) => {
    // Check if this is a route navigation
    const section = deepDiveSections.find(s => s.id === sectionId);
    if (section && (section as any).isRoute) {
      navigate('/v2/agileplan');
      setSidebarOpen(false);
      return;
    }

    const element = document.getElementById(sectionId);
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
      
      setActiveSection(sectionId);
      setSidebarOpen(false);
    }
  };

  useEffect(() => {
    // Apply card stack effect to accordion items after render
    const applyCardStackToAccordions = () => {
      const accordionItems = document.querySelectorAll('.v2-page-container .accordion-item');
      accordionItems.forEach((item, index) => {
        const htmlItem = item as HTMLElement;
        htmlItem.style.position = 'sticky';
        htmlItem.style.top = `${index * 10}px`;
        htmlItem.style.zIndex = String(8 - index);
        htmlItem.style.backfaceVisibility = 'hidden';
      });
    };

    // Try to apply immediately
    applyCardStackToAccordions();

    // Also try after a delay to ensure DOM is ready
    const timeout = setTimeout(() => {
      applyCardStackToAccordions();
    }, 100);

    return () => clearTimeout(timeout);
  }, []);

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
    const styleId = 'v2-page-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@700&display=swap');

        .v2-page-container * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .v2-page-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
          background: linear-gradient(180deg, #fafbfc 0%, #f4f6f9 50%, #eef2f6 100%);
          color: #1e293b;
          line-height: 1.7;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-weight: 400;
          letter-spacing: -0.011em;
        }

        .v2-page-container ::-webkit-scrollbar {
          width: 6px;
        }
        .v2-page-container ::-webkit-scrollbar-track {
          background: transparent;
        }
        .v2-page-container ::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        .v2-page-container ::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }

        /* Typography Scale - Modern & Light */
        .v2-page-container h1 {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(2.5rem, 5vw, 4rem);
          font-weight: 700;
          line-height: 1.1;
          letter-spacing: -0.045em;
          color: #0f172a;
          margin: 0 0 1.5rem 0;
        }

        .v2-page-container h1 .subtitle {
          font-size: clamp(1.5rem, 3vw, 2rem);
          font-weight: 400;
          opacity: 0.75;
          letter-spacing: -0.02em;
        }

        .v2-page-container h2 {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(1.75rem, 3vw, 2.25rem);
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: -0.03em;
          color: #0f172a;
          margin: 4rem 0 1.5rem 0;
        }

        .v2-page-container h2:first-of-type {
          margin-top: 0;
        }

        .v2-page-container h3 {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(1.25rem, 2vw, 1.5rem);
          font-weight: 600;
          line-height: 1.35;
          letter-spacing: -0.02em;
          color: #0f172a;
          margin: 2.5rem 0 1rem 0;
        }

        .v2-page-container h4 {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 1.125rem;
          font-weight: 600;
          line-height: 1.4;
          letter-spacing: -0.015em;
          color: #0f172a;
          margin: 1.5rem 0 0.75rem 0;
        }

        .v2-page-container p {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 1.0625rem;
          line-height: 1.75;
          color: #475569;
          margin-bottom: 1.5rem;
          font-weight: 400;
          letter-spacing: -0.011em;
        }

        .v2-page-container .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 clamp(1rem, 4vw, 4rem);
        }

        /* Mobile Responsive Improvements */
        @media (max-width: 768px) {
          .v2-page-container h2 {
            font-size: 1.5rem;
            margin: 2rem 0 1rem 0;
          }
          
          .v2-page-container h3 {
            font-size: 1.25rem;
            margin: 1.5rem 0 0.75rem 0;
          }
          
          .v2-page-container p {
            font-size: 1rem;
            line-height: 1.65;
          }
          
          .v2-page-container table {
            font-size: 0.875rem;
            display: block;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          
          .v2-page-container table th,
          .v2-page-container table td {
            padding: 0.5rem !important;
            font-size: 0.875rem;
          }
          
          .v2-page-container pre {
            font-size: 0.75rem;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
        }

        @media (max-width: 640px) {
          .v2-page-container .container {
            padding: 0 1rem;
          }
          
          .v2-page-container table {
            font-size: 0.8125rem;
          }
          
          .v2-page-container table th,
          .v2-page-container table td {
            padding: 0.375rem !important;
            font-size: 0.8125rem;
          }
        }

        .v2-page-container section {
          padding: 6rem 0;
          position: relative;
        }

        .v2-page-container section:first-of-type {
          padding-top: 4rem;
        }

        .v2-page-container .architecture-section {
          padding-top: 3rem;
        }

        /* Intro Section - Asymmetric Layout */
        .v2-page-container .intro-section-wrapper {
          padding-top: 2rem;
        }

        .v2-page-container .intro-section {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 2rem;
          align-items: start;
          margin: 0 0 3rem 0;
          padding: 0.5rem;
        }

        .v2-page-container .intro-text h2 {
          font-size: clamp(2rem, 4vw, 2.75rem);
          margin-bottom: 2rem;
          position: relative;
        }

        .v2-page-container .intro-text h2::after {
          content: '';
          position: absolute;
          bottom: -0.75rem;
          left: 0;
          width: 3rem;
          height: 3px;
          background: linear-gradient(90deg, #0066ff 0%, #00d4ff 100%);
          border-radius: 2px;
        }

        .v2-page-container .intro-text p {
          font-size: 1rem;
          line-height: 1.7;
          color: #4a5568;
          margin-bottom: 1rem;
        }

        .v2-page-container .intro-visual {
          position: sticky;
          top: 2rem;
          background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 1px solid rgba(226, 232, 240, 0.8);
          padding: 1.5rem;
          border-radius: 20px;
          box-shadow: 
            0 10px 15px -3px rgba(15, 23, 42, 0.06),
            0 4px 6px -2px rgba(15, 23, 42, 0.04),
            0 0 0 1px rgba(255, 255, 255, 0.1) inset;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .v2-page-container .intro-visual:hover {
          transform: translateY(-4px);
          box-shadow: 
            0 20px 25px -5px rgba(15, 23, 42, 0.08),
            0 10px 10px -5px rgba(15, 23, 42, 0.04),
            0 0 0 1px rgba(59, 130, 246, 0.1);
          border-color: rgba(59, 130, 246, 0.3);
        }

        .v2-page-container .architecture-diagram {
          width: 100%;
          height: 380px;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 400'%3E%3Cdefs%3E%3ClinearGradient id='grad1' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%230066ff;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%2300d4ff;stop-opacity:1' /%3E%3C/linearGradient%3E%3ClinearGradient id='grad2' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23ffffff;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%23f0f7ff;stop-opacity:1' /%3E%3C/linearGradient%3E%3Cfilter id='glow'%3E%3CfeGaussianBlur stdDeviation='3' result='coloredBlur'/%3E%3CfeMerge%3E%3CfeMergeNode in='coloredBlur'/%3E%3CfeMergeNode in='SourceGraphic'/%3E%3C/feMerge%3E%3C/filter%3E%3Cfilter id='shadow'%3E%3CfeDropShadow dx='0' dy='2' stdDeviation='4' flood-opacity='0.15'/%3E%3C/filter%3E%3C/defs%3E%3C!-- LOS Systems Section --%3E%3Cg id='los-systems'%3E%3Ctext x='80' y='30' font-size='14' font-weight='700' fill='%231a1d29' font-family='Space Grotesk' letter-spacing='0.5px'%3ELOS SYSTEMS%3C/text%3E%3Crect x='40' y='50' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='60' cy='75' r='8' fill='url(%23grad1)'/%3E%3Ctext x='80' y='80' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3EEncompass%3C/text%3E%3Ctext x='60' y='100' font-size='11' fill='%2364748b' font-family='Inter'%3EREST + SOAP%3C/text%3E%3Crect x='40' y='130' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='60' cy='155' r='8' fill='url(%23grad1)'/%3E%3Ctext x='80' y='160' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3ECalyx Point%3C/text%3E%3Ctext x='60' y='180' font-size='11' fill='%2364748b' font-family='Inter'%3EDatabase Access%3C/text%3E%3Crect x='40' y='210' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='60' cy='235' r='8' fill='url(%23grad1)'/%3E%3Ctext x='80' y='240' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3EMeridianLink%3C/text%3E%3Ctext x='60' y='260' font-size='11' fill='%2364748b' font-family='Inter'%3EAPI Integration%3C/text%3E%3C/g%3E%3C!-- Coheus Platform Center --%3E%3Cg id='coheus-platform'%3E%3Crect x='250' y='80' width='500' height='300' rx='20' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='4' filter='url(%23glow)'/%3E%3Crect x='270' y='100' width='460' height='60' rx='12' fill='url(%23grad1)'/%3E%3Ctext x='500' y='135' text-anchor='middle' fill='%23ffffff' font-size='24' font-weight='700' font-family='Space Grotesk' letter-spacing='-0.5px'%3ECoheus v2%3C/text%3E%3Ctext x='500' y='155' text-anchor='middle' fill='%23ffffff' font-size='11' font-weight='500' font-family='Inter' opacity='0.95'%3EUniversal Integration Platform%3C/text%3E%3Crect x='280' y='180' width='440' height='200' rx='12' fill='%23ffffff' stroke='%23e2e8f0' stroke-width='1.5'/%3E%3Ctext x='500' y='200' text-anchor='middle' fill='%231a1d29' font-size='14' font-weight='700' font-family='Space Grotesk'%3EUniversal Connector%3C/text%3E%3Cg transform='translate(300, 210)'%3E%3Crect x='0' y='0' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='15' cy='12' r='6' fill='url(%23grad1)'/%3E%3Ctext x='25' y='16' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3ELOS Adapters%3C/text%3E%3Ctext x='15' y='30' font-size='9' fill='%2364748b' font-family='Inter'%3ECanonical Schema%3C/text%3E%3Crect x='110' y='0' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='125' cy='12' r='6' fill='url(%23grad1)'/%3E%3Ctext x='135' y='16' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3EVendor APIs%3C/text%3E%3Ctext x='125' y='30' font-size='9' fill='%2364748b' font-family='Inter'%3EUnified Interface%3C/text%3E%3Crect x='0' y='58' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='15' cy='70' r='6' fill='url(%23grad1)'/%3E%3Ctext x='25' y='74' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3ERAG Engine%3C/text%3E%3Ctext x='15' y='88' font-size='9' fill='%2364748b' font-family='Inter'%3EVector Search%3C/text%3E%3Crect x='110' y='58' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='125' cy='70' r='6' fill='url(%23grad1)'/%3E%3Ctext x='135' y='74' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3EAI Analytics%3C/text%3E%3Ctext x='125' y='88' font-size='9' fill='%2364748b' font-family='Inter'%3EExecutive Insights%3C/text%3E%3Crect x='0' y='116' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='15' cy='128' r='6' fill='url(%23grad1)'/%3E%3Ctext x='25' y='132' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3EWebSocket%3C/text%3E%3Ctext x='15' y='146' font-size='9' fill='%2364748b' font-family='Inter'%3EReal-time Sync%3C/text%3E%3Crect x='110' y='116' width='90' height='48' rx='8' fill='%23f8fafc' stroke='%23e2e8f0' stroke-width='1'/%3E%3Ccircle cx='125' cy='128' r='6' fill='url(%23grad1)'/%3E%3Ctext x='135' y='132' font-size='11' font-weight='600' fill='%231a1d29' font-family='Space Grotesk'%3ESecurity%3C/text%3E%3Ctext x='125' y='146' font-size='9' fill='%2364748b' font-family='Inter'%3ESOC 2 + HIPAA%3C/text%3E%3C/g%3E%3C/g%3E%3C!-- Vendors Section --%3E%3Cg id='vendors'%3E%3Ctext x='840' y='30' font-size='14' font-weight='700' fill='%231a1d29' font-family='Space Grotesk' letter-spacing='0.5px'%3EVENDORS%3C/text%3E%3Crect x='800' y='50' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='820' cy='75' r='8' fill='url(%23grad1)'/%3E%3Ctext x='840' y='80' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3EMCT%3C/text%3E%3Crect x='800' y='130' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='820' cy='155' r='8' fill='url(%23grad1)'/%3E%3Ctext x='840' y='160' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3EAccounting%3C/text%3E%3Crect x='800' y='210' width='120' height='60' fill='url(%23grad2)' stroke='url(%23grad1)' stroke-width='2.5' rx='12' filter='url(%23shadow)'/%3E%3Ccircle cx='820' cy='235' r='8' fill='url(%23grad1)'/%3E%3Ctext x='840' y='240' font-size='13' font-weight='700' fill='%230066ff' font-family='Space Grotesk'%3EServicing%3C/text%3E%3C/g%3E%3C!-- Connection Lines --%3E%3Cg id='connections' stroke='url(%23grad1)' stroke-width='2.5' fill='none' opacity='0.6'%3E%3Cpath d='M 160 80 L 250 200' stroke-dasharray='6,4'/%3E%3Cpath d='M 160 160 L 250 220' stroke-dasharray='6,4'/%3E%3Cpath d='M 160 240 L 250 240' stroke-dasharray='6,4'/%3E%3Cpath d='M 750 200 L 800 80' stroke-dasharray='6,4'/%3E%3Cpath d='M 750 220 L 800 160' stroke-dasharray='6,4'/%3E%3Cpath d='M 750 240 L 800 240' stroke-dasharray='6,4'/%3E%3C/g%3E%3C!-- Data Flow Indicators --%3E%3Ccircle cx='205' cy='140' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3Ccircle cx='205' cy='190' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3Ccircle cx='205' cy='240' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3Ccircle cx='775' cy='140' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3Ccircle cx='775' cy='190' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3Ccircle cx='775' cy='240' r='3' fill='%2300d4ff' opacity='0.8'/%3E%3C/svg%3E") center center/contain no-repeat;
          position: relative;
          z-index: 1;
          cursor: pointer !important;
          pointer-events: auto !important;
          transition: all 0.3s ease;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .v2-page-container .architecture-diagram:hover {
          transform: scale(1.02);
          box-shadow: 0 8px 32px rgba(0, 102, 255, 0.2);
        }

        .v2-page-container .architecture-diagram::after {
          content: 'Click to expand';
          position: absolute;
          bottom: 1rem;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 102, 255, 0.9);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          white-space: nowrap;
        }

        .v2-page-container .architecture-diagram:hover::after {
          opacity: 1;
        }

        /* Modal Styles */
        .v2-page-container .diagram-modal {
          display: none;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          z-index: 99999 !important;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          animation: fadeIn 0.3s ease;
        }

        .v2-page-container .diagram-modal.active {
          display: flex !important;
        }

        .v2-page-container .diagram-modal-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          cursor: pointer;
        }

        .v2-page-container .diagram-modal-content {
          position: relative;
          z-index: 10001;
          background: white;
          border-radius: 24px;
          padding: 3rem;
          max-width: 90vw;
          max-height: 90vh;
          box-shadow: 0 32px 80px rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(0, 0, 0, 0.06);
          animation: scaleIn 0.3s cubic-bezier(0.23, 1, 0.32, 1);
          overflow: auto;
        }
        
        .v2-page-container .diagram-modal-content::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        .v2-page-container .diagram-modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .v2-page-container .diagram-modal-content::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .v2-page-container .diagram-modal-close {
          position: absolute;
          top: 1.5rem;
          right: 1.5rem;
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 12px;
          background: rgba(0, 0, 0, 0.05);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          color: #4a5568;
          transition: all 0.2s ease;
          font-family: 'Space Grotesk', sans-serif;
          z-index: 10002;
        }

        .v2-page-container .diagram-modal-close:hover {
          background: rgba(0, 0, 0, 0.1);
          transform: rotate(90deg);
        }

        .v2-page-container .diagram-modal-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.75rem;
          font-weight: 700;
          color: #0a0d14;
          margin-bottom: 2rem;
          text-align: center;
        }

        .v2-page-container .diagram-modal-diagram {
          width: 100%;
          min-width: 1000px;
          height: 600px;
          background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
          border-radius: 16px;
          padding: 2rem;
          position: relative;
          overflow: auto;
        }

        .v2-page-container .diagram-modal-diagram::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: 
            linear-gradient(rgba(0, 102, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 102, 255, 0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.5;
          pointer-events: none;
        }

        .v2-page-container .diagram-modal-diagram svg {
          width: 100%;
          height: 100%;
          min-height: 600px;
          position: relative;
          z-index: 1;
          display: block;
          visibility: visible !important;
          opacity: 1 !important;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @media (max-width: 768px) {
          .v2-page-container .diagram-modal-content {
            padding: 2rem 1.5rem;
            max-width: 95vw;
          }

          .v2-page-container .diagram-modal-diagram {
            min-width: 100%;
            height: 400px;
          }
        }

        /* Feature Grid - More Refined */
        .v2-page-container .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 2rem;
          margin: 3rem 0;
        }

        .v2-page-container .feature-card {
          background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(226, 232, 240, 0.8);
          border-radius: 16px;
          padding: 2rem;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          box-shadow: 
            0 1px 3px rgba(15, 23, 42, 0.03),
            0 1px 2px rgba(15, 23, 42, 0.02);
          overflow: hidden;
        }

        .v2-page-container .feature-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .v2-page-container .feature-card:hover {
          transform: translateY(-4px);
          border-color: rgba(59, 130, 246, 0.3);
          box-shadow: 
            0 20px 25px -5px rgba(15, 23, 42, 0.08),
            0 10px 10px -5px rgba(15, 23, 42, 0.04),
            0 0 0 1px rgba(59, 130, 246, 0.1);
          background: #ffffff;
        }

        .v2-page-container .feature-card:hover::before {
          transform: scaleX(1);
        }

        .v2-page-container .feature-card h4 {
          margin-top: 0;
          display: flex;
          align-items: center;
          gap: 0.875rem;
          font-size: 1.25rem;
        }

        .v2-page-container .feature-icon {
          font-size: 1.75rem;
          flex-shrink: 0;
          line-height: 1;
        }

        .v2-page-container .feature-card p {
          margin-bottom: 0;
          font-size: 1rem;
          line-height: 1.7;
        }

        /* Insights Grid */
        .v2-page-container .insights-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2.5rem;
          margin: 4rem 0;
        }

        .v2-page-container .insight-card {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(250, 251, 252, 0.9) 100%);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 24px;
          padding: 2.5rem;
          position: relative;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
        }

        .v2-page-container .insight-card::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #0066ff 0%, #00d4ff 100%);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.4s ease;
        }

        .v2-page-container .insight-card:hover {
          transform: translateY(-8px);
          border-color: rgba(0, 102, 255, 0.15);
          box-shadow: 0 20px 60px rgba(0, 102, 255, 0.2);
        }

        .v2-page-container .insight-card:hover::after {
          transform: scaleX(1);
        }

        .v2-page-container .insight-icon {
          font-size: 3rem;
          margin-bottom: 1.5rem;
          display: block;
          line-height: 1;
        }

        .v2-page-container .insight-card h3 {
          font-size: 1.5rem;
          margin-bottom: 1rem;
          color: #0a0d14;
        }

        .v2-page-container .insight-card p {
          color: #4a5568;
          font-size: 1.0625rem;
          line-height: 1.75;
          margin-bottom: 0;
        }

        /* Accordion - Card Stack Effect */
        .v2-page-container .accordion-wrapper {
          position: relative;
          width: 100%;
          min-height: 400vh;
          perspective: 1000px;
          margin-top: 3rem;
        }

        .v2-page-container .accordion-item {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 16px;
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 10px 40px rgba(0, 0, 0, 0.02);
          position: sticky;
          backface-visibility: hidden;
          margin-bottom: 1.5rem;
        }

        .v2-page-container .accordion-item:nth-child(1) {
          top: 0px;
          z-index: 8;
        }

        .v2-page-container .accordion-item:nth-child(2) {
          top: 10px;
          z-index: 7;
        }

        .v2-page-container .accordion-item:nth-child(3) {
          top: 20px;
          z-index: 6;
        }

        .v2-page-container .accordion-item:nth-child(4) {
          top: 30px;
          z-index: 5;
        }

        .v2-page-container .accordion-item:nth-child(5) {
          top: 40px;
          z-index: 4;
        }

        .v2-page-container .accordion-item:nth-child(6) {
          top: 50px;
          z-index: 3;
        }

        .v2-page-container .accordion-item:nth-child(7) {
          top: 60px;
          z-index: 2;
        }

        .v2-page-container .accordion-item:nth-child(8) {
          top: 70px;
          z-index: 1;
        }

        .v2-page-container .accordion-item.active {
          border-color: rgba(0, 102, 255, 0.2);
          box-shadow: 0 12px 40px rgba(0, 102, 255, 0.15);
          background: rgba(255, 255, 255, 0.95);
        }

        .v2-page-container .accordion-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2rem;
          cursor: pointer;
          user-select: none;
          background: transparent;
          transition: all 0.3s ease;
        }

        .v2-page-container .accordion-item.active .accordion-header {
          background: linear-gradient(90deg, rgba(0, 102, 255, 0.03) 0%, transparent 100%);
        }

        .v2-page-container .accordion-header:active {
          transform: scale(0.998);
        }

        .v2-page-container .section-number {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 3.5rem;
          height: 3.5rem;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border-radius: 12px;
          font-weight: 600;
          font-size: 1.25rem;
          flex-shrink: 0;
          margin-right: 1.75rem;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
          font-family: 'Space Grotesk', sans-serif;
          box-shadow: 0 4px 12px rgba(0, 102, 255, 0.3);
        }

        .v2-page-container .section-title {
          flex: 1;
        }

        .v2-page-container .section-title h3 {
          font-size: 1.375rem;
          margin: 0 0 0.5rem 0;
          color: #0f172a;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .v2-page-container .section-title p {
          font-size: 0.9375rem;
          color: #64748b;
          margin: 0;
          font-weight: 400;
          letter-spacing: -0.01em;
        }

        .v2-page-container .accordion-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2.75rem;
          height: 2.75rem;
          background: rgba(0, 0, 0, 0.03);
          border-radius: 10px;
          color: #0066ff;
          font-size: 1.125rem;
          transition: all 0.3s ease;
          flex-shrink: 0;
          cursor: pointer;
        }

        .v2-page-container .accordion-item.active .accordion-toggle {
          background: #0066ff;
          color: white;
          transform: rotate(180deg);
        }

        .v2-page-container .accordion-content {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.5s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
          will-change: grid-template-rows;
        }

        .v2-page-container .accordion-item.active .accordion-content {
          grid-template-rows: 1fr;
        }

        .v2-page-container .accordion-content-inner {
          padding: 0 2rem 2.5rem 2rem;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          padding-top: 2.5rem;
          min-height: 0;
          overflow: hidden;
          opacity: 0;
          transition: opacity 0.3s ease 0.1s;
        }

        .v2-page-container .accordion-item.active .accordion-content-inner {
          opacity: 1;
        }

        /* Code Blocks */
        .v2-page-container pre {
          background: #0a0d14;
          color: #e2e8f0;
          padding: 2rem;
          border-radius: 16px;
          overflow-x: auto;
          margin: 2rem 0;
          font-family: 'IBM Plex Mono', 'Fira Code', monospace;
          font-size: 0.875rem;
          line-height: 1.7;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .v2-page-container code {
          font-family: 'IBM Plex Mono', 'Fira Code', monospace;
          font-size: 0.9375em;
        }

        /* Tables */
        .v2-page-container table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          margin: 2rem 0;
          font-size: 1rem;
          background: white;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
        }

        .v2-page-container th {
          background: linear-gradient(135deg, #0066ff 0%, #0052cc 100%);
          color: white;
          padding: 1.25rem 1.5rem;
          text-align: left;
          font-weight: 600;
          font-size: 0.9375rem;
          letter-spacing: 0.02em;
          font-family: 'Space Grotesk', sans-serif;
        }

        .v2-page-container td {
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          padding: 1.25rem 1.5rem;
          color: #4a5568;
        }

        .v2-page-container tr:last-child td {
          border-bottom: none;
        }

        .v2-page-container tr:hover {
          background: rgba(0, 102, 255, 0.02);
        }

        /* Callouts */
        .v2-page-container .callout {
          border-left: 4px solid;
          padding: 2rem;
          margin: 2.5rem 0;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(20px);
          border-color: #0066ff;
          position: relative;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          border-right: 1px solid rgba(0, 0, 0, 0.06);
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }

        .v2-page-container .callout strong {
          display: block;
          color: #0a0d14;
          margin-bottom: 0.75rem;
          font-size: 1.125rem;
          font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
        }

        .v2-page-container .callout.warning {
          border-color: #f59e0b;
          background: rgba(255, 251, 235, 0.8);
        }

        .v2-page-container .callout.success {
          border-color: #10b981;
          background: rgba(236, 253, 245, 0.8);
        }

        .v2-page-container .callout.danger {
          border-color: #ef4444;
          background: rgba(254, 242, 242, 0.8);
        }

        /* Decision Box */
        .v2-page-container .decision-box {
          background: linear-gradient(135deg, rgba(255, 107, 53, 0.05) 0%, rgba(255, 107, 53, 0.02) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid rgba(255, 107, 53, 0.2);
          border-radius: 20px;
          padding: 2.25rem;
          margin: 2.5rem 0;
          box-shadow: 0 8px 32px rgba(255, 107, 53, 0.1);
          position: relative;
        }

        .v2-page-container .decision-box::before {
          content: '💭';
          display: block;
          font-size: 2rem;
          margin-bottom: 1rem;
          line-height: 1;
        }

        .v2-page-container .decision-box strong {
          color: #ff6b35;
          display: block;
          margin-bottom: 1rem;
          font-size: 1.125rem;
          font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
        }

        /* Value Prop */
        .v2-page-container .value-prop {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(250, 251, 252, 0.9) 100%);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 24px;
          padding: 4rem;
          margin: 5rem 0;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08);
        }

        .v2-page-container .value-prop h2 {
          font-size: clamp(2rem, 4vw, 2.5rem);
          margin-bottom: 3rem;
          text-align: center;
        }

        .v2-page-container .comparison-table {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2.5rem;
          margin-top: 3rem;
        }

        .v2-page-container .comparison-col {
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(20px);
          padding: 2.5rem;
          border-radius: 20px;
          border: 2px solid rgba(0, 0, 0, 0.06);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
          transition: all 0.3s ease;
        }

        .v2-page-container .comparison-col.bad {
          border-color: rgba(239, 68, 68, 0.3);
        }

        .v2-page-container .comparison-col.good {
          border-color: rgba(16, 185, 129, 0.3);
        }

        .v2-page-container .comparison-col h4 {
          font-size: 1.375rem;
          margin-bottom: 2rem;
          display: flex;
          align-items: center;
          gap: 0.875rem;
        }

        .v2-page-container .comparison-col ul {
          list-style: none;
          margin: 0;
        }

        .v2-page-container .comparison-col li {
          padding: 1rem 0;
          padding-left: 2rem;
          position: relative;
          color: #4a5568;
          font-size: 1.0625rem;
          line-height: 1.7;
        }

        .v2-page-container .comparison-col.bad li::before {
          content: '✗';
          position: absolute;
          left: 0;
          color: #ef4444;
          font-weight: bold;
          font-size: 1.25rem;
        }

        .v2-page-container .comparison-col.good li::before {
          content: '✓';
          position: absolute;
          left: 0;
          color: #10b981;
          font-weight: bold;
          font-size: 1.25rem;
        }

        /* Timeline */
        .v2-page-container .timeline {
          position: relative;
          margin: 3rem 0;
        }

        .v2-page-container .timeline-item {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 2.5rem;
          margin-bottom: 2.5rem;
          position: relative;
        }

        .v2-page-container .timeline-date {
          font-weight: 700;
          color: #0066ff;
          font-size: 1rem;
          font-family: 'Space Grotesk', sans-serif;
        }

        .v2-page-container .timeline-content {
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(20px);
          padding: 1.75rem;
          border-radius: 16px;
          border-left: 3px solid #0066ff;
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-left: 3px solid #0066ff;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
        }

        .v2-page-container .timeline-content strong {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          color: #0a0d14;
          display: block;
          margin-bottom: 0.5rem;
        }

        /* Lists */
        .v2-page-container ul, .v2-page-container ol {
          margin: 1.5rem 0 1.5rem 2rem;
          color: #4a5568;
        }

        .v2-page-container li {
          margin-bottom: 0.75rem;
          line-height: 1.75;
          font-size: 1.0625rem;
        }

        /* Footer */
        .v2-page-container .footer {
          background: linear-gradient(135deg, #0a0d14 0%, #1a1d29 100%);
          color: rgba(255, 255, 255, 0.9);
          padding: 4rem 2rem;
          text-align: center;
          margin-top: 6rem;
        }

        .v2-page-container .footer p {
          color: rgba(255, 255, 255, 0.7);
          font-size: 1rem;
          margin: 0.5rem 0;
        }

        .v2-page-container .footer p strong {
          color: white;
          font-weight: 600;
          font-family: 'Space Grotesk', sans-serif;
        }

        /* Utility Classes */
        .v2-page-container .mt-3 { margin-top: 2rem; }
        .v2-page-container .mb-3 { margin-bottom: 2rem; }
        .v2-page-container .text-center { text-align: center; }

        /* Responsive */
        @media (max-width: 968px) {
          .v2-page-container .intro-section {
            grid-template-columns: 1fr;
            gap: 3rem;
          }

          .v2-page-container .intro-visual {
            position: static;
          }

          .v2-page-container .comparison-table {
            grid-template-columns: 1fr;
          }

          .v2-page-container .section-number {
            width: 3rem;
            height: 3rem;
            font-size: 1.125rem;
            margin-right: 1.25rem;
          }

          .v2-page-container .timeline-item {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .v2-page-container .timeline-date {
            margin-bottom: 0.5rem;
          }
        }

        @media (max-width: 640px) {
          .v2-page-container section {
            padding: 4rem 0;
          }

          .v2-page-container .container {
            padding: 0 1.5rem;
          }

          .v2-page-container .value-prop {
            padding: 2.5rem 1.5rem;
          }

          .v2-page-container .accordion-header {
            padding: 1.5rem;
          }

          .v2-page-container .accordion-content-inner {
            padding: 0 1.5rem 2rem 1.5rem;
            padding-top: 2rem;
          }
        }

        /* Deep Dives Sidebar Styles */
        .deep-dives-sidebar {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
        }

        .deep-dives-sidebar::-webkit-scrollbar {
          width: 6px;
        }

        .deep-dives-sidebar::-webkit-scrollbar-track {
          background: transparent;
        }

        .deep-dives-sidebar::-webkit-scrollbar-thumb {
          background-color: rgba(0, 0, 0, 0.1);
          border-radius: 3px;
        }

        .deep-dives-sidebar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0, 0, 0, 0.2);
        }

        .deep-dive-item.active {
          font-weight: 500;
        }

        /* Scroll padding for sections */
        .v2-page-container .accordion-item {
          scroll-margin-top: 100px;
        }

        /* Economics section positioning */
        .v2-page-container #economics-section {
          transition: margin-top 0.4s cubic-bezier(0.23, 1, 0.32, 1);
        }

        .v2-page-container #build-timeline:not(.active) ~ section#economics-section,
        .v2-page-container .accordion-wrapper:has(#build-timeline:not(.active)) ~ section#economics-section {
          margin-top: -200px;
        }

        html {
          scroll-behavior: smooth;
        }
      `;
      document.head.appendChild(style);
    }

    // Accordion toggle function
    const toggleAccordion = (header: HTMLElement) => {
      const accordion = header.closest('.accordion-item');
      if (!accordion) return;
      
      const isActive = accordion.classList.contains('active');
      
      // Close others
      document.querySelectorAll('.v2-page-container .accordion-item.active').forEach((item) => {
        if (item !== accordion) {
          item.classList.remove('active');
        }
      });
      
      // Toggle this one
      accordion.classList.toggle('active');
      
      // Move Economics section up when accordion #8 is closed
      updateEconomicsSectionPosition();
    };

    // Function to update Economics section position based on accordion #8 state
    const updateEconomicsSectionPosition = () => {
      const buildTimelineAccordion = document.querySelector('.v2-page-container #build-timeline');
      const economicsSection = document.querySelector('.v2-page-container #economics-section');
      
      if (!buildTimelineAccordion || !economicsSection) return;
      
      const isClosed = !buildTimelineAccordion.classList.contains('active');
      const economicsEl = economicsSection as HTMLElement;
      
      if (isClosed) {
        economicsEl.style.marginTop = '-200px';
      } else {
        economicsEl.style.marginTop = '';
      }
    };

    // Modal functions - store references for proper cleanup
    let diagramClickHandler: ((e: Event) => void) | null = null;
    let backdropClickHandler: ((e: Event) => void) | null = null;
    let closeClickHandler: ((e: Event) => void) | null = null;

    const openDiagramModal = () => {
      const modal = document.querySelector('.v2-page-container .diagram-modal');
      if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    };

    const closeDiagramModal = () => {
      const modal = document.querySelector('.v2-page-container .diagram-modal');
      if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }
    };

    // Function to attach accordion handlers
    const attachAccordionHandlers = () => {
      const accordionHeaders = document.querySelectorAll('.v2-page-container .accordion-header');
      accordionHeaders.forEach((header) => {
        // Skip if already has listener attached
        if ((header as HTMLElement).dataset.listenerAttached === 'true') {
          return;
        }
        
        // Mark as having listener attached
        (header as HTMLElement).dataset.listenerAttached = 'true';
        
        // Add click listener
        header.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleAccordion(header as HTMLElement);
        });
      });

      // Open first accordion on load
      const first = document.querySelector('.v2-page-container .accordion-item');
      if (first && !first.classList.contains('active')) {
        first.classList.add('active');
      }

      // Apply card stack effect
      applyCardStackEffect();
      
      // Update Economics section position on load
      updateEconomicsSectionPosition();
    };

    // Function to apply card stack effect to accordion items
    const applyCardStackEffect = () => {
      const accordionWrapper = document.querySelector('.v2-page-container .accordion-wrapper');
      if (!accordionWrapper) return;

      const accordionItems = accordionWrapper.querySelectorAll('.accordion-item');
      if (accordionItems.length === 0) return;

      // Ensure wrapper has proper styling for card stack
      const wrapperEl = accordionWrapper as HTMLElement;
      wrapperEl.style.position = 'relative';
      wrapperEl.style.width = '100%';
      wrapperEl.style.minHeight = '400vh';
      wrapperEl.style.perspective = '1000px';

      // Apply card stack positioning to each item
      accordionItems.forEach((item, index) => {
        const htmlItem = item as HTMLElement;
        htmlItem.style.position = 'sticky';
        htmlItem.style.top = `${index * 10}px`;
        htmlItem.style.zIndex = String(8 - index);
        htmlItem.style.backfaceVisibility = 'hidden';
        htmlItem.style.marginBottom = '1.5rem';
      });
    };

    // Use requestAnimationFrame and multiple attempts to ensure handlers are attached
    const tryAttachHandlers = () => {
      const hasAccordion = document.querySelector('.v2-page-container .accordion-header');
      if (hasAccordion) {
        attachAccordionHandlers();
        return true;
      }
      return false;
    };

    // Try immediately
    if (!tryAttachHandlers()) {
      // Use MutationObserver to detect when HTML is inserted
      const observer = new MutationObserver(() => {
        if (tryAttachHandlers()) {
          observer.disconnect();
        }
      });

      // Start observing
      const container = document.querySelector('.v2-page-container');
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true
        });
      }

      // Also try with delays as fallback
      requestAnimationFrame(() => {
        if (!tryAttachHandlers()) {
          setTimeout(() => tryAttachHandlers(), 100);
          setTimeout(() => tryAttachHandlers(), 300);
          setTimeout(() => tryAttachHandlers(), 600);
        }
      });
    }

    // Add diagram modal handlers
    const attachModalHandlers = () => {
      const diagram = document.querySelector('.v2-page-container .architecture-diagram');
      if (diagram && !diagramClickHandler) {
        diagramClickHandler = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          openDiagramModal();
        };
        diagram.addEventListener('click', diagramClickHandler);
        // Ensure element is clickable
        (diagram as HTMLElement).style.pointerEvents = 'auto';
        (diagram as HTMLElement).style.cursor = 'pointer';
      }

      const modalBackdrop = document.querySelector('.v2-page-container .diagram-modal-backdrop');
      if (modalBackdrop && !backdropClickHandler) {
        backdropClickHandler = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          closeDiagramModal();
        };
        modalBackdrop.addEventListener('click', backdropClickHandler);
      }

      const modalClose = document.querySelector('.v2-page-container .diagram-modal-close');
      if (modalClose && !closeClickHandler) {
        closeClickHandler = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          closeDiagramModal();
        };
        modalClose.addEventListener('click', closeClickHandler);
      }
    };

    // Close modal on Escape key
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDiagramModal();
      }
    };
    document.addEventListener('keydown', escapeHandler);

    // Try to attach handlers multiple times to ensure they're attached
    const tryAttachModalHandlers = () => {
      const diagram = document.querySelector('.v2-page-container .architecture-diagram');
      const modal = document.querySelector('.v2-page-container .diagram-modal');
      if (diagram && modal) {
      attachModalHandlers();
        return true;
      }
      return false;
    };

    // Try immediately
    if (!tryAttachModalHandlers()) {
      // Use MutationObserver to detect when HTML is inserted
      const observer = new MutationObserver(() => {
        if (tryAttachModalHandlers()) {
          observer.disconnect();
        }
      });

      // Start observing
      const container = document.querySelector('.v2-page-container');
      if (container) {
        observer.observe(container, {
          childList: true,
          subtree: true
        });
      }

      // Also try with delays as fallback
      setTimeout(() => {
        if (!tryAttachModalHandlers()) {
          setTimeout(() => tryAttachModalHandlers(), 200);
        }
    }, 100);
    }

    return () => {
      // Cleanup - remove style tag if component unmounts
      const styleTag = document.getElementById(styleId);
      if (styleTag) {
        styleTag.remove();
      }
    };
  }, []);

  // Extract body content from the HTML (everything between <body> and </body>)
  const bodyContent = `
    <!-- The Build Timeline Section -->
    <section class="architecture-section" style="background: linear-gradient(135deg, #fafafa 0%, #ffffff 50%, #fafafa 100%); padding: 5rem 0; margin: 0; width: 100vw; position: relative; left: 50%; right: 50%; margin-left: -50vw; margin-right: -50vw;">
        <div style="max-width: 1400px; margin: 0 auto; padding: 0 clamp(2rem, 5vw, 4rem);">
            <h2 style="margin-bottom: 1.5rem; line-height: 1.3;">The Build Timeline <span style="color: #10b981; font-size: clamp(0.75rem, 2vw, 0.875rem); font-weight: 600; margin-left: clamp(0.5rem, 2vw, 1rem); display: inline-block; padding: 0.25rem 0.75rem; background: rgba(16, 185, 129, 0.1); border-radius: 6px; white-space: normal; line-height: 1.4;">Deployment-ready Jan 1, 2026 - 22 days ahead of Jan 23 deadline</span></h2>
            <p style="font-size: 1.125rem; margin-bottom: 2.5rem; max-width: 900px; line-height: 1.7; color: #475569;"><strong style="color: #0f172a;">Dec 15, 2025 to Jan 23, 2026</strong> - A comprehensive 6-week development plan built using modern development practices, AI-assisted coding, and strategic architecture decisions. What traditionally takes 6-12 months is being accomplished in 6 weeks—a <strong style="color: #0f172a;">10x acceleration</strong>. <span style="color: #10b981; font-weight: 600;">Core infrastructure, security, and deployment systems are operational and ready for production use. Pending LOS API integration testing.</span></p>

            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem; border-radius: 16px; margin-bottom: 3rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
            <div style="display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.25rem;">
                <div style="width: 52px; height: 52px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </div>
                <h3 style="margin: 0; color: #0f172a; font-size: 1.375rem; font-weight: 700;">Rapid Development Approach</h3>
            </div>
            <p style="margin: 0; color: #475569; line-height: 1.8; font-size: 1.0625rem; padding-left: 4.25rem;">Leveraging AI pair programming (<strong>Codex Max</strong>, <strong>Claude Sonnet 4.5 via Composer</strong>, and <strong>Gemini Flash</strong>), modern frameworks, and cloud-native services enabled us to build production-ready features 10x faster than traditional development cycles.</p>
        </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: clamp(1.25rem, 3vw, 2rem); margin: 3rem 0;">
            <!-- Week 1 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(99, 102, 241, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.5rem; gap: 1rem;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                        </div>
                        <div>
                            <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 1</h4>
                            <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">Foundation</p>
                        </div>
                    </div>
                    <a href="https://d2wvs4i87rs881.cloudfront.net/v2/agileplan" target="_blank" rel="noopener noreferrer" style="background: rgba(99, 102, 241, 0.1); padding: 0.5rem 0.875rem; border-radius: 8px; font-size: 0.8125rem; text-decoration: none; color: #6366f1; font-weight: 600; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap;" onmouseover="this.style.background='rgba(99, 102, 241, 0.15)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(99, 102, 241, 0.1)'; this.style.transform='scale(1)'">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                        Plan
                    </a>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Dec 15-19, 2025</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">AWS infrastructure setup (VPC, EC2, RDS, S3)</li>
                    <li style="margin-bottom: 0.5rem;">Architecture diagrams and decision docs</li>
                    <li style="margin-bottom: 0.5rem;">Database schema design (PostgreSQL multi-tenant)</li>
                    <li style="margin-bottom: 0.5rem;">Prisma ORM setup and configuration</li>
                    <li>Development environment (Docker, local setup)</li>
                </ul>
            </div>

            <!-- Week 2 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(59, 130, 246, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 2</h4>
                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">Backend & Security</p>
                    </div>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Dec 22-26, 2025</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">Authentication system (JWT + refresh tokens)</li>
                    <li style="margin-bottom: 0.5rem;">SSO implementation (AWS IAM + SAML)</li>
                    <li style="margin-bottom: 0.5rem;">Multi-tenant isolation (row-level security)</li>
                    <li style="margin-bottom: 0.5rem;">API Gateway and rate limiting</li>
                    <li>Middleware (auth, tenant resolution, logging)</li>
                </ul>
            </div>

            <!-- Week 3 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(16, 185, 129, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 6.1H3"></path>
                            <path d="M21 12.1H3"></path>
                            <path d="M15.1 18H3"></path>
                        </svg>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 3</h4>
                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">LOS Connectors</p>
                    </div>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Dec 29, 2025 - Jan 2, 2026</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">Universal loan schema (canonical model)</li>
                    <li style="margin-bottom: 0.5rem;">Base connector class (factory pattern)</li>
                    <li style="margin-bottom: 0.5rem;">Encompass connector (REST + OAuth)</li>
                    <li style="margin-bottom: 0.5rem;">Calyx connector (database access)</li>
                    <li>MeridianLink connector (API integration)</li>
                </ul>
            </div>

            <!-- Week 4 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(168, 85, 247, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 4</h4>
                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">Vendors & Security</p>
                    </div>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Jan 5-9, 2026</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">Vendor connector framework (generic pattern)</li>
                    <li style="margin-bottom: 0.5rem;">Credit bureau integration (Experian, Equifax, TransUnion)</li>
                    <li style="margin-bottom: 0.5rem;">Encryption implementation (KMS, field-level)</li>
                    <li style="margin-bottom: 0.5rem;">SOC 2 controls (audit logging, compliance)</li>
                    <li>Security testing (penetration testing, vulnerability assessment)</li>
                </ul>
            </div>

            <!-- Week 5 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(236, 72, 153, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="22"></line>
                        </svg>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 5</h4>
                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">RAG & AI</p>
                    </div>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Jan 12-16, 2026</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">Document processing pipeline (upload, extract, normalize, chunk)</li>
                    <li style="margin-bottom: 0.5rem;">Embedding generation (OpenAI embeddings)</li>
                    <li style="margin-bottom: 0.5rem;">Pinecone integration (vector database setup)</li>
                    <li style="margin-bottom: 0.5rem;">RAG prompt engineering (optimize for accuracy)</li>
                    <li>Ailethia voice AI integration (Gemini Live API)</li>
                </ul>
            </div>

            <!-- Week 6 -->
            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.25rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(14, 165, 233, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                        </svg>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.1875rem; font-weight: 700; color: #0f172a;">Week 6</h4>
                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b; margin-top: 0.125rem;">Launch Prep</p>
                    </div>
                </div>
                <p style="margin: 0 0 1.25rem 0; font-size: 0.9375rem; color: #64748b; font-weight: 600;">Jan 19-23, 2026</p>
                <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.9375rem; line-height: 1.9; color: #475569;">
                    <li style="margin-bottom: 0.5rem;">Automated onboarding system (30-minute flow)</li>
                    <li style="margin-bottom: 0.5rem;">Video training platform (training videos with quizzes)</li>
                    <li style="margin-bottom: 0.5rem;">Documentation (API docs, runbooks, user guides)</li>
                    <li style="margin-bottom: 0.5rem;">Performance testing (load testing and optimization)</li>
                    <li>Go/no-go review (final polish and launch readiness)</li>
                </ul>
            </div>
        </div>

        <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 3rem 2.5rem; border-radius: 16px; margin: 4rem 0 3rem 0; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
            <div style="display: flex; align-items: center; gap: 1.25rem; margin-bottom: 2.5rem;">
                <div style="width: 52px; height: 52px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                </div>
                <h3 style="margin: 0; color: #0f172a; font-size: 1.625rem; font-weight: 700;">Why So Fast?</h3>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: clamp(1.5rem, 3vw, 2.5rem);">
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(59, 130, 246, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 8V4H8"></path>
                                <rect width="16" height="12" x="4" y="8" rx="2"></rect>
                                <path d="M2 14h2"></path>
                                <path d="M20 14h2"></path>
                                <path d="M15 13v2"></path>
                                <path d="M9 13v2"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">AI-Assisted Development</h4>
                    </div>
                        <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">Using <strong>Codex Max</strong>, <strong>Claude Sonnet 4.5 via Composer</strong>, and <strong>Gemini Flash</strong> accelerated development by 10x.</p>
                </div>
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(16, 185, 129, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="16 18 22 12 16 6"></polyline>
                                <polyline points="8 6 2 12 8 18"></polyline>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">Modern Stack</h4>
                    </div>
                    <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">React, TypeScript, and Tailwind CSS provide rapid UI development. Shadcn UI components eliminate custom building.</p>
                </div>
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(168, 85, 247, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">Cloud-Native</h4>
                    </div>
                    <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">AWS managed services (RDS, KMS, Elastic Beanstalk, CloudFront) eliminate infrastructure management overhead.</p>
                </div>
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(245, 158, 11, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 6v6l4 2"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">Strategic Focus</h4>
                    </div>
                    <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">Built MVP features first, then iterated. No premature optimization. Focus on solving lender integration problems.</p>
                </div>
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(236, 72, 153, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">Agile Methodology</h4>
                    </div>
                    <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">Daily standups, sprint planning, and continuous delivery. Rapid feedback loops and iterative development kept momentum high.</p>
                </div>
                <div>
                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                        <div style="width: 40px; height: 40px; background: rgba(14, 165, 233, 0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                                <path d="M9 3v18"></path>
                                <path d="m16 15-3-3 3-3"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; color: #0f172a; font-size: 1.125rem; font-weight: 700;">Reusable Components</h4>
                    </div>
                    <p style="margin: 0; font-size: 1rem; line-height: 1.8; color: #475569;">Component library approach with Shadcn UI. Build once, use everywhere. Consistent design system accelerates feature development.</p>
                </div>
            </div>
        </div>

        <div style="background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: clamp(2rem, 5vw, 3.5rem) clamp(1.5rem, 4vw, 2.5rem); border-radius: 16px; text-align: center; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); margin-bottom: 4rem;">
            <h3 style="margin: 0 0 clamp(2rem, 4vw, 3rem) 0; font-size: clamp(1.25rem, 3vw, 1.625rem); font-weight: 700; color: #0f172a;">Development Metrics</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: clamp(1.5rem, 4vw, 3rem);">
                <div>
                    <div style="font-size: 3rem; font-weight: 800; margin-bottom: 0.75rem; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">6</div>
                    <div style="font-size: 1rem; color: #64748b; font-weight: 600; line-height: 1.4;">Weeks Total (Planned)</div>
                </div>
                <div>
                    <div style="font-size: 3rem; font-weight: 800; margin-bottom: 0.75rem; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">30</div>
                    <div style="font-size: 1rem; color: #64748b; font-weight: 600; line-height: 1.4;">Major Tasks</div>
                </div>
                <div>
                    <div style="font-size: 3rem; font-weight: 800; margin-bottom: 0.75rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">157</div>
                    <div style="font-size: 1rem; color: #64748b; font-weight: 600; line-height: 1.4;">Files Created</div>
                </div>
                <div>
                    <div style="font-size: 3rem; font-weight: 800; margin-bottom: 0.75rem; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">10x</div>
                    <div style="font-size: 1rem; color: #64748b; font-weight: 600; line-height: 1.4;">Faster than Traditional</div>
                </div>
                <div>
                    <div style="font-size: 3rem; font-weight: 800; margin-bottom: 0.75rem; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">85%</div>
                    <div style="font-size: 1rem; color: #64748b; font-weight: 600; line-height: 1.4;">SOC 2 Complete</div>
                </div>
            </div>
        </div>
        </div>
    </section>

    <div class="container">
        <section class="intro-section-wrapper">
            <div class="intro-section">
            <div class="intro-text">
            
            <div class="diagram-modal">
                <div class="diagram-modal-backdrop"></div>
                <div class="diagram-modal-content">
                    <button class="diagram-modal-close" aria-label="Close modal">×</button>
                    <h3 class="diagram-modal-title">Coheus v2 Architecture</h3>
                    <div class="diagram-modal-diagram">
                        <svg viewBox="0 0 1200 700" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" style="stop-color:#0066ff;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#00d4ff;stop-opacity:1" />
                                </linearGradient>
                                <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#f8fafc;stop-opacity:1" />
                                </linearGradient>
                                <linearGradient id="platformGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" style="stop-color:#0066ff;stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:#00d4ff;stop-opacity:1" />
                                </linearGradient>
                                <filter id="shadow">
                                    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.1" flood-color="#000000"/>
                                </filter>
                                <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="2.5" orient="auto">
                                    <polygon points="0 0, 8 2.5, 0 5" fill="#94a3b8"/>
                                </marker>
                                <marker id="arrowheadBlue" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                                    <polygon points="0 0, 10 3, 0 6" fill="#0066ff"/>
                                </marker>
                            </defs>
                            
                            <!-- Background -->
                            <rect width="1200" height="700" fill="#ffffff"/>
                            
                            <!-- LOS Systems (Left) -->
                            <g id="los-systems" class="animate-los">
                                <text x="150" y="40" font-size="16" font-weight="700" fill="#1a1d29" font-family="Space Grotesk, sans-serif" letter-spacing="1px">LOS SYSTEMS</text>
                                
                                <!-- Encompass -->
                                <g transform="translate(80, 70)" class="los-item">
                                    <rect x="10" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <circle cx="0" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <path d="M -8 40 C -8 35, -5 32, 0 32 C 5 32, 8 35, 8 40 C 8 45, 5 48, 0 48 C -5 48, -8 45, -8 40 M -4 36 L 0 32 L 4 36 M -4 44 L 0 48 L 4 44" fill="none" stroke="#0066ff" stroke-width="1.5" stroke-linecap="round"/>
                                    <text x="40" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="los-title">Encompass</text>
                                    <text x="20" y="55" font-size="11" fill="#64748b" font-family="Inter, sans-serif" class="los-subtitle">REST + SOAP</text>
                                </g>
                                
                                <!-- Calyx Point -->
                                <g transform="translate(80, 180)" class="los-item">
                                    <rect x="10" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <circle cx="0" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <ellipse cx="0" cy="35" rx="6" ry="8" fill="#0066ff"/>
                                    <rect x="-4" y="40" width="8" height="8" rx="1" fill="#0066ff"/>
                                    <text x="40" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="los-title">Calyx Point</text>
                                    <text x="20" y="55" font-size="11" fill="#64748b" font-family="Inter, sans-serif" class="los-subtitle">Database Access</text>
                                </g>
                                
                                <!-- MeridianLink -->
                                <g transform="translate(80, 290)" class="los-item">
                                    <rect x="10" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <circle cx="0" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <rect x="-6" y="32" width="8" height="10" rx="1" fill="#0066ff"/>
                                    <rect x="2" y="36" width="8" height="10" rx="1" fill="#0066ff" opacity="0.8"/>
                                    <text x="40" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="los-title">MeridianLink</text>
                                    <text x="20" y="55" font-size="11" fill="#64748b" font-family="Inter, sans-serif" class="los-subtitle">API Integration</text>
                                </g>
                            </g>
                            
                            <!-- Coheus Platform (Center) -->
                            <g id="coheus-platform" class="platform-main">
                                <rect x="320" y="100" width="560" height="500" rx="24" fill="#ffffff" stroke="#e2e8f0" stroke-width="2" filter="url(#shadow)"/>
                                
                                <!-- Header with Gradient -->
                                <rect x="340" y="120" width="520" height="90" rx="16" fill="url(#platformGrad)"/>
                                <text x="600" y="165" text-anchor="middle" font-size="32" font-weight="700" fill="#ffffff" font-family="Space Grotesk, sans-serif" letter-spacing="-1px">Coheus v2</text>
                                <text x="600" y="190" text-anchor="middle" font-size="13" font-weight="500" fill="#ffffff" font-family="Inter, sans-serif" opacity="0.95">Universal Integration Platform</text>
                                
                                <!-- Universal Connector Section -->
                                <g transform="translate(360, 240)">
                                    <line x1="0" y1="30" x2="80" y2="30" stroke="#cbd5e1" stroke-width="1"/>
                                    <text x="240" y="30" text-anchor="middle" font-size="12" font-weight="600" fill="#64748b" font-family="Space Grotesk, sans-serif" letter-spacing="1px">UNIVERSAL CONNECTOR</text>
                                    <line x1="400" y1="30" x2="480" y2="30" stroke="#cbd5e1" stroke-width="1"/>
                                    
                                    <!-- Features Grid 2x3 -->
                                    <g transform="translate(0, 50)">
                                    <!-- Row 1 -->
                                        <rect x="0" y="0" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <path d="M 25 25 L 15 35 L 25 35 L 35 25 Z" fill="#0066ff" stroke="none"/>
                                    <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">LOS Adapters</text>
                                    <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">Canonical Schema</text>
                                    
                                        <rect x="230" y="0" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <circle cx="25" cy="25" r="8" fill="none" stroke="#0066ff" stroke-width="1.5"/>
                                        <circle cx="25" cy="25" r="4" fill="#0066ff"/>
                                        <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">Vendor APIs</text>
                                        <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">Unified Interface</text>
                                    
                                    <!-- Row 2 -->
                                        <rect x="0" y="90" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <ellipse cx="25" cy="25" rx="6" ry="8" fill="#0066ff"/>
                                        <rect x="22" y="32" width="6" height="8" rx="1" fill="#0066ff"/>
                                        <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">RAG Engine</text>
                                        <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">Vector Search</text>
                                        
                                        <rect x="230" y="90" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <rect x="18" y="18" width="14" height="14" rx="2" fill="none" stroke="#0066ff" stroke-width="1.5"/>
                                        <circle cx="22" cy="22" r="2" fill="#0066ff"/>
                                        <circle cx="28" cy="22" r="2" fill="#0066ff"/>
                                        <circle cx="22" cy="28" r="2" fill="#0066ff"/>
                                        <circle cx="28" cy="28" r="2" fill="#0066ff"/>
                                        <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">AI Analytics</text>
                                        <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">Executive Insights</text>
                                    
                                    <!-- Row 3 -->
                                        <rect x="0" y="180" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <path d="M 20 25 L 25 20 L 30 25 L 25 30 Z" fill="#0066ff"/>
                                        <path d="M 20 30 L 30 30" stroke="#0066ff" stroke-width="1.5" stroke-linecap="round"/>
                                        <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">WebSocket</text>
                                        <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">Real-time Sync</text>
                                        
                                        <rect x="230" y="180" width="210" height="70" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#shadow)"/>
                                        <path d="M 25 20 L 25 15 L 30 20 L 25 25 Z" fill="#0066ff"/>
                                        <path d="M 20 25 L 30 25" stroke="#0066ff" stroke-width="1.5" stroke-linecap="round"/>
                                        <text x="45" y="30" font-size="13" font-weight="600" fill="#1a1d29" font-family="Space Grotesk, sans-serif">Security</text>
                                        <text x="25" y="50" font-size="11" fill="#64748b" font-family="Inter, sans-serif">SOC 2 + HIPAA</text>
                                    </g>
                                </g>
                            </g>
                            
                            <!-- Vendors (Right) -->
                            <g id="vendors" class="animate-vendors">
                                <text x="980" y="40" font-size="16" font-weight="700" fill="#1a1d29" font-family="Space Grotesk, sans-serif" letter-spacing="1px">VENDORS</text>
                                
                                <!-- MCT -->
                                <g transform="translate(980, 70)" class="vendor-item">
                                    <rect x="0" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <text x="20" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="vendor-title">MCT</text>
                                    <circle cx="150" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <rect x="142" y="32" width="12" height="16" rx="1" fill="#0066ff"/>
                                    <path d="M 144 36 L 152 36 M 144 40 L 152 40 M 144 44 L 152 44" stroke="#ffffff" stroke-width="1"/>
                                </g>
                                
                                <!-- Accounting -->
                                <g transform="translate(980, 180)" class="vendor-item">
                                    <rect x="0" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <text x="20" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="vendor-title">Accounting</text>
                                    <circle cx="150" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <rect x="142" y="30" width="16" height="20" rx="1" fill="#0066ff"/>
                                    <path d="M 144 34 L 156 34" stroke="#ffffff" stroke-width="1"/>
                                    <path d="M 144 38 L 156 38" stroke="#ffffff" stroke-width="1"/>
                                </g>
                                
                                <!-- Servicing -->
                                <g transform="translate(980, 290)" class="vendor-item">
                                    <rect x="0" y="0" width="140" height="80" rx="16" fill="url(#cardGrad)" stroke="#0066ff" stroke-width="1.5" filter="url(#shadow)"/>
                                    <text x="20" y="30" font-size="14" font-weight="700" fill="#0066ff" font-family="Space Grotesk, sans-serif" class="vendor-title">Servicing</text>
                                    <circle cx="150" cy="40" r="20" fill="#e0f2fe" stroke="#0066ff" stroke-width="1.5"/>
                                    <rect x="142" y="30" width="12" height="16" rx="1" fill="#0066ff"/>
                                    <rect x="150" y="34" width="12" height="16" rx="1" fill="#0066ff" opacity="0.8"/>
                                </g>
                            </g>
                            
                            <!-- Connection Lines -->
                            <g id="connections" fill="none">
                                <!-- LOS to Coheus - Light gray dashed -->
                                <path d="M 220 110 Q 270 180, 320 250" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8,4" marker-end="url(#arrowhead)" opacity="0.6"/>
                                <path d="M 220 220 Q 270 250, 320 300" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8,4" marker-end="url(#arrowhead)" opacity="0.6"/>
                                <path d="M 220 330 Q 270 360, 320 350" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8,4" marker-end="url(#arrowhead)" opacity="0.6"/>
                                
                                <!-- Coheus to MCT - Thick blue solid -->
                                <path d="M 880 250 Q 930 180, 980 110" stroke="#0066ff" stroke-width="4" marker-end="url(#arrowheadBlue)"/>
                                <circle cx="980" cy="110" r="4" fill="#0066ff"/>
                                
                                <!-- Coheus to Accounting - Light gray dashed -->
                                <path d="M 880 300 Q 930 220, 980 220" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8,4" marker-end="url(#arrowhead)" opacity="0.6"/>
                                <circle cx="980" cy="220" r="4" fill="#0066ff"/>
                                
                                <!-- Coheus to Servicing - Light gray dashed -->
                                <path d="M 880 350 Q 930 300, 980 330" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8,4" marker-end="url(#arrowhead)" opacity="0.6"/>
                                <circle cx="980" cy="330" r="4" fill="#0066ff"/>
                            </g>
                        </svg>
                    </div>
                </div>
            </div>
            </div>
        </section>

        <section class="architecture-section">
            <h2>Architecture at a Glance</h2>
            <p style="font-size: 1.125rem; margin-bottom: 3rem; max-width: 900px;">Coheus v2 is built on <strong>battle-tested, enterprise-grade technologies</strong>, specifically architected for the unique demands of mortgage lending: persistent WebSocket connections for real-time voice AI, simultaneous sync with multiple LOS systems, sub-second API response times, and SOC 2 Type II compliance from day one.</p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.75rem; margin-bottom: 3rem;">
                <!-- Node.js Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(34, 197, 94, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="16 18 22 12 16 6"></polyline>
                                <polyline points="8 6 2 12 8 18"></polyline>
                            </svg>
                </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">Node.js 20 + TypeScript</h4>
                </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">Modern, performant runtime with excellent async/await support for complex integration workflows. TypeScript ensures type safety across 157 files.</p>
                    <div style="background: rgba(34, 197, 94, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #22c55e;">
                        <p style="margin: 0; font-size: 0.875rem; color: #166534; line-height: 1.6;"><strong>Why:</strong> Non-blocking I/O perfect for handling thousands of concurrent LOS connections</p>
                </div>
                </div>

                <!-- PostgreSQL Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(59, 130, 246, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                            </svg>
                </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">PostgreSQL 15 + Redis</h4>
                    </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">Proven data layer for transactional integrity (PostgreSQL) and high-speed caching (Redis) of frequently accessed LOS data and session state.</p>
                    <div style="background: rgba(59, 130, 246, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #3b82f6;">
                        <p style="margin: 0; font-size: 0.875rem; color: #1e40af; line-height: 1.6;"><strong>Why:</strong> ACID compliance for loan data, sub-10ms cache reads for real-time queries</p>
                    </div>
                </div>

                <!-- AWS Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(245, 158, 11, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">AWS Cloud-Native</h4>
                    </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">Fully managed infrastructure: Elastic Beanstalk for auto-scaling, RDS for HA databases, S3 for documents, CloudFront for global CDN, KMS for encryption.</p>
                    <div style="background: rgba(245, 158, 11, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #f59e0b;">
                        <p style="margin: 0; font-size: 0.875rem; color: #92400e; line-height: 1.6;"><strong>Why:</strong> Zero infrastructure management, automatic scaling, 99.99% uptime SLA</p>
                    </div>
                </div>

                <!-- Ailethia AI Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(168, 85, 247, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 8V4H8"></path>
                                <rect width="16" height="12" x="4" y="8" rx="2"></rect>
                                <path d="M2 14h2"></path>
                                <path d="M20 14h2"></path>
                                <path d="M15 13v2"></path>
                                <path d="M9 13v2"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">Ailethia AI Insights</h4>
                    </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">AI-powered executive intelligence for mortgage decision-makers. Real-time pipeline analysis, risk assessment, and predictive analytics.</p>
                    <div style="background: rgba(168, 85, 247, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #a855f7;">
                        <p style="margin: 0; font-size: 0.875rem; color: #6b21a8; line-height: 1.6;"><strong>Why:</strong> Turn raw loan data into actionable insights for executives</p>
                    </div>
                </div>

                <!-- LOS Adapters Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(236, 72, 153, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17 6.1H3"></path>
                                <path d="M21 12.1H3"></path>
                                <path d="M15.1 18H3"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">Synapse Connect</h4>
                    </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">Canonical schema with pluggable adapters for Encompass, Calyx, MeridianLink, Byte, and more. Add new LOS systems in hours, not months.</p>
                    <div style="background: rgba(236, 72, 153, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #ec4899;">
                        <p style="margin: 0; font-size: 0.875rem; color: #9f1239; line-height: 1.6;"><strong>Why:</strong> One data model, infinite LOS compatibility</p>
                    </div>
                </div>

                <!-- RAG Search Card -->
                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(14, 165, 233, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem;">
                        <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.3-4.3"></path>
                            </svg>
                        </div>
                        <h4 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #0f172a; letter-spacing: -0.01em;">RAG-Powered Search</h4>
                    </div>
                    <p style="margin: 0 0 1rem 0; font-size: 0.9375rem; line-height: 1.7; color: #475569;">Semantic search over mortgage documents with vector embeddings. Find information by meaning, not keywords. Powered by OpenAI + Pinecone.</p>
                    <div style="background: rgba(14, 165, 233, 0.08); padding: 0.875rem; border-radius: 8px; border-left: 3px solid #0ea5e9;">
                        <p style="margin: 0; font-size: 0.875rem; color: #075985; line-height: 1.6;"><strong>Why:</strong> Instant answers from thousands of documents, no manual searching</p>
                    </div>
                </div>
            </div>
        </section>

        <section>
            <h2>Deep Dives</h2>
            <p style="margin-bottom: 2.5rem;">Click on any section in the sidebar to explore the architecture decisions, implementation details, and rationale behind Coheus v2.</p>
            
            <div class="accordion-wrapper" id="accordion-container-scroll">
                <div class="accordion-item" id="admin-panel">
                    <div class="accordion-header">
                        <div class="section-number">1</div>
                        <div class="section-title">
                            <h3>Admin Panel & User Management</h3>
                            <p>Complete control center for system administration</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>The Admin Panel provides comprehensive system management capabilities for super admins and tenant administrators. It's the command center for user management, tenant configuration, security settings, and system monitoring.</p>
                            
                            <h3>User Management</h3>
                            <ul>
                                <li><strong>Create, edit, and delete users</strong> with full CRUD operations</li>
                                <li><strong>Assign roles</strong>: Super Admin, Tenant Admin, Loan Officer, User</li>
                                <li><strong>Tenant assignment</strong> and isolation for multi-tenant security</li>
                                <li><strong>Real-time user status tracking</strong> and activity monitoring</li>
                            </ul>
                            
                            <h3>Admin Sections</h3>
                            <table>
                                <tr><th>Section</th><th>Features</th></tr>
                                <tr><td><strong>Users</strong></td><td>CRUD operations, role assignment, tenant management</td></tr>
                                <tr><td><strong>Tenants</strong></td><td>Organization management, subscription tracking</td></tr>
                                <tr><td><strong>RAG Settings</strong></td><td>Knowledge base configuration, vector store management</td></tr>
                                <tr><td><strong>Demo Data</strong></td><td>Sample data generation for testing</td></tr>
                                <tr><td><strong>LOS Settings</strong></td><td>Loan origination system integrations</td></tr>
                                <tr><td><strong>Synapse Connect</strong></td><td>Vendor API integrations</td></tr>
                                <tr><td><strong>System</strong></td><td>Health monitoring, performance metrics</td></tr>
                                <tr><td><strong>Security</strong></td><td>Audit logs, encryption status, compliance</td></tr>
                            </table>
                            
                            <h3>UI/UX Design</h3>
                            <p>The admin interface features a sophisticated, modern design:</p>
                            <ul>
                                <li><strong>Very light blue background</strong> (almost white) for reduced eye strain</li>
                                <li><strong>Consistent font styles</strong> (font-extralight, font-light) matching the Insights dashboard</li>
                                <li><strong>Enhanced form padding and spacing</strong> for better usability</li>
                                <li><strong>Blue focus ring theme</strong> throughout for accessibility</li>
                                <li><strong>Taller input fields</strong> (h-12) for better touch targets</li>
                                <li><strong>Visual separators</strong> and clear section hierarchy</li>
                            </ul>
                            
                            <pre><code>// User creation with role-based access
POST /api/admin/users
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "full_name": "John Doe",
  "role": "loan_officer",
  "tenant_id": "uuid-here"
}

// Response includes audit trail
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "loan_officer",
    "tenant_id": "uuid-here",
    "created_at": "2025-12-31T..."
  },
  "audit": {
    "action": "user_created",
    "actor": "admin@ailethia.com",
    "timestamp": "2025-12-31T..."
  }
}</code></pre>

                            <div class="decision-box">
                                <strong>Design Philosophy</strong>
                                The admin panel prioritizes clarity and efficiency. Every action is logged, every permission is checked, and every UI element is designed for speed. Admins can create a new user, assign roles, and configure tenant settings in under 30 seconds.
                            </div>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="insights-dashboard">
                    <div class="accordion-header">
                        <div class="section-number">2</div>
                        <div class="section-title">
                            <h3>Insights Dashboard</h3>
                            <p>Executive intelligence and analytics</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>The Insights Dashboard is the primary interface for executives and loan officers, providing real-time visibility into loan pipelines, performance metrics, and AI-powered recommendations.</p>
                            
                            <h3>Key Features</h3>
                            <ul>
                                <li><strong>Pipeline Overview</strong>: Real-time loan status across all stages</li>
                                <li><strong>Performance Metrics</strong>: Conversion rates, cycle times, volume trends</li>
                                <li><strong>AI Insights</strong>: Predictive analytics and recommendations</li>
                                <li><strong>Industry News</strong>: Curated mortgage industry updates</li>
                                <li><strong>Knowledge Base</strong>: Quick access to API docs, policies, use cases</li>
                            </ul>
                            
                            <h3>Mobile Responsive</h3>
                            <p>The dashboard is fully responsive with optimized layouts for:</p>
                            <ul>
                                <li><strong>Desktop (1920px+)</strong>: Full multi-column layout with side-by-side panels</li>
                                <li><strong>Tablet (768px-1919px)</strong>: Adaptive 2-column grid with collapsible sections</li>
                                <li><strong>Mobile (320px-767px)</strong>: Single column with touch-optimized controls</li>
                            </ul>
                            
                            <h3>Knowledge Base Links</h3>
                            <p>Integrated access to critical resources:</p>
                            <ul>
                                <li><strong>API Documentation</strong>: ICE Encompass, Meridian Link APIs</li>
                                <li><strong>Lending Policies</strong>: State-by-state regulations and guidelines</li>
                                <li><strong>Industry News</strong>: Latest updates from mortgage industry sources</li>
                                <li><strong>Executive Thinking</strong>: How to think like a lender executive</li>
                                <li><strong>Use Cases</strong>: Real-world lending scenarios and solutions</li>
                            </ul>

                            <div class="callout warning">
                                <strong>Industry News Modal</strong>
                                The industry news feature includes a mobile-responsive modal with well-structured CSS, proper padding, and smooth animations. News articles are categorized and filterable for quick access to relevant information.
                            </div>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="los-adapter">
                    <div class="accordion-header">
                        <div class="section-number">3</div>
                        <div class="section-title">
                            <h3>The LOS Adapter Pattern</h3>
                            <p>Supporting Encompass, Calyx, and beyond</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>Ellie Mae Encompass uses REST + SOAP. Calyx Point requires direct database access. MeridianLink has a completely different API surface. How do we support all of them without building 5 separate platforms?</p>

                            <h3>The Adapter Pattern</h3>
                            <p>We define a canonical loan schema—what a loan looks like in Coheus land. Then each LOS system gets an adapter that knows how to:</p>
                            <ol>
                                <li>Authenticate with that LOS</li>
                                <li>Fetch loan data in their format</li>
                                <li>Transform it to our canonical schema</li>
                                <li>Handle real-time webhooks they send us</li>
                            </ol>

                            <pre><code>// Abstract base class
abstract class LOSConnector {
  protected tenantId: string;
  
  abstract authenticate(): Promise&lt;void&gt;;
  abstract fetchLoans(filters?: LoanFilters): Promise&lt;CanonicalLoan[]&gt;;
  abstract syncWebhook(event: WebhookEvent): Promise&lt;void&gt;;
  
  // Shared across all implementations
  protected async encryptPII(loan: CanonicalLoan): Promise&lt;void&gt; {
    // Encrypt SSN, DOB, account numbers
  }
}

// Encompass-specific implementation
class EncompassConnector extends LOSConnector {
  async authenticate() {
    // OAuth 2.0 flow with Encompass API
  }
  
  async fetchLoans() {
    // Call Encompass REST API
    // Transform their format to CanonicalLoan
  }
}</code></pre>

                            <h3>The Universal Schema</h3>
                            <p>This is where everything converges. Every LOS system has different field names, different data structures, different ways of organizing information. But underneath, they're all capturing the same fundamental things:</p>

                            <pre><code>interface CanonicalLoan {
  // Identification
  loanNumber: string;
  borrowerInfo: {
    firstName: string;
    lastName: string;
    ssn?: string;        // Encrypted
    email: string;
    dti?: number;
  };
  
  // Loan details
  loanAmount: number;
  propertyValue: number;
  loanType: 'fha' | 'va' | 'conventional' | 'usda' | 'jumbo';
  
  // Pipeline
  stage: 'inquiry' | 'application' | 'processing' | 
         'underwriting' | 'approved' | 'clear-to-close' | 'funded';
  
  // Key dates
  applicationDate: Date;
  expectedCloseDate?: Date;
  
  // Source tracking
  source: 'encompass' | 'calyx' | 'meridian' | ...;
  lastSynced: Date;
}</code></pre>

                            <div class="decision-box">
                                <strong>Data Sync Strategy</strong>
                                Real-time webhooks for urgent updates (loan status changes). Daily full sync at 2 AM for reconciliation. Hourly incremental sync for anything missed. If a webhook fails, the daily sync catches it.
                            </div>

                            <h3>Adding a New LOS System</h3>
                            <p>With our standardized lender API, adding a new LOS system typically takes less than a day—sometimes just a few hours. Here's the streamlined process:</p>
                            <ol>
                                <li>Connect to the lender's API endpoint</li>
                                <li>Authenticate using standardized credentials</li>
                                <li>Map their fields to our CanonicalLoan schema</li>
                                <li>Configure webhook endpoints for real-time updates</li>
                                <li>Run automated tests against sample data</li>
                                <li>Deploy behind feature flag for gradual rollout</li>
                            </ol>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="security">
                    <div class="accordion-header">
                        <div class="section-number">4</div>
                        <div class="section-title">
                            <h3>Security: Beyond Checkboxes</h3>
                            <p>🔒 SOC 2 Type II Implementation - Nearing Completion</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <div class="callout warning" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.15) 100%); border-left: 4px solid #3b82f6; margin-bottom: 2rem;">
                                <strong>🔒 SOC 2 Type II Compliance - Advanced Implementation Stage</strong>
                                <p style="margin: 0.5rem 0;">Coheus v2 is undergoing <strong>comprehensive SOC 2 Type II compliance implementation</strong>, with robust security controls, audit logging, and compliance frameworks being actively developed and refined. Our platform is architected with enterprise-grade security at its foundation.</p>
                                <ul style="margin-top: 1rem; line-height: 1.8;">
                                    <li>🔄 <strong>Access Control:</strong> Role-based permissions with comprehensive audit trails (in development)</li>
                                    <li>🔄 <strong>Encryption:</strong> AWS KMS field-level encryption for all PII data (actively implementing)</li>
                                    <li>🔄 <strong>Audit Logging:</strong> Every action tracked with user, timestamp, and changes (core functionality complete)</li>
                                    <li>🔄 <strong>Change Management:</strong> Code review, testing, and approval workflows (established)</li>
                                    <li>🔄 <strong>Monitoring:</strong> 24/7 security event alerting and automated response (in progress)</li>
                                    <li>🔄 <strong>Incident Response:</strong> Documented runbooks and on-call rotation (under development)</li>
                                </ul>
                                <p style="margin-top: 1rem; padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-radius: 6px; font-weight: 500;">
                                    <strong>Compliance Progress:</strong> SOC 2 Type II (85% Complete) | HIPAA Ready (Framework Established) | GDPR Compliant (In Progress) | Approaching Production Readiness
                                </p>
                            </div>

                            <p>Compliance isn't a feature you add at the end. It's baked into every design decision from day one. <strong>We're actively building a comprehensive SOC 2 compliant system, with core security controls already implemented and undergoing rigorous testing and refinement.</strong></p>

                            <h3>Encryption Strategy</h3>
                            <p>Three layers, each serving a different purpose:</p>

                            <div class="feature-grid">
                                <div class="feature-card">
                                    <h4><span class="feature-icon">🔐</span> At Rest</h4>
                                    <p><strong>AES-256</strong> via AWS KMS. RDS encryption enabled. S3 default encryption. Field-level encryption for PII (SSN, DOB, account numbers).</p>
                                </div>
                                <div class="feature-card">
                                    <h4><span class="feature-icon">🚀</span> In Transit</h4>
                                    <p><strong>TLS 1.3</strong> for all HTTP endpoints. <strong>WSS (Secure WebSocket)</strong> for voice connections. Certificate pinning for critical vendor APIs.</p>
                                </div>
                                <div class="feature-card">
                                    <h4><span class="feature-icon">🔑</span> Key Management</h4>
                                    <p><strong>AWS KMS</strong> for key rotation and lifecycle management. No keys stored in code. Automatic key versioning for decryption of old data.</p>
                                </div>
                            </div>

                            <h3>🔒 SOC 2 Type II: Advanced Implementation Stage</h3>
                            <p><strong>We're actively implementing SOC 2 Type II compliance</strong> with comprehensive controls across all five Trust Service Criteria. SOC 2 Type II isn't a certificate you buy—it's an independent audit that verifies you have controls in place and that they're operating effectively over time. Our platform is being architected with these requirements at its core.</p>
                            
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin: 1.5rem 0;">
                                <div style="padding: 1.25rem; background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%); border-radius: 12px; border-left: 4px solid #6366f1;">
                                    <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">🔄 Access Control</strong>
                                    <p style="margin: 0; font-size: 0.9rem; color: #475569;">Implementing role-based permissions with comprehensive audit trails to ensure only authorized personnel access sensitive data.</p>
                                </div>
                                <div style="padding: 1.25rem; background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(217, 70, 239, 0.1) 100%); border-radius: 12px; border-left: 4px solid #a855f7;">
                                    <strong style="color: #a855f7; display: block; margin-bottom: 0.5rem;">🔄 Change Management</strong>
                                    <p style="margin: 0; font-size: 0.9rem; color: #475569;">Establishing rigorous code review, testing, and approval workflows. Git-based version control with CI/CD pipeline integration.</p>
                                </div>
                                <div style="padding: 1.25rem; background: linear-gradient(135deg, rgba(236, 72, 153, 0.1) 0%, rgba(251, 113, 133, 0.1) 100%); border-radius: 12px; border-left: 4px solid #ec4899;">
                                    <strong style="color: #ec4899; display: block; margin-bottom: 0.5rem;">🔄 Monitoring</strong>
                                    <p style="margin: 0; font-size: 0.9rem; color: #475569;">Developing 24/7 security event alerting with automated anomaly detection. CloudWatch integration for real-time visibility.</p>
                                </div>
                                <div style="padding: 1.25rem; background: linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, rgba(251, 146, 60, 0.1) 100%); border-radius: 12px; border-left: 4px solid #f97316;">
                                    <strong style="color: #f97316; display: block; margin-bottom: 0.5rem;">🔄 Incident Response</strong>
                                    <p style="margin: 0; font-size: 0.9rem; color: #475569;">Creating documented runbooks, on-call rotation procedures, and post-incident review processes with automated escalation.</p>
                                </div>
                            </div>

                            <div class="callout warning" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.1) 100%); border-left: 4px solid #3b82f6;">
                                <strong>🔄 Active Development and Refinement</strong>
                                <p style="margin: 0.5rem 0;">Core SOC 2 controls are being systematically implemented and tested. Our admin panel includes a dedicated <strong>SOC 2 Compliance section</strong> (currently in development) for real-time audit trail access, designed to provide complete visibility into every action taken in the system.</p>
                                <p style="margin: 0.5rem 0 0 0; font-style: italic; color: #2563eb;">Code reviews aren't optional. Audit logging isn't optional. Change tracking isn't optional. Compliance is being built-in from the ground up, not bolted-on as an afterthought.</p>
                            </div>

                            <h3>HIPAA Readiness</h3>
                            <p>Mortgage files can contain health information (disability, medical leave, etc.). HIPAA doesn't directly apply to mortgages, but many lenders work with healthcare companies where HIPAA does apply.</p>

                            <p>We're HIPAA-ready by default:</p>
                            <ul>
                                <li>Encryption at rest and in transit</li>
                                <li>Access logging for all PHI</li>
                                <li>Audit trails showing who accessed what data</li>
                                <li>BAAs (Business Associate Agreements) with AWS and all vendors</li>
                                <li>Annual penetration testing and vulnerability assessments</li>
                            </ul>

                            <h3>Field-Level Encryption Example</h3>
                            <pre><code>// When storing a borrower's SSN
const borrower = {
  firstName: 'John',
  lastName: 'Doe',
  ssn: '123-45-6789'  // Never store plaintext
};

// Encrypt before saving
const encrypted = await kmsClient.encrypt({
  KeyId: process.env.KMS_KEY_ID,
  Plaintext: borrower.ssn
});

await db.borrowers.create({
  firstName: borrower.firstName,
  lastName: borrower.lastName,
  ssn_encrypted: encrypted.CiphertextBlob,
  created_at: new Date()
});

// When we need to use it
const decrypted = await kmsClient.decrypt({
  CiphertextBlob: borrower.ssn_encrypted
});
const ssn = decrypted.Plaintext.toString();</code></pre>

                            <h3>Zero Trust Network</h3>
                            <p>Every request is authenticated and authorized, regardless of where it comes from. Every internal service verifies every other service. No "it's fine, it's internal."</p>

                            <h3>Actual Implementation: What We Built</h3>

                            <h4>1. Role-Based Access Control (RBAC)</h4>
                            <p>We implemented a comprehensive RBAC system with four role levels:</p>
                            <pre><code>// Middleware: requireRole
export const requireRole = (...allowedRoles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = await getUserRole(req.userId);
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Usage in routes
router.post('/admin/users', 
  authenticateToken, 
  requireRole('super_admin'), 
  createUser
);

// Role hierarchy:
// super_admin: Full system access, all tenants
// tenant_admin: Tenant-specific admin access
// loan_officer: Loan management within tenant
// user: Read-only access to assigned loans</code></pre>

                            <h4>2. AWS KMS Field-Level Encryption</h4>
                            <p>We implemented field-level encryption using AWS Key Management Service for PII data:</p>
                            <pre><code>// server/src/services/encryption.ts
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kmsClient = new KMSClient({ region: 'us-east-1' });
const KMS_KEY_ID = process.env.KMS_KEY_ID;

export async function encryptField(plaintext: string): Promise&lt;string&gt; {
  const command = new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(plaintext)
  });
  const response = await kmsClient.send(command);
  return Buffer.from(response.CiphertextBlob).toString('base64');
}

// Automatically encrypt SSN, DOB, account numbers
const encryptedSSN = await encryptField(borrower.ssn);</code></pre>

                            <h4>3. Comprehensive Audit Logging</h4>
                            <p>Every sensitive action is logged for SOC 2 compliance:</p>
                            <pre><code>// server/src/services/auditLogger.ts
export async function logAudit(event: AuditEvent) {
  await pool.query(
    \`INSERT INTO audit_logs 
     (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)\`,
    [event.userId, event.action, event.resourceType, event.resourceId, 
     event.ipAddress, event.userAgent, JSON.stringify(event.metadata)]
  );
}

// Logged actions:
// - User login/logout
// - User creation/modification/deletion
// - PII data access
// - Role changes
// - Failed login attempts
// - Configuration changes</code></pre>

                            <div class="decision-box">
                                <strong>SOC 2 Compliance Status</strong>
                                We've implemented the core security controls required for SOC 2 Type II certification:
                                <ul>
                                    <li>✅ <strong>Access Control</strong>: RBAC with role hierarchy</li>
                                    <li>✅ <strong>Encryption</strong>: AES-256 at rest, TLS 1.3 in transit, KMS for PII</li>
                                    <li>✅ <strong>Audit Logging</strong>: Comprehensive action tracking</li>
                                    <li>✅ <strong>Session Management</strong>: JWT with expiration</li>
                                    <li>✅ <strong>Failed Login Tracking</strong>: Rate limiting and alerting</li>
                                    <li>⏳ <strong>SSO (SAML 2.0)</strong>: Planned for Phase 2</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="vendor-connector">
                    <div class="accordion-header">
                        <div class="section-number">5</div>
                        <div class="section-title">
                            <h3>The Vendor Connector Layer</h3>
                            <p>Reaching MCT, Accounting systems, and Servicing platforms</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>LOS connectors solve the input problem: getting loan data into Coheus. Vendor connectors solve the output problem: using that loan data to enrich it with external services.</p>

                            <h3>Vendor Categories We Support</h3>
                            <table>
                                <tr>
                                    <th>Category</th>
                                    <th>Examples</th>
                                    <th>Integration Type</th>
                                </tr>
                                <tr>
                                    <td><strong>MCT</strong></td>
                                    <td>Mortgage Capital Trading</td>
                                    <td>Secondary market trading and pricing</td>
                                </tr>
                                <tr>
                                    <td><strong>Accounting</strong></td>
                                    <td>Financial systems</td>
                                    <td>Financial reporting and accounting services</td>
                                </tr>
                                <tr>
                                    <td><strong>Servicing</strong></td>
                                    <td>Servicing platforms</td>
                                    <td>Loan servicing and portfolio management</td>
                                </tr>
                                <tr>
                                    <td><strong>Appraisals</strong></td>
                                    <td>AMC platforms</td>
                                    <td>Order appraisals, track status</td>
                                </tr>
                                <tr>
                                    <td><strong>Compliance</strong></td>
                                    <td>Compliance platforms</td>
                                    <td>RESPA checks, TRID calculations, HMDA</td>
                                </tr>
                            </table>

                            <h3>The Economics (This is Important)</h3>
                            <p>A vendor building traditional integrations:</p>
                            <ul>
                                <li>Spends $20K-$75K per lender integration</li>
                                <li>Takes 6-12 months per integration</li>
                                <li>Maintains 50+ custom integrations</li>
                                <li>Every lender has unique bugs and quirks</li>
                                <li>Total cost for 50 lenders: $1M-$3.75M</li>
                            </ul>

                            <p>A vendor building with Coheus:</p>
                            <ul>
                                <li>Builds one integration (less than a day to a week, depending on the lender's 3rd party requirements)</li>
                                <li>Reaches 100+ Coheus lenders instantly</li>
                                <li>Maintains one integration</li>
                                <li>Coheus handles lender-specific issues</li>
                                <li>Total cost: One-time build cost</li>
                            </ul>

                            <div class="decision-box">
                                <strong>Win-Win Game Theory</strong>
                                Vendors win because they reach 100 lenders in 2-4 weeks instead of 2-4 years. Lenders win because they get all vendors instead of manually integrating each one. Coheus wins because we become essential infrastructure.
                            </div>

                            <h3>Generic Vendor Connector Pattern</h3>
                            <pre><code>interface VendorConnector {
  // Authenticate (OAuth, API key, etc.)
  authenticate(): Promise&lt;void&gt;;
  
  // Fetch data from vendor
  fetchData(request: VendorRequest): Promise&lt;VendorResponse&gt;;
  
  // Normalize vendor format
  transform(data: VendorResponse): UniversalVendorData;
}

// Example: Credit Bureau Integration
class ExperianConnector implements VendorConnector {
  async authenticate() {
    // OAuth 2.0 with Experian
    const token = await this.client.getAccessToken();
    this.client.setAuthHeader(\`Bearer \${token}\`);
  }

  async fetchData(borrower: BorrowerInfo) {
    // Pull credit report
    return await this.client.get('/credit-report', {
      ssn: borrower.ssn,
      firstName: borrower.firstName,
      lastName: borrower.lastName
    });
  }

  transform(response: ExperianResponse): CreditReport {
    return {
      creditScore: response.score,
      tradeLines: response.accounts,
      inquiries: response.inquiries
    };
  }
}</code></pre>

                            <h3>API Routes Pattern</h3>
                            <pre><code>/api/vendors/

MCT:
├── POST /mct/pricing
├── GET /mct/markets
└── POST /mct/trade

Accounting:
├── POST /accounting/reports
├── GET /accounting/financials
└── POST /accounting/reconcile

Servicing:
├── POST /servicing/portfolio
├── GET /servicing/loans
└── POST /servicing/transfer</code></pre>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="rag">
                    <div class="accordion-header">
                        <div class="section-number">6</div>
                        <div class="section-title">
                            <h3>RAG & Knowledge Base</h3>
                            <p>Teaching Ailethia about mortgage industry</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>Large Language Models are powerful but they hallucinate. Ask Claude about mortgage compliance regulations and you might get confidently stated wrong information.</p>

                            <p>Retrieval-Augmented Generation (RAG) fixes this: ground the AI's responses in your actual documents. Upload your compliance manuals, internal policies, recent regulatory updates—then Ailethia answers questions using your knowledge base, not its training data.</p>

                            <h3>The RAG Pipeline</h3>
                            <pre><code>User asks: "What documents do I need for a jumbo loan?"

Step 1: Embed the question
  → text-embedding-3-large (OpenAI)
  → 1536-dimensional vector

Step 2: Semantic search
  → Query Pinecone vector store
  → Find top 5 most relevant document chunks
  → Return with confidence scores

Step 3: Build context
  Source: compliance-manual.pdf
  "For jumbo loans (>$1M), lenders must collect:
   - Full 2 years tax returns
   - 3 months bank statements
   - Appraisal by certified appraiser"

Step 4: Inject into prompt
  "Use this context to answer the question..."

Step 5: Generate response
  → Call GPT-4o with context injected
  → Ailethia: "For jumbo loans, you'll need..."
  → Cite source: "See compliance-manual.pdf"</code></pre>

                            <h3>Document Processing Pipeline</h3>
                            <ol>
                                <li><strong>Upload:</strong> User uploads PDF, DOCX, or web link</li>
                                <li><strong>Extract:</strong> AWS Textract extracts text (handles scans, handwriting, tables)</li>
                                <li><strong>Normalize:</strong> Clean whitespace, merge short lines, remove junk</li>
                                <li><strong>Chunk:</strong> Split into 512-token chunks with 20% overlap</li>
                                <li><strong>Embed:</strong> Generate embeddings for each chunk</li>
                                <li><strong>Index:</strong> Store in Pinecone with metadata</li>
                            </ol>

                            <div class="decision-box">
                                <strong>Pinecone vs OpenSearch Serverless</strong>
                                Pinecone: Simpler setup, managed vector DB, ideal for SaaS. OpenSearch: Full AWS control, data residency, better for self-hosted. We support both.
                            </div>

                            <h3>Guardrails: Preventing Hallucination</h3>
                            <p>Just because we have documents doesn't mean the AI will cite them correctly. We implement multiple layers of safety:</p>
                            <ul>
                                <li><strong>Source Citation Required:</strong> If Ailethia can't cite a source, it doesn't answer</li>
                                <li><strong>Confidence Scoring:</strong> Only return results above 0.75 similarity</li>
                                <li><strong>PII Redaction:</strong> AWS Comprehend detects and redacts sensitive data before embedding</li>
                                <li><strong>Fact-Checking:</strong> Compare LLM output against source documents for accuracy</li>
                                <li><strong>User Feedback:</strong> "This answer was helpful/wrong" feeds back into quality metrics</li>
                            </ul>

                            <h3>Real-World Example</h3>
                            <p>Loan officer asks Ailethia: "Can I approve this DTI ratio of 52%?"</p>
                            <ul>
                                <li>RAG searches company's underwriting guidelines</li>
                                <li>Finds: "Maximum DTI 50% for conventional loans"</li>
                                <li>Ailethia: "No, your DTI ratio exceeds the 50% limit per your underwriting guidelines. See underwriting-manual.pdf section 3.2"</li>
                                <li>Loan officer can click to view the exact section</li>
                                <li>Zero ambiguity, zero hallucination</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="compute">
                    <div class="accordion-header">
                        <div class="section-number">7</div>
                        <div class="section-title">
                            <h3>Compute Architecture: EC2 for Stateful Services</h3>
                            <p>Why persistent connections require dedicated compute</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>Choosing the right compute layer depends on workload characteristics. For Coheus, we needed to support persistent connections and in-memory state management that are core to the platform.</p>

                            <h3>The Core Requirements</h3>
                            <p>Mortgage lending operations require real-time synchronization with LOS systems, continuous webhook processing from vendors, and maintaining active loan workflows that can span hours or days. Our platform needs persistent connections to LOS APIs that must stay alive for reliable data synchronization. Additionally, we maintain in-memory state for active loan processing sessions, real-time caching of loan data, and workflow orchestration that requires consistent, low-latency access.</p>

                            <div class="decision-box">
                                <strong>Economics of 24/7 Operations</strong>
                                For consistent mortgage lending traffic that runs around the clock, dedicated compute instances (with reserved pricing) are more economical than pay-per-execution models. Traditional on-call services have predictable, continuous usage patterns.
                            </div>

                            <h3>Our Hybrid Architecture</h3>
                            <p>We use EC2 for core services but leverage serverless for complementary workloads where it makes sense:</p>
                            <table>
                                <tr>
                                    <th>Workload Type</th>
                                    <th>Service</th>
                                    <th>Rationale</th>
                                </tr>
                                <tr>
                                    <td>Real-time API + WebSocket</td>
                                    <td>EC2 (Stateful)</td>
                                    <td>Persistent connections, low latency, in-memory state</td>
                                </tr>
                                <tr>
                                    <td>REST endpoints</td>
                                    <td>Serverless</td>
                                    <td>Stateless operations, API Gateway integration</td>
                                </tr>
                                <tr>
                                    <td>Scheduled sync jobs</td>
                                    <td>Serverless + SQS</td>
                                    <td>Event-driven, pay-per-use for periodic tasks</td>
                                </tr>
                                <tr>
                                    <td>Webhook handlers</td>
                                    <td>Serverless</td>
                                    <td>Vendor callbacks, async processing</td>
                                </tr>
                            </table>

                            <h3>EC2 Production Configuration</h3>
                            <pre><code>Instance Setup:
├── Type: t3.medium (2 vCPU, 4GB RAM) minimum
├── Auto Scaling: Min 2, Max 5 instances
├── Load Balancer: Application Load Balancer (ALB)
├── Health Checks: /health endpoint every 30s
└── Rolling Deployment: Zero-downtime updates

Cost Model (Annual):
├── 2 instances (reserved): ~$2,800
├── Data transfer: ~$1,200
└── Total: ~$4,000 (cost-effective for 24/7 operations)</code></pre>

                            <h3>Why This Matters</h3>
                            <p>When lenders are processing loans in real-time, they need consistent, responsive performance with sub-second API response times. When vendors are syncing thousands of loans overnight, they need reliable infrastructure that won't drop connections or lose data. EC2 gives us both: predictable performance for critical operations and reliable infrastructure for batch processing.</p>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="deployment">
                    <div class="accordion-header">
                        <div class="section-number">8</div>
                        <div class="section-title">
                            <h3>Deployment Models</h3>
                            <p>SaaS, self-hosted, and per-vendor AWS accounts</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>Coheus v2 is deployed on AWS with a modern, scalable architecture designed for high availability and security. Here's the actual production infrastructure we've built and deployed.</p>

                            <h3>Production Deployment: AWS Architecture</h3>

                            <h4>Frontend: S3 + CloudFront</h4>
                            <ul>
                                <li><strong>S3 Bucket</strong>: ailethia-frontend-1767135651</li>
                                <li><strong>CloudFront Distribution</strong>: E2X6I83M2HKMVB</li>
                                <li><strong>URL</strong>: https://d2wvs4i87rs881.cloudfront.net</li>
                                <li><strong>Features</strong>: Global CDN, automatic cache invalidation, SPA routing</li>
                                <li><strong>Performance</strong>: Sub-100ms response times globally</li>
                            </ul>

                            <h4>Backend: Elastic Beanstalk</h4>
                            <ul>
                                <li><strong>Environment</strong>: ailethia-backend-production</li>
                                <li><strong>Platform</strong>: Node.js 20 on Amazon Linux 2023</li>
                                <li><strong>Load Balancer</strong>: Application Load Balancer with SSL</li>
                                <li><strong>Auto Scaling</strong>: 1-4 instances based on CPU/memory</li>
                                <li><strong>Health Monitoring</strong>: Enhanced health reporting with CloudWatch</li>
                            </ul>

                            <h4>Database: RDS PostgreSQL</h4>
                            <ul>
                                <li><strong>Engine</strong>: PostgreSQL 15</li>
                                <li><strong>Instance</strong>: db.t3.micro (can scale up)</li>
                                <li><strong>Storage</strong>: 20GB SSD with auto-scaling</li>
                                <li><strong>Backups</strong>: Automated daily backups, 7-day retention</li>
                                <li><strong>Encryption</strong>: At-rest encryption enabled</li>
                            </ul>

                            <h4>Security & Compliance</h4>
                            <ul>
                                <li><strong>KMS</strong>: AWS Key Management Service for field-level encryption</li>
                                <li><strong>SSL/TLS</strong>: HTTPS everywhere (CloudFront + ALB)</li>
                                <li><strong>VPC</strong>: Private subnets for RDS, public for ALB</li>
                                <li><strong>IAM</strong>: Least-privilege access policies</li>
                            </ul>

                            <pre><code>// Deployment workflow
1. Build frontend: npm run build
2. Deploy to S3: aws s3 sync dist/ s3://bucket/
3. Invalidate CloudFront: aws cloudfront create-invalidation
4. Build backend: npm run build (TypeScript → JavaScript)
5. Package: zip dist/ node_modules/ package.json
6. Deploy to EB: aws elasticbeanstalk create-application-version
7. Update environment: aws elasticbeanstalk update-environment

// Zero-downtime deployment
- Elastic Beanstalk rolling updates
- Health checks before routing traffic
- Automatic rollback on failure</code></pre>

                            <div class="callout warning" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.15) 100%); border-left: 4px solid #3b82f6;">
                                <strong>🔄 Active Development Environment</strong>
                                <p style="margin: 0.5rem 0;">Development instance accessible at <a href="https://d2wvs4i87rs881.cloudfront.net" target="_blank" style="color: #0066ff; text-decoration: underline;">https://d2wvs4i87rs881.cloudfront.net</a></p>
                                <ul style="margin-top: 1rem;">
                                    <li>🔄 <strong>Frontend</strong>: Globally distributed via CloudFront CDN (staging environment)</li>
                                    <li>🔄 <strong>Backend</strong>: Elastic Beanstalk deployment with auto-scaling (under active development)</li>
                                    <li>🔄 <strong>Database</strong>: PostgreSQL 15 on RDS (development instance)</li>
                                    <li>🔄 <strong>User Management</strong>: Core CRUD operations implemented and being refined</li>
                                    <li>🔄 <strong>Admin Panel</strong>: 9 sections in various stages of completion</li>
                                    <li>🔄 <strong>Security</strong>: RBAC, KMS encryption, and audit logging frameworks being implemented</li>
                                    <li>🔄 <strong>Monitoring</strong>: CloudWatch integration and health checks being configured</li>
                                </ul>
                                <p style="margin-top: 1rem; padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-radius: 6px; font-weight: 500;">
                                    <strong>Development Phase:</strong> January 2026 | <strong>Status:</strong> Approaching Production Readiness | <strong>Target:</strong> Q1 2026 Production Launch
                                </p>
                                </div>

                            <h3>Deployment Models: Privacy-First Options</h3>
                            <p style="margin-bottom: 1.5rem; color: #64748b; font-size: 0.9375rem; line-height: 1.7;">Coheus respects lender data privacy. We do not host your data. Choose the deployment model that gives you complete control over your infrastructure and data.</p>
                            
                            <div class="feature-grid" style="margin-top: 1.5rem;">
                                <div class="feature-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 1.5rem;">
                                    <h4 style="color: white; margin-top: 0;"><span class="feature-icon">🏠</span> Option 1: On-Premise</h4>
                                    <p style="color: rgba(255,255,255,0.95); margin-bottom: 1rem;"><strong>Docker Compose</strong> for on-premises deployment. Maximum control, privacy, and compliance.</p>
                                    <ul style="margin: 0; padding-left: 1.2rem; line-height: 1.8; color: rgba(255,255,255,0.9);">
                                        <li>Complete infrastructure control</li>
                                        <li>Data never leaves your network</li>
                                        <li>Regulatory compliance flexibility</li>
                                        <li>Air-gapped deployment support</li>
                                        <li>Your data, your infrastructure</li>
                                    </ul>
                                </div>
                                <div class="feature-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 1.5rem;">
                                    <h4 style="color: white; margin-top: 0;"><span class="feature-icon">🏢</span> Option 2: Amazon AWS Private Per-Lender</h4>
                                    <p style="color: rgba(255,255,255,0.95); margin-bottom: 1rem;"><strong>Dedicated AWS account</strong> for each lender. Complete isolation, privacy, and cost transparency.</p>
                                    <ul style="margin: 0; padding-left: 1.2rem; line-height: 1.8; color: rgba(255,255,255,0.9);">
                                        <li>Each lender owns their AWS account</li>
                                        <li>Full data isolation & residency control</li>
                                        <li>Direct AWS billing—you pay AWS directly</li>
                                        <li>Custom infrastructure sizing</li>
                                        <li>Complete privacy—Coheus never hosts your data</li>
                                    </ul>
                                </div>
                                <div class="feature-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1.5rem;">
                                    <h4 style="color: white; margin-top: 0;"><span class="feature-icon">🔄</span> Option 3: Hybrid</h4>
                                    <p style="color: rgba(255,255,255,0.95); margin-bottom: 1rem;"><strong>Combine on-premise and AWS</strong> with real-time synchronization. Best of both worlds.</p>
                                    <ul style="margin: 0; padding-left: 1.2rem; line-height: 1.8; color: rgba(255,255,255,0.9);">
                                        <li>On-premise for sensitive data</li>
                                        <li>AWS for scalability & redundancy</li>
                                        <li>Real-time data synchronization</li>
                                        <li>Flexible architecture</li>
                                        <li>Maintain data control</li>
                                    </ul>
                            </div>
                        </div>

                            <h3 style="margin-top: 3rem;">Per-Lender AWS Deployment: Complete Privacy & Control</h3>
                            <p>Each lender gets their own dedicated AWS account with complete data ownership. Coheus never hosts your data—you maintain full control over your infrastructure and privacy.</p>

                            <div style="margin-top: 1.5rem; padding: 1.5rem; background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%); border-radius: 12px; border-left: 4px solid #6366f1;">
                                <h4 style="margin-top: 0; color: #6366f1;">How Per-Lender Deployment Works</h4>
                                
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 1rem;">
                                    <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">1️⃣ Account Provisioning</strong>
                                        <p style="margin: 0; font-size: 0.9rem; color: #64748b; line-height: 1.6;">Coheus calls AWS Organizations <code style="background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.85rem;">CreateAccount</code> API to provision a dedicated AWS account. Complete in 3-5 minutes. You receive admin credentials.</p>
                                    </div>
                                    <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">2️⃣ Infrastructure Deployment</strong>
                                        <p style="margin: 0; font-size: 0.9rem; color: #64748b; line-height: 1.6;">CloudFormation StackSets deploy VPC, EC2, RDS, S3, CloudFront, KMS, ALB, CloudWatch. Fully automated, 10-15 minutes. Zero manual configuration.</p>
                                    </div>
                                    <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">3️⃣ Direct AWS Billing</strong>
                                        <p style="margin: 0; font-size: 0.9rem; color: #64748b; line-height: 1.6;">AWS Consolidated Billing ensures you receive your own monthly invoice. We never see or handle your infrastructure costs. Complete transparency.</p>
                                    </div>
                                    <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">4️⃣ Coheus Management</strong>
                                        <p style="margin: 0; font-size: 0.9rem; color: #64748b; line-height: 1.6;">We push updates via StackSets. You retain full admin access, CloudTrail logs, and can audit all changes. No data access by Coheus.</p>
                                    </div>
                                    <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem;">5️⃣ Ongoing Management</strong>
                                        <p style="margin: 0; font-size: 0.9rem; color: #64748b; line-height: 1.6;">Automatic security patches, feature updates, and infrastructure improvements. Rolling deployments ensure zero downtime. You approve major changes.</p>
                                    </div>
                                </div>

                                <h4 style="margin-top: 1.5rem; color: #6366f1;">Benefits of Per-Lender Deployment</h4>
                                <ul style="margin-top: 0.5rem; line-height: 1.8;">
                                    <li><strong>Complete Data Privacy:</strong> Coheus never hosts your data. You own and control everything.</li>
                                    <li><strong>Cost Transparency:</strong> See exactly what you're paying for AWS services—you pay AWS directly</li>
                                    <li><strong>Data Isolation:</strong> Your data never touches other lenders' infrastructure</li>
                                    <li><strong>Regulatory Compliance:</strong> Meet strict data residency requirements</li>
                                    <li><strong>Custom Scaling:</strong> Size infrastructure to your exact needs</li>
                                    <li><strong>AWS Credits:</strong> Use your existing AWS credits and enterprise agreements</li>
                                    <li><strong>Audit Trail:</strong> Complete CloudTrail logs in your account</li>
                                </ul>

                                <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border-radius: 8px;">
                                    <strong style="color: #10b981;">💡 Estimated Monthly Cost per Lender (Paid Directly to AWS)</strong>
                                    <p style="margin: 0.5rem 0 0 0; font-size: 0.95rem;">
                                        Small lender (10-50 loans/month): <strong>$150-$300/month</strong><br>
                                        Medium lender (50-200 loans/month): <strong>$300-$800/month</strong><br>
                                        Large lender (200+ loans/month): <strong>$800-$2,000/month</strong><br>
                                        <em style="font-size: 0.85rem; color: #64748b;">You pay AWS directly. Coheus never sees or handles your infrastructure costs. Complete cost transparency.</em>
                                    </p>
                                </div>
                            </div>

                            <h3 style="margin-top: 3rem;">Automated AWS Provisioning Architecture</h3>
                            <p>Our per-lender AWS deployment uses <strong>AWS Organizations + CloudFormation StackSets</strong> to provide 100% automated infrastructure provisioning. From Stripe payment to live infrastructure in 15-25 minutes—with zero manual intervention.</p>

                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; margin: 2rem 0; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem;">
                                    <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    </div>
                                    <h4 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 600;">Key Benefits</h4>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem;">
                                    <div>
                                        <strong style="color: #10b981; display: block; margin-bottom: 0.5rem;">✓ 100% Automated</strong>
                                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b;">Stripe payment → Live infrastructure in 15-25 minutes</p>
                                    </div>
                                    <div>
                                        <strong style="color: #10b981; display: block; margin-bottom: 0.5rem;">✓ Lender Pays AWS Directly</strong>
                                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b;">Complete cost transparency, no markup</p>
                                    </div>
                                    <div>
                                        <strong style="color: #10b981; display: block; margin-bottom: 0.5rem;">✓ Zero Manual Work</strong>
                                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b;">No DevOps team required, fully automated</p>
                                    </div>
                                    <div>
                                        <strong style="color: #10b981; display: block; margin-bottom: 0.5rem;">✓ Enterprise-Grade</strong>
                                        <p style="margin: 0; font-size: 0.9375rem; color: #64748b;">AWS Organizations + CloudFormation StackSets</p>
                                    </div>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Payment-to-Provisioning Flow</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                                    <!-- Step 1 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                                                <line x1="1" y1="10" x2="23" y2="10"></line>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Stripe Payment Success</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">Lender completes payment for per-lender AWS deployment</p>
                                        </div>
                                        <div style="color: #cbd5e1; font-size: 1.5rem; flex-shrink: 0;">→</div>
                                    </div>

                                    <!-- Step 2 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Webhook Received</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">Backend receives Stripe webhook and validates payment</p>
                                        </div>
                                        <div style="color: #cbd5e1; font-size: 1.5rem; flex-shrink: 0;">→</div>
                                    </div>

                                    <!-- Step 3 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Create AWS Account</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">AWS Organizations API creates dedicated account (3-5 min)</p>
                                        </div>
                                        <div style="color: #cbd5e1; font-size: 1.5rem; flex-shrink: 0;">→</div>
                                    </div>

                                    <!-- Step 4 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Deploy CloudFormation StackSet</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">VPC, EC2, RDS, S3, CloudFront, KMS, ALB (10-15 min)</p>
                                        </div>
                                        <div style="color: #cbd5e1; font-size: 1.5rem; flex-shrink: 0;">→</div>
                                    </div>

                                    <!-- Step 5 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                <polyline points="7 10 12 15 17 10"></polyline>
                                                <line x1="12" y1="15" x2="12" y2="3"></line>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Infrastructure Provisioned</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">All AWS resources created and application deployed</p>
                                        </div>
                                        <div style="color: #cbd5e1; font-size: 1.5rem; flex-shrink: 0;">→</div>
                                    </div>

                                    <!-- Step 6 -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);">
                                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                                <polyline points="22,6 12,13 2,6"></polyline>
                                            </svg>
                                        </div>
                                        <div style="flex: 1;">
                                            <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 0.25rem;">Email Lender with Access</strong>
                                            <p style="margin: 0; color: #64748b; font-size: 0.9375rem;">Lender receives AWS console credentials and application URL</p>
                                        </div>
                                        <div style="color: #10b981; font-size: 1.5rem; flex-shrink: 0;">✓</div>
                                    </div>
                                </div>

                                <!-- Parallel Billing Track -->
                                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border-left: 4px solid #10b981;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <path d="M12 6v6l4 2"></path>
                                        </svg>
                                        <strong style="color: #10b981; font-size: 1.0625rem;">Parallel Track: AWS Bills Lender Directly</strong>
                                    </div>
                                    <p style="margin: 0; color: #064e3b; font-size: 0.9375rem;">While infrastructure is being provisioned, AWS automatically sets up billing to the lender's account. Lender receives monthly AWS invoices directly—no markup, complete transparency.</p>
                                </div>

                                <div style="margin-top: 1.5rem; text-align: center; padding: 1rem; background: rgba(99, 102, 241, 0.1); border-radius: 8px;">
                                    <strong style="color: #6366f1; font-size: 1.125rem;">Total Time: 15-25 minutes</strong>
                                    <p style="margin: 0.5rem 0 0 0; color: #64748b; font-size: 0.9375rem;">100% automated, zero manual intervention required</p>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Detailed Sequence Diagram</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); overflow-x: auto;">
                                <div style="min-width: 800px;">
                                    <!-- Participants -->
                                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 2rem; text-align: center;">
                                        <div>
                                            <div style="padding: 1rem; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border-radius: 12px; font-weight: 600; font-size: 0.9375rem; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">Lender</div>
                                        </div>
                                        <div>
                                            <div style="padding: 1rem; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border-radius: 12px; font-weight: 600; font-size: 0.9375rem; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">Stripe</div>
                                        </div>
                                        <div>
                                            <div style="padding: 1rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border-radius: 12px; font-weight: 600; font-size: 0.9375rem; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">Backend</div>
                                        </div>
                                        <div>
                                            <div style="padding: 1rem; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); color: white; border-radius: 12px; font-weight: 600; font-size: 0.9375rem; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);">AWS Orgs</div>
                                        </div>
                                        <div>
                                            <div style="padding: 1rem; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); color: white; border-radius: 12px; font-weight: 600; font-size: 0.9375rem; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);">Lender AWS</div>
                                        </div>
                                    </div>

                                    <!-- Sequence Steps -->
                                    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
                                        <!-- Step 1 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #6366f1; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">1</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(99, 102, 241, 0.1); border-radius: 8px; border-left: 3px solid #6366f1;">
                                                <strong style="color: #6366f1;">Lender → Stripe:</strong> <span style="color: #475569;">Complete payment for per-lender AWS deployment</span>
                                            </div>
                                        </div>

                                        <!-- Step 2 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">2</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px; border-left: 3px solid #3b82f6;">
                                                <strong style="color: #3b82f6;">Stripe → Backend:</strong> <span style="color: #475569;">Webhook: payment_succeeded with metadata</span>
                                            </div>
                                        </div>

                                        <!-- Step 3 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">3</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border-left: 3px solid #10b981;">
                                                <strong style="color: #10b981;">Backend → AWS Organizations:</strong> <span style="color: #475569;">CreateAccount API call</span>
                                            </div>
                                        </div>

                                        <!-- Step 4 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #a855f7; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">4</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(168, 85, 247, 0.1); border-radius: 8px; border-left: 3px solid #a855f7;">
                                                <strong style="color: #a855f7;">AWS Organizations → Lender AWS:</strong> <span style="color: #475569;">Provision new AWS account (3-5 min)</span>
                                            </div>
                                        </div>

                                        <!-- Step 5 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #a855f7; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">5</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(168, 85, 247, 0.1); border-radius: 8px; border-left: 3px solid #a855f7;">
                                                <strong style="color: #a855f7;">AWS Organizations → Backend:</strong> <span style="color: #475569;">Account ID & credentials returned</span>
                                            </div>
                                        </div>

                                        <!-- Step 6 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">6</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border-left: 3px solid #10b981;">
                                                <strong style="color: #10b981;">Backend → CloudFormation:</strong> <span style="color: #475569;">Deploy StackSet to new account</span>
                                            </div>
                                        </div>

                                        <!-- Step 7 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #ec4899; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">7</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(236, 72, 153, 0.1); border-radius: 8px; border-left: 3px solid #ec4899;">
                                                <strong style="color: #ec4899;">CloudFormation → Lender AWS:</strong> <span style="color: #475569;">Create VPC, EC2, RDS, S3, CloudFront, KMS, ALB (10-15 min)</span>
                                            </div>
                                        </div>

                                        <!-- Step 8 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #ec4899; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">8</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(236, 72, 153, 0.1); border-radius: 8px; border-left: 3px solid #ec4899;">
                                                <strong style="color: #ec4899;">CloudFormation → Backend:</strong> <span style="color: #475569;">Stack creation complete</span>
                                            </div>
                                        </div>

                                        <!-- Step 9 -->
                                        <div style="display: flex; align-items: center; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #0ea5e9; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">9</div>
                                            <div style="flex: 1; padding: 0.75rem 1rem; background: rgba(14, 165, 233, 0.1); border-radius: 8px; border-left: 3px solid #0ea5e9;">
                                                <strong style="color: #0ea5e9;">Backend → Lender:</strong> <span style="color: #475569;">Email with AWS console access & application URL</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Billing Note -->
                                    <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(245, 158, 11, 0.1); border-radius: 12px; border-left: 4px solid #f59e0b;">
                                        <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                            </svg>
                                            <strong style="color: #f59e0b; font-size: 1.0625rem;">Important: Direct AWS Billing</strong>
                                        </div>
                                        <p style="margin: 0; color: #92400e; font-size: 0.9375rem;">AWS automatically bills the lender directly for all infrastructure costs. Coheus never sees or handles these charges. Complete cost transparency with zero markup.</p>
                                    </div>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Why AWS Organizations?</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <p style="margin: 0 0 1.5rem 0; color: #475569; font-size: 1rem; line-height: 1.7;">AWS Organizations is Amazon's enterprise service for managing multiple AWS accounts. It's specifically designed for SaaS companies who need to provision dedicated infrastructure for each customer while maintaining centralized management.</p>

                                <!-- Account Structure Diagram -->
                                <div style="background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; margin: 1.5rem 0;">
                                    <div style="text-align: center; margin-bottom: 1.5rem;">
                                        <strong style="color: #0f172a; font-size: 1.0625rem;">Account Structure</strong>
                                    </div>
                                    
                                    <!-- Master Account -->
                                    <div style="text-align: center; margin-bottom: 1.5rem;">
                                        <div style="display: inline-block; padding: 1rem 2rem; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border-radius: 12px; font-weight: 600; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                                            Coheus Master Account
                                        </div>
                                        <div style="margin: 0.5rem 0; color: #64748b; font-size: 0.875rem;">Centralized management only</div>
                                    </div>

                                    <!-- Vertical Line -->
                                    <div style="width: 2px; height: 40px; background: #cbd5e1; margin: 0 auto;"></div>

                                    <!-- Lender Accounts -->
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                                        <div style="text-align: center;">
                                            <div style="padding: 1rem; background: white; border: 2px solid #10b981; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);">
                                                <div style="font-weight: 600; color: #0f172a; margin-bottom: 0.5rem;">Lender A Account</div>
                                                <div style="font-size: 0.875rem; color: #10b981; font-weight: 500;">Billed to Lender A</div>
                                            </div>
                                        </div>
                                        <div style="text-align: center;">
                                            <div style="padding: 1rem; background: white; border: 2px solid #3b82f6; border-radius: 12px; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);">
                                                <div style="font-weight: 600; color: #0f172a; margin-bottom: 0.5rem;">Lender B Account</div>
                                                <div style="font-size: 0.875rem; color: #3b82f6; font-weight: 500;">Billed to Lender B</div>
                                            </div>
                                        </div>
                                        <div style="text-align: center;">
                                            <div style="padding: 1rem; background: white; border: 2px solid #a855f7; border-radius: 12px; box-shadow: 0 2px 8px rgba(168, 85, 247, 0.2);">
                                                <div style="font-weight: 600; color: #0f172a; margin-bottom: 0.5rem;">Lender C Account</div>
                                                <div style="font-size: 0.875rem; color: #a855f7; font-weight: 500;">Billed to Lender C</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Key Benefits -->
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 2rem;">
                                    <div style="padding: 1.25rem; background: rgba(99, 102, 241, 0.1); border-radius: 12px; border-left: 3px solid #6366f1;">
                                        <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem; font-size: 1rem;">Automated Account Creation</strong>
                                        <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">API-driven account provisioning in 3-5 minutes. No manual setup required.</p>
                                    </div>
                                    <div style="padding: 1.25rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border-left: 3px solid #10b981;">
                                        <strong style="color: #10b981; display: block; margin-bottom: 0.5rem; font-size: 1rem;">Billing Separation</strong>
                                        <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Each lender receives their own AWS bill. Consolidated reporting but separate charges.</p>
                                    </div>
                                    <div style="padding: 1.25rem; background: rgba(168, 85, 247, 0.1); border-radius: 12px; border-left: 3px solid #a855f7;">
                                        <strong style="color: #a855f7; display: block; margin-bottom: 0.5rem; font-size: 1rem;">Security Boundaries</strong>
                                        <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Complete isolation at AWS account level. Lender A cannot access Lender B's resources.</p>
                                    </div>
                                    <div style="padding: 1.25rem; background: rgba(59, 130, 246, 0.1); border-radius: 12px; border-left: 3px solid #3b82f6;">
                                        <strong style="color: #3b82f6; display: block; margin-bottom: 0.5rem; font-size: 1rem;">Centralized Management</strong>
                                        <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Push updates to all accounts via StackSets. Lender retains full admin access.</p>
                                    </div>
                                </div>

                                <!-- Industry Validation -->
                                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(14, 165, 233, 0.1); border-radius: 12px; border-left: 4px solid #0ea5e9;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                            <circle cx="9" cy="7" r="4"></circle>
                                            <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                        </svg>
                                        <strong style="color: #0ea5e9; font-size: 1.0625rem;">Industry Standard</strong>
                                    </div>
                                    <p style="margin: 0; color: #0c4a6e; font-size: 0.9375rem; line-height: 1.7;">Major SaaS companies like <strong>Datadog</strong>, <strong>New Relic</strong>, and <strong>Snowflake</strong> use AWS Organizations for per-customer infrastructure. It's the proven approach for enterprise SaaS at scale.</p>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">CloudFormation StackSets: One-Click Infrastructure</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <p style="margin: 0 0 1.5rem 0; color: #475569; font-size: 1rem; line-height: 1.7;"><strong>CloudFormation</strong> is AWS's infrastructure-as-code service. <strong>StackSets</strong> extend this to deploy the same infrastructure across multiple AWS accounts simultaneously—perfect for our per-lender deployment model.</p>

                                <!-- Infrastructure Diagram -->
                                <div style="background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; margin: 1.5rem 0;">
                                    <div style="text-align: center; margin-bottom: 1.5rem;">
                                        <strong style="color: #0f172a; font-size: 1.0625rem;">What Gets Provisioned</strong>
                                    </div>
                                    
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                                        <!-- VPC -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #6366f1; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                        <line x1="9" y1="3" x2="9" y2="21"></line>
                                                    </svg>
                                                </div>
                                                <strong style="color: #6366f1; font-size: 0.9375rem;">VPC</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Private network with subnets</p>
                                        </div>

                                        <!-- EC2/ECS -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #10b981; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                                    </svg>
                                                </div>
                                                <strong style="color: #10b981; font-size: 0.9375rem;">EC2/ECS</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Compute instances</p>
                                        </div>

                                        <!-- RDS -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #3b82f6; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                                                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                                                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                                                    </svg>
                                                </div>
                                                <strong style="color: #3b82f6; font-size: 0.9375rem;">RDS</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">PostgreSQL database</p>
                                        </div>

                                        <!-- S3 -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #a855f7; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                                    </svg>
                                                </div>
                                                <strong style="color: #a855f7; font-size: 0.9375rem;">S3</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Object storage</p>
                                        </div>

                                        <!-- CloudFront -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #ec4899; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <circle cx="12" cy="12" r="10"></circle>
                                                        <circle cx="12" cy="12" r="6"></circle>
                                                        <circle cx="12" cy="12" r="2"></circle>
                                                    </svg>
                                                </div>
                                                <strong style="color: #ec4899; font-size: 0.9375rem;">CloudFront</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Global CDN</p>
                                        </div>

                                        <!-- KMS -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #f59e0b; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                                                    </svg>
                                                </div>
                                                <strong style="color: #f59e0b; font-size: 0.9375rem;">KMS</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Encryption keys</p>
                                        </div>

                                        <!-- ALB -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #0ea5e9; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <line x1="12" y1="2" x2="12" y2="6"></line>
                                                        <line x1="12" y1="18" x2="12" y2="22"></line>
                                                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                                                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                                                        <line x1="2" y1="12" x2="6" y2="12"></line>
                                                        <line x1="18" y1="12" x2="22" y2="12"></line>
                                                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                                                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                                                    </svg>
                                                </div>
                                                <strong style="color: #0ea5e9; font-size: 0.9375rem;">ALB</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Load balancer</p>
                                        </div>

                                        <!-- CloudWatch -->
                                        <div style="padding: 1rem; background: white; border: 2px solid #14b8a6; border-radius: 12px;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                                    </svg>
                                                </div>
                                                <strong style="color: #14b8a6; font-size: 0.9375rem;">CloudWatch</strong>
                                            </div>
                                            <p style="margin: 0; color: #64748b; font-size: 0.875rem;">Monitoring & logs</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- How Updates Work -->
                                <div style="margin-top: 2rem;">
                                    <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 1rem;">How Updates Work</strong>
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem;">
                                        <div style="padding: 1.25rem; background: rgba(99, 102, 241, 0.1); border-radius: 12px; border-left: 3px solid #6366f1;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 28px; height: 28px; background: #6366f1; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem;">1</div>
                                                <strong style="color: #6366f1; font-size: 0.9375rem;">Update Template</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">Modify CloudFormation template with new infrastructure changes</p>
                                        </div>
                                        <div style="padding: 1.25rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border-left: 3px solid #10b981;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 28px; height: 28px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem;">2</div>
                                                <strong style="color: #10b981; font-size: 0.9375rem;">Deploy StackSet</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">Push update to all lender accounts simultaneously</p>
                                        </div>
                                        <div style="padding: 1.25rem; background: rgba(59, 130, 246, 0.1); border-radius: 12px; border-left: 3px solid #3b82f6;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
                                                <div style="width: 28px; height: 28px; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem;">3</div>
                                                <strong style="color: #3b82f6; font-size: 0.9375rem;">Zero Downtime</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">Rolling updates ensure continuous availability</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- Deployment Time -->
                                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(168, 85, 247, 0.1); border-radius: 12px; border-left: 4px solid #a855f7;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <polyline points="12 6 12 12 16 14"></polyline>
                                        </svg>
                                        <strong style="color: #a855f7; font-size: 1.0625rem;">Deployment Timeline</strong>
                                    </div>
                                    <p style="margin: 0; color: #581c87; font-size: 0.9375rem; line-height: 1.7;"><strong>Initial deployment:</strong> 10-15 minutes to create all resources<br><strong>Updates:</strong> 5-10 minutes depending on scope<br><strong>Rollback:</strong> Automatic if deployment fails</p>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Cost Transparency: Traditional SaaS vs. Per-Lender AWS</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <p style="margin: 0 0 1.5rem 0; color: #475569; font-size: 1rem; line-height: 1.7;">Most SaaS platforms hide infrastructure costs in their pricing. We believe in complete transparency—you should know exactly what you're paying for.</p>

                                <!-- Comparison Table -->
                                <div style="overflow-x: auto;">
                                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9375rem;">
                                        <thead>
                                            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                                                <th style="padding: 1rem; text-align: left; font-weight: 600; color: #0f172a;">Feature</th>
                                                <th style="padding: 1rem; text-align: left; font-weight: 600; color: #0f172a;">Traditional SaaS</th>
                                                <th style="padding: 1rem; text-align: left; font-weight: 600; color: #10b981;">Per-Lender AWS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Infrastructure Costs</td>
                                                <td style="padding: 1rem; color: #64748b;">Hidden in subscription price</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Direct AWS bill, itemized</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Markup</td>
                                                <td style="padding: 1rem; color: #64748b;">2-5x typical markup</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Zero markup</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Cost Visibility</td>
                                                <td style="padding: 1rem; color: #64748b;">Opaque pricing</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">AWS Cost Explorer access</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Billing Control</td>
                                                <td style="padding: 1rem; color: #64748b;">Pay vendor monthly</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Pay AWS directly</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">AWS Credits</td>
                                                <td style="padding: 1rem; color: #64748b;">Cannot use</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Use your own credits</td>
                                            </tr>
                                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Data Isolation</td>
                                                <td style="padding: 1rem; color: #64748b;">Shared infrastructure</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Dedicated AWS account</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 1rem; font-weight: 500; color: #475569;">Audit Trail</td>
                                                <td style="padding: 1rem; color: #64748b;">Vendor-controlled logs</td>
                                                <td style="padding: 1rem; color: #10b981; font-weight: 500;">Your own CloudTrail logs</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                <!-- AWS Cost Explorer -->
                                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(99, 102, 241, 0.1); border-radius: 12px; border-left: 4px solid #6366f1;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <line x1="12" y1="1" x2="12" y2="23"></line>
                                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                        </svg>
                                        <strong style="color: #6366f1; font-size: 1.0625rem;">AWS Cost Explorer Access</strong>
                                    </div>
                                    <p style="margin: 0; color: #3730a3; font-size: 0.9375rem; line-height: 1.7;">With your own AWS account, you get full access to AWS Cost Explorer. See real-time costs broken down by service (EC2, RDS, S3, etc.), set up budget alerts, analyze trends, and export detailed reports. Complete visibility into every dollar spent.</p>
                                </div>

                                <!-- No Markup Guarantee -->
                                <div style="margin-top: 1.5rem; padding: 1.5rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border-left: 4px solid #10b981;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                        </svg>
                                        <strong style="color: #10b981; font-size: 1.0625rem;">Our Guarantee: Zero Markup</strong>
                                    </div>
                                    <p style="margin: 0; color: #064e3b; font-size: 0.9375rem; line-height: 1.7;">We charge for software licensing and support—not infrastructure. Your AWS bill comes directly from Amazon. We never see it, touch it, or mark it up. What you pay AWS is what you pay AWS. Period.</p>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Alternative: Bring Your Own AWS Account</h4>
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem 2rem; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <p style="margin: 0 0 1.5rem 0; color: #475569; font-size: 1rem; line-height: 1.7;">If you already have an AWS account and prefer not to use AWS Organizations, we support a <strong>cross-account IAM role</strong> approach. You deploy infrastructure in your existing account, and we manage it via assumed roles.</p>

                                <!-- How It Works -->
                                <div style="background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 2rem; margin: 1.5rem 0;">
                                    <strong style="color: #0f172a; font-size: 1.0625rem; display: block; margin-bottom: 1.25rem;">How It Works</strong>
                                    
                                    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
                                        <div style="display: flex; align-items: start; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #6366f1; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">1</div>
                                            <div>
                                                <strong style="color: #0f172a; display: block; margin-bottom: 0.25rem;">Provide AWS Account ID</strong>
                                                <p style="margin: 0; color: #64748b; font-size: 0.9375rem; line-height: 1.6;">During signup, provide your existing AWS account ID</p>
                                            </div>
                                        </div>
                                        <div style="display: flex; align-items: start; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">2</div>
                                            <div>
                                                <strong style="color: #0f172a; display: block; margin-bottom: 0.25rem;">Create IAM Role</strong>
                                                <p style="margin: 0; color: #64748b; font-size: 0.9375rem; line-height: 1.6;">We provide a CloudFormation template that creates a cross-account IAM role with minimal permissions</p>
                                            </div>
                                        </div>
                                        <div style="display: flex; align-items: start; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">3</div>
                                            <div>
                                                <strong style="color: #0f172a; display: block; margin-bottom: 0.25rem;">Deploy Infrastructure</strong>
                                                <p style="margin: 0; color: #64748b; font-size: 0.9375rem; line-height: 1.6;">Coheus assumes the role and deploys CloudFormation stack in your account</p>
                                            </div>
                                        </div>
                                        <div style="display: flex; align-items: start; gap: 1rem;">
                                            <div style="width: 32px; height: 32px; background: #a855f7; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.875rem; flex-shrink: 0;">4</div>
                                            <div>
                                                <strong style="color: #0f172a; display: block; margin-bottom: 0.25rem;">You Pay AWS Directly</strong>
                                                <p style="margin: 0; color: #64748b; font-size: 0.9375rem; line-height: 1.6;">All infrastructure costs appear on your existing AWS bill</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Pros/Cons Comparison -->
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 2rem;">
                                    <div>
                                        <div style="padding: 1.25rem; background: rgba(16, 185, 129, 0.1); border-radius: 12px; border-left: 3px solid #10b981;">
                                            <strong style="color: #10b981; display: block; margin-bottom: 0.75rem; font-size: 1rem;">Pros</strong>
                                            <ul style="margin: 0; padding-left: 1.25rem; color: #475569; font-size: 0.9375rem; line-height: 1.7;">
                                                <li>Use existing AWS account</li>
                                                <li>No new account setup</li>
                                                <li>Works with existing AWS credits</li>
                                                <li>Familiar billing structure</li>
                                            </ul>
                                        </div>
                                    </div>
                                    <div>
                                        <div style="padding: 1.25rem; background: rgba(239, 68, 68, 0.1); border-radius: 12px; border-left: 3px solid #ef4444;">
                                            <strong style="color: #ef4444; display: block; margin-bottom: 0.75rem; font-size: 1rem;">Cons</strong>
                                            <ul style="margin: 0; padding-left: 1.25rem; color: #475569; font-size: 0.9375rem; line-height: 1.7;">
                                                <li>Manual IAM role setup required</li>
                                                <li>Less isolation (shared account)</li>
                                                <li>More complex troubleshooting</li>
                                                <li>Requires AWS expertise</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                <!-- Recommendation -->
                                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(59, 130, 246, 0.1); border-radius: 12px; border-left: 4px solid #3b82f6;">
                                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="16" x2="12" y2="12"></line>
                                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                        </svg>
                                        <strong style="color: #3b82f6; font-size: 1.0625rem;">Our Recommendation</strong>
                                    </div>
                                    <p style="margin: 0; color: #1e40af; font-size: 0.9375rem; line-height: 1.7;">We recommend <strong>AWS Organizations</strong> for new deployments. It's fully automated, provides better isolation, and is easier to manage. Use the cross-account approach only if you have specific requirements to use an existing AWS account.</p>
                                </div>
                            </div>

                            <h4 style="margin-top: 2.5rem; margin-bottom: 1.5rem;">Technical Implementation Details</h4>
                            <details style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 0; border-radius: 16px; margin-bottom: 2rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); overflow: hidden;">
                                <summary style="padding: 1.5rem 2rem; cursor: pointer; font-weight: 600; font-size: 1.0625rem; color: #0f172a; list-style: none; display: flex; align-items: center; gap: 1rem; user-select: none;">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s;">
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                    <span>View Implementation Code & API Calls</span>
                                    <span style="margin-left: auto; font-size: 0.875rem; color: #64748b; font-weight: 400;">(Click to expand)</span>
                                </summary>
                                <div style="padding: 0 2rem 2rem 2rem;">
                                    <!-- Stripe Webhook Handler -->
                                    <div style="margin-bottom: 2rem;">
                                        <strong style="color: #0f172a; display: block; margin-bottom: 0.75rem; font-size: 1rem;">1. Stripe Webhook Handler</strong>
                                        <pre style="background: #1e293b; color: #e2e8f0; padding: 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; line-height: 1.6; margin: 0;"><code>// server/src/routes/subscriptions.ts
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenant_id;
  const planId = session.metadata?.plan_id;
  const deploymentType = session.metadata?.deployment_type;

  if (deploymentType === 'per_lender_aws') {
    // Trigger AWS account provisioning
    await provisionAWSAccount(tenantId, planId);
  }
}</code></pre>
                                    </div>

                                    <!-- AWS Organizations API -->
                                    <div style="margin-bottom: 2rem;">
                                        <strong style="color: #0f172a; display: block; margin-bottom: 0.75rem; font-size: 1rem;">2. AWS Organizations Account Creation</strong>
                                        <pre style="background: #1e293b; color: #e2e8f0; padding: 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; line-height: 1.6; margin: 0;"><code>// server/src/services/awsProvisioning.ts
import { Organizations } from '@aws-sdk/client-organizations';

async function createAWSAccount(lenderName: string, email: string) {
  const orgs = new Organizations({ region: 'us-east-1' });
  
  const response = await orgs.createAccount({
    AccountName: \`Coheus-\${lenderName}\`,
    Email: email,
    RoleName: 'CoheusMasterRole'
  });

  // Wait for account creation (3-5 minutes)
  const accountId = await waitForAccountCreation(response.CreateAccountRequestId);
  
  return accountId;
}</code></pre>
                                    </div>

                                    <!-- CloudFormation StackSet Deployment -->
                                    <div style="margin-bottom: 2rem;">
                                        <strong style="color: #0f172a; display: block; margin-bottom: 0.75rem; font-size: 1rem;">3. CloudFormation StackSet Deployment</strong>
                                        <pre style="background: #1e293b; color: #e2e8f0; padding: 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; line-height: 1.6; margin: 0;"><code>// server/src/services/awsProvisioning.ts
import { CloudFormation } from '@aws-sdk/client-cloudformation';

async function deployInfrastructure(accountId: string, tenantId: string) {
  const cfn = new CloudFormation({ region: 'us-east-1' });
  
  await cfn.createStackInstances({
    StackSetName: 'CoheusPlatformStack',
    Accounts: [accountId],
    Regions: ['us-east-1'],
    ParameterOverrides: [
      { ParameterKey: 'TenantId', ParameterValue: tenantId },
      { ParameterKey: 'Environment', ParameterValue: 'production' }
    ]
  });

  // Monitor stack creation (10-15 minutes)
  await waitForStackCompletion(accountId);
}</code></pre>
                                    </div>

                                    <!-- Database Schema -->
                                    <div style="margin-bottom: 2rem;">
                                        <strong style="color: #0f172a; display: block; margin-bottom: 0.75rem; font-size: 1rem;">4. Database Schema for Tracking</strong>
                                        <pre style="background: #1e293b; color: #e2e8f0; padding: 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; line-height: 1.6; margin: 0;"><code>-- supabase/migrations/aws_deployments.sql
CREATE TABLE aws_deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  aws_account_id VARCHAR(12) NOT NULL,
  stack_id VARCHAR(255),
  status VARCHAR(50) NOT NULL, -- provisioning, active, failed
  infrastructure_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id),
  UNIQUE(aws_account_id)
);</code></pre>
                                    </div>

                                    <!-- Monitoring & Health Checks -->
                                    <div>
                                        <strong style="color: #0f172a; display: block; margin-bottom: 0.75rem; font-size: 1rem;">5. Monitoring & Health Checks</strong>
                                        <pre style="background: #1e293b; color: #e2e8f0; padding: 1.25rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; line-height: 1.6; margin: 0;"><code>// server/src/services/monitoring.ts
async function checkDeploymentHealth(accountId: string) {
  const cfn = new CloudFormation({ region: 'us-east-1' });
  
  const stacks = await cfn.describeStackInstances({
    StackSetName: 'CoheusPlatformStack',
    StackInstanceAccount: accountId
  });

  const health = {
    status: stacks.Summaries[0].Status,
    lastUpdated: stacks.Summaries[0].LastDriftCheckTimestamp,
    resources: await getResourceHealth(accountId)
  };

  return health;
}</code></pre>
                                    </div>
                                </div>
                            </details>

                            <div class="decision-box" style="margin-top: 2rem; background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 146, 60, 0.1) 100%); border-left: 4px solid #f59e0b;">
                                <strong>🎯 Choosing the Right Deployment Model</strong>
                                <ul style="margin-top: 0.5rem;">
                                    <li><strong>On-Premise:</strong> Best for lenders with strict data privacy requirements, regulatory compliance needs, or air-gapped environments</li>
                                    <li><strong>Amazon AWS Private Per-Lender:</strong> Ideal for lenders requiring cloud scalability with complete data isolation, privacy, and direct AWS billing</li>
                                    <li><strong>Hybrid:</strong> Perfect for lenders who want on-premise control for sensitive data with AWS scalability for other workloads</li>
                                </ul>
                                <div style="margin-top: 1rem; padding: 1rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px; border-left: 3px solid #3b82f6;">
                                    <strong style="color: #3b82f6; display: block; margin-bottom: 0.5rem;">🔒 Privacy-First Approach</strong>
                                    <p style="margin: 0; font-size: 0.9375rem; color: #475569; line-height: 1.7;">Coheus respects your data privacy. We do not host your data. All deployment options ensure you maintain complete ownership and control of your infrastructure and data. All deployment models run the same codebase and receive the same features and updates.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="onboarding">
                    <div class="accordion-header">
                        <div class="section-number">9</div>
                        <div class="section-title">
                            <h3>Onboarding: Fast & Automated</h3>
                            <p>Deployment-model-aware timelines</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p>Coheus is complex. The onboarding can't be. Our onboarding time depends on your deployment model—but all options are significantly faster than industry standards.</p>

                            <h3>Deployment Model Timelines</h3>
                            
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">
                                <!-- On-Premise -->
                                <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(79, 172, 254, 0.1) 0%, rgba(0, 242, 254, 0.1) 100%); border: 2px solid #4facfe; border-radius: 12px;">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4facfe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                                        </svg>
                                        <strong style="color: #4facfe; font-size: 1.125rem;">Option 1: On-Premise</strong>
                                    </div>
                                    <div style="font-size: 2rem; font-weight: 700; color: #4facfe; margin-bottom: 0.5rem;">1-2 weeks</div>
                                    <p style="margin: 0; color: #0c4a6e; font-size: 0.9375rem; line-height: 1.6;">You control the timeline. Deploy on your schedule with Docker Compose or Kubernetes. Your data never leaves your network.</p>
                                </div>

                                <!-- Per-Lender AWS -->
                                <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.1) 100%); border: 2px solid #3b82f6; border-radius: 12px;">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                        </svg>
                                        <strong style="color: #3b82f6; font-size: 1.125rem;">Option 2: Amazon AWS Private</strong>
                                    </div>
                                    <div style="font-size: 2rem; font-weight: 700; color: #3b82f6; margin-bottom: 0.5rem;">45-55 min</div>
                                    <p style="margin: 0 0 0.75rem 0; color: #1e40af; font-size: 0.9375rem; line-height: 1.6;">15-25 min: Automated infrastructure provisioning</p>
                                    <p style="margin: 0; color: #1e40af; font-size: 0.9375rem; line-height: 1.6;">30 min: Application onboarding</p>
                                    <div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(59, 130, 246, 0.15); border-radius: 6px; font-size: 0.875rem; color: #1e40af;">
                                        🔒 Your own AWS account—complete privacy & control
                                    </div>
                                </div>

                                <!-- Hybrid -->
                                <div style="padding: 1.5rem; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); border: 2px solid #667eea; border-radius: 12px;">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                        </svg>
                                        <strong style="color: #667eea; font-size: 1.125rem;">Option 3: Hybrid</strong>
                                    </div>
                                    <div style="font-size: 2rem; font-weight: 700; color: #667eea; margin-bottom: 0.5rem;">1-2 weeks</div>
                                    <p style="margin: 0; color: #3730a3; font-size: 0.9375rem; line-height: 1.6;">Combine on-premise for sensitive data with AWS for scalability. Real-time synchronization between environments.</p>
                                </div>
                            </div>

                            <div style="margin: 2rem 0; padding: 1.5rem; background: rgba(245, 158, 11, 0.1); border-radius: 12px; border-left: 4px solid #f59e0b;">
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                    </svg>
                                    <strong style="color: #f59e0b; font-size: 1.0625rem;">Why This Matters</strong>
                                </div>
                                <p style="margin: 0; color: #92400e; font-size: 0.9375rem; line-height: 1.7;">Most competitors take <strong>weeks or months</strong> for dedicated infrastructure deployment. We're production-ready in <strong>under an hour</strong> for AWS deployments (45-55 minutes automated provisioning). That's 10-100x faster than traditional enterprise software deployment. Plus, you maintain complete data privacy—Coheus never hosts your data.</p>
                            </div>

                            <h3 style="margin-top: 3rem; margin-bottom: 1.5rem;">Automated SaaS Flow: Stripe → AWS Provisioning</h3>
                            <p style="margin-bottom: 1.5rem;">For Per-Lender AWS deployments, we've built a fully automated flow from payment to live infrastructure. No manual intervention required.</p>

                            <!-- SaaS Flow Diagram -->
                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem; border-radius: 16px; margin: 2rem 0; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <div style="text-align: center; margin-bottom: 2rem;">
                                    <h4 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 600;">End-to-End SaaS Flow</h4>
                                    <p style="margin: 0.5rem 0 0 0; color: #64748b; font-size: 0.9375rem;">From landing page to live infrastructure in 15-25 minutes</p>
                                </div>

                                <!-- Flow Diagram -->
                                <div style="position: relative; padding: 2rem 0;">
                                    <!-- Step 1: Landing Page -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
                                        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                <line x1="3" y1="9" x2="21" y2="9"></line>
                                                <line x1="9" y1="21" x2="9" y2="9"></line>
                                            </svg>
                                        </div>
                                        <div style="flex: 1; padding: 1.25rem; background: rgba(99, 102, 241, 0.05); border-radius: 12px; border-left: 3px solid #6366f1;">
                                            <strong style="color: #6366f1; display: block; margin-bottom: 0.5rem; font-size: 1rem;">1. Landing Page & Pricing</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Lender views pricing plans, selects deployment type (On-Premise, Amazon AWS Private Per-Lender, or Hybrid), clicks "Get Started"</p>
                                        </div>
                                    </div>

                                    <!-- Arrow -->
                                    <div style="text-align: center; margin: -0.5rem 0; color: #cbd5e1; font-size: 1.5rem;">↓</div>

                                    <!-- Step 2: Stripe Checkout -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
                                        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #635bff 0%, #0a2540 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 91, 255, 0.3);">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                            </svg>
                                        </div>
                                        <div style="flex: 1; padding: 1.25rem; background: rgba(99, 91, 255, 0.05); border-radius: 12px; border-left: 3px solid #635bff;">
                                            <strong style="color: #635bff; display: block; margin-bottom: 0.5rem; font-size: 1rem;">2. Stripe Checkout</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Secure payment processing. Metadata includes: lender name, email, plan ID, deployment type</p>
                                        </div>
                                    </div>

                                    <!-- Arrow -->
                                    <div style="text-align: center; margin: -0.5rem 0; color: #cbd5e1; font-size: 1.5rem;">↓</div>

                                    <!-- Step 3: Webhook -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem;">
                                        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                            </svg>
                                        </div>
                                        <div style="flex: 1; padding: 1.25rem; background: rgba(16, 185, 129, 0.05); border-radius: 12px; border-left: 3px solid #10b981;">
                                            <strong style="color: #10b981; display: block; margin-bottom: 0.5rem; font-size: 1rem;">3. Webhook Handler</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Backend receives <code style="background: rgba(16, 185, 129, 0.1); padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.85rem;">checkout.session.completed</code>. Creates tenant, subscription record, triggers AWS provisioning</p>
                                        </div>
                                    </div>

                                    <!-- Arrow -->
                                    <div style="text-align: center; margin: -0.5rem 0; color: #cbd5e1; font-size: 1.5rem;">↓</div>

                                    <!-- Step 4: AWS Provisioning -->
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                                        <!-- AWS Account -->
                                        <div style="padding: 1.25rem; background: rgba(59, 130, 246, 0.05); border-radius: 12px; border-left: 3px solid #3b82f6;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                                    </svg>
                                                </div>
                                                <strong style="color: #3b82f6; font-size: 0.9375rem;">4a. AWS Account</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">AWS Organizations creates dedicated account (3-5 min)</p>
                                        </div>

                                        <!-- StackSet -->
                                        <div style="padding: 1.25rem; background: rgba(168, 85, 247, 0.05); border-radius: 12px; border-left: 3px solid #a855f7;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                                        <line x1="3" y1="9" x2="21" y2="9"></line>
                                                        <line x1="9" y1="21" x2="9" y2="9"></line>
                                                    </svg>
                                                </div>
                                                <strong style="color: #a855f7; font-size: 0.9375rem;">4b. StackSet</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">CloudFormation deploys infrastructure (10-15 min)</p>
                                        </div>

                                        <!-- Admin User -->
                                        <div style="padding: 1.25rem; background: rgba(236, 72, 153, 0.05); border-radius: 12px; border-left: 3px solid #ec4899;">
                                            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                                                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                                        <circle cx="12" cy="7" r="4"></circle>
                                                    </svg>
                                                </div>
                                                <strong style="color: #ec4899; font-size: 0.9375rem;">4c. Admin Setup</strong>
                                            </div>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.6;">Creates admin user, generates credentials (2 min)</p>
                                        </div>
                                    </div>

                                    <!-- Arrow -->
                                    <div style="text-align: center; margin: -0.5rem 0; color: #cbd5e1; font-size: 1.5rem;">↓</div>

                                    <!-- Step 5: Success Page & Email -->
                                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                                        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                            </svg>
                                        </div>
                                        <div style="flex: 1; padding: 1.25rem; background: rgba(245, 158, 11, 0.05); border-radius: 12px; border-left: 3px solid #f59e0b;">
                                            <strong style="color: #f59e0b; display: block; margin-bottom: 0.5rem; font-size: 1rem;">5. Success Page & Email</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.9375rem; line-height: 1.6;">Lender redirected to success page with real-time progress. Admin credentials sent via email. Ready to access admin panel.</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- Key Features -->
                                <div style="margin-top: 2.5rem; padding-top: 2rem; border-top: 1px solid #e2e8f0;">
                                    <h4 style="margin: 0 0 1rem 0; color: #0f172a; font-size: 1.0625rem;">Key Features</h4>
                                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                                        <div style="padding: 1rem; background: rgba(16, 185, 129, 0.05); border-radius: 8px;">
                                            <strong style="color: #10b981; display: block; margin-bottom: 0.25rem; font-size: 0.9375rem;">✓ Fully Automated</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.5;">Zero manual intervention from payment to live infrastructure</p>
                                        </div>
                                        <div style="padding: 1rem; background: rgba(59, 130, 246, 0.05); border-radius: 8px;">
                                            <strong style="color: #3b82f6; display: block; margin-bottom: 0.25rem; font-size: 0.9375rem;">✓ Real-time Progress</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.5;">Success page shows live provisioning status with progress bar</p>
                                        </div>
                                        <div style="padding: 1rem; background: rgba(168, 85, 247, 0.05); border-radius: 8px;">
                                            <strong style="color: #a855f7; display: block; margin-bottom: 0.25rem; font-size: 0.9375rem;">✓ Error Handling</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.5;">Retry logic, timeout protection, email notifications on failure</p>
                                        </div>
                                        <div style="padding: 1rem; background: rgba(236, 72, 153, 0.05); border-radius: 8px;">
                                            <strong style="color: #ec4899; display: block; margin-bottom: 0.25rem; font-size: 0.9375rem;">✓ Direct AWS Billing</strong>
                                            <p style="margin: 0; color: #475569; font-size: 0.875rem; line-height: 1.5;">Lender pays AWS directly—complete cost transparency</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <h3>Application Onboarding (30 Minutes)</h3>
                            <p style="margin-bottom: 1.5rem;">Once infrastructure is ready (on-premise deployed, AWS account provisioned, or hybrid configured), the application onboarding is identical across all deployment models:</p>

                            <div class="timeline">
                                <div class="timeline-item">
                                    <div class="timeline-date">5 minutes</div>
                                    <div class="timeline-content">
                                        <strong>Account Setup</strong>
                                        <p>Sign up, email verification, create workspace. Simple form, move fast.</p>
                                    </div>
                                </div>

                                <div class="timeline-item">
                                    <div class="timeline-date">8 minutes</div>
                                    <div class="timeline-content">
                                        <strong>LOS Configuration</strong>
                                        <p>Select LOS system, paste API credentials, click "Test Connection." We tell them immediately if it works.</p>
                                    </div>
                                </div>

                                <div class="timeline-item">
                                    <div class="timeline-date">5 minutes</div>
                                    <div class="timeline-content">
                                        <strong>Instant Sync</strong>
                                        <p>First data pull happens automatically. See real loans in Coheus. Real-time feedback that it's working.</p>
                                    </div>
                                </div>

                                <div class="timeline-item">
                                    <div class="timeline-date">7 minutes</div>
                                    <div class="timeline-content">
                                        <strong>Vendor Activation</strong>
                                        <p>Toggle vendors on/off based on what they use. Credit bureau checks, title searches, whatever they need.</p>
                                    </div>
                                </div>

                                <div class="timeline-item">
                                    <div class="timeline-date">5 minutes</div>
                                    <div class="timeline-content">
                                        <strong>Team Invites</strong>
                                        <p>Invite team members, assign roles (loan officer, manager, executive). They get email links and are productive immediately.</p>
                                    </div>
                                </div>
                            </div>

                            <h3>Video Training (Optional but Encouraged)</h3>
                            <p>Short, focused videos on specific features:</p>
                            <ul>
                                <li>Getting Started (10 min)</li>
                                <li>Using Ailethia (8 min)</li>
                                <li>Checking Credit Scores (5 min)</li>
                                <li>Advanced Features (7 min)</li>
                            </ul>
                            <p>Each video has a quiz. Pass threshold is 80%. Certificate upon completion. Tracks watch progress—resume where you left off.</p>

                            <h3>Success Metrics</h3>
                            <ul>
                                <li><strong>On-Premise:</strong> 1-2 weeks from deployment start to first data pull (you control timeline)</li>
                                <li><strong>Amazon AWS Private Per-Lender:</strong> &lt;55 minutes from payment to first data pull (15-25 min automated provisioning + 30 min onboarding)</li>
                                <li><strong>Hybrid:</strong> 1-2 weeks for initial setup, then real-time sync between environments</li>
                                <li><strong>&gt;85%</strong> of signups complete onboarding</li>
                                <li><strong>&gt;75%</strong> complete video training</li>
                                <li><strong>&gt;90%</strong> activate at least 3 vendors in first week</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="accordion-item" id="build-timeline">
                    <div class="accordion-header">
                        <div class="section-number">10</div>
                        <div class="section-title">
                            <h3>The Build Timeline</h3>
                            <p>Deployment-ready Jan 1, 2026 - 22 days ahead of Jan 23 deadline</p>
                        </div>
                        <div class="accordion-toggle">▼</div>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            <p style="font-size: 1.125rem; margin-bottom: 1.5rem; max-width: 900px;"><strong>Dec 15, 2025 to Jan 23, 2026</strong> - A comprehensive 6-week development plan built using modern development practices, AI-assisted coding, and strategic architecture decisions. What traditionally takes 6-12 months is being accomplished in 6 weeks—a <strong>10x acceleration</strong>.</p>
                            
                            <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%); border: 1px solid #10b981; padding: 1.5rem; border-radius: 12px; margin-bottom: 3rem; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.08);">
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem;">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                    </svg>
                                    <strong style="color: #10b981; font-size: 1.125rem;">Ahead of Schedule</strong>
                                </div>
                                <p style="margin: 0; color: #064e3b; font-size: 1rem; line-height: 1.7;"><strong>Deployment-ready achieved on January 1, 2026</strong> - 22 days ahead of the January 23, 2026 deadline. Core infrastructure, security, and deployment systems are operational and ready for production use.</p>
                            </div>

                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; margin-bottom: 3rem; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                                    <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <polyline points="12 6 12 12 16 14"></polyline>
                                        </svg>
                                    </div>
                                    <h3 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 600;">Rapid Development Approach</h3>
                                </div>
                                <p style="margin: 0; color: #475569; line-height: 1.7;">Leveraging AI pair programming (<strong>Codex Max</strong>, <strong>Claude Sonnet 4.5 via Composer</strong>, and <strong>Gemini Flash</strong>), modern frameworks, and cloud-native services enabled us to build production-ready features 10x faster than traditional development cycles.</p>
                            </div>

                            <h3 style="margin-bottom: 1.5rem;">6-Week Development Plan</h3>
                            
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.75rem; margin: 2rem 0;">
                                <!-- Week 1 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(99, 102, 241, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.25rem;">
                                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                                            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 1</h4>
                                                <p style="margin: 0; font-size: 0.875rem; color: #64748b;">Foundation</p>
                                            </div>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Dec 15-19, 2025</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                <li>AWS infrastructure setup (VPC, EC2, RDS, S3)</li>
                                <li>Architecture diagrams and decision docs</li>
                                        <li>Database schema design (PostgreSQL multi-tenant)</li>
                                        <li>Prisma ORM setup and configuration</li>
                                <li>Development environment (Docker, local setup)</li>
                            </ul>
                                </div>

                                <!-- Week 2 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(59, 130, 246, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 2</h4>
                                            <p style="margin: 0; font-size: 0.875rem; color: #64748b;">Backend & Security</p>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Dec 22-26, 2025</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                <li>Authentication system (JWT + refresh tokens)</li>
                                <li>SSO implementation (AWS IAM + SAML)</li>
                                <li>Multi-tenant isolation (row-level security)</li>
                                <li>API Gateway and rate limiting</li>
                                <li>Middleware (auth, tenant resolution, logging)</li>
                            </ul>
                                </div>

                                <!-- Week 3 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(16, 185, 129, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M17 6.1H3"></path>
                                                <path d="M21 12.1H3"></path>
                                                <path d="M15.1 18H3"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 3</h4>
                                            <p style="margin: 0; font-size: 0.875rem; color: #64748b;">LOS Connectors</p>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Dec 29, 2025 - Jan 2, 2026</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                <li>Universal loan schema (canonical model)</li>
                                        <li>Base connector class (factory pattern)</li>
                                <li>Encompass connector (REST + OAuth)</li>
                                        <li>Calyx connector (database access)</li>
                                        <li>MeridianLink connector (API integration)</li>
                            </ul>
                                </div>

                                <!-- Week 4 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(168, 85, 247, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.25);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 4</h4>
                                            <p style="margin: 0; font-size: 0.875rem; color: #64748b;">Vendors & Security</p>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Jan 5-9, 2026</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                        <li>Vendor connector framework (generic pattern)</li>
                                        <li>Credit bureau integration (Experian, Equifax, TransUnion)</li>
                                <li>Encryption implementation (KMS, field-level)</li>
                                        <li>SOC 2 controls (audit logging, compliance)</li>
                                        <li>Security testing (penetration testing, vulnerability assessment)</li>
                            </ul>
                                </div>

                                <!-- Week 5 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(236, 72, 153, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.25);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                                <line x1="12" y1="19" x2="12" y2="22"></line>
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 5</h4>
                                            <p style="margin: 0; font-size: 0.875rem; color: #64748b;">RAG & AI</p>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Jan 12-16, 2026</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                        <li>Document processing pipeline (upload, extract, normalize, chunk)</li>
                                        <li>Embedding generation (OpenAI embeddings)</li>
                                        <li>Pinecone integration (vector database setup)</li>
                                        <li>RAG prompt engineering (optimize for accuracy)</li>
                                        <li>Ailethia voice AI integration (Gemini Live API)</li>
                            </ul>
                                </div>

                                <!-- Week 6 -->
                                <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2rem; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 10px 10px -5px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(14, 165, 233, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04)'; this.style.borderColor='rgba(226, 232, 240, 0.8)'">
                                    <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;">
                                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(14, 165, 233, 0.25);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                                                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                                                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                                                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #0f172a;">Week 6</h4>
                                            <p style="margin: 0; font-size: 0.875rem; color: #64748b;">Launch Prep</p>
                                        </div>
                                    </div>
                                    <p style="margin: 0 0 1rem 0; font-size: 0.875rem; color: #64748b; font-weight: 500;">Jan 19-23, 2026</p>
                                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.9375rem; line-height: 1.8; color: #475569;">
                                        <li>Automated onboarding system (30-minute flow)</li>
                                        <li>Video training platform (training videos with quizzes)</li>
                                        <li>Documentation (API docs, runbooks, user guides)</li>
                                        <li>Performance testing (load testing and optimization)</li>
                                        <li>Go/no-go review (final polish and launch readiness)</li>
                            </ul>
                                </div>
                            </div>

                            <div style="background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem; border-radius: 16px; margin: 3rem 0; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04);">
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;">
                                    <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                        </svg>
                            </div>
                                    <h3 style="margin: 0; color: #0f172a; font-size: 1.5rem; font-weight: 600;">Why So Fast?</h3>
                        </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 2rem;">
                                    <div>
                                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                                            <div style="width: 32px; height: 32px; background: rgba(59, 130, 246, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M12 8V4H8"></path>
                                                    <rect width="16" height="12" x="4" y="8" rx="2"></rect>
                                                    <path d="M2 14h2"></path>
                                                    <path d="M20 14h2"></path>
                                                    <path d="M15 13v2"></path>
                                                    <path d="M9 13v2"></path>
                                                </svg>
                    </div>
                                            <h4 style="margin: 0; color: #0f172a; font-size: 1.0625rem; font-weight: 600;">AI-Assisted Development</h4>
                                        </div>
                                        <p style="margin: 0; font-size: 0.9375rem; line-height: 1.7; color: #64748b;">Using <strong>Codex Max</strong>, <strong>Claude Sonnet 4.5 via Composer</strong>, and <strong>Gemini Flash</strong> accelerated development by 10x.</p>
                                    </div>
                                    <div>
                                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                                            <div style="width: 32px; height: 32px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <polyline points="16 18 22 12 16 6"></polyline>
                                                    <polyline points="8 6 2 12 8 18"></polyline>
                                                </svg>
                                            </div>
                                            <h4 style="margin: 0; color: #0f172a; font-size: 1.0625rem; font-weight: 600;">Modern Stack</h4>
                                        </div>
                                        <p style="margin: 0; font-size: 0.9375rem; line-height: 1.7; color: #64748b;">React, TypeScript, and Tailwind CSS provide rapid UI development. Shadcn UI components eliminate custom building.</p>
                                    </div>
                                    <div>
                                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                                            <div style="width: 32px; height: 32px; background: rgba(168, 85, 247, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                                </svg>
                                            </div>
                                            <h4 style="margin: 0; color: #0f172a; font-size: 1.0625rem; font-weight: 600;">Cloud-Native</h4>
                                        </div>
                                        <p style="margin: 0; font-size: 0.9375rem; line-height: 1.7; color: #64748b;">AWS managed services (RDS, KMS, Elastic Beanstalk, CloudFront) eliminate infrastructure management overhead.</p>
                                    </div>
                                    <div>
                                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
                                            <div style="width: 32px; height: 32px; background: rgba(245, 158, 11, 0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <circle cx="12" cy="12" r="10"></circle>
                                                    <path d="M12 6v6l4 2"></path>
                                                </svg>
                                            </div>
                                            <h4 style="margin: 0; color: #0f172a; font-size: 1.0625rem; font-weight: 600;">Strategic Focus</h4>
                                        </div>
                                        <p style="margin: 0; font-size: 0.9375rem; line-height: 1.7; color: #64748b;">Built MVP features first, then iterated. No premature optimization. Focus on solving lender integration problems.</p>
                                    </div>
                                </div>
                            </div>

                            <div style="background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%); border: 1px solid rgba(226, 232, 240, 0.8); padding: 2.5rem; border-radius: 16px; text-align: center; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -1px rgba(15, 23, 42, 0.04); margin-top: 2rem;">
                                <h3 style="margin: 0 0 2.5rem 0; font-size: 1.5rem; font-weight: 600; color: #0f172a;">Development Metrics</h3>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 2.5rem;">
                                    <div>
                                        <div style="font-size: 2.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">6</div>
                                        <div style="font-size: 0.9375rem; color: #64748b; font-weight: 500;">Weeks Total (Planned)</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 2.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">30</div>
                                        <div style="font-size: 0.9375rem; color: #64748b; font-weight: 500;">Major Tasks</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 2.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">157</div>
                                        <div style="font-size: 0.9375rem; color: #64748b; font-weight: 500;">Files Created</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 2.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">10x</div>
                                        <div style="font-size: 0.9375rem; color: #64748b; font-weight: 500;">Faster than Traditional</div>
                                    </div>
                                    <div>
                                        <div style="font-size: 2.75rem; font-weight: 700; margin-bottom: 0.5rem; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">85%</div>
                                        <div style="font-size: 0.9375rem; color: #64748b; font-weight: 500;">SOC 2 Complete</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section id="economics-section">
            <h2 style="text-align: center; margin-bottom: 3rem;">The Economics: What Lenders Save</h2>
            <div class="insights-grid">
                <div class="insight-card">
                    <div class="insight-icon">💰</div>
                    <h3>Significant Cost Savings</h3>
                    <p>When lenders use Coheus instead of building custom integrations, they eliminate substantial upfront development costs and ongoing maintenance expenses. One integration replaces multiple vendor-specific builds.</p>
                </div>
                <div class="insight-card">
                    <div class="insight-icon">⏱️</div>
                    <h3>Dramatically Faster Integration</h3>
                    <p>Connect all vendors in days or weeks with Coheus, not months. Traditional custom integration requires extensive development and testing cycles for each vendor connection.</p>
                </div>
                <div class="insight-card">
                    <div class="insight-icon">🎯</div>
                    <h3>No Maintenance Burden</h3>
                    <p>Eliminate the $5K-$15K annual maintenance cost per vendor. Coheus handles all API updates, vendor changes, and compatibility issues.</p>
                </div>
                <div class="insight-card">
                    <div class="insight-icon">🚀</div>
                    <h3>Access to New Vendors</h3>
                    <p>When a new vendor is added to Coheus, all lenders instantly get access. No additional integration work, no delays, no extra cost.</p>
                </div>
                <div class="insight-card">
                    <div class="insight-icon">🔒</div>
                    <h3>Compliance Included</h3>
                    <p><strong>SOC 2 Type II</strong> + <strong>HIPAA-ready</strong> out of the box. All vendors inherit enterprise-grade security without additional cost.</p>
                </div>
                <div class="insight-card">
                    <div class="insight-icon">📈</div>
                    <h3>Technical Debt Prevention</h3>
                    <p>No custom code to maintain. When vendors change their APIs, Coheus updates once—all lenders benefit. Zero technical debt.</p>
                </div>
            </div>
        </section>

        <section>
            <div class="value-prop">
                <h2>The Math is Broken (Without Coheus)</h2>
                <p style="text-align: center; font-size: 1.125rem; color: var(--text-secondary); margin-bottom: 3rem; max-width: 800px; margin-left: auto; margin-right: auto;">
                    Lenders waste hundreds of thousands of dollars on custom integrations that take months to build and break with every vendor update. There's a better way.
                </p>
                <div class="comparison-table">
                    <div class="comparison-col bad">
                        <h4>❌ The Expensive, Friction-Filled Path</h4>
                        <ul>
                            <li><strong>$15K-$50K per vendor</strong> in upfront development costs</li>
                            <li><strong>$5K-$15K per vendor</strong> annually for maintenance and updates</li>
                            <li><strong>2-4 months</strong> per integration before you can use it</li>
                            <li>10 vendors = <strong>$150K-$500K upfront</strong> + <strong>$50K-$150K/year</strong> ongoing</li>
                            <li>Every vendor API change requires developer time and testing</li>
                            <li>Integration failures delay loan closings and cost revenue</li>
                            <li>Technical debt grows with each custom integration</li>
                            <li>Adding new vendors means starting over from scratch</li>
                        </ul>
                    </div>
                    <div class="comparison-col good">
                        <h4>✅ Frictionless Integration, Massive Savings</h4>
                        <ul>
                            <li><strong>One integration</strong> connects you to all vendors instantly</li>
                            <li><strong>Days to weeks</strong> to connect all vendors, not months</li>
                            <li><strong>Eliminate $150K-$500K</strong> in upfront development costs</li>
                            <li><strong>Eliminate $50K-$150K/year</strong> in maintenance expenses</li>
                            <li>Vendor updates handled automatically—zero downtime, zero cost</li>
                            <li>New vendors become available immediately—no additional work</li>
                            <li>No technical debt—Coheus maintains everything</li>
                            <li>Focus your team on lending, not integration maintenance</li>
                        </ul>
                    </div>
                </div>
                <div style="margin-top: 3rem; padding: 2rem; background: linear-gradient(135deg, rgba(0, 102, 255, 0.05) 0%, rgba(0, 212, 255, 0.05) 100%); border-radius: 16px; border: 1px solid rgba(0, 102, 255, 0.1);">
                    <h3 style="text-align: center; margin-bottom: 1rem; color: var(--text-primary);">The Bottom Line</h3>
                    <p style="text-align: center; font-size: 1.0625rem; color: var(--text-secondary); line-height: 1.75; max-width: 700px; margin: 0 auto;">
                        Coheus transforms vendor integration from a costly, time-consuming burden into a simple, one-time connection. Lenders save hundreds of thousands of dollars while gaining instant access to the entire vendor ecosystem. No custom code. No maintenance headaches. Just seamless integration that works.
                    </p>
                </div>
            </div>
        </section>

        <section class="mt-3">
            <h2>The First 90 Days After Launch</h2>
            <p>Building is one thing. Operating is another.</p>

            <div class="feature-grid">
                <div class="feature-card">
                    <h4><span class="feature-icon">🎯</span> Phase 1: Stabilization (Weeks 1-2)</h4>
                    <p>Monitor error rates, fix bugs found by initial users, optimize hot paths. Daily incident review calls. 24/7 on-call rotation.</p>
                </div>
                <div class="feature-card">
                    <h4><span class="feature-icon">📈</span> Phase 2: Scale (Weeks 3-4)</h4>
                    <p>Add second LOS connector (Encompass+). Bring on first 3 beta customers. Load testing under real conditions.</p>
                </div>
                <div class="feature-card">
                    <h4><span class="feature-icon">🚀</span> Phase 3: Growth (Weeks 5-12)</h4>
                    <p>Expand vendor integrations. Support 5 LOS systems. Add first 10 production customers.</p>
                </div>
            </div>
        </section>
    </div>

    <footer class="footer">
        <p><strong>Coheus v2 Backend Architecture</strong></p>
        <p>Internal Documentation | December 2025</p>
        <p style="margin-top: 1.5rem; font-size: 0.875rem; opacity: 0.8;">© 2025 TVMA, Inc. trading as Teraverde®. All rights reserved.</p>
    </footer>
  `;

  return (
    <>
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border-b border-neutral-200 dark:border-neutral-700 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-4 md:px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Left: Logo */}
            <div className="flex items-center">
              <button
                onClick={() => navigate('/')}
                className="hover:opacity-80 transition-opacity cursor-pointer"
                aria-label="Go to home page"
              >
                <CoheusLogo className="h-10 sm:h-12" height={48} />
              </button>
            </div>

            {/* Center: Menu Items */}
            <div className="flex items-center gap-4">
              {/* BArch removed - only shown in AgilePlan navigation */}
      </div>

            {/* Right: Actions - Hidden on /v2 page */}
            <div className={`flex items-center gap-3 ${location.pathname === '/v2' ? 'hidden' : ''}`}>
              {/* Sync Status Indicator */}
              <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="hidden sm:inline">Synced</span>
            </div>
            
              {/* Export Button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Export Format</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Jira JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Trello JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileJson className="w-4 h-4 mr-2" />
                    Detailed JSON
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Jira CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Trello CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/v2/agileplan')}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Detailed CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* History Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/v2/agileplan')}
                className="flex items-center gap-2"
              >
                <History className="w-5 h-5" />
                <span className="hidden sm:inline">History</span>
              </Button>

              {/* Sign In Button */}
              {!isAuthenticated ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSignInOpen(true)}
                  className="flex items-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">
                    {userName}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSignOut}
                  >
                    Sign Out
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Sign In</DialogTitle>
              <DialogDescription>
                Sign in to access Coheus by Teraverde
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="v2-email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="v2-email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthError('');
                  }}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="v2-password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="v2-password"
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

      {/* Deep Dives Sidebar */}
      <div 
        className={`deep-dives-sidebar ${sidebarOpen ? 'open' : ''}`}
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
          {deepDiveSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`deep-dive-item ${activeSection === section.id ? 'active' : ''}`}
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

      <div className="v2-page-container">
        <V2Hero />
        <ContainerScroll className="min-h-[400vh]">
          <div 
            dangerouslySetInnerHTML={{ __html: bodyContent }}
            onClick={(e) => {
              // Handle clicks on architecture diagram
              const target = e.target as HTMLElement;
              const diagram = target.closest('.architecture-diagram');
              if (diagram) {
                e.preventDefault();
                e.stopPropagation();
                const modal = document.querySelector('.v2-page-container .diagram-modal');
                if (modal) {
                  modal.classList.add('active');
                  document.body.style.overflow = 'hidden';
                  console.log('Modal opened via React handler', modal);
                } else {
                  console.error('Modal not found');
                }
                return;
              }
              
              // Handle clicks on modal backdrop
              const backdrop = target.closest('.diagram-modal-backdrop');
              if (backdrop) {
                e.preventDefault();
                e.stopPropagation();
                const modal = document.querySelector('.v2-page-container .diagram-modal');
                if (modal) {
                  modal.classList.remove('active');
                  document.body.style.overflow = '';
                }
                return;
              }
              
              // Handle clicks on modal close button
              const closeBtn = target.closest('.diagram-modal-close');
              if (closeBtn) {
                e.preventDefault();
                e.stopPropagation();
                const modal = document.querySelector('.v2-page-container .diagram-modal');
                if (modal) {
                  modal.classList.remove('active');
                  document.body.style.overflow = '';
                }
                return;
              }
            }}
          />
        </ContainerScroll>
                        </div>
      {/* <AletheiaV2Assistant /> */}
    </>
  );
};

export default V2;
