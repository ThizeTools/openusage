import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ loadMock: vi.fn(), saveMock: vi.fn() }))

vi.mock("@/lib/settings", async () => ({
  ...(await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings")),
  loadPaceThresholds: state.loadMock,
  savePaceThresholds: state.saveMock,
}))

import { PaceThresholds } from "@/components/widget-tab/pace-thresholds"

beforeEach(() => {
  state.loadMock.mockReset().mockResolvedValue({ healthy: 80, closeToLimit: 100 })
  state.saveMock.mockReset().mockResolvedValue(undefined)
})
afterEach(() => cleanup())

const healthy = () => screen.getByRole("slider", { name: "Healthy until" })
const close = () => screen.getByRole("slider", { name: "Close to limit until" })

describe("PaceThresholds", () => {
  it("renders the defaults with the example line and no Reset", async () => {
    render(<PaceThresholds />)
    expect(healthy()).toHaveAttribute("aria-valuenow", "80")
    expect(close()).toHaveAttribute("aria-valuenow", "100")
    expect(screen.getByText("0%")).toBeInTheDocument()
    expect(screen.getByText("150% of expected")).toBeInTheDocument()
    expect(screen.getByTestId("pace-example")).toHaveTextContent(
      "Example: used 42% when 50% was expected → 84% of pace → Close to limit."
    )
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull()
  })

  it("shows the stored thresholds", async () => {
    state.loadMock.mockResolvedValue({ healthy: 90, closeToLimit: 120 })
    render(<PaceThresholds />)
    await waitFor(() => expect(healthy()).toHaveAttribute("aria-valuenow", "90"))
    expect(screen.getByTestId("pace-example")).toHaveTextContent("→ Healthy.")
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument()
  })

  it("arrow keys move a handle by 5 and save", async () => {
    render(<PaceThresholds />)
    await waitFor(() => expect(state.loadMock).toHaveBeenCalled())
    healthy().focus()
    await userEvent.keyboard("{ArrowLeft}")
    expect(healthy()).toHaveAttribute("aria-valuenow", "75")
    expect(state.saveMock).toHaveBeenLastCalledWith({ healthy: 75, closeToLimit: 100 })
    close().focus()
    await userEvent.keyboard("{ArrowRight}{ArrowRight}")
    expect(state.saveMock).toHaveBeenLastCalledWith({ healthy: 75, closeToLimit: 110 })
  })

  it("keeps the handles at least 5 apart and inside 5..150", async () => {
    state.loadMock.mockResolvedValue({ healthy: 95, closeToLimit: 100 })
    render(<PaceThresholds />)
    await waitFor(() => expect(healthy()).toHaveAttribute("aria-valuenow", "95"))
    healthy().focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(healthy()).toHaveAttribute("aria-valuenow", "95")
    expect(state.saveMock).not.toHaveBeenCalled()
    close().focus()
    await userEvent.keyboard("{ArrowLeft}")
    expect(close()).toHaveAttribute("aria-valuenow", "100")

    cleanup()
    state.loadMock.mockResolvedValue({ healthy: 5, closeToLimit: 150 })
    render(<PaceThresholds />)
    await waitFor(() => expect(healthy()).toHaveAttribute("aria-valuenow", "5"))
    healthy().focus()
    await userEvent.keyboard("{ArrowLeft}")
    close().focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(healthy()).toHaveAttribute("aria-valuenow", "5")
    expect(close()).toHaveAttribute("aria-valuenow", "150")
    expect(state.saveMock).not.toHaveBeenCalled()
  })

  it("dragging saves on pointer up only, snapped to steps of 5", async () => {
    render(<PaceThresholds />)
    await waitFor(() => expect(state.loadMock).toHaveBeenCalled())
    const bar = screen.getByTestId("pace-thresholds").firstElementChild as HTMLElement
    bar.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect // 2px per 1%
    fireEvent.pointerDown(healthy(), { pointerId: 1 })
    fireEvent.pointerMove(healthy(), { pointerId: 1, clientX: 102 }) // 51% -> 50
    expect(healthy()).toHaveAttribute("aria-valuenow", "50")
    expect(state.saveMock).not.toHaveBeenCalled()
    fireEvent.pointerMove(healthy(), { pointerId: 1, clientX: 400 }) // clamped to closeToLimit - 5
    expect(healthy()).toHaveAttribute("aria-valuenow", "95")
    fireEvent.pointerUp(healthy(), { pointerId: 1 })
    expect(state.saveMock).toHaveBeenCalledTimes(1)
    expect(state.saveMock).toHaveBeenCalledWith({ healthy: 95, closeToLimit: 100 })
  })

  it("Reset restores and saves the defaults", async () => {
    state.loadMock.mockResolvedValue({ healthy: 60, closeToLimit: 120 })
    render(<PaceThresholds />)
    await userEvent.click(await screen.findByRole("button", { name: "Reset" }))
    expect(healthy()).toHaveAttribute("aria-valuenow", "80")
    expect(state.saveMock).toHaveBeenCalledWith({ healthy: 80, closeToLimit: 100 })
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull()
  })

  it("logs a failed load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    state.loadMock.mockRejectedValue(new Error("boom"))
    render(<PaceThresholds />)
    await waitFor(() => expect(error).toHaveBeenCalled())
    error.mockRestore()
  })
})
