import { useEffect, useState } from 'react';
import { CohiChatPanel } from '@/components/dashboard/CohiChatPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';

export function GlobalCohiChat() {
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    const handleClose = () => setIsOpen(false);
    window.addEventListener('cohi-chat-open', handleOpen);
    window.addEventListener('cohi-chat-close', handleClose);
    return () => {
      window.removeEventListener('cohi-chat-open', handleOpen);
      window.removeEventListener('cohi-chat-close', handleClose);
    };
  }, []);

  if (!isAuthenticated) return null;

  // Use selected tenant from store (for super admins who select tenants)
  // Fall back to user's tenant_id (for regular tenant users)
  const effectiveTenantId = selectedTenantId || user?.tenant_id || undefined;

  return (
    <CohiChatPanel
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      tenantId={effectiveTenantId}
    />
  );
}
