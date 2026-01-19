import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

export function SeedDataButton() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const seedDemoData = async () => {
    setLoading(true);
    try {
      const data = await api.invokeFunction('seed-demo-data', {});

      toast({
        title: 'Demo data created',
        description: 'Your dashboard has been populated with sample data',
      });

      // Reload the page to show new data
      setTimeout(() => window.location.reload(), 1000);
    } catch (error: any) {
      toast({
        title: 'Failed to seed data',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return null; // Hidden
}
