import { useState } from 'react';
import { FloatingLunaButton } from './FloatingLunaButton';
import { LunaModal } from './LunaModal';

export function LunaVoiceAssistant() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <FloatingLunaButton onClick={() => setIsModalOpen(true)} />
      <LunaModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
