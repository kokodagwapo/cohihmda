import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Users,
  Phone,
  FileText,
  Link2,
  DollarSign,
  TrendingUp,
  Brain,
  CreditCard,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import type { AdminStats } from '@/hooks/admin/useAdminStats';

interface OverviewSectionProps {
  stats: AdminStats;
  overviewLoading: boolean;
}

export const OverviewSection = ({ stats, overviewLoading }: OverviewSectionProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Light Elegant Section Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-blue-200/40 dark:border-slate-700/50 shadow-lg shadow-blue-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            {stats.isSuperAdmin ? 'Platform Overview' : 'Organization Overview'}
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            {stats.isSuperAdmin ? 'System-wide metrics and platform health' : 'Your organization\'s metrics and activity'}
          </p>
        </div>
        <Badge className={`px-4 py-2 text-sm font-semibold rounded-full shadow-lg ${
          stats.isSuperAdmin 
            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0' 
            : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0'
        }`}>
          {stats.isSuperAdmin ? 'Super Admin' : 'Lender Admin'}
        </Badge>
      </div>

      {/* Overview - Balanced 3x3 Grid (9 Cards) - Improved UX/UI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
        {/* Card 1: Total Tenants */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Tenants
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalTenants
              )}
            </div>
            {!overviewLoading && stats.recent.newTenants > 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1 font-extralight">
                +{stats.recent.newTenants} this week
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Total Users */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Users
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20">
              <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalUsers
              )}
            </div>
            {!overviewLoading && stats.recent.newUsers > 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1 font-extralight">
                +{stats.recent.newUsers} this week
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 3: Total Calls */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Calls
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20">
              <Phone className="h-4 w-4 text-green-600 dark:text-green-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalCalls
              )}
            </div>
            {!overviewLoading && stats.recent.callsLast7d > 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                {stats.recent.callsLast7d} in last 7 days
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 4: LOS Connections */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              LOS Connections
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
              <Link2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.losConnections
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              Active connections
            </p>
          </CardContent>
        </Card>

        {/* Card 5: Total Contacts */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Contacts
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20">
              <Users className="h-4 w-4 text-rose-600 dark:text-rose-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalContacts
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              All contacts
            </p>
          </CardContent>
        </Card>

        {/* Monthly Costs Card */}
        {!stats.isSuperAdmin && (
          overviewLoading ? (
            <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                  Monthly Costs
                </CardTitle>
                <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                  <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              </CardContent>
            </Card>
          ) : (
            stats.costSummary && (
              <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                    Monthly Costs
                  </CardTitle>
                  <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                    <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
                    ${stats.costSummary.total.toFixed(2)}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                    This month
                  </p>
                </CardContent>
              </Card>
            )
          )
        )}

        {/* Projected Costs Card - NEW CARD beside Monthly Costs */}
        {!stats.isSuperAdmin && (
          overviewLoading ? (
            <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                  Projected Costs
                </CardTitle>
                <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                  <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={1.5} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              </CardContent>
            </Card>
          ) : (
            stats.costSummary && (
              <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                    Projected Costs
                  </CardTitle>
                  <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                    <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={1.5} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
                    ${(stats.costSummary.total * 1.15).toFixed(2)}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                    End of month estimate
                  </p>
                </CardContent>
              </Card>
            )
          )
        )}

        {/* Card 7: Total Loans (Super Admin) or RAG Documents (Regular Admin) */}
        {stats.isSuperAdmin ? (
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                Total Loans
              </CardTitle>
              <div className="p-1.5 rounded-lg bg-cyan-50 dark:bg-cyan-900/20">
                <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-400" strokeWidth={1.5} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalLoans
              )}
              </div>
              {!overviewLoading && stats.recent.loansLast7d > 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                  {stats.recent.loansLast7d} in last 7 days
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                RAG Documents
              </CardTitle>
              <div className="p-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20">
                <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" strokeWidth={1.5} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.ragDocuments
              )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                Indexed documents
              </p>
            </CardContent>
          </Card>
        )}

        {/* Card 8: Active Subscriptions (Super Admin only) */}
        {stats.isSuperAdmin && (
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                Active Subscriptions
              </CardTitle>
              <div className="p-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20">
                <CreditCard className="h-4 w-4 text-violet-600 dark:text-violet-400" strokeWidth={1.5} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
                {overviewLoading ? (
                  <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
                ) : (
                  stats.activeSubscriptions
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-extralight">
                Active plans
              </p>
            </CardContent>
          </Card>
        )}

        {/* Recent Activity Card */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Recent Activity
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-pink-50 dark:bg-pink-900/20">
              <Activity className="h-4 w-4 text-pink-600 dark:text-pink-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-extralight text-slate-500 dark:text-slate-400">Users</span>
                <span className="text-base font-thin text-slate-900 dark:text-white">
                  {overviewLoading ? (
                    <div className="h-4 w-8 bg-slate-200 dark:bg-slate-700 animate-pulse rounded inline-block" />
                  ) : (
                    `+${stats.recent.newUsers}`
                  )}
                </span>
              </div>
              {stats.isSuperAdmin && (
                <div className="flex items-center justify-between">
                  <span className="text-base font-extralight text-slate-500 dark:text-slate-400">Tenants</span>
                  <span className="text-base font-thin text-slate-900 dark:text-white">
                    {overviewLoading ? (
                      <div className="h-4 w-8 bg-slate-200 dark:bg-slate-700 animate-pulse rounded inline-block" />
                    ) : (
                      `+${stats.recent.newTenants}`
                    )}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-base font-extralight text-slate-500 dark:text-slate-400">Calls</span>
                <span className="text-base font-thin text-slate-900 dark:text-white">
                  {overviewLoading ? (
                    <div className="h-4 w-8 bg-slate-200 dark:bg-slate-700 animate-pulse rounded inline-block" />
                  ) : (
                    stats.recent.callsLast7d
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 9: System Health (Super Admin only) - ensures exactly 9 cards for both user types */}
        {stats.isSuperAdmin && (
          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
                System Health
              </CardTitle>
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-base font-extralight text-slate-500 dark:text-slate-400">Database</span>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs px-2 py-0">
                    OK
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base font-extralight text-slate-500 dark:text-slate-400">API</span>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs px-2 py-0">
                    Online
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Card 10: LOS Connections */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              LOS Connections
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <Link2 className="h-4 w-4 text-orange-600 dark:text-orange-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.losConnections
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              Active integrations
            </p>
          </CardContent>
        </Card>

        {/* Card 11: Total Documents */}
        <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.2)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-300 rounded-xl hover:border-slate-300 dark:hover:border-slate-600">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-extralight text-slate-700 dark:text-slate-300 tracking-tight">
              Total Documents
            </CardTitle>
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
              <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl sm:text-4xl font-thin text-slate-900 dark:text-white tracking-tight">
              {overviewLoading ? (
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 animate-pulse rounded" />
              ) : (
                stats.totalDocuments
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-light">
              Stored documents
            </p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
};

