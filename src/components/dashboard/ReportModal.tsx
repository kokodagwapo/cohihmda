import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, ArrowUp, ArrowDown, Minus, Download, Calendar } from "lucide-react";
import { ReportData } from "@/data/reportSimulations";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  report: ReportData | null;
}

const COLORS = [
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

// Generate diverse, realistic name pool for ReportModal
const generateReportModalNames = () => {
  const firstNames = [
    "Valentina",
    "Benjamin",
    "Naomi",
    "Lawrence",
    "Ingrid",
    "Marcus",
    "Adriana",
    "Malik",
    "Natalie",
    "Dwayne",
    "Isabelle",
    "Nigel",
    "Francesca",
    "Darren",
    "Tamara",
    "Preston",
    "Elena",
    "Sebastian",
    "Camila",
    "Julian",
    "Isabella",
    "Gabriel",
    "Sofia",
    "Lucas",
    "Emma",
    "Noah",
    "Olivia",
    "Liam",
    "Ava",
    "Mason",
    "Mia",
    "Ethan",
    "Charlotte",
    "Alexander",
    "Amelia",
    "James",
    "Harper",
    "Michael",
    "Evelyn",
    "Daniel",
    "Abigail",
    "Matthew",
    "Emily",
    "David",
    "Elizabeth",
    "Joseph",
    "Sofia",
    "William",
    "Aria",
    "John",
    "Scarlett",
    "Andrew",
    "Grace",
    "Joshua",
    "Chloe",
    "Christopher",
    "Victoria",
    "Anthony",
    "Riley",
    "Mark",
  ];

  const lastNames = [
    "Rossi",
    "Kowalczyk",
    "Takahashi",
    "Fitzgerald",
    "Johansson",
    "Oyelaran",
    "Martinez",
    "Chen",
    "Rodriguez",
    "Wilson",
    "Anderson",
    "Kim",
    "Brown",
    "Taylor",
    "White",
    "Johnson",
    "Davis",
    "Thompson",
    "Miller",
    "Garcia",
    "Lopez",
    "Hill",
    "Scott",
    "Green",
    "Adams",
    "Baker",
    "Gonzalez",
    "Nelson",
    "Carter",
    "Mitchell",
    "Perez",
    "Roberts",
    "Turner",
    "Phillips",
    "Campbell",
    "Parker",
    "Evans",
    "Edwards",
    "Collins",
    "Stewart",
    "Sanchez",
    "Morris",
    "Rogers",
    "Reed",
    "Cook",
    "Morgan",
    "Bell",
    "Murphy",
    "Bailey",
    "Rivera",
    "Cooper",
    "Richardson",
    "Cox",
    "Howard",
    "Ward",
    "Torres",
    "Peterson",
    "Gray",
    "Ramirez",
    "James",
  ];

  const allNames: string[] = [];
  for (let i = 0; i < firstNames.length; i++) {
    for (let j = 0; j < lastNames.length; j++) {
      allNames.push(`${firstNames[i]} ${lastNames[j]}`);
    }
  }

  // Shuffle using Fisher-Yates algorithm
  for (let i = allNames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allNames[i], allNames[j]] = [allNames[j], allNames[i]];
  }

  return allNames;
};

const reportModalNamePool = generateReportModalNames();
let reportModalNameIndex = 0;
const getNextReportModalName = () =>
  reportModalNamePool[reportModalNameIndex++ % reportModalNamePool.length];

export const ReportModal: React.FC<ReportModalProps> = ({
  open,
  onClose,
  report,
}) => {
  if (!report) return null;

  const renderChart = (chart: ReportData["charts"][0], index: number) => {
    const commonProps = {
      width: "100%",
      height: 300,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    switch (chart.type) {
      case "line":
        return (
          <ResponsiveContainer key={index} {...commonProps}>
            <LineChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey={Object.keys(chart.data[0] || {})[0]}
                stroke="#9ca3af"
              />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: "8px",
                  color: "#f1f5f9",
                }}
              />
              <Legend />
              {Object.keys(chart.data[0] || {})
                .slice(1)
                .map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case "bar":
        return (
          <ResponsiveContainer key={index} {...commonProps}>
            <BarChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: "8px",
                  color: "#f1f5f9",
                }}
              />
              <Legend />
              {Object.keys(chart.data[0] || {})
                .filter((key) => key !== "name" && key !== "color")
                .map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={COLORS[i % COLORS.length]}
                  />
                ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case "area":
        return (
          <ResponsiveContainer key={index} {...commonProps}>
            <AreaChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey={Object.keys(chart.data[0] || {})[0]}
                stroke="#9ca3af"
              />
              <YAxis stroke="#9ca3af" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: "8px",
                  color: "#f1f5f9",
                }}
              />
              <Legend />
              {Object.keys(chart.data[0] || {})
                .slice(1)
                .map((key, i) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={COLORS[i % COLORS.length]}
                    fill={COLORS[i % COLORS.length]}
                    fillOpacity={0.3}
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer key={index} {...commonProps}>
            <PieChart>
              <Pie
                data={chart.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) =>
                  `${name}: ${(percent * 100).toFixed(0)}%`
                }
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chart.data.map((entry: any, i: number) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={entry.color || COLORS[i % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: "8px",
                  color: "#f1f5f9",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  };

  const getTrendIcon = (trend: "up" | "down" | "neutral") => {
    switch (trend) {
      case "up":
        return <ArrowUp className="w-4 h-4 text-green-500" />;
      case "down":
        return <ArrowDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };

  const getAlertColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "border-l-red-400/50 bg-red-50/20 dark:bg-red-950/10";
      case "high":
        return "border-l-amber-400/50 bg-amber-50/20 dark:bg-amber-950/10";
      case "medium":
        return "border-l-yellow-400/50 bg-yellow-50/20 dark:bg-yellow-950/10";
      default:
        return "border-l-slate-400/50 bg-slate-50/20 dark:bg-slate-950/10";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[75vh] sm:max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-950 p-4 sm:p-6 pt-14 sm:pt-12">
        <DialogHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <report.icon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <DialogTitle className="text-xl sm:text-2xl font-light tracking-tight">
                {report.title}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6 mt-2 pb-12 sm:pb-16">
          {/* Executive Summary - Minimalist */}
          <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-slate-50/20 dark:bg-slate-900/15 backdrop-blur-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-light">
                Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.summary.keyTakeaways.map((takeaway, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-start gap-2 p-2.5 rounded border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20"
                  >
                    <div className="w-1 h-1 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-light leading-relaxed">
                      {takeaway}
                    </p>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Primary KPIs - Minimalist */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            {report.summary.primaryKPI.map((kpi, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.03 }}
              >
                <Card className="h-full border border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/30 backdrop-blur-sm">
                  <CardContent className="p-3">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-light">
                      {kpi.label}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg sm:text-xl font-light text-slate-900 dark:text-slate-100">
                        {kpi.value}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {getTrendIcon(kpi.trend)}
                        <span
                          className={`text-[10px] font-light ${
                            kpi.trend === "up"
                              ? "text-green-600 dark:text-green-500"
                              : kpi.trend === "down"
                                ? "text-red-600 dark:text-red-500"
                                : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {kpi.change}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Charts - Minimalist */}
          {report.charts.map((chart, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="border border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/30 backdrop-blur-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-light">
                    {chart.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                    {renderChart(chart, index)}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}

          {/* Data Tables - Minimalist */}
          {report.tables.map((table, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (report.charts.length + index) * 0.05 }}
            >
              <Card className="border border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/30 backdrop-blur-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-light">
                    {table.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200/50 dark:border-slate-800/50">
                          {table.headers.map((header, i) => (
                            <th
                              key={i}
                              className="text-left p-2 font-light text-slate-600 dark:text-slate-400"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-slate-100/30 dark:border-slate-800/20 hover:bg-slate-50/30 dark:hover:bg-slate-900/20"
                          >
                            {row.map((cell, j) => (
                              <td
                                key={j}
                                className="p-2 text-slate-500 dark:text-slate-400 font-light"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}

          {/* Detailed Breakdown by Category/Stage */}
          {report.id === "1" && (
            <>
              {/* Production Breakdown by Stage */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Production Breakdown by Stage
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          stage: "Locked",
                          count: 47,
                          change: "+12%",
                          color: "emerald",
                          revenue: "$2.1M",
                        },
                        {
                          stage: "Submitted",
                          count: 52,
                          change: "+8%",
                          color: "blue",
                          revenue: "$2.3M",
                        },
                        {
                          stage: "Approved",
                          count: 45,
                          change: "+5%",
                          color: "cyan",
                          revenue: "$2.0M",
                        },
                        {
                          stage: "Funded",
                          count: 38,
                          change: "+3%",
                          color: "purple",
                          revenue: "$1.7M",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                            {item.stage}
                          </p>
                          <p className="text-lg font-light text-slate-900 dark:text-white">
                            {item.count}
                          </p>
                          <p
                            className={`text-[10px] font-light mt-0.5 ${
                              item.color === "emerald"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : item.color === "blue"
                                  ? "text-blue-600 dark:text-blue-400"
                                  : item.color === "cyan"
                                    ? "text-cyan-600 dark:text-cyan-400"
                                    : "text-purple-600 dark:text-purple-400"
                            }`}
                          >
                            {item.change}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                            {item.revenue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Hourly Production Trend */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Hourly Production Today
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart
                          data={[
                            {
                              hour: "8AM",
                              locked: 2,
                              submitted: 3,
                              approved: 1,
                            },
                            {
                              hour: "9AM",
                              locked: 5,
                              submitted: 4,
                              approved: 3,
                            },
                            {
                              hour: "10AM",
                              locked: 8,
                              submitted: 7,
                              approved: 5,
                            },
                            {
                              hour: "11AM",
                              locked: 6,
                              submitted: 8,
                              approved: 7,
                            },
                            {
                              hour: "12PM",
                              locked: 4,
                              submitted: 5,
                              approved: 6,
                            },
                            {
                              hour: "1PM",
                              locked: 7,
                              submitted: 6,
                              approved: 5,
                            },
                            {
                              hour: "2PM",
                              locked: 9,
                              submitted: 10,
                              approved: 8,
                            },
                            {
                              hour: "3PM",
                              locked: 6,
                              submitted: 9,
                              approved: 10,
                            },
                          ]}
                          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis
                            dataKey="hour"
                            stroke="#9ca3af"
                            fontSize={10}
                          />
                          <YAxis stroke="#9ca3af" fontSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="locked"
                            stackId="1"
                            stroke="#10b981"
                            fill="#10b981"
                            fillOpacity={0.4}
                            name="Locked"
                          />
                          <Area
                            type="monotone"
                            dataKey="submitted"
                            stackId="1"
                            stroke="#3b82f6"
                            fill="#3b82f6"
                            fillOpacity={0.4}
                            name="Submitted"
                          />
                          <Area
                            type="monotone"
                            dataKey="approved"
                            stackId="1"
                            stroke="#8b5cf6"
                            fill="#8b5cf6"
                            fillOpacity={0.4}
                            name="Approved"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Branch Performance Today */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Branch Performance Today
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          branch: "North Region HQ",
                          locked: 12,
                          revenue: "$540K",
                          target: 110,
                          status: "ahead",
                        },
                        {
                          branch: "Downtown Metro",
                          locked: 10,
                          revenue: "$450K",
                          target: 95,
                          status: "ahead",
                        },
                        {
                          branch: "Coastal Division",
                          locked: 8,
                          revenue: "$360K",
                          target: 85,
                          status: "on-track",
                        },
                        {
                          branch: "Suburban West",
                          locked: 6,
                          revenue: "$270K",
                          target: 75,
                          status: "behind",
                        },
                        {
                          branch: "East Valley",
                          locked: 5,
                          revenue: "$225K",
                          target: 70,
                          status: "behind",
                        },
                      ].map((branch, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                              {branch.branch}
                            </p>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded ${
                                branch.status === "ahead"
                                  ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                                  : branch.status === "on-track"
                                    ? "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                                    : "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                              }`}
                            >
                              {branch.status === "ahead"
                                ? "↑ Ahead"
                                : branch.status === "on-track"
                                  ? "→ On Track"
                                  : "↓ Behind"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Locked
                                </p>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">
                                  {branch.locked}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                  Revenue
                                </p>
                                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                  {branch.revenue}
                                </p>
                              </div>
                            </div>
                            <div className="w-20">
                              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${branch.target >= 100 ? "bg-emerald-500" : branch.target >= 80 ? "bg-blue-500" : "bg-amber-500"}`}
                                  style={{
                                    width: `${Math.min(branch.target, 100)}%`,
                                  }}
                                />
                              </div>
                              <p className="text-[9px] text-slate-500 dark:text-slate-400 text-right mt-0.5">
                                {branch.target}% target
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Pipeline Health Snapshot */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Pipeline Health Snapshot
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        {
                          status: "Healthy",
                          count: 156,
                          pct: 68,
                          color: "emerald",
                          value: "$42.5M",
                        },
                        {
                          status: "At Risk",
                          count: 52,
                          pct: 22,
                          color: "amber",
                          value: "$14.2M",
                        },
                        {
                          status: "Critical",
                          count: 23,
                          pct: 10,
                          color: "red",
                          value: "$6.3M",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-800/50 text-center"
                        >
                          <div
                            className={`w-10 h-10 mx-auto rounded-full flex items-center justify-center mb-2 ${
                              item.color === "emerald"
                                ? "bg-emerald-100 dark:bg-emerald-950/30"
                                : item.color === "amber"
                                  ? "bg-amber-100 dark:bg-amber-950/30"
                                  : "bg-red-100 dark:bg-red-950/30"
                            }`}
                          >
                            <span
                              className={`text-sm font-medium ${
                                item.color === "emerald"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : item.color === "amber"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {item.pct}%
                            </span>
                          </div>
                          <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                            {item.status}
                          </p>
                          <p className="text-lg font-light text-slate-900 dark:text-white">
                            {item.count}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {report.id === "2" && (
            <>
              {/* Risk Breakdown by Category */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Risk Breakdown by Category
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          category: "Rate Lock Expirations",
                          count: 12,
                          risk: "CRITICAL",
                          exposure: "$892K",
                          trend: "up",
                        },
                        {
                          category: "Aging Loans (>30 days)",
                          count: 23,
                          risk: "HIGH",
                          exposure: "$1.2M",
                          trend: "up",
                        },
                        {
                          category: "Withdrawals Today",
                          count: 8,
                          risk: "MEDIUM",
                          exposure: "$450K",
                          trend: "stable",
                        },
                        {
                          category: "Declinations Today",
                          count: 5,
                          risk: "LOW",
                          exposure: "$280K",
                          trend: "down",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-lg bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-800/50"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                item.risk === "CRITICAL"
                                  ? "bg-red-500 animate-pulse"
                                  : item.risk === "HIGH"
                                    ? "bg-amber-500"
                                    : item.risk === "MEDIUM"
                                      ? "bg-yellow-500"
                                      : "bg-slate-400"
                              }`}
                            />
                            <div>
                              <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                                {item.category}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {item.count} cases
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-[10px] ${
                                item.trend === "up"
                                  ? "text-red-500"
                                  : item.trend === "down"
                                    ? "text-emerald-500"
                                    : "text-slate-400"
                              }`}
                            >
                              {item.trend === "up"
                                ? "↑"
                                : item.trend === "down"
                                  ? "↓"
                                  : "→"}
                            </span>
                            <div className="text-right">
                              <p
                                className={`text-xs font-light ${
                                  item.risk === "CRITICAL"
                                    ? "text-red-600 dark:text-red-400"
                                    : item.risk === "HIGH"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : item.risk === "MEDIUM"
                                        ? "text-yellow-600 dark:text-yellow-400"
                                        : "text-slate-500 dark:text-slate-400"
                                }`}
                              >
                                {item.risk}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {item.exposure}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Fallout Cause Analysis */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Top Fallout Causes Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-3">
                      {[
                        {
                          cause: "Rate Increases",
                          pct: 38,
                          count: 18,
                          color: "#ef4444",
                          mitigation: "Monitor rate movement, lock earlier",
                        },
                        {
                          cause: "Appraisal Issues",
                          pct: 24,
                          count: 12,
                          color: "#f59e0b",
                          mitigation: "Pre-qualify property value",
                        },
                        {
                          cause: "Credit Concerns",
                          pct: 18,
                          count: 9,
                          color: "#eab308",
                          mitigation: "Early credit review",
                        },
                        {
                          cause: "MLO Behavior",
                          pct: 12,
                          count: 6,
                          color: "#10b981",
                          mitigation: "Enhanced training",
                        },
                        {
                          cause: "Ops Delays",
                          pct: 8,
                          count: 4,
                          color: "#3b82f6",
                          mitigation: "Process automation",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded"
                                style={{ backgroundColor: item.color }}
                              />
                              <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                                {item.cause}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-900 dark:text-white">
                                {item.pct}%
                              </span>
                              <span className="text-[10px] text-slate-500">
                                ({item.count})
                              </span>
                            </div>
                          </div>
                          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${item.pct}%`,
                                backgroundColor: item.color,
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="font-medium">Mitigation:</span>{" "}
                            {item.mitigation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Rate Lock Expiration Timeline */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Rate Lock Expiration Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                          data={[
                            { day: "Today", expiring: 3, amount: 450 },
                            { day: "Tomorrow", expiring: 4, amount: 620 },
                            { day: "Day 3", expiring: 2, amount: 280 },
                            { day: "Day 4", expiring: 1, amount: 150 },
                            { day: "Day 5", expiring: 1, amount: 180 },
                            { day: "Day 6", expiring: 0, amount: 0 },
                            { day: "Day 7", expiring: 1, amount: 120 },
                          ]}
                          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis dataKey="day" stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Bar
                            dataKey="expiring"
                            fill="#ef4444"
                            name="Locks Expiring"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <div className="text-center p-2 rounded bg-red-50 dark:bg-red-950/20">
                        <p className="text-[10px] text-red-600 dark:text-red-400">
                          Next 48 Hours
                        </p>
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          7 locks
                        </p>
                        <p className="text-[10px] text-red-500">
                          $1.07M at risk
                        </p>
                      </div>
                      <div className="text-center p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">
                          Days 3-5
                        </p>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          4 locks
                        </p>
                        <p className="text-[10px] text-amber-500">
                          $610K at risk
                        </p>
                      </div>
                      <div className="text-center p-2 rounded bg-slate-50/30 dark:bg-slate-800/20">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400">
                          Days 6-7
                        </p>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          1 lock
                        </p>
                        <p className="text-[10px] text-slate-500">
                          $120K at risk
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* At-Risk Loans by Channel */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      At-Risk Loans by Channel
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          channel: "FHA Purchase",
                          count: 8,
                          risk: "high",
                          exposure: "$520K",
                          change: "+15%",
                        },
                        {
                          channel: "Conv Refi",
                          count: 5,
                          risk: "medium",
                          exposure: "$380K",
                          change: "+5%",
                        },
                        {
                          channel: "VA Purchase",
                          count: 3,
                          risk: "low",
                          exposure: "$245K",
                          change: "-2%",
                        },
                        {
                          channel: "Jumbo",
                          count: 2,
                          risk: "low",
                          exposure: "$680K",
                          change: "-8%",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${
                            item.risk === "high"
                              ? "bg-red-50/50 dark:bg-red-950/20 border-red-200/50 dark:border-red-900/50"
                              : item.risk === "medium"
                                ? "bg-amber-50/30 dark:bg-amber-950/15 border-amber-200/30 dark:border-amber-900/20"
                                : "bg-slate-50/30 dark:bg-slate-900/20 border-slate-200/30 dark:border-slate-800/20"
                          }`}
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                            {item.channel}
                          </p>
                          <p className="text-lg font-light text-slate-900 dark:text-white">
                            {item.count}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {item.exposure}
                          </p>
                          <p
                            className={`text-[10px] mt-1 ${item.change.startsWith("+") ? "text-red-500" : "text-emerald-500"}`}
                          >
                            {item.change} vs last week
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {report.id === "3" && (
            <>
              {/* Performance Breakdown by Tier */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Performance Breakdown by Tier
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-3">
                      {[
                        {
                          tier: "Top Tier",
                          count: 20,
                          revenue: "$15.6M",
                          pct: "65%",
                          avgLoans: 62.5,
                          pullThrough: "89%",
                          color: "tier-top",
                        },
                        {
                          tier: "Second Tier",
                          count: 30,
                          revenue: "$6.3M",
                          pct: "26%",
                          avgLoans: 21,
                          pullThrough: "75%",
                          color: "tier-second",
                        },
                        {
                          tier: "Bottom Tier",
                          count: 50,
                          revenue: "$2.1M",
                          pct: "9%",
                          avgLoans: 4.2,
                          pullThrough: "58%",
                          color: "tier-bottom",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${
                            item.color === "emerald"
                              ? "bg-emerald-50/30 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-900/50"
                              : item.color === "amber"
                                ? "bg-amber-50/30 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/50"
                                : "bg-rose-50/30 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-900/50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  item.color === "emerald"
                                    ? "bg-emerald-500"
                                    : item.color === "amber"
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                }`}
                              />
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                {item.tier}
                              </p>
                            </div>
                            <p className="text-xs font-light text-slate-500 dark:text-slate-400">
                              {item.count} LOs
                            </p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-center">
                            <div>
                              <p className="text-sm font-light text-slate-900 dark:text-white">
                                {item.revenue}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Revenue
                              </p>
                            </div>
                            <div>
                              <p className="text-sm font-light text-slate-900 dark:text-white">
                                {item.pct}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                of Total
                              </p>
                            </div>
                            <div>
                              <p className="text-sm font-light text-slate-900 dark:text-white">
                                {item.avgLoans}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Avg Loans
                              </p>
                            </div>
                            <div>
                              <p
                                className={`text-sm font-light ${
                                  item.color === "emerald"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : item.color === "amber"
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                {item.pullThrough}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Pull-Through
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Top Performers */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Top 5 Performers This Month
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          rank: 1,
                          name: getNextReportModalName(),
                          branch: "North Region",
                          loans: 28,
                          revenue: "$348.6K",
                          pullThrough: "92%",
                        },
                        {
                          rank: 2,
                          name: getNextReportModalName(),
                          branch: "Downtown",
                          loans: 25,
                          revenue: "$311.3K",
                          pullThrough: "89%",
                        },
                        {
                          rank: 3,
                          name: getNextReportModalName(),
                          branch: "Coastal",
                          loans: 23,
                          revenue: "$286.4K",
                          pullThrough: "87%",
                        },
                        {
                          rank: 4,
                          name: getNextReportModalName(),
                          branch: "West",
                          loans: 22,
                          revenue: "$274.0K",
                          pullThrough: "85%",
                        },
                        {
                          rank: 5,
                          name: getNextReportModalName(),
                          branch: "East Valley",
                          loans: 21,
                          revenue: "$261.5K",
                          pullThrough: "84%",
                        },
                      ].map((lo, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                              lo.rank === 1
                                ? "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400"
                                : lo.rank === 2
                                  ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                  : lo.rank === 3
                                    ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-500"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {lo.rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                              {lo.name}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {lo.branch}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {lo.revenue}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {lo.loans} loans
                            </p>
                          </div>
                          <div className="w-12 text-right">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {lo.pullThrough}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* LOs Requiring Attention */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-red-200/50 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light text-red-700 dark:text-red-400">
                      ⚠ LOs Requiring Coaching
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          name: getNextReportModalName(),
                          currentTier: "Middle",
                          trend: "↓ Bottom",
                          issue: "Low pull-through (62%)",
                          action: "Schedule coaching session",
                        },
                        {
                          name: getNextReportModalName(),
                          currentTier: "Middle",
                          trend: "↓ Bottom",
                          issue: "Declining volume",
                          action: "Review pipeline",
                        },
                        {
                          name: getNextReportModalName(),
                          currentTier: "Bottom",
                          trend: "↓",
                          issue: "Multiple client complaints",
                          action: "Performance improvement plan",
                        },
                      ].map((lo, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-white/30 dark:bg-slate-900/20 border border-red-200/30 dark:border-red-900/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {lo.name}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">
                                {lo.currentTier}
                              </span>
                              <span className="text-[10px] text-red-500">
                                {lo.trend}
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-red-600 dark:text-red-400 mb-1">
                            Issue: {lo.issue}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="font-medium">Recommended:</span>{" "}
                            {lo.action}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Pull-Through Trend by Tier */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Pull-Through Rate Trend by Tier
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart
                          data={[
                            {
                              week: "W1",
                              topTier: 87,
                              middleTier: 74,
                              bottomTier: 55,
                            },
                            {
                              week: "W2",
                              topTier: 88,
                              middleTier: 73,
                              bottomTier: 56,
                            },
                            {
                              week: "W3",
                              topTier: 89,
                              middleTier: 75,
                              bottomTier: 54,
                            },
                            {
                              week: "W4",
                              topTier: 90,
                              middleTier: 76,
                              bottomTier: 57,
                            },
                            {
                              week: "W5",
                              topTier: 89,
                              middleTier: 75,
                              bottomTier: 58,
                            },
                            {
                              week: "W6",
                              topTier: 91,
                              middleTier: 77,
                              bottomTier: 56,
                            },
                          ]}
                          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis
                            dataKey="week"
                            stroke="#9ca3af"
                            fontSize={10}
                          />
                          <YAxis
                            stroke="#9ca3af"
                            fontSize={10}
                            domain={[50, 95]}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="topTier"
                            stroke="#00008F"
                            strokeWidth={2}
                            name="Top Tier"
                          />
                          <Line
                            type="monotone"
                            dataKey="middleTier"
                            stroke="#52B852"
                            strokeWidth={2}
                            name="Second Tier"
                          />
                          <Line
                            type="monotone"
                            dataKey="bottomTier"
                            stroke="#B2DCB2"
                            strokeWidth={2}
                            name="Bottom Tier"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {report.id === "4" && (
            <>
              {/* SLA Performance by Stage */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      SLA Performance by Stage
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          stage: "Processing",
                          target: "5 days",
                          actual: "5.2 days",
                          compliance: "96%",
                          status: "GREEN",
                          capacity: "78%",
                          queue: 42,
                        },
                        {
                          stage: "Underwriting",
                          target: "7 days",
                          actual: "7.8 days",
                          compliance: "89%",
                          status: "YELLOW",
                          capacity: "92%",
                          queue: 67,
                        },
                        {
                          stage: "Closing",
                          target: "10 days",
                          actual: "11.2 days",
                          compliance: "88%",
                          status: "YELLOW",
                          capacity: "65%",
                          queue: 31,
                        },
                        {
                          stage: "Post-Closing",
                          target: "3 days",
                          actual: "2.8 days",
                          compliance: "100%",
                          status: "GREEN",
                          capacity: "58%",
                          queue: 18,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                              {item.stage}
                            </p>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded ${
                                item.status === "GREEN"
                                  ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                                  : "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Target
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.target}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Actual
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.actual}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Compliance
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.compliance}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Capacity
                              </p>
                              <p
                                className={`font-light ${parseInt(item.capacity) > 85 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                              >
                                {item.capacity}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                In Queue
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.queue}
                              </p>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="mt-2 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${item.status === "GREEN" ? "bg-emerald-500" : "bg-amber-500"}`}
                              style={{ width: item.compliance }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Team Workload Distribution */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Team Workload Distribution
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        {
                          name: getNextReportModalName(),
                          role: "Processor",
                          files: 14,
                          avgDays: 4.8,
                          status: "normal",
                          overdue: 0,
                        },
                        {
                          name: getNextReportModalName(),
                          role: "Processor",
                          files: 18,
                          avgDays: 5.6,
                          status: "high",
                          overdue: 2,
                        },
                        {
                          name: getNextReportModalName(),
                          role: "Underwriter",
                          files: 12,
                          avgDays: 7.2,
                          status: "normal",
                          overdue: 1,
                        },
                        {
                          name: getNextReportModalName(),
                          role: "Underwriter",
                          files: 15,
                          avgDays: 8.1,
                          status: "high",
                          overdue: 3,
                        },
                        {
                          name: getNextReportModalName(),
                          role: "Closer",
                          files: 8,
                          avgDays: 9.5,
                          status: "normal",
                          overdue: 0,
                        },
                        {
                          name: getNextReportModalName(),
                          role: "Closer",
                          files: 11,
                          avgDays: 11.8,
                          status: "high",
                          overdue: 2,
                        },
                      ].map((person, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                {person.name}
                              </p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                {person.role}
                              </p>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded ${
                                person.status === "high"
                                  ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                                  : "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                              }`}
                            >
                              {person.status === "high"
                                ? "High Load"
                                : "Normal"}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Active Files
                              </p>
                              <p className="font-medium text-slate-700 dark:text-slate-300">
                                {person.files}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Avg Days
                              </p>
                              <p className="font-medium text-slate-700 dark:text-slate-300">
                                {person.avgDays}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Overdue
                              </p>
                              <p
                                className={`font-medium ${person.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                              >
                                {person.overdue}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Bottleneck Analysis */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Bottleneck & Delay Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-3">
                      {[
                        {
                          cause: "Document Collection Delays",
                          pct: 38,
                          impact: "$892K",
                          trend: "up",
                          files: 24,
                        },
                        {
                          cause: "Appraisal Delays",
                          pct: 24,
                          impact: "$564K",
                          trend: "stable",
                          files: 15,
                        },
                        {
                          cause: "Underwriter Review Backlog",
                          pct: 18,
                          impact: "$423K",
                          trend: "up",
                          files: 11,
                        },
                        {
                          cause: "Title Issues",
                          pct: 12,
                          impact: "$282K",
                          trend: "down",
                          files: 8,
                        },
                        {
                          cause: "Other Delays",
                          pct: 8,
                          impact: "$188K",
                          trend: "stable",
                          files: 5,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-light text-slate-700 dark:text-slate-300">
                              {item.cause}
                            </p>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] ${
                                  item.trend === "up"
                                    ? "text-red-600 dark:text-red-400"
                                    : item.trend === "down"
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-slate-500 dark:text-slate-400"
                                }`}
                              >
                                {item.trend === "up"
                                  ? "↑"
                                  : item.trend === "down"
                                    ? "↓"
                                    : "→"}
                              </span>
                              <span className="text-xs font-medium text-slate-900 dark:text-white">
                                {item.pct}%
                              </span>
                            </div>
                          </div>
                          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                            <div
                              className={`h-full rounded-full ${
                                item.pct >= 30
                                  ? "bg-red-500"
                                  : item.pct >= 20
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                              }`}
                              style={{ width: `${item.pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                            <span>{item.files} files affected</span>
                            <span>Revenue at risk: {item.impact}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Cycle Time Trend Chart */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Weekly Cycle Time Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart
                          data={[
                            {
                              week: "W1",
                              cycleTime: 31.2,
                              target: 30,
                              processing: 5.1,
                              uw: 7.4,
                              closing: 10.2,
                              postClose: 2.8,
                            },
                            {
                              week: "W2",
                              cycleTime: 30.8,
                              target: 30,
                              processing: 5.0,
                              uw: 7.2,
                              closing: 10.0,
                              postClose: 2.9,
                            },
                            {
                              week: "W3",
                              cycleTime: 32.4,
                              target: 30,
                              processing: 5.3,
                              uw: 7.8,
                              closing: 10.8,
                              postClose: 2.8,
                            },
                            {
                              week: "W4",
                              cycleTime: 31.5,
                              target: 30,
                              processing: 5.2,
                              uw: 7.5,
                              closing: 10.5,
                              postClose: 2.7,
                            },
                            {
                              week: "W5",
                              cycleTime: 30.2,
                              target: 30,
                              processing: 4.9,
                              uw: 7.0,
                              closing: 9.8,
                              postClose: 2.8,
                            },
                            {
                              week: "W6",
                              cycleTime: 32.0,
                              target: 30,
                              processing: 5.2,
                              uw: 7.8,
                              closing: 11.2,
                              postClose: 2.8,
                            },
                          ]}
                          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis
                            dataKey="week"
                            stroke="#9ca3af"
                            fontSize={10}
                          />
                          <YAxis stroke="#9ca3af" fontSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="cycleTime"
                            stroke="#3b82f6"
                            fill="#3b82f6"
                            fillOpacity={0.2}
                            name="Cycle Time"
                          />
                          <Line
                            type="monotone"
                            dataKey="target"
                            stroke="#ef4444"
                            strokeDasharray="5 5"
                            name="Target"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {[
                        { label: "Best Week", value: "W5", days: "30.2d" },
                        { label: "Worst Week", value: "W3", days: "32.4d" },
                        { label: "Avg Cycle", value: "—", days: "31.4d" },
                        { label: "Target", value: "—", days: "30.0d" },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="text-center p-2 rounded bg-slate-100/50 dark:bg-slate-800/50"
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {item.label}
                          </p>
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            {item.days}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {report.id === "5" && (
            <>
              {/* Rate Breakdown by Product */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Rate Breakdown by Product
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          product: "Conventional",
                          rate: "6.75%",
                          vsMarket: "-0.125%",
                          locked: "72%",
                          margin: "250 bps",
                          volume: "$12.8M",
                        },
                        {
                          product: "FHA",
                          rate: "6.50%",
                          vsMarket: "-0.10%",
                          locked: "65%",
                          margin: "280 bps",
                          volume: "$5.2M",
                        },
                        {
                          product: "VA",
                          rate: "6.45%",
                          vsMarket: "-0.15%",
                          locked: "68%",
                          margin: "270 bps",
                          volume: "$3.1M",
                        },
                        {
                          product: "Jumbo",
                          rate: "7.10%",
                          vsMarket: "-0.05%",
                          locked: "75%",
                          margin: "300 bps",
                          volume: "$2.9M",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {item.product}
                            </p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-slate-900 dark:text-white">
                                {item.rate}
                              </p>
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                {item.vsMarket}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Locked
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.locked}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Margin
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.margin}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Volume
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.volume}
                              </p>
                            </div>
                            <div className="flex items-end justify-end">
                              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: item.locked }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Rate Trend vs Competitors */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      30-Year Fixed Rate vs Competitors (Last 14 Days)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart
                          data={[
                            {
                              day: "D1",
                              ourRate: 6.65,
                              compA: 6.72,
                              compB: 6.7,
                              market: 6.68,
                            },
                            {
                              day: "D2",
                              ourRate: 6.68,
                              compA: 6.75,
                              compB: 6.72,
                              market: 6.7,
                            },
                            {
                              day: "D3",
                              ourRate: 6.7,
                              compA: 6.78,
                              compB: 6.75,
                              market: 6.72,
                            },
                            {
                              day: "D4",
                              ourRate: 6.72,
                              compA: 6.8,
                              compB: 6.77,
                              market: 6.75,
                            },
                            {
                              day: "D5",
                              ourRate: 6.7,
                              compA: 6.77,
                              compB: 6.74,
                              market: 6.73,
                            },
                            {
                              day: "D6",
                              ourRate: 6.68,
                              compA: 6.75,
                              compB: 6.72,
                              market: 6.71,
                            },
                            {
                              day: "D7",
                              ourRate: 6.72,
                              compA: 6.78,
                              compB: 6.76,
                              market: 6.74,
                            },
                            {
                              day: "D8",
                              ourRate: 6.75,
                              compA: 6.82,
                              compB: 6.79,
                              market: 6.78,
                            },
                            {
                              day: "D9",
                              ourRate: 6.73,
                              compA: 6.8,
                              compB: 6.77,
                              market: 6.76,
                            },
                            {
                              day: "D10",
                              ourRate: 6.7,
                              compA: 6.77,
                              compB: 6.74,
                              market: 6.73,
                            },
                            {
                              day: "D11",
                              ourRate: 6.72,
                              compA: 6.79,
                              compB: 6.76,
                              market: 6.75,
                            },
                            {
                              day: "D12",
                              ourRate: 6.74,
                              compA: 6.81,
                              compB: 6.78,
                              market: 6.77,
                            },
                            {
                              day: "D13",
                              ourRate: 6.73,
                              compA: 6.8,
                              compB: 6.77,
                              market: 6.76,
                            },
                            {
                              day: "D14",
                              ourRate: 6.75,
                              compA: 6.82,
                              compB: 6.79,
                              market: 6.78,
                            },
                          ]}
                          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis dataKey="day" stroke="#9ca3af" fontSize={10} />
                          <YAxis
                            stroke="#9ca3af"
                            fontSize={10}
                            domain={[6.6, 6.9]}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="ourRate"
                            stroke="#10b981"
                            strokeWidth={2}
                            name="Our Rate"
                          />
                          <Line
                            type="monotone"
                            dataKey="compA"
                            stroke="#ef4444"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            name="Competitor A"
                          />
                          <Line
                            type="monotone"
                            dataKey="compB"
                            stroke="#f59e0b"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            name="Competitor B"
                          />
                          <Line
                            type="monotone"
                            dataKey="market"
                            stroke="#64748b"
                            strokeWidth={1}
                            name="Market Avg"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-slate-600 dark:text-slate-400">
                          We're beating market by avg 3 bps
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Lock/Float Recommendation */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-blue-200/50 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light text-blue-700 dark:text-blue-400">
                      💡 Cohi Lock/Float Recommendation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-white/50 dark:bg-slate-900/50 border border-blue-200/50 dark:border-blue-900/50">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Current Recommendation
                        </p>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg font-light text-blue-600 dark:text-blue-400">
                            LOCK
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
                            High Confidence
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Rates expected to rise 5-10 bps in next 7 days based
                          on Fed signals.
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-white/50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-800/50">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Market Factors
                        </p>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">
                              Fed Policy
                            </span>
                            <span className="text-[10px] text-amber-600">
                              Hawkish
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">
                              10Y Treasury
                            </span>
                            <span className="text-[10px] text-red-500">
                              ↑ Rising
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">
                              MBS Spreads
                            </span>
                            <span className="text-[10px] text-slate-600">
                              Stable
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Pricing Exceptions */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Pricing Exceptions This Week
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          branch: "North Region",
                          count: 4,
                          avgBps: "-12 bps",
                          trend: "down",
                        },
                        {
                          branch: "Downtown",
                          count: 3,
                          avgBps: "-8 bps",
                          trend: "down",
                        },
                        {
                          branch: "Coastal",
                          count: 3,
                          avgBps: "-10 bps",
                          trend: "stable",
                        },
                        {
                          branch: "West",
                          count: 2,
                          avgBps: "-6 bps",
                          trend: "stable",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-800/50 text-center"
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                            {item.branch}
                          </p>
                          <p className="text-lg font-light text-slate-900 dark:text-white">
                            {item.count}
                          </p>
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">
                            {item.avgBps}
                          </p>
                          <p
                            className={`text-[9px] mt-1 ${item.trend === "down" ? "text-emerald-500" : "text-slate-400"}`}
                          >
                            {item.trend === "down"
                              ? "↓ Decreasing"
                              : "→ Stable"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {report.id === "6" && (
            <>
              {/* Profitability Breakdown by Product */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: (report.charts.length + report.tables.length) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Profitability Breakdown by Product
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          product: "Conventional",
                          revenue: "$17.5M",
                          cost: "$11.5M",
                          profit: "$6.0M",
                          margin: "34.3%",
                          loans: 425,
                        },
                        {
                          product: "FHA",
                          revenue: "$8.4M",
                          cost: "$5.88M",
                          profit: "$2.52M",
                          margin: "30.0%",
                          loans: 185,
                        },
                        {
                          product: "VA",
                          revenue: "$3.5M",
                          cost: "$2.45M",
                          profit: "$1.05M",
                          margin: "30.0%",
                          loans: 78,
                        },
                        {
                          product: "Jumbo",
                          revenue: "$1.2M",
                          cost: "$720K",
                          profit: "$480K",
                          margin: "40.0%",
                          loans: 12,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {item.product}
                            </p>
                            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {item.profit}
                            </p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Revenue
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.revenue}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Cost
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.cost}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Margin
                              </p>
                              <p className="font-light text-emerald-600 dark:text-emerald-400">
                                {item.margin}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Loans
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.loans}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: item.margin }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Daily P&L Trend */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 1) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Daily P&L Trend (Last 14 Days)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="bg-slate-50/30 dark:bg-slate-900/20 rounded border border-slate-200/30 dark:border-slate-800/20 p-3">
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart
                          data={[
                            {
                              day: "D1",
                              revenue: 1.82,
                              cost: 1.35,
                              profit: 0.47,
                            },
                            {
                              day: "D2",
                              revenue: 1.95,
                              cost: 1.42,
                              profit: 0.53,
                            },
                            {
                              day: "D3",
                              revenue: 1.78,
                              cost: 1.3,
                              profit: 0.48,
                            },
                            {
                              day: "D4",
                              revenue: 2.1,
                              cost: 1.52,
                              profit: 0.58,
                            },
                            {
                              day: "D5",
                              revenue: 1.88,
                              cost: 1.38,
                              profit: 0.5,
                            },
                            {
                              day: "D6",
                              revenue: 1.65,
                              cost: 1.22,
                              profit: 0.43,
                            },
                            {
                              day: "D7",
                              revenue: 1.72,
                              cost: 1.28,
                              profit: 0.44,
                            },
                            {
                              day: "D8",
                              revenue: 1.92,
                              cost: 1.4,
                              profit: 0.52,
                            },
                            {
                              day: "D9",
                              revenue: 2.05,
                              cost: 1.48,
                              profit: 0.57,
                            },
                            {
                              day: "D10",
                              revenue: 1.85,
                              cost: 1.35,
                              profit: 0.5,
                            },
                            {
                              day: "D11",
                              revenue: 1.98,
                              cost: 1.45,
                              profit: 0.53,
                            },
                            {
                              day: "D12",
                              revenue: 2.12,
                              cost: 1.55,
                              profit: 0.57,
                            },
                            {
                              day: "D13",
                              revenue: 1.9,
                              cost: 1.38,
                              profit: 0.52,
                            },
                            {
                              day: "D14",
                              revenue: 1.85,
                              cost: 1.32,
                              profit: 0.53,
                            },
                          ]}
                          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#374151"
                            opacity={0.3}
                          />
                          <XAxis dataKey="day" stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: "8px",
                              color: "#f1f5f9",
                            }}
                          />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#3b82f6"
                            fill="#3b82f6"
                            fillOpacity={0.2}
                            name="Revenue ($M)"
                          />
                          <Area
                            type="monotone"
                            dataKey="profit"
                            stroke="#10b981"
                            fill="#10b981"
                            fillOpacity={0.4}
                            name="Profit ($M)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div className="text-center p-2 rounded bg-blue-50/50 dark:bg-blue-950/20">
                        <p className="text-[10px] text-blue-600 dark:text-blue-400">
                          Avg Daily Revenue
                        </p>
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          $1.90M
                        </p>
                      </div>
                      <div className="text-center p-2 rounded bg-emerald-50/50 dark:bg-emerald-950/20">
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          Avg Daily Profit
                        </p>
                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                          $510K
                        </p>
                      </div>
                      <div className="text-center p-2 rounded bg-slate-50/50 dark:bg-slate-800/50">
                        <p className="text-[10px] text-slate-600 dark:text-slate-400">
                          Avg Margin
                        </p>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          26.8%
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Expense Variance by Department */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 2) * 0.05,
                }}
              >
                <Card className="border border-slate-200/30 dark:border-slate-800/20 bg-white/30 dark:bg-slate-900/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light">
                      Expense Variance by Department
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-2">
                      {[
                        {
                          dept: "Operations",
                          budget: "$2.1M",
                          actual: "$2.05M",
                          variance: "-$50K",
                          status: "under",
                          pct: -2.4,
                        },
                        {
                          dept: "Sales",
                          budget: "$1.8M",
                          actual: "$1.82M",
                          variance: "+$20K",
                          status: "over",
                          pct: 1.1,
                        },
                        {
                          dept: "Technology",
                          budget: "$450K",
                          actual: "$445K",
                          variance: "-$5K",
                          status: "under",
                          pct: -1.1,
                        },
                        {
                          dept: "Administration",
                          budget: "$320K",
                          actual: "$325K",
                          variance: "+$5K",
                          status: "over",
                          pct: 1.6,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-50/30 dark:bg-slate-900/20 border border-slate-200/30 dark:border-slate-800/20"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {item.dept}
                            </p>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded ${
                                item.status === "under"
                                  ? "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                                  : "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                              }`}
                            >
                              {item.status === "under"
                                ? "Under Budget"
                                : "Over Budget"}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Budget
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.budget}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Actual
                              </p>
                              <p className="font-light text-slate-700 dark:text-slate-300">
                                {item.actual}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Variance
                              </p>
                              <p
                                className={`font-light ${item.status === "under" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                              >
                                {item.variance}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                % Var
                              </p>
                              <p
                                className={`font-light ${item.pct < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                              >
                                {item.pct > 0 ? "+" : ""}
                                {item.pct}%
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Hedging Impact Analysis */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay:
                    (report.charts.length + report.tables.length + 3) * 0.05,
                }}
              >
                <Card className="border border-emerald-200/50 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20 backdrop-blur-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-light text-emerald-700 dark:text-emerald-400">
                      📈 Hedging Impact (Last 4 Weeks)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          week: "This Week",
                          gain: "+$125K",
                          movement: "Favorable",
                          positive: true,
                        },
                        {
                          week: "Last Week",
                          gain: "+$85K",
                          movement: "Favorable",
                          positive: true,
                        },
                        {
                          week: "2 Weeks Ago",
                          gain: "-$45K",
                          movement: "Unfavorable",
                          positive: false,
                        },
                        {
                          week: "3 Weeks Ago",
                          gain: "+$95K",
                          movement: "Favorable",
                          positive: true,
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${
                            item.positive
                              ? "bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-900/50"
                              : "bg-red-50/50 dark:bg-red-950/30 border-red-200/50 dark:border-red-900/50"
                          }`}
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                            {item.week}
                          </p>
                          <p
                            className={`text-sm font-medium ${item.positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {item.gain}
                          </p>
                          <p
                            className={`text-[10px] ${item.positive ? "text-emerald-500" : "text-red-500"}`}
                          >
                            {item.movement}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 p-2 rounded bg-white/50 dark:bg-slate-900/50 border border-emerald-200/50 dark:border-emerald-900/50">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          Net 4-Week Impact: +$260K
                        </span>
                        <span className="mx-2">•</span>
                        Hedging strategy performing well, continue current
                        approach
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </>
          )}

          {/* Alerts - Minimalist */}
          {report.alerts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: (report.charts.length + report.tables.length + 1) * 0.05,
              }}
            >
              <Card className="border border-slate-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/30 backdrop-blur-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-light">
                    Action Items & Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {report.alerts.map((alert, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded border-l-2 ${getAlertColor(alert.severity)}`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-light text-slate-700 dark:text-slate-300 leading-relaxed">
                              {alert.message}
                            </p>
                            {alert.action && (
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-light">
                                <span className="font-normal">Action:</span>{" "}
                                {alert.action}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Action Buttons - Minimalist */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200/50 dark:border-slate-800/50">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs font-light h-8 px-3 hover:bg-slate-100/50 dark:hover:bg-slate-800/50"
            >
              <Calendar className="w-3.5 h-3.5" />
              Date Range
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs font-light h-8 px-3 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900"
            >
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
