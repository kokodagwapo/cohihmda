import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CohiChatPanel } from '@/components/dashboard/CohiChatPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';

export function GlobalCohiChat() {
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const location = useLocation();
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

  if (isUnifiedChatClientEnabled()) {
    return null;
  }

  // HMDA page has its own embedded UI; keep top area clean.
  // Covers /hmda, /hmda/, and any future nested HMDA routes.
  if (location.pathname === '/hmda' || location.pathname.startsWith('/hmda/')) {
    return null;
  }

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
