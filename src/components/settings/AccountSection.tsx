import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Loader2, KeyRound, ShieldAlert, User, Mail, Building2, UserCog } from 'lucide-react';
import { MFASetup } from './MFASetup';

/** Decode JWT payload without verification (client-side only) */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Check if the current session was authenticated via SSO */
function isAuthViaSso(): boolean {
  const token = api.getToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  return payload?.authMethod === 'cognito_sso';
}

/** Map raw role strings to human-readable labels */
function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    platform_admin: 'Platform Admin',
    support: 'Support',
    tenant_admin: 'Organization Admin',
    admin: 'Admin',
    user: 'User',
    viewer: 'Viewer',
    loan_officer: 'Loan Officer',
    processor: 'Processor',
  };
  return labels[role] || role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function PasswordStrength({ password }: { password: string }) {
  const getStrength = (pw: string): { label: string; color: string; width: string } => {
    if (!pw) return { label: '', color: '', width: 'w-0' };
    if (pw.length < 8) return { label: 'Too short', color: 'bg-rose-500', width: 'w-1/4' };

    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 2) return { label: 'Weak', color: 'bg-orange-500', width: 'w-1/3' };
    if (score <= 3) return { label: 'Fair', color: 'bg-amber-500', width: 'w-1/2' };
    if (score <= 4) return { label: 'Good', color: 'bg-blue-500', width: 'w-3/4' };
    return { label: 'Strong', color: 'bg-emerald-500', width: 'w-full' };
  };

  const strength = getStrength(password);
  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${strength.color} ${strength.width} rounded-full transition-all duration-300`} />
      </div>
      <p className="text-xs text-muted-foreground">{strength.label}</p>
    </div>
  );
}

export function AccountSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSso = isAuthViaSso();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email' | null>(null);

  useEffect(() => {
    if (isSso) return;
    const loadMfaStatus = async () => {
      try {
        const response = await api.request<{ mfaMethod: 'totp' | 'email' | null }>('/api/auth/mfa/status');
        setMfaMethod(response.mfaMethod || null);
      } catch {
        setMfaMethod(null);
      }
    };
    void loadMfaStatus();
  }, [isSso]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast({ title: 'Validation Error', description: 'New password must be at least 8 characters.', variant: 'destructive' });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: 'Validation Error', description: 'Passwords do not match.', variant: 'destructive' });
      return;
    }

    if (currentPassword === newPassword) {
      toast({ title: 'Validation Error', description: 'New password must be different from current password.', variant: 'destructive' });
      return;
    }

    setLoading(true);

    try {
      await api.request('/api/user/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      toast({ title: 'Password Changed', description: 'Your password has been updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      const message = error.message || 'Failed to change password';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Account Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account Information</CardTitle>
          <CardDescription>Your account details are managed by your organization administrator.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <User className="h-3 w-3" />
                Full Name
              </Label>
              <div className="text-sm font-medium px-3 py-2 bg-muted/50 rounded-md">
                {user.full_name || 'Not set'}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3 w-3" />
                Email
              </Label>
              <div className="text-sm font-medium px-3 py-2 bg-muted/50 rounded-md truncate">
                {user.email}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <UserCog className="h-3 w-3" />
                Role
              </Label>
              <div className="px-3 py-2 bg-muted/50 rounded-md">
                <Badge variant="secondary" className="font-medium">
                  {roleLabel(user.role)}
                </Badge>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Building2 className="h-3 w-3" />
                Organization
              </Label>
              <div className="text-sm font-medium px-3 py-2 bg-muted/50 rounded-md">
                {user.tenant_name || (user.is_super_admin ? 'Cohi Platform' : 'Not assigned')}
              </div>
            </div>

            {!isSso && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-3 w-3" />
                  MFA Method
                </Label>
                <div className="px-3 py-2 bg-muted/50 rounded-md">
                  <Badge variant="secondary" className="font-medium">
                    {mfaMethod === 'totp' ? 'Authenticator App' : mfaMethod === 'email' ? 'Email Code' : 'Not configured'}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          {isSso && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <ShieldAlert className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-700 dark:text-blue-300">
                You are signed in via Single Sign-On (SSO). Your account is managed by your organization's identity provider.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MFA Setup */}
      {!isSso && <MFASetup />}

      {/* Password Change */}
      {!isSso && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Change Password
            </CardTitle>
            <CardDescription>
              Update your password. You'll need to enter your current password first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={8}
                />
                <PasswordStrength password={newPassword} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={8}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-rose-500">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
