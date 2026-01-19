import React from 'react';
import { NodeType } from '../../types';
import { LucideIcon } from 'lucide-react';
interface DiagramNodeProps {
  node: NodeType;
  align: 'left' | 'right';
  isActive?: boolean;
  onClick?: () => void;
}
export const DiagramNode: React.FC<DiagramNodeProps> = ({
  node,
  align,
  isActive,
  onClick
}) => {
  const Icon = node.icon as LucideIcon;
  return <div onClick={onClick} className={`
        relative group cursor-pointer transition-all duration-200 ease-out
        w-52 p-5 rounded-xl shadow-sm border border-slate-200
        ${isActive ? 'bg-blue-50/80 border-blue-400 shadow-md scale-[1.02]' : 'bg-white hover:border-blue-300 hover:shadow-md'}
      `}>
      <div className={`flex items-center gap-4 ${align === 'right' ? 'flex-row-reverse text-right' : 'flex-row'}`}>
        <div className={`
          p-2.5 rounded-lg shrink-0 transition-colors duration-200
          ${isActive ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'}
        `}>
          {Icon && <Icon size={22} strokeWidth={2} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{
          fontFamily: 'Space Grotesk, sans-serif'
        }} className="font-bold text-slate-800 leading-tight text-center text-2xl mb-[30px]">
            {node.label}
          </h3>
          {node.subLabel && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed" style={{
          fontFamily: 'Inter, sans-serif'
        }}>
              {node.subLabel}
            </p>}
        </div>
      </div>
      {/* Connection indicator dot - matching reference */}
      <div className={`
        absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white
        ${isActive ? 'bg-blue-500' : 'bg-blue-400'}
        ${align === 'left' ? '-right-1.5' : '-left-1.5'}
        shadow-sm
      `} />
    </div>;
};