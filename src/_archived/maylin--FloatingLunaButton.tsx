import { useState } from 'react';
import { Mic } from 'lucide-react';
import { ParticleBackground } from './ParticleBackground';

interface FloatingLunaButtonProps {
  onClick: () => void;
}

export function FloatingLunaButton({ onClick }: FloatingLunaButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="fixed bottom-8 right-8 z-50 group">
      <button
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative w-20 h-20 rounded-full bg-gradient-to-br from-white to-blue-50 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden animate-pulse hover:animate-none hover:scale-110"
        style={{
          boxShadow: '0 8px 32px rgba(180, 220, 255, 0.4)',
        }}
        aria-label="Talk to Cam"
      >
        {/* Particle animation inside button */}
        <ParticleBackground 
          speed={isHovered ? 0.8 : 0.3} 
          particleCount={20}
          className="opacity-60"
        />
        
        {/* Microphone icon */}
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Mic className="w-8 h-8 text-blue-500" />
        </div>

        {/* Glow ring */}
        <div 
          className="absolute inset-0 rounded-full transition-all duration-300"
          style={{
            background: 'radial-gradient(circle, rgba(180,220,255,0.3) 0%, transparent 70%)',
            transform: isHovered ? 'scale(1.2)' : 'scale(1)',
          }}
        />
      </button>

      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-white rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap text-sm font-medium text-gray-700">
        Talk to Cam
      </div>
    </div>
  );
}
