import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/components/theme-provider';
import { api } from '@/lib/api';
import { Loader2, Sun, Moon, Laptop, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppearancePreferences {
  theme: 'light' | 'dark' | 'system';
  defaultPage: string;
  sidebarCollapsed: boolean;
}

const DEFAULT_PREFS: AppearancePreferences = {
  theme: 'system',
  defaultPage: '/insights',
  sidebarCollapsed: false,
};

const landingPages = [
  { value: '/insights', label: 'Insights' },
  { value: '/my-dashboard', label: 'My Workbench' },
  { value: '/loans', label: 'Loans' },
];

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
] as const;

export function AppearanceSection() {
  const { toast } = useToast();
  const { theme: currentTheme, setTheme } = useTheme();

  const [prefs, setPrefs] = useState<AppearancePreferences>({
    ...DEFAULT_PREFS,
    theme: currentTheme as AppearancePreferences['theme'],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [savedPrefs, setSavedPrefs] = useState<AppearancePreferences | null>(null);

  // Load preferences from server
  useEffect(() => {
    const loadPrefs = async () => {
      setLoading(true);
      try {
        const data = await api.request<{ preference_key: string; preference_value: any }>('/api/user/preferences/appearance');
        if (data.preference_value) {
          const serverPrefs = {
            ...DEFAULT_PREFS,
            ...data.preference_value,
          };
          setPrefs(serverPrefs);
          setSavedPrefs(serverPrefs);
          // Sync theme to ThemeProvider if server has a different value
          if (serverPrefs.theme && serverPrefs.theme !== currentTheme) {
            setTheme(serverPrefs.theme);
          }
        } else {
          // No server prefs yet -- use current theme from localStorage
          const initial = { ...DEFAULT_PREFS, theme: currentTheme as AppearancePreferences['theme'] };
          setPrefs(initial);
          setSavedPrefs(initial);
        }
      } catch {
        // Use defaults if fetch fails
        const initial = { ...DEFAULT_PREFS, theme: currentTheme as AppearancePreferences['theme'] };
        setPrefs(initial);
        setSavedPrefs(initial);
      } finally {
        setLoading(false);
      }
    };
    loadPrefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track changes
  useEffect(() => {
    if (!savedPrefs) return;
    const changed =
      prefs.theme !== savedPrefs.theme ||
      prefs.defaultPage !== savedPrefs.defaultPage ||
      prefs.sidebarCollapsed !== savedPrefs.sidebarCollapsed;
    setHasChanges(changed);
  }, [prefs, savedPrefs]);

  const handleThemeChange = (value: string) => {
    const newTheme = value as AppearancePreferences['theme'];
    setPrefs((p) => ({ ...p, theme: newTheme }));
    // Apply theme immediately for live preview
    setTheme(newTheme);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.request('/api/user/preferences/appearance', {
        method: 'PUT',
        body: JSON.stringify({ preference_value: prefs }),
      });
      setSavedPrefs({ ...prefs });
      setHasChanges(false);
      toast({ title: 'Saved', description: 'Appearance preferences updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save preferences.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Theme
          </CardTitle>
          <CardDescription>Choose how Cohi looks to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const selected = prefs.theme === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleThemeChange(option.value)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150',
                    selected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
                  )}
                >
                  <Icon className={cn('h-6 w-6', selected ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground')} />
                  <span className={cn('text-sm font-medium', selected ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground')}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Display Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Display Preferences</CardTitle>
          <CardDescription>Configure your default layout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="default-page">Default Landing Page</Label>
            <p className="text-xs text-muted-foreground">The page shown when you log in or click the logo.</p>
            <Select
              value={prefs.defaultPage}
              onValueChange={(value) => setPrefs((p) => ({ ...p, defaultPage: value }))}
            >
              <SelectTrigger id="default-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {landingPages.map((page) => (
                  <SelectItem key={page.value} value={page.value}>
                    {page.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sidebar-collapsed">Sidebar Collapsed</Label>
              <p className="text-xs text-muted-foreground">Start with the sidebar collapsed by default.</p>
            </div>
            <Switch
              id="sidebar-collapsed"
              checked={prefs.sidebarCollapsed}
              onCheckedChange={(checked) => setPrefs((p) => ({ ...p, sidebarCollapsed: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
      </div>
    </div>
  );
}
