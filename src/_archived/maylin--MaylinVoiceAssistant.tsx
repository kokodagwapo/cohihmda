import { useState } from 'react';
import { FloatingMaylinButton } from './FloatingMaylinButton';
import { MaylinModal } from './MaylinModal';

export function MaylinVoiceAssistant() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <FloatingMaylinButton onClick={() => setIsModalOpen(true)} />
      <MaylinModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
