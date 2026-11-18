import { useId, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SectionProps {
  title: string
  /** One-line current value, shown right-aligned in the header (also while collapsed). */
  summary?: ReactNode
  /** Controlled open state; leave out to let the section keep its own (see `defaultOpen`). */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Rendered only while open. */
  children: ReactNode
  className?: string
}

/**
 * Accordion row: chevron, title, right-aligned summary and a collapsible body.
 * Meant to be stacked inside a card (`divide-y` between rows); the header is a button (`aria-expanded`).
 */
export function Section({
  title,
  summary,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}: SectionProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const open = openProp ?? ownOpen
  const bodyId = useId()

  const toggle = () => {
    const next = !open
    if (openProp === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={cn("bg-card", className)} data-testid={`widget-section-${title.toLowerCase()}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        {summary !== undefined && (
          <span className="ml-auto min-w-0 truncate text-[13px] text-muted-foreground" data-testid="section-summary">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="border-t border-border/60 bg-muted/30 pb-3 pl-9 pr-3 pt-2">
          {children}
        </div>
      )}
    </div>
  )
}
