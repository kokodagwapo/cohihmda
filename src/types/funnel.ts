export interface FunnelDataPoint {
  id: string;
  label: string;
  value: number;
  valueDisplay: string; // e.g., "16.47M"
  color: string;
  textColor?: string;
  description?: string;
  isFallout?: boolean;
  // Additional data for accurate calculations
  volume?: number;      // Dollar volume
  units?: number;       // Unit count
  lostRevenue?: number; // Actual lost revenue amount
}

export interface DashboardMetric {
  label: string;
  value: string;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  color: string;
}

export enum ChartViewMode {
  FUNNEL = 'FUNNEL',
  BAR = 'BAR'
}
