import { useState } from 'react';
import { CohiAvatar } from './CohiAvatar';
import { CohiModal } from './CohiModal';

interface CohiVoiceAssistantProps {
  dashboardContext?: any;
}

export function CohiVoiceAssistant({ dashboardContext }: CohiVoiceAssistantProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <CohiAvatar onClick={() => setIsModalOpen(true)} />
      <CohiModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        dashboardContext={dashboardContext}
      />
    </>
  );
}
