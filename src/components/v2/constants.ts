import { 
  Database, Globe, Server, ShieldCheck, Cpu, Activity, 
  ArrowRightLeft, FileText, Briefcase, CreditCard 
} from 'lucide-react';
import { NodeType, ConnectionType } from '../../types';

export const SOURCE_NODES: NodeType[] = [
  { id: 'encompass', label: 'Encompass', subLabel: 'REST + SOAP', type: 'source', icon: Globe, y: 20 },
  { id: 'calyx', label: 'Calyx Point', subLabel: 'Database Access', type: 'source', icon: Database, y: 50 },
  { id: 'meridian', label: 'MeridianLink', subLabel: 'API Integration', type: 'source', icon: Server, y: 80 }
];

export const TARGET_NODES: NodeType[] = [
  { id: 'mct', label: 'Capital Markets', type: 'target', icon: Briefcase, y: 20 },
  { id: 'accounting', label: 'Accounting', type: 'target', icon: FileText, y: 50 },
  { id: 'servicing', label: 'Servicing', type: 'target', icon: CreditCard, y: 80 }
];

export const INTERNAL_MODULES: NodeType[] = [
  { id: 'los-adapters', label: 'LOS Adapters', subLabel: 'Canonical Schema', type: 'internal', icon: ArrowRightLeft },
  { id: 'vendor-apis', label: 'Vendor APIs', subLabel: 'Unified Interface', type: 'internal', icon: Globe },
  { id: 'rag-engine', label: 'RAG Engine', subLabel: 'Vector Search', type: 'internal', icon: Database },
  { id: 'ai-analytics', label: 'AI Analytics', subLabel: 'Executive Insights', type: 'internal', icon: Cpu },
  { id: 'websocket', label: 'WebSocket', subLabel: 'Real-time Sync', type: 'internal', icon: Activity },
  { id: 'security', label: 'Security', subLabel: 'SOC 2 + HIPAA', type: 'internal', icon: ShieldCheck },
];

export const CONNECTIONS: ConnectionType[] = [
  { id: 'c-encompass', from: 'encompass', to: 'hub-input-1', type: 'input' },
  { id: 'c-calyx', from: 'calyx', to: 'hub-input-2', type: 'input' },
  { id: 'c-meridian', from: 'meridian', to: 'hub-input-3', type: 'input' },
  { id: 'c-mct', from: 'hub-output-1', to: 'mct', type: 'output' },
  { id: 'c-accounting', from: 'hub-output-2', to: 'accounting', type: 'output' },
  { id: 'c-servicing', from: 'hub-output-3', to: 'servicing', type: 'output' },
];
