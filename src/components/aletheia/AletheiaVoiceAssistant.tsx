import { useState } from 'react';
import { AletheiaAvatar } from './AletheiaAvatar';
import { AletheiaModal } from './AletheiaModal';

interface AletheiaVoiceAssistantProps {
  dashboardContext?: any;
}

export function AletheiaVoiceAssistant({ dashboardContext }: AletheiaVoiceAssistantProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <AletheiaAvatar onClick={() => setIsModalOpen(true)} />
      <AletheiaModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        dashboardContext={dashboardContext}
      />
    </>
  );
}
