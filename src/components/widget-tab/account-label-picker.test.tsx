import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AccountLabelPicker } from "@/components/widget-tab/account-label-picker"

afterEach(() => cleanup())

describe("AccountLabelPicker", () => {
  it("shows the four cards with the selected one checked and the helper text", () => {
    render(<AccountLabelPicker value="initial" onChange={vi.fn()} />)
    const group = screen.getByRole("radiogroup", { name: "Menu bar account name" })
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("data-menu-bar-account-label", "off")
    expect(screen.getByRole("radio", { name: "Initial" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Beside" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "On top" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "On top" })).toHaveAttribute("data-menu-bar-account-label", "top")
    expect(screen.getByText("Shown when more than one Claude account is registered.")).toBeInTheDocument()
  })

  it("calls onChange with the clicked card, not for the selected one", async () => {
    const onChange = vi.fn()
    render(<AccountLabelPicker value="initial" onChange={onChange} />)
    await userEvent.click(screen.getByRole("radio", { name: "Initial" }))
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("radio", { name: "Beside" }))
    expect(onChange).toHaveBeenCalledWith("beside")
    await userEvent.click(screen.getByRole("radio", { name: "On top" }))
    expect(onChange).toHaveBeenLastCalledWith("top")
    await userEvent.click(screen.getByRole("radio", { name: "Off" }))
    expect(onChange).toHaveBeenLastCalledWith("off")
  })
})
