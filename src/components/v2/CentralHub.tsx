import React from 'react';
import { INTERNAL_MODULES } from './constants';
import { LucideIcon } from 'lucide-react';
interface CentralHubProps {
  activeModule?: string | null;
}
export const CentralHub: React.FC<CentralHubProps> = ({
  activeModule
}) => {
  return <div className="w-full h-full flex flex-col rounded-3xl shadow-lg overflow-hidden bg-white border border-slate-100">
      <div className="bg-gradient-to-r from-blue-500 to-cyan-400 px-8 pt-14 pb-10 text-center relative overflow-hidden">
        <h2 style={{
        fontFamily: 'Space Grotesk, sans-serif'
      }} className="font-bold relative z-10 tracking-wide text-5xl text-center text-primary-foreground py-[3px] my-[15px]">

Coheus v2</h2>
        
      </div>

      <div className="flex-1 pt-8 pb-10 flex flex-col justify-start relative bg-white border-4 border-black/0 px-[10px] py-[10px] my-0 mx-0">
        <div className="text-center mb-6">
          <h3 className="text-slate-600 font-semibold text-xs uppercase tracking-wider bg-slate-50 inline-block px-5 py-2 rounded-full border border-slate-200" style={{
          fontFamily: 'Inter, sans-serif'
        }}>
            Synapse API
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-4 border-8 border-black/0">
          {INTERNAL_MODULES.map(mod => {
          const Icon = mod.icon as LucideIcon;
          const isHighlighted = activeModule === mod.id;
          return <div key={mod.id} className={`p-4 rounded-xl border transition-all duration-300 flex items-start gap-3 ${isHighlighted ? 'bg-blue-50/80 border-blue-400 shadow-md scale-[1.02]' : 'bg-transparent border-slate-200 hover:border-blue-200 hover:bg-slate-50/30'}`}>
                <div className={`p-2.5 rounded-lg shrink-0 transition-colors duration-200 ${isHighlighted ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'}`}>
                  {Icon && <Icon size={22} strokeWidth={2} />}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-bold text-sm mb-1 ${isHighlighted ? 'text-blue-900' : 'text-slate-800'}`} style={{
                fontFamily: 'Space Grotesk, sans-serif'
              }}>
                    {mod.label}
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed" style={{
                fontFamily: 'Inter, sans-serif'
              }}>
                    {mod.subLabel}
                  </p>
                </div>
              </div>;
        })}
        </div>
      </div>
    </div>;
};