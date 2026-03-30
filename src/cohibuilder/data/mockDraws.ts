export type DrawStatus = 'Approved' | 'Pending Inspection' | 'Action Required';

export type DrawRequest = {
  id: string;
  project: string;
  phase: string;
  requested: number;
  total: number;
  status: DrawStatus;
  requestedDate: string; // ISO date (YYYY-MM-DD)
  lastUpdatedDate: string; // ISO date (YYYY-MM-DD)
  inspector: string;
  inspectionStatus: 'Complete' | 'Scheduled' | 'Not scheduled' | 'N/A';
  inspectionDateLabel: string;
  notes: string;
};

export const DRAW_REQUESTS: DrawRequest[] = [
  {
    id: 'DRW-001',
    project: 'Sarah & Mark Jenkins',
    phase: 'Foundation',
    requested: 45_000,
    total: 450_000,
    status: 'Approved',
    requestedDate: '2026-03-06',
    lastUpdatedDate: '2026-03-10',
    inspector: 'John Smith',
    inspectionStatus: 'Complete',
    inspectionDateLabel: 'Completed: Mar 09, 2026',
    notes: 'Inspection complete; funding queued with lien waiver packet.',
  },
  {
    id: 'DRW-002',
    project: 'David Miller',
    phase: 'Framing',
    requested: 85_000,
    total: 620_000,
    status: 'Pending Inspection',
    requestedDate: '2026-03-11',
    lastUpdatedDate: '2026-03-14',
    inspector: 'Pending assignment',
    inspectionStatus: 'Scheduled',
    inspectionDateLabel: 'Scheduled: Mar 18, 2026',
    notes: 'Awaiting site inspection and photo set before approval.',
  },
  {
    id: 'DRW-003',
    project: 'Elena Rodriguez',
    phase: 'Permitting',
    requested: 15_000,
    total: 380_000,
    status: 'Action Required',
    requestedDate: '2026-03-12',
    lastUpdatedDate: '2026-03-15',
    inspector: 'N/A',
    inspectionStatus: 'N/A',
    inspectionDateLabel: 'N/A',
    notes: 'Missing updated invoices + permit documentation; borrower approval pending.',
  },
  {
    id: 'DRW-004',
    project: 'The Henderson Family',
    phase: 'Drywall',
    requested: 62_500,
    total: 1_160_000,
    status: 'Pending Inspection',
    requestedDate: '2026-03-15',
    lastUpdatedDate: '2026-03-16',
    inspector: 'Built Field Ops',
    inspectionStatus: 'Not scheduled',
    inspectionDateLabel: 'Not scheduled',
    notes: 'Needs inspection scheduling to maintain draw SLA.',
  },
  {
    id: 'DRW-005',
    project: 'Robert Chen',
    phase: 'Framing',
    requested: 40_000,
    total: 1_480_000,
    status: 'Approved',
    requestedDate: '2026-03-02',
    lastUpdatedDate: '2026-03-05',
    inspector: 'Built Field Ops',
    inspectionStatus: 'Complete',
    inspectionDateLabel: 'Completed: Mar 04, 2026',
    notes: 'Approved; ensure payees align to contractor roster.',
  },
];

