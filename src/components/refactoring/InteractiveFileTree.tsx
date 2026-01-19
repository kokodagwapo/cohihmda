import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileCode, Layers } from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  lines?: number;
  extracted?: boolean;
  children?: FileNode[];
}

const fileStructure: FileNode[] = [
  {
    name: 'components',
    type: 'folder',
    children: [
      {
        name: 'dashboard',
        type: 'folder',
        children: [
          {
            name: 'views',
            type: 'folder',
            extracted: true,
            children: [
              { name: 'CompanyDetailView.tsx', type: 'file', lines: 342, extracted: true },
              { name: 'SalesView.tsx', type: 'file', lines: 289, extracted: true },
              { name: 'OpsView.tsx', type: 'file', lines: 256, extracted: true },
            ],
          },
          {
            name: 'modals',
            type: 'folder',
            extracted: true,
            children: [
              { name: 'ContactModal.tsx', type: 'file', lines: 156, extracted: true },
              { name: 'ExportModal.tsx', type: 'file', lines: 234, extracted: true },
              { name: 'MetricModal.tsx', type: 'file', lines: 298, extracted: true },
              { name: 'FalloutModal.tsx', type: 'file', lines: 412, extracted: true },
            ],
          },
          { name: 'Dashboard.tsx', type: 'file', lines: 1038 },
        ],
      },
      {
        name: 'admin',
        type: 'folder',
        children: [
          { name: 'SecuritySection.tsx', type: 'file', lines: 319, extracted: true },
          { name: 'AWSHostingSection.tsx', type: 'file', lines: 447, extracted: true },
          { name: 'AdminContainer.tsx', type: 'file', lines: 45, extracted: true },
          { name: 'Admin.tsx', type: 'file', lines: 399 },
        ],
      },
    ],
  },
  {
    name: 'hooks',
    type: 'folder',
    children: [
      {
        name: 'dashboard',
        type: 'folder',
        extracted: true,
        children: [
          { name: 'useDashboardData.ts', type: 'file', lines: 156, extracted: true },
          { name: 'useMetrics.ts', type: 'file', lines: 89, extracted: true },
          { name: 'useMockData.ts', type: 'file', lines: 931, extracted: true },
        ],
      },
      {
        name: 'admin',
        type: 'folder',
        extracted: true,
        children: [
          { name: 'useStripeData.ts', type: 'file', lines: 78, extracted: true },
          { name: 'useAdminData.ts', type: 'file', lines: 124, extracted: true },
        ],
      },
    ],
  },
];

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [isOpen, setIsOpen] = useState(depth < 2);

  const isFolder = node.type === 'folder';
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors group ${
          node.extracted
            ? 'hover:bg-green-50'
            : 'hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
        onClick={() => isFolder && setIsOpen(!isOpen)}
      >
        {/* Expand icon */}
        {isFolder && hasChildren && (
          <motion.div
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </motion.div>
        )}
        {!isFolder && <div className="w-4" />}

        {/* Folder/File icon */}
        {isFolder ? (
          isOpen ? (
            <FolderOpen className={`w-5 h-5 ${node.extracted ? 'text-green-600' : 'text-blue-500'}`} />
          ) : (
            <Folder className={`w-5 h-5 ${node.extracted ? 'text-green-600' : 'text-blue-500'}`} />
          )
        ) : (
          <FileCode className={`w-5 h-5 ${node.extracted ? 'text-green-600' : 'text-violet-500'}`} />
        )}

        {/* Name */}
        <span className={`flex-1 text-sm font-medium ${
          node.extracted ? 'text-green-900' : 'text-slate-700'
        }`}>
          {node.name}
        </span>

        {/* Badges */}
        <div className="flex items-center gap-2">
          {node.lines && (
            <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-mono">
              {node.lines.toLocaleString()} lines
            </span>
          )}
          {node.extracted && (
            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold flex items-center gap-1">
              <Layers className="w-3 h-3" />
              Extracted
            </span>
          )}
        </div>
      </motion.div>

      {/* Children */}
      <AnimatePresence>
        {isFolder && isOpen && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {node.children?.map((child, index) => (
              <TreeNode key={`${child.name}-${index}`} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function InteractiveFileTree() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          New Architecture Explorer
        </h3>
        <p className="text-slate-600">Explore the modular structure we created</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-gradient-to-br from-violet-50 to-blue-50 border-2 border-violet-200 rounded-xl p-6 text-center"
        >
          <FileCode className="w-10 h-10 text-violet-600 mx-auto mb-3" />
          <div className="text-3xl font-bold text-violet-600 mb-1">22</div>
          <div className="text-sm text-slate-600 font-medium">View Components</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6 text-center"
        >
          <Layers className="w-10 h-10 text-green-600 mx-auto mb-3" />
          <div className="text-3xl font-bold text-green-600 mb-1">16</div>
          <div className="text-sm text-slate-600 font-medium">Custom Hooks</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl p-6 text-center"
        >
          <Folder className="w-10 h-10 text-blue-600 mx-auto mb-3" />
          <div className="text-3xl font-bold text-blue-600 mb-1">8</div>
          <div className="text-sm text-slate-600 font-medium">Module Folders</div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-lg"
      >
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
          <h4 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-blue-500" />
            Project Structure
          </h4>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              <span className="text-slate-600">Extracted Module</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-violet-500 rounded-full" />
              <span className="text-slate-600">Core File</span>
            </div>
          </div>
        </div>

        <div className="space-y-1 font-mono text-sm max-h-[600px] overflow-y-auto">
          {fileStructure.map((node, index) => (
            <TreeNode key={`${node.name}-${index}`} node={node} />
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3 }}
        className="mt-6 bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl p-6 text-center"
      >
        <div className="text-2xl mb-3">🎯</div>
        <p className="text-slate-700 font-medium">
          Each component has a <strong className="text-blue-600">single responsibility</strong> and is <strong className="text-blue-600">independently testable</strong>
        </p>
      </motion.div>
    </div>
  );
}

