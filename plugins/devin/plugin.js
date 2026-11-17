(function () {
  var SIGN_IN = "Sign in again in Settings → Accounts."
  var SESSION_PREFIX = "devin-session-token$"
  var DEFAULT_API_SERVER = "https://server.codeium.com"
  var USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus"
  var CLOUD_COMPAT_VERSION = "1.108.2"
  var TIMEOUT_MS = 15000
  var DAY_MS = 24 * 60 * 60 * 1000
  var WEEK_MS = 7 * DAY_MS

  function obj(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : null
  }

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : null
    if (typeof v === "string" && v.trim() !== "") {
      var n = Number(v)
      return isFinite(n) ? n : null
    }
    return null
  }

  function str(v) {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null
  }

  // Devin reports the share of each quota still left. A reset with no share means none left.
  function quota(ctx, planStatus, remainingKey, resetKey) {
    var resetSeconds = num(planStatus[resetKey])
    var resetsAt = resetSeconds === null ? null : ctx.util.toIso(resetSeconds)
    if (planStatus[remainingKey] === undefined) {
      return resetSeconds === null ? null : { remaining: 0, resetsAt: resetsAt }
    }
    var remaining = num(planStatus[remainingKey])
    if (remaining === null) throw "Devin usage response was invalid. Try again later."
    return { remaining: remaining, resetsAt: resetsAt }
  }

  function quotaLine(ctx, label, q, periodMs) {
    var used = Math.min(Math.max(100 - q.remaining, 0), 100)
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: q.resetsAt,
      periodDurationMs: periodMs
    })
  }

  function probe(ctx) {
    var creds = ctx.account && ctx.account.credentials
    var token = creds ? str(creds.token) : null
    if (!token) throw SIGN_IN
    var apiKey = token.indexOf(SESSION_PREFIX) === 0 ? token : SESSION_PREFIX + token
    var server = (str(creds.api_server_url) || DEFAULT_API_SERVER).replace(/\/+$/, "")

    var resp = ctx.host.http.request({
      method: "POST",
      url: server + USER_STATUS_PATH,
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1"
      },
      bodyText: JSON.stringify({
        metadata: {
          apiKey: apiKey,
          ideName: "devin",
          ideVersion: CLOUD_COMPAT_VERSION,
          extensionName: "devin",
          extensionVersion: CLOUD_COMPAT_VERSION,
          locale: "en"
        }
      }),
      timeoutMs: TIMEOUT_MS
    })
    if (resp.status === 401 || resp.status === 403) throw SIGN_IN
    if (resp.status < 200 || resp.status >= 300) {
      throw "Devin request failed (HTTP " + resp.status + "). Try again later."
    }
    var body = obj(ctx.util.tryParseJson(resp.bodyText))
    var userStatus = body ? obj(body.userStatus) : null
    if (!userStatus) throw "Devin usage response was invalid. Try again later."

    var email = str(userStatus.email)
    if (email) ctx.account.setLabel(email)

    var planStatus = obj(userStatus.planStatus) || {}
    var planInfo = obj(planStatus.planInfo) || {}
    var daily = quota(ctx, planStatus, "dailyQuotaRemainingPercent", "dailyQuotaResetAtUnix")
    var weekly = quota(ctx, planStatus, "weeklyQuotaRemainingPercent", "weeklyQuotaResetAtUnix")

    var lines = []
    if (planInfo.hideDailyQuota === true) {
      // A plan that hides its daily quota still meters it; the weekly row carries it when present.
      var shown = weekly || (daily ? { remaining: daily.remaining, resetsAt: null } : null)
      if (shown) lines.push(quotaLine(ctx, "Weekly quota", shown, WEEK_MS))
    } else {
      if (daily) lines.push(quotaLine(ctx, "Daily quota", daily, DAY_MS))
      if (weekly) lines.push(quotaLine(ctx, "Weekly quota", weekly, WEEK_MS))
    }

    var overageMicros = num(planStatus.overageBalanceMicros)
    if (overageMicros !== null) {
      var dollars = Math.max(0, overageMicros) / 1000000
      lines.push(ctx.line.text({ label: "Extra usage balance", value: "$" + dollars.toFixed(2) + " left" }))
    }
    if (lines.length === 0) throw "Devin reports no quota for this account."

    var out = { lines: lines }
    var plan = str(planInfo.planName)
    if (plan) out.plan = plan
    return out
  }

  globalThis.__openusage_plugin = { id: "devin", probe: probe }
})()
