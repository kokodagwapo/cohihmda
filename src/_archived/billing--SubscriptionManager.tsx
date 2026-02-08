import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';

export const SubscriptionManager = () => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Subscription Management</CardTitle>
          <CardDescription>Manage your subscription and billing</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
            <Info className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Free Plan</p>
              <p className="text-sm text-muted-foreground">
                You are currently on the free plan. Subscription management will be available soon.
              </p>
            </div>
            <Badge variant="secondary" className="ml-auto">Coming Soon</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
