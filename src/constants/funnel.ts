import { FunnelDataPoint, DashboardMetric } from '../types/funnel';

export const FUNNEL_DATA: FunnelDataPoint[] = [
  {
    id: 'started',
    label: 'Loans Started',
    value: 0,
    valueDisplay: '0',
    color: '#6B7280', // Gray-500
    description: 'Total loans initiated in the pipeline'
  },
  {
    id: 'respa',
    label: 'Loans with RESPA Applications',
    value: 0,
    valueDisplay: '0',
    color: '#374151', // Gray-700
    description: 'Applications proceeding to RESPA stage'
  },
  {
    id: 'originated',
    label: 'Originated Loans',
    value: 0,
    valueDisplay: '0',
    color: '#F59E0B', // Amber-500
    description: 'Loans successfully closed and funded'
  },
  {
    id: 'active',
    label: 'Loans Still Active',
    value: 0,
    valueDisplay: '0',
    color: '#3B82F6', // Blue-500
    description: 'Loans currently in processing'
  }
];

export const FALLOUT_DATA: FunnelDataPoint[] = [
  {
    id: 'no-respa',
    label: 'Loans with No RESPA Applications',
    value: 0,
    valueDisplay: '0',
    color: '#E5E7EB', // Gray-200
    isFallout: true,
    volume: 0,
    units: 0,
    lostRevenue: 0
  },
  {
    id: 'withdrawn',
    label: 'Fallout - Withdrawn',
    value: 0,
    valueDisplay: '0',
    color: '#DC2626', // Red-600
    isFallout: true,
    volume: 0,
    units: 0,
    lostRevenue: 0
  },
  {
    id: 'denied',
    label: 'Fallout - Denied',
    value: 0,
    valueDisplay: '0',
    color: '#FEE2E2', // Red-100
    textColor: '#991B1B',
    isFallout: true,
    volume: 0,
    units: 0,
    lostRevenue: 0
  }
];

export const TOP_METRICS: DashboardMetric[] = [
  {
    label: 'Lost Revenue (No RESPA)',
    value: '$0',
    subValue: '$0 Volume • 0 Units',
    color: 'text-red-600'
  },
  {
    label: 'Lost Revenue (Withdrawn)',
    value: '$0',
    subValue: '$0 Volume • 0 Units',
    color: 'text-red-600'
  },
  {
    label: 'Lost Revenue (Denied)',
    value: '$0',
    subValue: '$0 Volume • 0 Units',
    color: 'text-red-600'
  },
  {
    label: 'Total Potential Loss',
    value: '$0',
    subValue: '$0 Volume • 0 Units',
    color: 'text-red-800'
  }
];
