import { describe, expect, it } from "vitest"
import {
  summarizeBackdrop,
  summarizeColors,
  summarizeProviders,
  summarizeStyle,
} from "@/components/widget-tab/summaries"

const plugins = [
  { id: "claude", name: "Claude", enabled: true },
  { id: "codex", name: "ChatGPT", enabled: true },
  { id: "cursor", name: "Cursor", enabled: false },
]

describe("widget tab summaries", () => {
  it("names the style", () => {
    expect(summarizeStyle("compact")).toBe("Compact")
    expect(summarizeStyle("inline-compact")).toBe("Inline compact")
  })

  it("summarizes the background", () => {
    const base = { enabled: true, color: "auto", opacity: 0, glass: 0, blur: 50 }
    expect(summarizeBackdrop(base)).toBe("Auto · blur 50%")
    expect(summarizeBackdrop({ ...base, enabled: false })).toBe("Off")
    expect(summarizeBackdrop({ enabled: true, color: "#ff0000", opacity: 40, glass: 20, blur: 0 })).toBe(
      "#ff0000 · 40% · glass 20%"
    )
    expect(summarizeBackdrop({ enabled: true, color: "auto", opacity: 0, glass: 0, blur: 0 })).toBe("Auto")
    expect(summarizeBackdrop({ enabled: true, color: "auto", opacity: 15, glass: 60, blur: 80 })).toBe(
      "Auto · 15% · glass 60% · blur 80%"
    )
  })

  it("summarizes which texts are colored", () => {
    const tones = { ahead: "mono", onTrack: "color", behind: "color" } as const
    expect(summarizeColors({ label: "mono", used: "mono", expected: "mono" }, tones)).toBe("All mono")
    expect(summarizeColors({ label: "mono", used: "color", expected: "mono" }, tones)).toBe("Used colored")
    expect(summarizeColors({ label: "mono", used: "color", expected: "color" }, tones)).toBe("Used & pace colored")
    expect(summarizeColors({ label: "color", used: "color", expected: "mono" }, tones)).toBe("Label & used colored")
    expect(summarizeColors({ label: "color", used: "color", expected: "color" }, tones)).toBe("All colored")
  })

  it("says all mono when every tone is mono, whatever the texts say", () => {
    const mono = { ahead: "mono", onTrack: "mono", behind: "mono" } as const
    expect(summarizeColors({ label: "color", used: "color", expected: "color" }, mono)).toBe("All mono")
  })

  it("lists the shown providers", () => {
    expect(summarizeProviders(plugins, null)).toBe("Claude, ChatGPT")
    expect(summarizeProviders(plugins, ["codex"])).toBe("ChatGPT")
    // Disabled plugins never show, even when listed.
    expect(summarizeProviders(plugins, ["cursor"])).toBe("None")
    expect(summarizeProviders(plugins, [])).toBe("None")
    expect(summarizeProviders([], null)).toBe("None")
  })

  it("truncates past three providers", () => {
    const many = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase(), enabled: true }))
    expect(summarizeProviders(many, null)).toBe("A, B, C +2")
  })
})
