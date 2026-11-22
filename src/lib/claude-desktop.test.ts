import { describe, expect, it } from "vitest"
import { accountLabel, claudeAccountId } from "@/lib/claude-desktop"

describe("accountLabel", () => {
  it("keeps the part after the last separator", () => {
    expect(accountLabel("Claude · ThizeMl")).toBe("ThizeMl")
    expect(accountLabel("Claude · Team · Work")).toBe("Work")
  })

  it("keeps a name without the separator whole", () => {
    expect(accountLabel("Claude Work")).toBe("Claude Work")
  })
})

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
