import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { ProvidersList } from "@/components/widget-tab/providers-list"
import { makeWidgetTabModel } from "@/test/widget-tab-model"

afterEach(() => cleanup())

describe("ProvidersList compact variant", () => {
  it("renders a divided row per enabled provider with its metrics", () => {
    render(<ProvidersList model={makeWidgetTabModel()} variant="compact" />)
    const list = screen.getByTestId("widget-providers-list")
    expect(list).toHaveClass("divide-y")
    expect(within(list).getByLabelText("Claude")).toBeInTheDocument()
    expect(within(list).getByLabelText("ChatGPT")).toBeInTheDocument()
    expect(within(list).getAllByLabelText("Session")).toHaveLength(2)
    expect(within(list).getByLabelText("Sonnet")).toBeInTheDocument()
  })

  it("toggles providers and metrics through the model", async () => {
    const model = makeWidgetTabModel()
    render(<ProvidersList model={model} variant="compact" />)
    await userEvent.click(screen.getByLabelText("ChatGPT"))
    expect(model.onProviderIdsChange).toHaveBeenLastCalledWith(["claude"])
    await userEvent.click(screen.getByLabelText("Sonnet"))
    expect(model.onProviderMetricsChange).toHaveBeenLastCalledWith({ claude: ["Session", "Weekly", "Sonnet"] })
  })

  it("disables the metrics of a hidden provider", () => {
    render(<ProvidersList model={makeWidgetTabModel({ providerIds: ["claude"] })} variant="compact" />)
    const codexRow = screen.getByLabelText("ChatGPT").closest("div.flex-wrap") as HTMLElement
    for (const box of within(codexRow).getAllByRole("checkbox").slice(1)) {
      expect(box).toHaveAttribute("aria-disabled", "true")
    }
  })
})
