import { Button } from '@/components/ui/button';
import { CoheusLogo } from '@/components/ui/CoheusLogo';
import { ModeToggle } from '@/components/mode-toggle';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass dark:glass-dark border-b border-slate-200/50 dark:border-slate-700/50 shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => window.location.href = '/'}
            className="hover:opacity-80 transition-opacity cursor-pointer"
            aria-label="Go to home page"
          >
            <CoheusLogo className="h-8 sm:h-10" />
          </button>

          <div className="flex items-center gap-2 sm:gap-4">
            <ModeToggle />
            <Button
              size="sm"
              onClick={() => {
                window.location.href = '/insights';
              }}
              className="bg-[#407BFF] hover:bg-[#3566CC] text-white px-4 sm:px-6 font-semibold shadow-md hover:shadow-lg transition-all"
            >
              Reports
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
