import { MENU_BAR_ACCOUNT_LABELS, type MenuBarAccountLabel } from "@/lib/settings"
import { cn } from "@/lib/utils"

/** Card names, also used as the section summary. */
export const MENU_BAR_ACCOUNT_LABEL_NAMES: Record<MenuBarAccountLabel, string> = {
  off: "Off",
  initial: "Initial",
  beside: "Beside",
  top: "On top",
}

const BAR = "block rounded-full bg-muted-foreground/60"

/** Tiny picture of where an account name is drawn next to the provider icon (the square), for the option cards. */
function AccountGlyph({ id }: { id: MenuBarAccountLabel }) {
  if (id === "off") return <span className="text-base leading-6 text-muted-foreground">–</span>
  return (
    <span className="flex h-6 items-center gap-1">
      <span className="relative block size-5 rounded bg-muted-foreground/60">
        {id === "initial" && (
          <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-white/30 bg-neutral-800" />
        )}
      </span>
      {id === "beside" && <span className={cn(BAR, "h-1.5 w-3.5")} />}
      {id === "top" && (
        <span className="flex flex-col gap-0.5">
          <span className={cn(BAR, "h-0.5 w-2.5")} />
          <span className={cn(BAR, "h-1.5 w-3.5")} />
        </span>
      )}
    </span>
  )
}

/** Radio cards for how the menu bar widget names a Claude account (shown once 2+ Claude accounts are registered). */
export function AccountLabelPicker({
  value,
  onChange,
}: {
  value: MenuBarAccountLabel
  onChange: (value: MenuBarAccountLabel) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-muted-foreground">Shown when more than one Claude account is registered.</p>
      <div role="radiogroup" aria-label="Menu bar account name" className="grid grid-cols-4 gap-2">
        {MENU_BAR_ACCOUNT_LABELS.map((id) => {
          const selected = id === value
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={MENU_BAR_ACCOUNT_LABEL_NAMES[id]}
              data-menu-bar-account-label={id}
              onClick={() => {
                if (id !== value) onChange(id)
              }}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] bg-card px-1.5 py-2.5 text-center outline-none transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "border-primary ring-2 ring-primary/25" : "border-border hover:bg-muted/60"
              )}
            >
              <AccountGlyph id={id} />
              <span className="text-[13px] font-semibold text-foreground">{MENU_BAR_ACCOUNT_LABEL_NAMES[id]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
