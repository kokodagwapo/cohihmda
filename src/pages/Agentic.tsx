import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { VoiceInterface } from '@/components/agentic/VoiceInterface';
import { ConversationDisplay } from '@/components/agentic/ConversationDisplay';
import { DocumentUpload } from '@/components/agentic/DocumentUpload';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

const Agentic = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isCallActive, setIsCallActive] = useState(false);
  const [conversationTurns, setConversationTurns] = useState<any[]>([]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { user } = await api.getCurrentUser();
      if (!user) {
        navigate('/');
        return;
      }
    } catch (error) {
      navigate('/');
      return;
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Agentic Mode</h1>
          <p className="text-muted-foreground">
            Cam AI voice assistant for loan pre-qualification
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Voice Interface */}
          <Card className="p-6">
            <VoiceInterface
              isCallActive={isCallActive}
              onCallStatusChange={setIsCallActive}
              onConversationUpdate={setConversationTurns}
            />
          </Card>

          {/* Conversation Display */}
          <Card className="p-6">
            <ConversationDisplay turns={conversationTurns} />
          </Card>
        </div>

        {/* Document Upload Section */}
        <div className="mt-6">
          <DocumentUpload disabled={!isCallActive} />
        </div>
      </div>
    </div>
  );
};

export default Agentic;
