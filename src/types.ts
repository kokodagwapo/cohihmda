import { LucideIcon } from 'lucide-react';

export interface NodeType {
  id: string;
  label: string;
  subLabel?: string;
  type: 'source' | 'target' | 'internal';
  icon?: LucideIcon;
  x?: number; // Percentage X
  y?: number; // Percentage Y
}

export interface ConnectionType {
  id: string;
  from: string;
  to: string;
  type: 'input' | 'output';
}
