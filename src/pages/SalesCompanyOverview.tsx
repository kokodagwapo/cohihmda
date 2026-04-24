import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { useSalesCompanyOverviewData } from "@/hooks/useSalesCompanyOverviewData";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type LoanTypeDatum = {
  name: string;
  count: number;
  percent: number;
  fill: string;
};

const TYPE_COLORS = [
  "#312e81",
  "#14b8a6",
  "#7dd3fc",
  "#15803d",
  "#f97316",
  "#e11d48",
  "#9333ea",
];

const formatVolume = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
};

const formatWac = (value: number): string => `${(value || 0).toFixed(3)}%`;

const toLoanTypeData = (values?: Record<string, number>): LoanTypeDatum[] => {
  if (!values) return [];
  const total = Object.values(values).reduce((sum, count) => sum + Number(count || 0), 0);
  if (!total) return [];

  return Object.entries(values)
    .map(([name, count], index) => {
      const normalizedCount = Number(count || 0);
      return {
        name,
        count: normalizedCount,
        percent: (normalizedCount / total) * 100,
        fill: TYPE_COLORS[index % TYPE_COLORS.length],
      };
    })
    .sort((a, b) => b.count - a.count);
};

const SalesCompanyOverview = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId || user?.tenant_id || null;

  const { data: companyOverviewData, loading } = useSalesCompanyOverviewData(
    tenantId,
    selectedChannel,
  );

  const agingData = useMemo(
    () => [
      { range: "0-15", count: companyOverviewData?.aging?.["0-15"] || 0 },
      { range: "16-30", count: companyOverviewData?.aging?.["16-30"] || 0 },
      { range: "31-45", count: companyOverviewData?.aging?.["31-45"] || 0 },
      { range: "46-60", count: companyOverviewData?.aging?.["46-60"] || 0 },
      { range: "61-90", count: companyOverviewData?.aging?.["61-90"] || 0 },
      { range: ">90", count: companyOverviewData?.aging?.[">90"] || 0 },
    ],
    [companyOverviewData?.aging],
  );

  const submittedByType = useMemo(
    () => toLoanTypeData(companyOverviewData?.submittedByType),
    [companyOverviewData?.submittedByType],
  );
  const fundedByType = useMemo(
    () => toLoanTypeData(companyOverviewData?.fundedByType),
    [companyOverviewData?.fundedByType],
  );

  const kpis = [
    {
      title: "Active Loans",
      count: companyOverviewData?.activeLoans?.count || 0,
      volume: companyOverviewData?.activeLoans?.volume || 0,
      wac: companyOverviewData?.activeLoans?.avgInterestRate || 0,
      caption:
        "Active loans are open pipeline loans (not closed/funded/finalized adverse outcomes).",
    },
    {
      title: "Submitted Loans MTD",
      count: companyOverviewData?.submittedMTD?.count || 0,
      volume: companyOverviewData?.submittedMTD?.volume || 0,
      wac: companyOverviewData?.submittedMTD?.avgInterestRate || 0,
      caption:
        "Submitted MTD includes loans with Submitted to Processing date in the current month.",
    },
    {
      title: "Funded Loans MTD",
      count: companyOverviewData?.fundedMTD?.count || 0,
      volume: companyOverviewData?.fundedMTD?.volume || 0,
      wac: companyOverviewData?.fundedMTD?.avgInterestRate || 0,
      caption:
        "Funded MTD includes loans with Funding date in the current month.",
    },
  ];

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Sales Company Overview" />
        <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-3 max-w-[1800px] mx-auto w-full">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {kpis.map((kpi) => (
              <Card key={kpi.title} className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-medium text-slate-600">
                    {kpi.title}
                  </CardTitle>
                  <div className="text-4xl font-semibold text-cyan-700">
                    {loading ? "..." : kpi.count.toLocaleString()}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-3 border-t border-b py-3 mb-3">
                    <div>
                      <p className="text-xs text-slate-500">Volume</p>
                      <p className="text-3xl font-semibold text-cyan-700">
                        {loading ? "..." : formatVolume(kpi.volume)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">WAC</p>
                      <p className="text-3xl font-semibold text-cyan-700">
                        {loading ? "..." : formatWac(kpi.wac)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{kpi.caption}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Aging of Active Loans</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agingData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="range" width={50} />
                      <Tooltip formatter={(value) => [Number(value).toLocaleString(), "Loans"]} />
                      <Bar dataKey="count" fill="#9ca3af" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Loan Type MTD Submitted</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={submittedByType} dataKey="count" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                        {submittedByType.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name, item: any) => [
                          `${Number(value).toLocaleString()} loans (${(item?.payload?.percent || 0).toFixed(1)}%)`,
                          item?.payload?.name || "Loan Type",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Loan Type MTD Funded</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={fundedByType} dataKey="count" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                        {fundedByType.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name, item: any) => [
                          `${Number(value).toLocaleString()} loans (${(item?.payload?.percent || 0).toFixed(1)}%)`,
                          item?.payload?.name || "Loan Type",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default SalesCompanyOverview;
