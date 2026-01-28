import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const variantStyles: Record<string, string> = {
  violet: 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400',
  sky: 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400',
  mint: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400',
  amber: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
  fuchsia: 'bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-600 dark:text-fuchsia-400',
  slate: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400',
};

const sizeStyles = {
  sm: 'h-8 w-8 [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'h-9 w-9 [&>svg]:h-4 [&>svg]:w-4',
  lg: 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5',
  xl: 'h-12 w-12 [&>svg]:h-6 [&>svg]:w-6',
};

const roundedStyles = { lg: 'rounded-lg', xl: 'rounded-xl', '2xl': 'rounded-2xl' };

export interface IconBadgeProps {
  icon: LucideIcon;
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  rounded?: keyof typeof roundedStyles;
  className?: string;
}

export function IconBadge({
  icon: Icon,
  variant = 'slate',
  size = 'md',
  rounded = 'xl',
  className,
}: IconBadgeProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0 transition-colors',
        roundedStyles[rounded],
        variantStyles[variant] ?? variantStyles.slate,
        sizeStyles[size],
        className
      )}
    >
      <Icon className="shrink-0" strokeWidth={2} />
    </div>
  );
}
