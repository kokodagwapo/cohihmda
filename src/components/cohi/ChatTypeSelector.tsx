import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@/components/ui/select";

import { Checkbox } from "@/components/ui/checkbox";

import { Label } from "@/components/ui/label";

import { cn } from "@/lib/utils";

import type { UnifiedChatType } from "@/lib/unifiedChatClient";



const MODE_LABELS: Record<UnifiedChatType, string> = {

  chat: "Chat",

  research: "Research",

  insight_builder: "Insight builder",

  workbench: "Workbench",

};



export interface ChatTypeSelectProps {

  value: UnifiedChatType;

  onChange: (value: UnifiedChatType) => void;

  allowedTypes?: UnifiedChatType[];

  className?: string;

}



export function ChatTypeSelect({

  value,

  onChange,

  allowedTypes = ["chat", "research", "insight_builder", "workbench"],

  className,

}: ChatTypeSelectProps) {

  return (

    <Select value={value} onValueChange={(v) => onChange(v as UnifiedChatType)}>

      <SelectTrigger

        className={cn("h-10 w-[140px] shrink-0 text-xs rounded-xl", className)}

        aria-label="Chat type"

        data-tour="unified-chat-type"

      >

        <SelectValue />

      </SelectTrigger>

      <SelectContent>

        {allowedTypes.map((t) => (

          <SelectItem key={t} value={t}>

            {MODE_LABELS[t]}

          </SelectItem>

        ))}

      </SelectContent>

    </Select>

  );

}



export interface ResearchDeepAnalysisToggleProps {

  checked: boolean;

  onCheckedChange: (value: boolean) => void;

  className?: string;

}



export function ResearchDeepAnalysisToggle({

  checked,

  onCheckedChange,

  className,

}: ResearchDeepAnalysisToggleProps) {

  return (

    <div className={cn("flex items-center gap-2", className)}>

      <Checkbox

        id="cohi-deep-analysis"

        checked={checked}

        onCheckedChange={(c) => onCheckedChange(c === true)}

      />

      <Label htmlFor="cohi-deep-analysis" className="text-xs font-normal cursor-pointer">

        Deep analysis

      </Label>

    </div>

  );

}



export interface ChatTypeSelectorProps {

  value: UnifiedChatType;

  onChange: (value: UnifiedChatType) => void;

  deepAnalysis?: boolean;

  onDeepAnalysisChange?: (value: boolean) => void;

  allowedTypes?: UnifiedChatType[];

  className?: string;

}



export function ChatTypeSelector({

  value,

  onChange,

  deepAnalysis = false,

  onDeepAnalysisChange,

  allowedTypes = ["chat", "research", "insight_builder", "workbench"],

  className,

}: ChatTypeSelectorProps) {

  return (

    <div className={className}>

      <div className="flex flex-wrap items-center gap-3">

        <ChatTypeSelect value={value} onChange={onChange} allowedTypes={allowedTypes} />

        {value === "research" && onDeepAnalysisChange && (

          <ResearchDeepAnalysisToggle

            checked={deepAnalysis}

            onCheckedChange={onDeepAnalysisChange}

          />

        )}

      </div>

    </div>

  );

}


