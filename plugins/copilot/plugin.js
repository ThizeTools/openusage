(function () {
  const USAGE_URL = "https://api.github.com/copilot_internal/user"
  const USER_URL = "https://api.github.com/user"
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts."
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000

  function readToken(ctx) {
    const creds = ctx.account && ctx.account.credentials
    if (!creds || typeof creds.access_token !== "string" || !creds.access_token) {
      throw SIGN_IN_AGAIN
    }
    return creds.access_token
  }

  function num(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, value))
  }

  function planLabel(value) {
    if (typeof value !== "string") return undefined
    const words = value.trim().split(/[_\s-]+/).filter(Boolean)
    if (words.length === 0) return undefined
    return words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  }

  function percentLine(ctx, label, used, resetsAt) {
    const opts = {
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: MONTH_MS,
    }
    if (resetsAt) opts.resetsAt = resetsAt
    return ctx.line.progress(opts)
  }

  function snapshotLine(ctx, label, snapshot, resetsAt) {
    if (!snapshot || typeof snapshot !== "object") return null
    const entitlement = num(snapshot.entitlement)
    const remaining = num(snapshot.remaining)
    // Unlimited: explicit flag or GitHub's -1 sentinel. Hidden.
    if (snapshot.unlimited === true || entitlement === -1 || remaining === -1) return null
    if (entitlement === 0) return null

    const percentRemaining = num(snapshot.percent_remaining)
    let used
    if (percentRemaining !== null) {
      used = clampPercent(100 - percentRemaining)
    } else if (entitlement !== null && entitlement > 0 && remaining !== null) {
      used = clampPercent(100 - (remaining / entitlement) * 100)
    } else {
      return null
    }
    return percentLine(ctx, label, used, resetsAt)
  }

  function limitedLine(ctx, label, remainingRaw, totalRaw, resetsAt) {
    const total = num(totalRaw)
    const remaining = num(remainingRaw)
    if (total === null || total <= 0 || remaining === null) return null
    const used = Math.max(0, total - remaining)
    return percentLine(ctx, label, clampPercent((used / total) * 100), resetsAt)
  }

  function mapUsage(ctx, body) {
    const plan = planLabel(body.copilot_plan)
    const resetsAt =
      ctx.util.toIso(body.quota_reset_date) ||
      ctx.util.toIso(body.limited_user_reset_date) ||
      null
    const snapshots =
      body.quota_snapshots && typeof body.quota_snapshots === "object"
        ? body.quota_snapshots
        : {}
    const premium = snapshots.premium_interactions
    const lines = []

    const credits = snapshotLine(ctx, "Credits", premium, resetsAt)
    if (credits) {
      lines.push(credits)
      if (premium && premium.overage_permitted === true) {
        const overage = Math.max(0, num(premium.overage_count) || 0)
        lines.push(ctx.line.text({ label: "Extra Usage", value: String(overage) }))
      }
    }

    const chat = snapshotLine(ctx, "Chat", snapshots.chat, resetsAt)
    if (chat) lines.push(chat)
    const completions = snapshotLine(ctx, "Completions", snapshots.completions, resetsAt)
    if (completions) lines.push(completions)

    if (lines.length === 0) {
      const limited = body.limited_user_quotas || {}
      const monthly = body.monthly_quotas || {}
      const limitedChat = limitedLine(ctx, "Chat", limited.chat, monthly.chat, resetsAt)
      if (limitedChat) lines.push(limitedChat)
      const limitedCompletions = limitedLine(
        ctx, "Completions", limited.completions, monthly.completions, resetsAt
      )
      if (limitedCompletions) lines.push(limitedCompletions)
    }

    if (lines.length === 0) {
      if (body.token_based_billing !== true) {
        throw "Copilot usage data is unavailable for this account."
      }
      const used = premium ? num(premium.credits_used) : null
      if (used !== null && used > 0) {
        lines.push(ctx.line.text({ label: "Credits", value: String(used) }))
      }
    }

    return { plan: plan, lines: lines }
  }

  function fetchUsage(ctx, token) {
    const resp = ctx.host.http.request({
      method: "GET",
      url: USAGE_URL,
      headers: {
        Authorization: "token " + token,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
      },
      timeoutMs: 15000,
    })
    if (resp.status === 401 || resp.status === 403) throw SIGN_IN_AGAIN
    if (resp.status < 200 || resp.status >= 300) {
      throw "Request failed (HTTP " + resp.status + "). Try again later."
    }
    const body = ctx.util.tryParseJson(resp.bodyText)
    if (!body || typeof body !== "object") {
      throw "Invalid response from GitHub. Try again later."
    }
    return body
  }

  // Sets the account name to the GitHub login. A failed read keeps the current name.
  function syncLabel(ctx, token) {
    try {
      const resp = ctx.host.http.request({
        method: "GET",
        url: USER_URL,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "User-Agent": "OpenUsage",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("GitHub user read failed (HTTP " + resp.status + "); keeping account name")
        return
      }
      const user = ctx.util.tryParseJson(resp.bodyText)
      if (user && typeof user.login === "string" && user.login) {
        ctx.account.setLabel(user.login)
      }
    } catch (e) {
      ctx.host.log.warn("GitHub user read failed: " + String(e))
    }
  }

  globalThis.__openusage_plugin = {
    id: "copilot",
    probe: function (ctx) {
      const token = readToken(ctx)
      const mapped = mapUsage(ctx, fetchUsage(ctx, token))
      syncLabel(ctx, token)
      return { lines: mapped.lines, plan: mapped.plan }
    },
  }
})()
