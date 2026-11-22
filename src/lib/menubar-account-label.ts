import type { FontWeight, MeasureText } from "@/lib/menubar-widget-image"

/** `name` cut with "…" so it is at most `maxWidth` wide (measured with the injected `measure`). */
export function fitName(name: string, maxWidth: number, measure: MeasureText, weight: FontWeight, size: number): string {
  if (measure(name, weight, size) <= maxWidth) return name
  const chars = Array.from(name)
  for (let count = chars.length - 1; count > 0; count -= 1) {
    const cut = `${chars.slice(0, count).join("").trimEnd()}…`
    if (measure(cut, weight, size) <= maxWidth) return cut
  }
  return "…"
}

/** First character of the name, uppercased ("blu" -> "B"); empty for an empty name. */
export function badgeLetter(name: string): string {
  return (Array.from(name)[0] ?? "").toUpperCase()
}
