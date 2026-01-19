import { Home, Sparkles, Mic, FileText } from 'lucide-react';
import { Dock, DockIcon, DockItem, DockLabel } from '@/components/ui/dock';

const dockItems = [
  {
    title: 'Home',
    icon: Home,
    action: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  },
  {
    title: 'Features',
    icon: Sparkles,
    action: () => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }),
  },
  {
    title: 'Demo',
    icon: Mic,
    action: () => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }),
  },
  {
    title: 'Docs',
    icon: FileText,
    action: () => window.open('#', '_blank'),
  },
];

export function MaylinDock() {
  return (
    <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2">
      <Dock className="items-end pb-3">
        {dockItems.map((item, idx) => (
          <button key={idx} onClick={item.action} className="focus:outline-none">
            <DockItem className="aspect-square cursor-pointer rounded-full bg-card/80 backdrop-blur-sm">
              <DockLabel>{item.title}</DockLabel>
              <DockIcon>
                <item.icon className="h-full w-full text-foreground" />
              </DockIcon>
            </DockItem>
          </button>
        ))}
      </Dock>
    </div>
  );
}
