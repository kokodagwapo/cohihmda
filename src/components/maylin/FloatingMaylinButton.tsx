import { useState } from 'react';
import { Mic } from 'lucide-react';
import { ParticleBackground } from './ParticleBackground';

interface FloatingMaylinButtonProps {
  onClick: () => void;
}

export function FloatingMaylinButton({ onClick }: FloatingMaylinButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="fixed bottom-8 right-8 z-50 group">
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-2xl hover:shadow-blue-500/50 hover:scale-110 transition-all duration-300"
        aria-label="Open Cam Voice Assistant"
      >
        {isHovered && <ParticleBackground speed={0.6} particleCount={50} />}
        <Mic className="text-white" size={28} />
      </button>
    </div>
  );
}
