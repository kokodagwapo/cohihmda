import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { Plus } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

export { Accordion, AccordionContent, AccordionItem }

export function HmdaLenderModalAccordionItem({ value, children, className }) {
  return (
    <AccordionItem
      value={value}
      className={cn("hmda-lender-modal-accordion-item", className)}
    >
      {children}
    </AccordionItem>
  )
}

export function HmdaLenderModalAccordionTrigger({ children, className, aside }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "hmda-lender-modal-accordion-trigger flex flex-1 items-center gap-3 py-2.5 text-left text-[13px] font-semibold leading-6 transition-all",
          "[&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200",
          "[&>svg]:-order-1 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0",
          "[&[data-state=open]>svg]:rotate-180",
          className,
        )}
      >
        <Plus
          size={16}
          strokeWidth={2}
          className="shrink-0 opacity-60 transition-transform duration-200"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="truncate">{children}</span>
          {aside ? <span className="hmda-lender-modal-accordion-trigger__aside">{aside}</span> : null}
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}
