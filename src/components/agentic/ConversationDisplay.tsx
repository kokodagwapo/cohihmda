import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, Bot } from 'lucide-react';

interface ConversationTurn {
  speaker: string;
  message: string;
  timestamp: Date;
}

interface ConversationDisplayProps {
  turns: ConversationTurn[];
}

export function ConversationDisplay({ turns }: ConversationDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [turns]);

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-2xl font-semibold mb-4">Conversation</h2>
      
      <ScrollArea className="flex-1 pr-4">
        {turns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Conversation will appear here...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  turn.speaker === 'agent' ? 'justify-start' : 'justify-end'
                }`}
              >
                {turn.speaker === 'agent' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}
                
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    turn.speaker === 'agent'
                      ? 'bg-muted'
                      : 'bg-primary text-primary-foreground'
                  }`}
                >
                  <p className="text-sm font-medium mb-1">
                    {turn.speaker === 'agent' ? 'Cam AI' : 'Customer'}
                  </p>
                  <p>{turn.message}</p>
                  <p className="text-xs mt-2 opacity-70">
                    {new Date(turn.timestamp).toLocaleTimeString()}
                  </p>
                </div>

                {turn.speaker === 'customer' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                    <User className="w-5 h-5 text-accent-foreground" />
                  </div>
                )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
