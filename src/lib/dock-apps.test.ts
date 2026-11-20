import { describe, expect, it } from "vitest"
import { dockBundleIdsFor } from "@/lib/dock-apps"

describe("dockBundleIdsFor", () => {
  it("maps known providers", () => {
    expect(dockBundleIdsFor("claude")).toEqual(["com.anthropic.claudefordesktop"])
    expect(dockBundleIdsFor("kiro")).toEqual(["dev.kiro.desktop"])
  })

  it("strips the account suffix", () => {
    expect(dockBundleIdsFor("claude@1a2b")).toEqual(["com.anthropic.claudefordesktop"])
  })

  it("returns an empty list for unknown providers", () => {
    expect(dockBundleIdsFor("gemini")).toEqual([])
  })
})
