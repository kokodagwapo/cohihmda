import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { Plus } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

export { Accordion, AccordionContent, AccordionItem }

export function HmdaLenderCardAccordionItem({ value, children, className }) {
  return (
    <AccordionItem value={value} className={cn("hmda-lender-card-accordion-item", className)}>
      {children}
    </AccordionItem>
  )
}

export function HmdaLenderCardAccordionTrigger({ icon: Icon, title, sub, className, onClick }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick?.(e)
        }}
        className={cn(
          "hmda-lender-card-accordion-trigger flex w-full flex-1 items-center justify-between gap-3 py-2 text-left text-[13px] font-semibold leading-6 transition-all",
          "[&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200",
          "[&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0",
          "[&[data-state=open]>svg]:rotate-180",
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="hmda-lender-card-accordion-icon-well" aria-hidden="true">
            {Icon ? <Icon size={16} strokeWidth={2} className="opacity-60" /> : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">{title}</span>
            {sub ? <span className="hmda-lender-card-accordion-sub truncate">{sub}</span> : null}
          </span>
        </span>
        <Plus
          size={16}
          strokeWidth={2}
          className="hmda-lender-card-accordion-plus shrink-0 opacity-60 transition-transform duration-200"
          aria-hidden="true"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}
