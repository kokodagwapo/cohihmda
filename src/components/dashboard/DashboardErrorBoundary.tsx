import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Custom title for the error message */
  title?: string;
  /** Callback when retry is clicked */
  onRetry?: () => void;
  /** Custom class name for the container */
  className?: string;
  /** Minimum height for the error container */
  minHeight?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * DashboardErrorBoundary - A lightweight error boundary for dashboard sections
 * 
 * Unlike the global ErrorBoundary, this component:
 * - Renders inline within its parent container
 * - Shows a compact error message
 * - Allows retrying without page reload
 * - Can be reset by changing children or calling onRetry
 * 
 * Usage:
 * ```tsx
 * <DashboardErrorBoundary title="KPI Cards" onRetry={() => refetch()}>
 *   <ExecutiveDashboard />
 * </DashboardErrorBoundary>
 * ```
 */
export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[DashboardErrorBoundary${this.props.title ? ` - ${this.props.title}` : ''}] Error:`, error);
    console.error('Error info:', errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      const { title = 'This section', className = '', minHeight = 'min-h-[200px]' } = this.props;

      return (
        <div 
          className={`${minHeight} flex items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 ${className}`}
        >
          <div className="text-center space-y-3 max-w-sm">
            <div className="flex justify-center">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {title} couldn't load
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                An unexpected error occurred. Try refreshing.
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="text-left bg-slate-100 dark:bg-slate-800 p-2 rounded text-[10px] font-mono text-slate-600 dark:text-slate-400 max-h-20 overflow-auto">
                {this.state.error.message}
              </div>
            )}

            <Button
              onClick={this.handleRetry}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component version for wrapping components
 * 
 * Usage:
 * ```tsx
 * const SafeExecutiveDashboard = withDashboardErrorBoundary(ExecutiveDashboard, {
 *   title: 'Business Overview',
 * });
 * ```
 */
export function withDashboardErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const WithErrorBoundary = (props: P) => (
    <DashboardErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </DashboardErrorBoundary>
  );

  WithErrorBoundary.displayName = `withDashboardErrorBoundary(${displayName})`;

  return WithErrorBoundary;
}

export default DashboardErrorBoundary;
