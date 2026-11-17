import { useDarkMode } from "@/hooks/use-dark-mode"
import { getIconColor } from "@/lib/color"
import { cn } from "@/lib/utils"

type ProviderIconProps = {
  iconUrl: string
  brandColor?: string | null
  /** Accessible name. Omit when the icon sits next to its visible name. */
  label?: string
  className?: string
}

/** Provider logo drawn as a CSS mask, tinted like the side nav icons. */
export function ProviderIcon({ iconUrl, brandColor, label, className }: ProviderIconProps) {
  const isDark = useDarkMode()
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-5 shrink-0", className)}
      style={{
        backgroundColor: getIconColor(brandColor ?? undefined, isDark),
        WebkitMaskImage: `url(${iconUrl})`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url(${iconUrl})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  )
}
