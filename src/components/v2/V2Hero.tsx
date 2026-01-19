import React, { useState, useEffect, useCallback } from 'react';
import { SOURCE_NODES, TARGET_NODES, CONNECTIONS, INTERNAL_MODULES } from './constants';
import { DiagramNode } from './DiagramNode';
import { CentralHub } from './CentralHub';
import { DiagramOverlay } from './DiagramOverlay';
export const V2Hero: React.FC = () => {
  const [activeConnections, setActiveConnections] = useState<string[]>([]);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const triggerFlow = useCallback((sourceId: string) => {
    const inputConn = CONNECTIONS.find(c => c.from === sourceId);
    if (!inputConn) return;
    setActiveConnections(prev => [...prev, inputConn.id]);
    setTimeout(() => {
      const randomModule = INTERNAL_MODULES[Math.floor(Math.random() * INTERNAL_MODULES.length)];
      setActiveModule(randomModule.id);
      setTimeout(() => {
        setActiveModule(null);
        setActiveConnections(prev => prev.filter(id => id !== inputConn.id));
        let targetId = '';
        if (sourceId === 'encompass') targetId = 'mct';else if (sourceId === 'calyx') targetId = 'accounting';else targetId = 'servicing';
        const outputConn = CONNECTIONS.find(c => c.to === targetId);
        if (outputConn) {
          setActiveConnections(prev => [...prev, outputConn.id]);
          setTimeout(() => {
            setActiveConnections(prev => prev.filter(id => id !== outputConn.id));
          }, 1500);
        }
      }, 1200);
    }, 1000);
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeConnections.length === 0) {
        const randomSource = SOURCE_NODES[Math.floor(Math.random() * SOURCE_NODES.length)];
        triggerFlow(randomSource.id);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeConnections.length, triggerFlow]);
  return <section className="relative pt-8 pb-4 sm:pt-12 sm:pb-6 lg:pt-16 lg:pb-8 overflow-hidden bg-gradient-to-b from-slate-50 via-white to-white flex items-center justify-center" style={{
    zIndex: 1
  }}>
      {/* Subtle background pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.04),transparent_50%),radial-gradient(circle_at_70%_80%,rgba(6,182,212,0.04),transparent_50%)]" />
      
      {/* Main Content Container */}
      <div className="w-full max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 relative flex flex-col items-center justify-center" style={{
      zIndex: 1
    }}>
        <div className="flex flex-col items-center justify-center w-full gap-4 sm:gap-6 lg:gap-0">
          {/* Hero Text Section */}
          <header className="w-full max-w-4xl mx-auto flex-col text-center flex items-center justify-center">
            {/* Badge */}
            <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-100/60 text-blue-600 text-[11px] sm:text-xs font-semibold uppercase tracking-widest mb-6 sm:mb-8 shadow-sm">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-gradient-to-r from-blue-500 to-cyan-500" />
              </span>
              <span>Build Architecture</span>
            </div>

            {/* Heading - Improved mobile typography */}
            <h1 className="font-bold tracking-tight text-center w-full mb-2 sm:mb-3" style={{
            fontFamily: 'Space Grotesk, sans-serif'
          }}>
              <span className="block text-slate-900 text-[2rem] leading-[1.15] sm:text-4xl md:text-5xl lg:text-6xl sm:leading-[1.1] mb-2 sm:mb-3">
                Coheus V2
              </span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-xl leading-tight sm:text-3xl md:text-4xl lg:text-5xl">
                + Ailethia Insights
              </span>
            </h1>
            
            {/* Context Description - Mobile-first responsive card */}
            <div className="w-[85%] max-w-xs sm:max-w-lg md:max-w-2xl lg:max-w-3xl mx-auto mt-6 sm:mt-8">
              <div className="relative p-4 pl-5 sm:p-6 sm:pl-7 md:p-8 md:pl-10 text-left">
                
                <p className="text-sm leading-relaxed sm:text-base sm:leading-relaxed md:text-lg md:leading-relaxed text-slate-600 font-normal mb-4" style={{
                  fontFamily: 'Inter, sans-serif'
                }}>
                  Named after the Greek Titan of Intelligence, <span className="font-semibold text-slate-800">Coheus</span> is the mortgage industry's most powerful business intelligence platform. Coheus seamlessly integrates your LOS, accounting, and vendor systems.
                </p>
                <p className="text-sm leading-relaxed sm:text-base sm:leading-relaxed md:text-lg md:leading-relaxed text-slate-600 font-normal" style={{
                  fontFamily: 'Inter, sans-serif'
                }}>
                  <span className="font-semibold text-cyan-600">Ailethia</span> (Goddess of Truth) delivers real-time intelligence that analyzes your lending operations, provides critical alerts, and forecasts business performance.
                </p>
              </div>
            </div>
          </header>

          {/* Diagram Container - Mobile-first: reduced top margin and min-height */}
          <div className="w-full flex items-center justify-center mx-auto -mt-32 sm:-mt-20 md:-mt-16 lg:-mt-20">
            <div className="relative w-full items-center justify-center min-h-[280px] sm:min-h-[420px] md:min-h-[550px] lg:min-h-[700px] mt-0 sm:mt-0 mb-0 sm:mb-0 pt-0 sm:pt-0 pb-0 sm:pb-0 flex flex-col">
              <div className="scale-[0.25] sm:scale-[0.35] md:scale-[0.45] lg:scale-[0.55] xl:scale-[0.65] 2xl:scale-[0.7] transition-transform duration-500 ease-out origin-center">
                <div className="relative w-[1392px] h-[800px] bg-white shadow-lg border border-slate-100 border-none opacity-100 my-[10px] px-[10px] rounded-2xl pl-0 pr-0 pt-0 pb-0 py-[2px] mt-px mx-0">
                <DiagramOverlay connections={CONNECTIONS} activeConnections={activeConnections} />

                {/* LOS Systems - Left Side - Positioned to match arrow endpoints */}
                <div className="absolute left-[5%] top-0 bottom-0 w-[20%]">
                  <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-full text-center z-20">
                    <span className="font-bold tracking-widest text-xs uppercase text-slate-500" style={{
                      fontFamily: 'Inter, sans-serif'
                    }}>
                      LOS SYSTEMS
                    </span>
                  </div>
                  {SOURCE_NODES.map(node => {
                    // Use node.y property (20, 50, 80) to position cards at exact arrow endpoints
                    const topPosition = node.y || 50;
                    return <div key={node.id} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10" style={{
                      top: `${topPosition}%`
                    }}>
                        <DiagramNode node={node} align="left" isActive={activeConnections.some(c => c.startsWith(`c-${node.id}`))} onClick={() => triggerFlow(node.id)} />
                      </div>;
                  })}
                </div>

                {/* Central Hub - Centered with increased width */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[50%] max-w-[680px] flex items-center justify-center p-6 sm:p-8 z-20">
                  <div className="w-full h-full min-h-[680px] transition-transform hover:scale-[1.02] duration-300 ease-out">
                    <CentralHub activeModule={activeModule} />
                  </div>
                </div>

                {/* Vendors - Right Side - Positioned to match arrow endpoints using node.y property */}
                <div className="absolute right-[5%] top-0 bottom-0 w-[20%]">
                  <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-full text-center z-20">
                    <span className="font-bold tracking-widest text-xs uppercase text-slate-500" style={{
                      fontFamily: 'Inter, sans-serif'
                    }}>
                      VENDORS
                    </span>
                  </div>
                  {TARGET_NODES.map(node => {
                    // Use node.y property (20, 50, 80) to position cards at exact arrow endpoints
                    const topPosition = node.y || 50;
                    return <div key={node.id} className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10" style={{
                      top: `${topPosition}%`
                    }}>
                        <DiagramNode node={node} align="right" isActive={activeConnections.some(c => c.endsWith(node.id))} />
                      </div>;
                  })}
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>;
};