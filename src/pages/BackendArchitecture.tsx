import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronRight, ChevronLeft, X, Server, Database, Shield, Network, 
  Cloud, Lock, Key, Code, FileText
} from 'lucide-react';
import { CoheusLogo } from '@/components/ui/CoheusLogo';

const BackendArchitecture = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const sections = [
    { id: 'deployment', title: 'Deployment Models', subtitle: 'On-premise and cloud per-tenant', icon: Cloud, color: 'rgba(168, 85, 247, 0.1)', iconColor: '#a855f7' },
    { id: 'database', title: 'Database Architecture', subtitle: 'PostgreSQL and Redis setup', icon: Database, color: 'rgba(59, 130, 246, 0.1)', iconColor: '#3b82f6' },
    { id: 'security', title: 'Security & Compliance', subtitle: 'SOC 2, HIPAA, encryption', icon: Shield, color: 'rgba(236, 72, 153, 0.1)', iconColor: '#ec4899' },
    { id: 'api', title: 'API Architecture', subtitle: 'REST endpoints and WebSocket', icon: Network, color: 'rgba(34, 197, 94, 0.1)', iconColor: '#22c55e' },
    { id: 'authentication', title: 'Authentication & SSO', subtitle: 'JWT, SAML, multi-tenant', icon: Lock, color: 'rgba(251, 146, 60, 0.1)', iconColor: '#fb923c' },
    { id: 'connector', title: 'Universal Connector', subtitle: '3rd party integration API', icon: Code, color: 'rgba(139, 92, 246, 0.1)', iconColor: '#8b5cf6' },
    { id: 'documentation', title: 'Full Documentation', subtitle: 'Complete backend guide', icon: FileText, color: 'rgba(14, 165, 233, 0.1)', iconColor: '#0ea5e9' },
  ];

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
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

    const link3 = document.createElement('link');
    link3.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
    link3.rel = 'stylesheet';
    document.head.appendChild(link3);
  }, []);

  return (
    <>
      {/* Sidebar */}
      <div 
        className={`backend-arch-sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{
          position: 'fixed',
          right: sidebarOpen ? '0' : '-320px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '320px',
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
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1d29', margin: 0 }}>Backend Architecture</h3>
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
            Explore backend architecture and implementation details
          </p>
        </div>
        <div style={{ padding: '12px 0' }}>
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
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
          right: sidebarOpen ? '320px' : '0',
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

      {/* Main Content */}
      <div style={{ 
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: '#fafbfc',
        color: '#1a1d29',
        minHeight: '100vh',
        padding: '6rem 2rem 2rem',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}>
          <h1 style={{ 
            fontSize: '3rem', 
            fontWeight: 700, 
            margin: 0,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            Building Coheus v2<br />
            <span style={{ fontSize: '2rem', fontWeight: 400, color: '#64748b' }}>A Thoughtful Approach</span>
          </h1>
          <div style={{ flexShrink: 0 }}>
            <CoheusLogo className="h-16 sm:h-20" height={80} />
          </div>
        </div>
        <p style={{ fontSize: '1.25rem', color: '#64748b', marginBottom: '3rem' }}>
          Complete technical documentation for Coheus v2 backend infrastructure
        </p>

        <div id="deployment" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Deployment Models</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            Coheus v2 offers two deployment models ensuring complete data sovereignty.
          </p>
          {/* Content will be loaded from BACKEND_ARCHITECTURE.md */}
        </div>

        <div id="database" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Database Architecture</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            PostgreSQL and Redis configuration for high-performance data management.
          </p>
        </div>

        <div id="security" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Security & Compliance</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            SOC 2 Type II and HIPAA-ready security measures.
          </p>
        </div>

        <div id="api" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>API Architecture</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            REST endpoints and WebSocket connections for real-time communication.
          </p>
        </div>

        <div id="authentication" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Authentication & SSO</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            JWT authentication, SAML SSO, and multi-tenant isolation.
          </p>
        </div>

        <div id="connector" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Universal Connector API</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            Enable 3rd party vendors to connect to lenders through Coheus v2.
          </p>
        </div>

        <div id="documentation" style={{ marginBottom: '4rem', paddingTop: '2rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: '1rem' }}>Full Documentation</h2>
          <p style={{ fontSize: '1.125rem', color: '#64748b', marginBottom: '1.5rem' }}>
            Complete backend architecture guide available in the documentation.
          </p>
        </div>
      </div>
    </>
  );
};

export default BackendArchitecture;
