(function () {
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."

  function readCredentials(ctx) {
    const creds = ctx.account && ctx.account.credentials
    const org = creds && typeof creds.org === "string" ? creds.org.trim() : ""
    const token = creds && typeof creds.token === "string" ? creds.token.trim() : ""
    if (!org || !token) throw SIGN_IN_AGAIN
    return { org: org, token: token }
  }

  function num(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function round2(value) {
    return Math.round(value * 100) / 100
  }

  // Sums the Copilot items of GitHub's org billing report for the month.
  function sumCopilotItems(body) {
    const items = body && Array.isArray(body.usageItems) ? body.usageItems : null
    if (!items) throw "Unexpected GitHub billing response. Try again later."
    let credits = 0
    let spend = 0
    for (const item of items) {
      if (!item || item.product !== "Copilot") continue
      const quantity = num(item.grossQuantity)
      const amount = num(item.netAmount)
      if (quantity === null || amount === null) {
        throw "Unexpected GitHub billing response. Try again later."
      }
      credits += quantity
      spend += amount
    }
    return { credits: credits, spend: spend }
  }

  globalThis.__openusage_plugin = {
    id: "copilot-org",
    probe: function (ctx) {
      const creds = readCredentials(ctx)
      const url =
        "https://api.github.com/organizations/" +
        encodeURIComponent(creds.org) +
        "/settings/billing/ai_credit/usage"
      const resp = ctx.host.http.request({
        method: "GET",
        url: url,
        headers: {
          Authorization: "Bearer " + creds.token,
          Accept: "application/vnd.github+json",
          "User-Agent": "OpenUsage",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        timeoutMs: 15000,
      })
      if (resp.status === 401 || resp.status === 403) throw SIGN_IN_AGAIN
      if (resp.status === 404) {
        throw "GitHub has no organization “" + creds.org + "” this token can read."
      }
      if (resp.status < 200 || resp.status >= 300) {
        throw "Request failed (HTTP " + resp.status + "). Try again later."
      }

      const totals = sumCopilotItems(ctx.util.tryParseJson(resp.bodyText))
      ctx.account.setLabel(creds.org)
      return {
        lines: [
          ctx.line.text({ label: "Org Credits", value: String(round2(totals.credits)) + " credits" }),
          ctx.line.text({ label: "Org Spend", value: "$" + round2(totals.spend).toFixed(2) }),
        ],
      }
    },
  }
})()
