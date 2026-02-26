import { motion } from 'framer-motion';
import { LOSSettingsSection } from './LOSSettingsSection';

interface ConnectionsSectionProps {
  losConnections: any[];
  losTypes: any;
  losLoading: boolean;
  tenantMetrics?: any;
  loadingMetrics?: boolean;
  onTestLos: (connectionId: string, tenantId?: string) => Promise<any>;
  onSyncLos: (connectionId: string, tenantId?: string, clearDatabase?: boolean, testMode?: boolean, limit?: number, fullSync?: boolean) => Promise<any>;
  onToggleLos: (connectionId: string, isActive: boolean) => Promise<any>;
  onCreateLos: (data: any, tenantId?: string) => Promise<any>;
  onUpdateLos?: (connectionId: string, updates: any, tenantId?: string) => Promise<any>;
  onDeleteLos?: (connectionId: string, tenantId?: string) => Promise<any>;
  onLoadLosData?: (tenantId?: string) => Promise<any>;
  onLoadMetrics?: (tenantId: string) => Promise<void>;
}

export const ConnectionsSection = ({
  losConnections,
  losTypes,
  losLoading,
  tenantMetrics,
  loadingMetrics,
  onTestLos,
  onSyncLos,
  onToggleLos,
  onCreateLos,
  onUpdateLos,
  onDeleteLos,
  onLoadLosData,
  onLoadMetrics,
}: ConnectionsSectionProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-orange-200/40 dark:border-slate-700/50 shadow-lg shadow-orange-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Connections & Integrations
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Manage LOS connections
          </p>
        </div>
      </div>

      <LOSSettingsSection
        losConnections={losConnections}
        losTypes={losTypes}
        loading={losLoading}
        tenantMetrics={tenantMetrics}
        loadingMetrics={loadingMetrics}
        onTest={onTestLos}
        onSync={onSyncLos}
        onToggle={onToggleLos}
        onCreate={onCreateLos}
        onUpdate={onUpdateLos}
        onDelete={onDeleteLos}
        onLoadLosData={onLoadLosData}
        onLoadMetrics={onLoadMetrics}
      />
    </motion.div>
  );
};
