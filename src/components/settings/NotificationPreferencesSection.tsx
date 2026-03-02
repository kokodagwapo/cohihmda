import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Bell, Mail } from 'lucide-react';

export interface EmailPreferencesDailyBrief {
  enabled: boolean;
  frequency: 'daily' | 'weekdays' | 'weekly_monday';
  deliveryHour: number;
  email: string;
  sections: {
    marketSnapshot: boolean;
    industryNews: boolean;
    pipelineDigest: boolean;
    researchUpdates: boolean;
    trackedMetrics: boolean;
  };
  newsSourceFilter: string[];
}

export interface EmailPreferencesAlerts {
  criticalInsights: boolean;
  researchComplete: boolean;
  trackedMetricBreach: boolean;
}

export interface EmailPreferences {
  dailyBrief: EmailPreferencesDailyBrief;
  alerts: EmailPreferencesAlerts;
  unsubscribeToken: string | null;
}

const DEFAULT_SECTIONS: EmailPreferencesDailyBrief['sections'] = {
  marketSnapshot: true,
  industryNews: true,
  pipelineDigest: false,
  researchUpdates: false,
  trackedMetrics: false,
};

const DEFAULT_EMAIL_PREFS: EmailPreferences = {
  dailyBrief: {
    enabled: false,
    frequency: 'weekdays',
    deliveryHour: 8,
    email: '',
    sections: { ...DEFAULT_SECTIONS },
    newsSourceFilter: [],
  },
  alerts: {
    criticalInsights: false,
    researchComplete: false,
    trackedMetricBreach: false,
  },
  unsubscribeToken: null,
};

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly_monday', label: 'Weekly (Monday)' },
];

const DELIVERY_HOURS = [
  { value: 5, label: '5:00 AM' },
  { value: 8, label: '8:00 AM' },
  { value: 10, label: '10:00 AM' },
  { value: 14, label: '2:00 PM' },
  { value: 16, label: '4:00 PM' },
  { value: 18, label: '6:00 PM' },
];

const NEWS_SOURCES = [
  'MBA',
  'Fannie Mae',
  'Freddie Mac',
  'CFPB',
  'FHFA',
  'Federal Reserve',
  'Reuters',
  'National Mortgage News',
  'Mortgage News Daily',
];

function sectionsEqual(
  a: EmailPreferencesDailyBrief['sections'],
  b: EmailPreferencesDailyBrief['sections']
): boolean {
  return (
    a.marketSnapshot === b.marketSnapshot &&
    a.industryNews === b.industryNews &&
    a.pipelineDigest === b.pipelineDigest &&
    a.researchUpdates === b.researchUpdates &&
    a.trackedMetrics === b.trackedMetrics
  );
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

export function NotificationPreferencesSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const userEmail = user?.email ?? '';

  const [prefs, setPrefs] = useState<EmailPreferences>({ ...DEFAULT_EMAIL_PREFS });
  const [savedPrefs, setSavedPrefs] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingPreview, setSendingPreview] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.request<EmailPreferences>('/api/user/email-preferences');
      const merged: EmailPreferences = {
        ...DEFAULT_EMAIL_PREFS,
        ...data,
        dailyBrief: {
          ...DEFAULT_EMAIL_PREFS.dailyBrief,
          ...data.dailyBrief,
          email: data.dailyBrief?.email || userEmail,
          sections: {
            ...DEFAULT_SECTIONS,
            ...data.dailyBrief?.sections,
          },
          newsSourceFilter: Array.isArray(data.dailyBrief?.newsSourceFilter)
            ? data.dailyBrief.newsSourceFilter
            : [],
        },
        alerts: {
          ...DEFAULT_EMAIL_PREFS.alerts,
          ...data.alerts,
        },
      };
      setPrefs(merged);
      setSavedPrefs(merged);
    } catch {
      const fallback: EmailPreferences = {
        ...DEFAULT_EMAIL_PREFS,
        dailyBrief: { ...DEFAULT_EMAIL_PREFS.dailyBrief, email: userEmail },
      };
      setPrefs(fallback);
      setSavedPrefs(fallback);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    if (!savedPrefs) return;
    const changed =
      prefs.dailyBrief.enabled !== savedPrefs.dailyBrief.enabled ||
      prefs.dailyBrief.frequency !== savedPrefs.dailyBrief.frequency ||
      prefs.dailyBrief.deliveryHour !== savedPrefs.dailyBrief.deliveryHour ||
      prefs.dailyBrief.email !== savedPrefs.dailyBrief.email ||
      !sectionsEqual(prefs.dailyBrief.sections, savedPrefs.dailyBrief.sections) ||
      !arrayEqual(prefs.dailyBrief.newsSourceFilter, savedPrefs.dailyBrief.newsSourceFilter);
    setHasChanges(changed);
  }, [prefs, savedPrefs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.request('/api/user/email-preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      });
      setSavedPrefs({ ...prefs });
      setHasChanges(false);
      toast({ title: 'Saved', description: 'Notification preferences updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save preferences.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSendPreview = async () => {
    const email = prefs.dailyBrief.email?.trim();
    if (!email || !email.includes('@')) {
      toast({ title: 'Invalid email', description: 'Enter a valid email address.', variant: 'destructive' });
      return;
    }
    setSendingPreview(true);
    try {
      await api.request('/api/news/newsletter/send-preview', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      toast({ title: 'Preview sent', description: `Check ${email} for the daily brief preview.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to send preview.', variant: 'destructive' });
    } finally {
      setSendingPreview(false);
    }
  };

  const toggleSection = (key: keyof EmailPreferencesDailyBrief['sections'], value: boolean) => {
    setPrefs((p) => ({
      ...p,
      dailyBrief: {
        ...p.dailyBrief,
        sections: { ...p.dailyBrief.sections, [key]: value },
      },
    }));
  };

  const toggleNewsSource = (source: string) => {
    setPrefs((p) => {
      const current = p.dailyBrief.newsSourceFilter;
      const next = current.includes(source)
        ? current.filter((s) => s !== source)
        : [...current, source];
      return {
        ...p,
        dailyBrief: { ...p.dailyBrief, newsSourceFilter: next },
      };
    });
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
      {/* Card 1: Daily Morning Brief */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Daily Morning Brief
          </CardTitle>
          <CardDescription>
            Receive a daily email with market snapshot, headlines, and optional Cohi digest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="daily-brief-enabled">Receive the Cohi Daily Brief</Label>
            <Switch
              id="daily-brief-enabled"
              checked={prefs.dailyBrief.enabled}
              onCheckedChange={(checked) =>
                setPrefs((p) => ({
                  ...p,
                  dailyBrief: { ...p.dailyBrief, enabled: checked },
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-brief-email">Email address</Label>
            <Input
              id="daily-brief-email"
              type="email"
              placeholder="you@company.com"
              value={prefs.dailyBrief.email}
              onChange={(e) =>
                setPrefs((p) => ({
                  ...p,
                  dailyBrief: { ...p.dailyBrief, email: e.target.value },
                }))
              }
              disabled={!prefs.dailyBrief.enabled}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={prefs.dailyBrief.frequency}
                onValueChange={(value: EmailPreferencesDailyBrief['frequency']) =>
                  setPrefs((p) => ({
                    ...p,
                    dailyBrief: { ...p.dailyBrief, frequency: value },
                  }))
                }
                disabled={!prefs.dailyBrief.enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Delivery time</Label>
              <Select
                value={String(prefs.dailyBrief.deliveryHour)}
                onValueChange={(value) =>
                  setPrefs((p) => ({
                    ...p,
                    dailyBrief: { ...p.dailyBrief, deliveryHour: parseInt(value, 10) },
                  }))
                }
                disabled={!prefs.dailyBrief.enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_HOURS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSendPreview()}
            disabled={sendingPreview || !prefs.dailyBrief.email?.trim()}
          >
            {sendingPreview ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Send Preview'
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Card 2: Brief Content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Brief Content</CardTitle>
          <CardDescription>Choose which sections to include in your daily brief.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'marketSnapshot' as const, label: 'Market Snapshot', desc: 'Rates, treasury, MBA index' },
            { key: 'industryNews' as const, label: 'Industry Headlines', desc: 'Top headlines from selected sources' },
            { key: 'pipelineDigest' as const, label: 'Pipeline Digest', desc: 'Aggregate insight counts (no PII)' },
            { key: 'researchUpdates' as const, label: 'Research Updates', desc: 'Completed research sessions' },
            { key: 'trackedMetrics' as const, label: 'Tracked Metrics', desc: 'Watchlist changes' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <Switch
                checked={prefs.dailyBrief.sections[key]}
                onCheckedChange={(checked) => toggleSection(key, checked)}
                disabled={!prefs.dailyBrief.enabled}
              />
            </div>
          ))}
          <div className="pt-2">
            <Label className="text-sm">News sources (leave empty for all)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Limit headlines to these sources. Uncheck all to include every source.
            </p>
            <div className="flex flex-wrap gap-2">
              {NEWS_SOURCES.map((source) => (
                <label
                  key={source}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={prefs.dailyBrief.newsSourceFilter.includes(source)}
                    onChange={() => toggleNewsSource(source)}
                    disabled={!prefs.dailyBrief.enabled}
                    className="rounded"
                  />
                  {source}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Alert Emails (Coming soon) */}
      <Card className="opacity-90">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alert Emails
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              Coming soon
            </span>
          </CardTitle>
          <CardDescription>Real-time alerts for critical insights, research completion, and tracked metric changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'criticalInsights', label: 'Critical insight alerts' },
            { key: 'researchComplete', label: 'Research report completed' },
            { key: 'trackedMetricBreach', label: 'Tracked metric threshold breach' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between opacity-60">
              <span className="text-sm">{label}</span>
              <Switch disabled checked={false} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={saving || !hasChanges}>
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
