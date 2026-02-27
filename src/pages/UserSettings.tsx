import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Navigation } from '@/components/layout/Navigation';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationPreferencesSection } from '@/components/settings/NotificationPreferencesSection';
import { User, Palette, Bell, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SettingsSection = 'account' | 'appearance' | 'notifications';

const sections: { id: SettingsSection; label: string; icon: typeof User; description: string }[] = [
  { id: 'account', label: 'Account', icon: User, description: 'Your account info and password' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and display preferences' },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Email briefs and alerts' },
];

export default function UserSettings() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    tabParam === 'notifications' ? 'notifications' : tabParam === 'appearance' ? 'appearance' : 'account'
  );
  const navigate = useNavigate();

  useEffect(() => {
    if (tabParam === 'notifications') setActiveSection('notifications');
    else if (tabParam === 'appearance') setActiveSection('appearance');
    else if (tabParam === 'account') setActiveSection('account');
  }, [tabParam]);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="h-9 px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your account and preferences
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar */}
          <nav className="w-full md:w-56 shrink-0">
            <div className="space-y-1">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <div className="text-left">
                      <div>{section.label}</div>
                      <div className={cn(
                        'text-xs font-normal mt-0.5',
                        isActive ? 'text-white/70' : 'text-muted-foreground'
                      )}>
                        {section.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === 'account' && <AccountSection />}
            {activeSection === 'appearance' && <AppearanceSection />}
            {activeSection === 'notifications' && <NotificationPreferencesSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
