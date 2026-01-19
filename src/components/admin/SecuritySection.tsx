import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Users,
  CheckCircle2,
  Activity,
  AlertCircle,
  Key,
  Shield,
  Eye,
} from 'lucide-react';
import type { SecurityInfo } from '@/hooks/admin/useSecurityInfo';
import type { AdminSection } from '@/hooks/admin/useAdminState';

interface SecuritySectionProps {
  securityInfo: SecurityInfo | null;
  loading: boolean;
  onNavigate?: (section: AdminSection) => void;
}

export const SecuritySection = ({ securityInfo, loading, onNavigate }: SecuritySectionProps) => {
  if (!securityInfo || loading) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Security Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Users
            </CardTitle>
            <Users className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
              {securityInfo.authentication.totalUsers}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              Active accounts
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Verified Users
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" strokeWidth={1.5} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
              {securityInfo.authentication.confirmedUsers}
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-light">
              {securityInfo.authentication.totalUsers > 0 
                ? Math.round((securityInfo.authentication.confirmedUsers / securityInfo.authentication.totalUsers) * 100)
                : 0}% verified
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Recent Logins
            </CardTitle>
            <Activity className="h-4 w-4 text-blue-500 dark:text-blue-400" strokeWidth={1.5} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
              {securityInfo.authentication.recentLogins}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              Last 7 days
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Failed Logins
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-rose-500 dark:text-rose-400" strokeWidth={1.5} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
              {securityInfo.authentication.failedLogins || 0}
            </div>
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 font-light">
              Last 24 hours
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
              Authentication Status
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              User authentication statistics and health
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Total Users</span>
              <span className="text-base font-extralight text-slate-900 dark:text-white">{securityInfo.authentication.totalUsers}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Verified Users</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-extralight text-slate-900 dark:text-white">{securityInfo.authentication.confirmedUsers}</span>
                <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
                  {securityInfo.authentication.totalUsers > 0 
                    ? Math.round((securityInfo.authentication.confirmedUsers / securityInfo.authentication.totalUsers) * 100)
                    : 0}%
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Pending Verification</span>
              <span className="text-base font-extralight text-slate-900 dark:text-white">
                {securityInfo.authentication.totalUsers - securityInfo.authentication.confirmedUsers}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Recent Logins (7d)</span>
              <span className="text-base font-extralight text-slate-900 dark:text-white">{securityInfo.authentication.recentLogins}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-base font-extralight text-slate-600 dark:text-slate-400">Failed Attempts (24h)</span>
              <span className="text-base font-extralight text-rose-600 dark:text-rose-400">{securityInfo.authentication.failedLogins || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
              Security Policies
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Configure security policies and settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">JWT Token Expiry</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">{securityInfo.settings.jwtExpiry}</div>
              </div>
              <Key className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Password Min Length</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">{securityInfo.settings.passwordMinLength} characters</div>
              </div>
              <Shield className="h-4 w-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Rate Limiting</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">Enabled for auth endpoints</div>
              </div>
              <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                Active
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700">
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Data Encryption</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">{securityInfo.settings.encryptionEnabled ? 'AES-256 enabled' : 'Not configured'}</div>
              </div>
              <Badge variant="default" className={securityInfo.settings.encryptionEnabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0"}>
                {securityInfo.settings.encryptionEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Email Confirmation</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">Required for new users</div>
              </div>
              <Switch checked={securityInfo.settings.requireEmailConfirmation} disabled />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SOC 2 Compliance Status */}
      <Card className="border-slate-200 dark:border-slate-700 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                SOC 2 Compliance Status
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Audit trail and compliance monitoring
              </CardDescription>
            </div>
            <Badge className="bg-emerald-600 text-white px-4 py-1 text-xs font-medium">
              Compliant
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">Audit Logs</div>
              <div className="text-2xl font-light text-slate-900 dark:text-white">
                {securityInfo.auditTrail?.totalLogs || 'N/A'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">Total records</div>
            </div>
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">Last 24 Hours</div>
              <div className="text-2xl font-light text-slate-900 dark:text-white">
                {securityInfo.auditTrail?.last24h || 0}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">Recent activity</div>
            </div>
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">Retention Policy</div>
              <div className="text-2xl font-light text-slate-900 dark:text-white">
                {securityInfo.auditTrail?.retentionDays || 90}d
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">Log retention</div>
            </div>
          </div>
          {onNavigate && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('soc2')}
                className="font-extralight"
              >
                <Eye className="h-4 w-4 mr-2" />
                View Audit Trail
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Security Best Practices
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Recommendations for maintaining system security
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Strong Passwords</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                  Ensure all users use passwords with minimum {securityInfo.settings.passwordMinLength} characters
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">JWT Token Security</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                  Tokens expire after {securityInfo.settings.jwtExpiry} to prevent unauthorized access
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Email Verification</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                  {securityInfo.settings.requireEmailConfirmation 
                    ? 'Email confirmation is required for all new user registrations'
                    : 'Consider enabling email confirmation for enhanced security'}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-base font-extralight text-slate-900 dark:text-white">Audit Trail</div>
                <div className="text-xs text-slate-500 dark:text-slate-500 font-light mt-1">
                  All system actions are logged for SOC 2 compliance and security monitoring
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

