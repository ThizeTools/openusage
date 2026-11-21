import { describe, expect, it } from "vitest"
import { claudeAccountId } from "@/lib/claude-desktop"

describe("claudeAccountId", () => {
  it("returns the account id of a Claude account instance", () => {
    expect(claudeAccountId("claude@1a2b3c4d")).toBe("1a2b3c4d")
  })

  it("returns null for other plugins and the bare Claude plugin", () => {
    expect(claudeAccountId("copilot@1a2b3c4d")).toBeNull()
    expect(claudeAccountId("claude")).toBeNull()
    expect(claudeAccountId("claude@")).toBeNull()
  })
})
