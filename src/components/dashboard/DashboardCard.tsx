import React from 'react';

/**
 * Reusable Dashboard Card Component
 * A simple wrapper component for consistent card styling across the dashboard
 * 
 * @param children - React node to render inside the card
 * @param className - Optional additional CSS classes
 */
export const DashboardCard = ({
  children,
  className = ''
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${className}`}>
    {children}
  </div>
);

