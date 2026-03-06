import { useNavigate } from "react-router-dom";
import { Navigation } from "@/components/layout/Navigation";
import CohiChatPanel from "@/components/dashboard/CohiChatPanel";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DataChat() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />
      <div className="pt-14 sm:pt-16 min-h-screen flex flex-col">
        <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">
            Data Chat
          </h1>
        </div>
        <div className="flex-1 relative min-h-[calc(100vh-8rem)]">
          <CohiChatPanel
            isOpen={true}
            onClose={() => navigate(-1)}
          />
        </div>
      </div>
    </div>
  );
}
