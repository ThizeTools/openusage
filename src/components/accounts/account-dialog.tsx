import { useId, type ReactNode } from "react"

/** Modal panel for the account flows. Closing is done by the buttons inside. */
export function AccountDialog({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-4 shadow-lg"
      >
        <h4 id={titleId} className="text-base font-semibold">{title}</h4>
        {children}
      </div>
    </div>
  )
}
