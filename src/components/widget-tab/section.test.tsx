import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Section } from "@/components/widget-tab/section"

afterEach(() => cleanup())

describe("Section", () => {
  it("is collapsed by default, shows the summary and renders the body only when open", async () => {
    render(
      <Section title="Colors" summary="All mono">
        <p>body</p>
      </Section>
    )
    const header = screen.getByRole("button", { name: /Colors/ })
    expect(header).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("All mono")).toBeInTheDocument()
    expect(screen.queryByText("body")).toBeNull()

    await userEvent.click(header)
    expect(header).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("body")).toBeInTheDocument()
    await userEvent.click(header)
    expect(screen.queryByText("body")).toBeNull()
  })

  it("can start open", () => {
    render(
      <Section title="Colors" defaultOpen>
        <p>body</p>
      </Section>
    )
    expect(screen.getByText("body")).toBeInTheDocument()
  })

  it("can be controlled", async () => {
    const onOpenChange = vi.fn()
    render(
      <Section title="Colors" open={false} onOpenChange={onOpenChange}>
        <p>body</p>
      </Section>
    )
    await userEvent.click(screen.getByRole("button", { name: /Colors/ }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    // The parent did not open it, so it stays closed.
    expect(screen.queryByText("body")).toBeNull()
  })
})
