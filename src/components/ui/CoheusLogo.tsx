import React from 'react';

interface CoheusLogoProps {
  className?: string;
  height?: number;
}

export function CoheusLogo({ className = '', height = 40 }: CoheusLogoProps) {
  const logoPath = `${import.meta.env.BASE_URL}coheus-logo.png`;
  
  return (
    <img
      src={logoPath}
      alt="COHEUS Logo"
      className={className}
      style={{ height: `${height}px`, width: 'auto' }}
    />
  );
}
