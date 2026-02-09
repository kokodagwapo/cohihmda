/**
 * SchemaExplorer
 *
 * Searchable field/metric reference inside the Cohi panel.
 * Shows all available database fields grouped by category,
 * with type badges and descriptions.
 * Users can click a field to ask Cohi about it.
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  Database,
  Hash,
  Calendar,
  User,
  Home,
  DollarSign,
  Calculator,
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SchemaField {
  name: string;
  type: string;
  category: string;
  description?: string;
}

export interface SchemaExplorerProps {
  /** If provided, use these fields; otherwise use the hardcoded fallback */
  fields?: SchemaField[];
  onAskCohi: (question: string) => void;
}

// ---------------------------------------------------------------------------
// Fallback fields (same as LOAN_FIELD_SCHEMA in the backend)
// ---------------------------------------------------------------------------

const FALLBACK_FIELDS: SchemaField[] = [
  // Core
  { name: 'loan_id', type: 'TEXT', category: 'Core', description: 'Unique loan identifier' },
  { name: 'loan_number', type: 'TEXT', category: 'Core', description: 'Loan number' },
  { name: 'loan_amount', type: 'DECIMAL', category: 'Core', description: 'Total loan amount' },
  { name: 'loan_type', type: 'TEXT', category: 'Core', description: 'Conventional, FHA, VA, USDA' },
  { name: 'loan_purpose', type: 'TEXT', category: 'Core', description: 'Purchase, Refinance, Cash-Out' },
  { name: 'loan_program', type: 'TEXT', category: 'Core', description: 'Loan program name' },
  { name: 'current_loan_status', type: 'TEXT', category: 'Core', description: 'Active, Originated, Withdrawn, Denied' },
  { name: 'current_milestone', type: 'TEXT', category: 'Core', description: 'Current pipeline milestone' },
  { name: 'channel', type: 'TEXT', category: 'Core', description: 'Retail, Wholesale, Correspondent, TPO' },
  // Personnel
  { name: 'loan_officer', type: 'TEXT', category: 'Personnel', description: 'Loan officer name' },
  { name: 'loan_officer_id', type: 'TEXT', category: 'Personnel', description: 'Loan officer ID' },
  { name: 'processor', type: 'TEXT', category: 'Personnel', description: 'Processor name' },
  { name: 'underwriter', type: 'TEXT', category: 'Personnel', description: 'Underwriter name' },
  { name: 'closer', type: 'TEXT', category: 'Personnel', description: 'Closer name' },
  { name: 'branch', type: 'TEXT', category: 'Personnel', description: 'Branch name/code' },
  // Property
  { name: 'property_city', type: 'TEXT', category: 'Property', description: 'Property city' },
  { name: 'property_state', type: 'TEXT', category: 'Property', description: '2-letter state code' },
  { name: 'property_county', type: 'TEXT', category: 'Property', description: 'Property county' },
  { name: 'property_type', type: 'TEXT', category: 'Property', description: 'Single Family, Condo, etc.' },
  { name: 'occupancy_type', type: 'TEXT', category: 'Property', description: 'Primary, Investment, Second Home' },
  // Financial
  { name: 'interest_rate', type: 'DECIMAL', category: 'Financial', description: 'Interest rate %' },
  { name: 'fico_score', type: 'INTEGER', category: 'Financial', description: 'Credit score' },
  { name: 'ltv_ratio', type: 'DECIMAL', category: 'Financial', description: 'Loan-to-value ratio' },
  { name: 'be_dti_ratio', type: 'DECIMAL', category: 'Financial', description: 'Back-end DTI ratio' },
  { name: 'cltv', type: 'DECIMAL', category: 'Financial', description: 'Combined LTV' },
  // Dates
  { name: 'application_date', type: 'DATE', category: 'Dates', description: 'Application date' },
  { name: 'started_date', type: 'DATE', category: 'Dates', description: 'Started date' },
  { name: 'lock_date', type: 'DATE', category: 'Dates', description: 'Rate lock date' },
  { name: 'closing_date', type: 'DATE', category: 'Dates', description: 'Closing date' },
  { name: 'funding_date', type: 'DATE', category: 'Dates', description: 'Funding date' },
];

// ---------------------------------------------------------------------------
// Category icons
// ---------------------------------------------------------------------------

const catIcons: Record<string, React.ReactNode> = {
  Core: <Database className="h-3.5 w-3.5 text-indigo-500" />,
  Personnel: <User className="h-3.5 w-3.5 text-emerald-500" />,
  Property: <Home className="h-3.5 w-3.5 text-amber-500" />,
  Financial: <DollarSign className="h-3.5 w-3.5 text-green-500" />,
  Dates: <Calendar className="h-3.5 w-3.5 text-blue-500" />,
};

const typeBadgeColor: Record<string, string> = {
  TEXT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  DECIMAL: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  INTEGER: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  DATE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  TIMESTAMP: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  BOOLEAN: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchemaExplorer({ fields, onAskCohi }: SchemaExplorerProps) {
  const [search, setSearch] = useState('');
  const [expandedCat, setExpandedCat] = useState<string | null>('Core');

  const allFields = fields || FALLBACK_FIELDS;

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return allFields;
    const q = search.toLowerCase();
    return allFields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [allFields, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, SchemaField[]> = {};
    for (const f of filtered) {
      if (!map[f.category]) map[f.category] = [];
      map[f.category].push(f);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <Database className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Data Schema
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fields..."
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
        />
      </div>

      {/* Field list grouped by category */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {Object.entries(grouped).map(([cat, catFields]) => (
          <div key={cat} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
              onClick={() => setExpandedCat((prev) => (prev === cat ? null : cat))}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              {expandedCat === cat ? (
                <ChevronDown className="h-3 w-3 text-slate-400" />
              ) : (
                <ChevronRight className="h-3 w-3 text-slate-400" />
              )}
              {catIcons[cat] || <Hash className="h-3.5 w-3.5 text-slate-400" />}
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex-1 text-left">
                {cat}
              </span>
              <span className="text-[10px] text-slate-400">{catFields.length}</span>
            </button>

            {expandedCat === cat && (
              <div className="border-t border-slate-100 dark:border-slate-800 px-2 py-1 space-y-0.5">
                {catFields.map((field) => (
                  <div
                    key={field.name}
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white dark:hover:bg-slate-800 group transition-colors"
                  >
                    <code className="text-[10px] font-mono text-slate-700 dark:text-slate-300 flex-1 truncate">
                      {field.name}
                    </code>
                    <span
                      className={cn(
                        'text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0',
                        typeBadgeColor[field.type] || 'bg-slate-100 text-slate-500'
                      )}
                    >
                      {field.type}
                    </span>
                    <button
                      onClick={() =>
                        onAskCohi(`What is the "${field.name}" field? How is it used in loan data?`)
                      }
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-opacity"
                      title="Ask Cohi about this field"
                    >
                      <MessageSquare className="h-3 w-3 text-indigo-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">
            No fields match "{search}"
          </p>
        )}
      </div>
    </div>
  );
}
