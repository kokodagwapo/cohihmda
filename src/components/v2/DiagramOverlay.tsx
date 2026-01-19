import React from 'react';
import { ConnectionType } from '../../types';

interface DiagramOverlayProps {
  connections: ConnectionType[];
  activeConnections: string[];
}

const createPath = (startX: number, startY: number, endX: number, endY: number) => {
  const midX = startX + (endX - startX) * 0.5;
  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
};

export const DiagramOverlay: React.FC<DiagramOverlayProps> = ({ connections, activeConnections }) => {
  const WIDTH = 1392;
  const HEIGHT = 800;
  const SOURCE_X = WIDTH * 0.16;
  const TARGET_X = WIDTH * 0.84;
  const HUB_IN_X = WIDTH * 0.32;
  const HUB_OUT_X = WIDTH * 0.68;
  const Y_POS = { top: HEIGHT * 0.20, mid: HEIGHT * 0.50, bot: HEIGHT * 0.80 };

  const getCoordinates = (id: string) => {
    switch(id) {
      case 'c-encompass': return { x1: SOURCE_X, y1: Y_POS.top, x2: HUB_IN_X, y2: HEIGHT * 0.35 };
      case 'c-calyx': return { x1: SOURCE_X, y1: Y_POS.mid, x2: HUB_IN_X, y2: HEIGHT * 0.5 };
      case 'c-meridian': return { x1: SOURCE_X, y1: Y_POS.bot, x2: HUB_IN_X, y2: HEIGHT * 0.65 };
      case 'c-mct': return { x1: HUB_OUT_X, y1: HEIGHT * 0.35, x2: TARGET_X, y2: Y_POS.top };
      case 'c-accounting': return { x1: HUB_OUT_X, y1: HEIGHT * 0.5, x2: TARGET_X, y2: Y_POS.mid };
      case 'c-servicing': return { x1: HUB_OUT_X, y1: HEIGHT * 0.65, x2: TARGET_X, y2: Y_POS.bot };
      default: return { x1: 0, y1: 0, x2: 0, y2: 0 };
    }
  };

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#3B82F6" />
        </marker>
      </defs>
      {connections.map((conn) => {
        const coords = getCoordinates(conn.id);
        const pathData = createPath(coords.x1, coords.y1, coords.x2, coords.y2);
        const isActive = activeConnections.includes(conn.id);

        return (
          <g key={conn.id}>
            <path d={pathData} fill="none" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="8 8" strokeOpacity="0.8" markerEnd="url(#arrowhead)" />
            <path d={pathData} fill="none" stroke="#3B82F6" strokeWidth="4" strokeOpacity={isActive ? 1 : 0} className="transition-all duration-300" filter="drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))" />
            {isActive && (
              <circle r="8" fill="#2563EB">
                <animateMotion dur="1s" repeatCount="indefinite" path={pathData} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                <animate attributeName="opacity" values="0;1;1;0" dur="1s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
};
