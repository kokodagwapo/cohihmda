import React from 'react';
import { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type ButtonStatus = 'healthy' | 'warning' | 'critical';

interface CarButtonProps {
  icon: LucideIcon;
  label: string;
  status: ButtonStatus;
  onClick: () => void;
  className?: string;
}

const statusColors = {
  healthy: {
    dot: 'bg-emerald-500',
    text: 'text-slate-600 dark:text-slate-300',
    hover: 'hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-slate-600 dark:text-slate-300',
    hover: 'hover:bg-amber-50 dark:hover:bg-amber-950/30'
  },
  critical: {
    dot: 'bg-rose-500',
    text: 'text-slate-600 dark:text-slate-300',
    hover: 'hover:bg-rose-50 dark:hover:bg-rose-950/30'
  }
};

export const CarButton: React.FC<CarButtonProps> = ({
  icon: Icon,
  label,
  status,
  onClick,
  className
}) => {
  const colors = statusColors[status];
  const isPulsing = status === 'critical' || status === 'warning';

  return (
    <motion.button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1',
        'w-full py-2 px-1 rounded-md',
        'transition-all duration-200',
        colors.hover,
        'group cursor-pointer',
        className
      )}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Icon with status dot */}
      <div className="relative">
        <Icon
          className={cn(
            'w-4 h-4 transition-colors duration-200',
            colors.text
          )}
        />
        {/* Status dot */}
        <motion.div
          className={cn(
            'absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full',
            colors.dot
          )}
          animate={
            isPulsing
              ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
              : {}
          }
          transition={
            isPulsing
              ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
              : {}
          }
        />
      </div>

      {/* Label - always visible */}
      <span className={cn(
        'text-[9px] font-medium leading-tight text-center',
        colors.text
      )}>
        {label}
      </span>
    </motion.button>
  );
};
