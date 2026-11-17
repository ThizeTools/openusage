(function () {
  var SIGN_IN = "Sign in again in Settings → Accounts."
  var API = "https://api2.cursor.sh/aiserver.v1.DashboardService/"
  var USAGE_URL = API + "GetCurrentPeriodUsage"
  var PLAN_URL = API + "GetPlanInfo"
  var CREDITS_URL = API + "GetCreditGrantsBalance"
  var GROK_URL = API + "GetSandUsageStatus"
  var REFRESH_URL = "https://api2.cursor.sh/oauth/token"
  var CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
  var WEB = "https://cursor.com/api/"
  var USAGE_SUMMARY_URL = WEB + "usage-summary"
  var REST_USAGE_URL = WEB + "usage"
  var STRIPE_URL = WEB + "auth/stripe"
  var PROFILE_URL = WEB + "auth/me"
  var TIMEOUT_MS = 10000
  var DAY_MS = 24 * 60 * 60 * 1000
  var WEEK_MS = 7 * DAY_MS
  var MONTH_MS = 30 * DAY_MS
  // The access token is a 60-day JWT that is also the refresh token: renew a week before its exp.
  var REFRESH_LEAD_MS = WEEK_MS
  var RENEWAL_REFUSED = ["invalid_grant", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"]
  var ON_DEMAND_LABELS = ["Extra Usage", "Team Spend"]

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

  function numOr(v, fallback) {
    var n = num(v)
    return n === null ? fallback : n
  }

  function str(v) {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null
  }

  function money(cents) {
    return "$" + (cents / 100).toFixed(2)
  }

  function jwtPayload(ctx, token) {
    return obj(ctx.jwt.decodePayload(token))
  }

  function jwtExpMs(ctx, token) {
    var payload = jwtPayload(ctx, token)
    var exp = payload ? num(payload.exp) : null
    return exp === null ? null : exp * 1000
  }

  function isoMs(ctx, value) {
    var iso = ctx.util.toIso(value)
    return iso === null ? null : Date.parse(iso)
  }

  // Session cookie built from the JWT subject, as the cursor.com endpoints expect it.
  function cursorSession(ctx, token) {
    var payload = jwtPayload(ctx, token)
    var subject = payload ? str(payload.sub) : null
    if (!subject) return null
    var parts = subject.split("|")
    var userId = parts.length > 1 ? parts[1] : parts[0]
    if (!userId) return null
    return { userId: userId, cookie: "WorkosCursorSessionToken=" + userId + "%3A%3A" + token }
  }

  function connectPost(ctx, url, token) {
    return ctx.host.http.request({
      method: "POST",
      url: url,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1"
      },
      bodyText: "{}",
      timeoutMs: TIMEOUT_MS
    })
  }

  function cookieGet(ctx, url, session) {
    if (!session) return null
    return ctx.host.http.request({ method: "GET", url: url, headers: { Cookie: session.cookie }, timeoutMs: TIMEOUT_MS })
  }

  // Optional reads: a failure is logged and only its metric is skipped.
  function optionalJson(ctx, label, send) {
    var resp = null
    try {
      resp = send()
    } catch (e) {
      ctx.host.log.warn("Cursor " + label + " request failed: " + String(e))
      return null
    }
    if (!resp) {
      ctx.host.log.warn("Cursor " + label + " request could not be prepared from the current session")
      return null
    }
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("Cursor " + label + " request returned HTTP " + resp.status)
      return null
    }
    var body = obj(ctx.util.tryParseJson(resp.bodyText))
    if (!body) ctx.host.log.warn("Cursor " + label + " response was not a JSON object")
    return body
  }

  function errorCode(body) {
    if (typeof body.error === "string") return body.error
    var err = obj(body.error)
    if (err && typeof err.code === "string") return err.code
    return typeof body.code === "string" ? body.code : null
  }

  // Trades the refresh token for a new JWT and saves it. Cursor answers with access_token only.
  function refreshAccess(ctx, creds) {
    var refreshToken = str(creds.refreshToken)
    if (!refreshToken) throw SIGN_IN
    var resp = ctx.host.http.request({
      method: "POST",
      url: REFRESH_URL,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      bodyText: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken }),
      timeoutMs: TIMEOUT_MS
    })
    var body = obj(ctx.util.tryParseJson(resp.bodyText))
    if (body && body.shouldLogout === true) throw SIGN_IN
    if (resp.status < 200 || resp.status >= 300) {
      var code = body ? errorCode(body) : null
      if ([400, 401, 403].indexOf(resp.status) >= 0 && RENEWAL_REFUSED.indexOf(code) >= 0) throw SIGN_IN
      throw "Cursor sign-in renewal failed (HTTP " + resp.status + "). Try again later."
    }
    var access = body ? str(body.access_token) : null
    if (!access) throw "Cursor sign-in renewal returned an invalid response. Try again later."
    var next = Object.assign({}, creds, {
      accessToken: access,
      refreshToken: str(body.refresh_token) || access,
      expiresAt: jwtExpMs(ctx, access)
    })
    ctx.account.saveCredentials(JSON.stringify(next))
    return next
  }

  function resolvedPlanName(planName, membership) {
    var lower = planName ? planName.toLowerCase() : null
    var isOrg = membership === "enterprise" || membership === "team"
    if (isOrg && (planName === null || lower === "pro" || lower === "pro plan")) return membership
    return planName || membership
  }

  function billingCycle(ctx, usage) {
    var start = num(usage.billingCycleStart)
    var end = num(usage.billingCycleEnd)
    if (start !== null && end !== null && end > start) {
      return { resetsAt: ctx.util.toIso(end), periodMs: Math.round(end - start) }
    }
    return { resetsAt: end === null ? null : ctx.util.toIso(end), periodMs: MONTH_MS }
  }

  function summaryCycle(ctx, summary, rest) {
    var start = summary ? isoMs(ctx, summary.billingCycleStart) : null
    var end = summary ? isoMs(ctx, summary.billingCycleEnd) : null
    if (start !== null && end !== null && end > start) {
      return { resetsAt: ctx.util.toIso(end), periodMs: end - start }
    }
    var restStart = rest ? isoMs(ctx, rest.startOfMonth) : null
    return { resetsAt: restStart === null ? null : ctx.util.toIso(restStart + MONTH_MS), periodMs: MONTH_MS }
  }

  function percentLine(ctx, label, used, cycle) {
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: cycle.resetsAt,
      periodDurationMs: cycle.periodMs
    })
  }

  // Cents in, dollars out.
  function dollarLine(ctx, label, usedCents, limitCents, cycle) {
    return ctx.line.progress({
      label: label,
      used: usedCents / 100,
      limit: limitCents / 100,
      format: { kind: "dollars" },
      resetsAt: cycle.resetsAt,
      periodDurationMs: cycle.periodMs
    })
  }

  function countLine(ctx, label, used, limit, cycle) {
    return ctx.line.progress({
      label: label,
      used: used,
      limit: limit,
      format: { kind: "count", suffix: "requests" },
      resetsAt: cycle.resetsAt,
      periodDurationMs: cycle.periodMs
    })
  }

  function planFacts(usage) {
    var pu = obj(usage.planUsage)
    var hasPlanUsage = pu !== null
    pu = pu || {}
    var limit = num(pu.limit)
    var totalPercentUsed = num(pu.totalPercentUsed)
    var auto = num(pu.autoPercentUsed)
    var api = num(pu.apiPercentUsed)
    var spent = numOr(pu.totalSpend, (limit || 0) - numOr(pu.remaining, limit === null ? 0 : limit))
    var hasModelPools = false
    if (auto !== null && api !== null && auto >= 0 && api >= 0) {
      hasModelPools = auto > 0 || api > 0 || spent === 0
    }
    var sl = obj(usage.spendLimitUsage) || {}
    var limitType = str(sl.limitType)
    var pooledLimit = numOr(sl.pooledLimit, 0)
    var isEnabled = usage.enabled !== false
    var planUsageLimitMissing = hasPlanUsage && limit === null
    return {
      isEnabled: isEnabled,
      hasPlanUsage: hasPlanUsage,
      limit: limit,
      totalPercentUsed: totalPercentUsed,
      hasModelPools: hasModelPools,
      pooledLimit: pooledLimit,
      planUsageLimitMissing: planUsageLimitMissing,
      planUsageUnusable: !hasPlanUsage || (planUsageLimitMissing && !hasModelPools),
      isTeamByShape: (limitType !== null && limitType.toLowerCase() === "team") || pooledLimit > 0,
      shouldTryGenericRequestFallback: isEnabled && hasPlanUsage && limit === null && totalPercentUsed === null && !hasModelPools
    }
  }

  // Non-null when plan data is unusable and the request-based summary must be read instead.
  function requestFallbackMessage(f, planName) {
    if (!f.isEnabled) return null
    var normalized = planName ? planName.toLowerCase() : ""
    if (f.planUsageUnusable && f.totalPercentUsed === null) {
      if (normalized === "enterprise") return "Enterprise usage data unavailable. Try again later."
      if (normalized === "team") return "Team request-based usage data unavailable. Try again later."
      if (normalized === "" && planName === null) return "Cursor request-based usage data unavailable. Try again later."
    }
    if (f.isTeamByShape && f.planUsageLimitMissing && !f.hasModelPools) {
      return "Cursor request-based usage data unavailable. Try again later."
    }
    return null
  }

  function onDemandSpend(reported, limit, remaining) {
    for (var i = 0; i < reported.length; i++) {
      if (reported[i] > 0) return reported[i]
    }
    var inferred = remaining === null ? 0 : Math.max(0, limit - remaining)
    if (inferred > 0) return inferred
    return reported.length > 0 ? reported[0] : 0
  }

  function appendOnDemandUsage(ctx, sl, f, cycle, lines) {
    var individualLimit = num(sl.individualLimit)
    var hasTeamSpend = f.isTeamByShape || numOr(sl.pooledUsed, 0) > 0
    var limit = 0
    var spentKeys = ["individualUsed", "pooledUsed", "totalSpend"]
    var remainingKey = null
    if (individualLimit !== null) {
      limit = individualLimit
      spentKeys = hasTeamSpend ? ["individualUsed"] : ["individualUsed", "totalSpend"]
      remainingKey = "individualRemaining"
    } else if (f.pooledLimit > 0) {
      limit = f.pooledLimit
      spentKeys = ["pooledUsed"]
      remainingKey = "pooledRemaining"
    }
    var reported = []
    for (var i = 0; i < spentKeys.length; i++) {
      var v = num(sl[spentKeys[i]])
      if (v !== null) reported.push(v)
    }
    var spent = onDemandSpend(reported, limit, remainingKey ? num(sl[remainingKey]) : null)
    var label = individualLimit === null && f.isTeamByShape && (limit > 0 || spent > 0) ? "Team Spend" : "Extra Usage"
    if (limit > 0) lines.push(dollarLine(ctx, label, spent, limit, cycle))
    else if (spent > 0) lines.push(ctx.line.text({ label: label, value: money(spent) }))
  }

  function creditsLine(ctx, credits, stripeCents, lines) {
    var hasGrants = credits !== null && credits.hasCreditGrants === true
    var grantTotal = hasGrants ? numOr(credits.totalCents, 0) : 0
    var grantUsed = hasGrants ? numOr(credits.usedCents, 0) : 0
    var validGrant = hasGrants && grantTotal > 0
    var combined = (validGrant ? grantTotal : 0) + stripeCents
    if (credits === null && !(combined > 0)) return
    var remaining = Math.max(0, combined - (validGrant ? grantUsed : 0))
    lines.push(ctx.line.text({ label: "Credits", value: money(remaining) + " left" }))
  }

  // Plan-usage metrics (the main path).
  function usageLines(ctx, usage, f, planName, credits, stripeCents) {
    if (!f.isEnabled || !f.hasPlanUsage) throw "No active Cursor subscription."
    if (f.limit === null && f.totalPercentUsed === null && !f.hasModelPools) {
      throw "Total usage limit missing from API response."
    }
    var pu = obj(usage.planUsage) || {}
    var cycle = billingCycle(ctx, usage)
    var lines = []
    creditsLine(ctx, credits, stripeCents, lines)

    var planUsedCents = numOr(pu.totalSpend, (f.limit || 0) - numOr(pu.remaining, 0))
    var computedPercent = f.limit !== null && f.limit > 0 ? (planUsedCents / f.limit) * 100 : 0
    var isTeam = (planName !== null && planName.toLowerCase() === "team") || f.isTeamByShape
    if (isTeam && f.hasModelPools) {
      // Structured pool data wins; never build a total from stale dollars.
      if (f.totalPercentUsed !== null) lines.push(percentLine(ctx, "Total Usage", f.totalPercentUsed, cycle))
    } else if (isTeam) {
      if (f.limit !== null) lines.push(dollarLine(ctx, "Total Usage", planUsedCents, f.limit, cycle))
      else if (f.totalPercentUsed !== null) lines.push(percentLine(ctx, "Total Usage", f.totalPercentUsed, cycle))
      else throw "Cursor request-based usage data unavailable. Try again later."
    } else {
      lines.push(percentLine(ctx, "Total Usage", f.totalPercentUsed !== null ? f.totalPercentUsed : computedPercent, cycle))
    }

    var auto = num(pu.autoPercentUsed)
    if (auto !== null) lines.push(percentLine(ctx, "Cursor Models", auto, cycle))
    var api = num(pu.apiPercentUsed)
    if (api !== null) lines.push(percentLine(ctx, "Other Models", api, cycle))

    var sl = obj(usage.spendLimitUsage)
    if (sl) appendOnDemandUsage(ctx, sl, f, cycle, lines)
    return lines
  }

  function dollarMeter(value) {
    var b = obj(value)
    if (!b || b.enabled === false) return null
    var limit = num(b.limit)
    if (limit === null || limit <= 0) return null
    var reported = num(b.used)
    var inferred = Math.max(0, limit - numOr(b.remaining, limit))
    var used = reported !== null && reported > 0 ? reported : inferred
    return { used: Math.max(0, used), limit: limit }
  }

  function appendOnDemandBucket(ctx, value, cycle, lines) {
    var b = obj(value)
    if (!b || b.enabled === false) return false
    var meter = dollarMeter(b)
    if (meter) {
      lines.push(dollarLine(ctx, "Extra Usage", meter.used, meter.limit, cycle))
      return true
    }
    var used = num(b.used)
    if (used !== null && used > 0) {
      lines.push(ctx.line.text({ label: "Extra Usage", value: money(used) }))
      return true
    }
    return false
  }

  function appendOnDemand(ctx, summary, cycle, lines) {
    var ind = obj(summary.individualUsage) || {}
    var team = obj(summary.teamUsage) || {}
    if (!appendOnDemandBucket(ctx, ind.onDemand, cycle, lines)) appendOnDemandBucket(ctx, team.onDemand, cycle, lines)
  }

  function usableDollarBucket(value) {
    var b = obj(value)
    if (!b || b.enabled === false) return false
    return dollarMeter(b) !== null || numOr(b.used, 0) > 0
  }

  function hasUsableSummaryPayload(ctx, summary) {
    var start = isoMs(ctx, summary.billingCycleStart)
    var end = isoMs(ctx, summary.billingCycleEnd)
    if (start !== null && end !== null && end > start) return true
    var ind = obj(summary.individualUsage) || {}
    var team = obj(summary.teamUsage) || {}
    var plan = obj(ind.plan) || {}
    var keys = ["totalPercentUsed", "autoPercentUsed", "apiPercentUsed"]
    for (var i = 0; i < keys.length; i++) {
      if (num(plan[keys[i]]) !== null) return true
    }
    return [ind.onDemand, ind.overall, team.onDemand, team.pooled].some(usableDollarBucket)
  }

  function appendRequests(ctx, rest, cycle, lines) {
    var gpt4 = rest ? obj(rest["gpt-4"]) : null
    if (!gpt4) return false
    var limit = num(gpt4.maxRequestUsage)
    if (limit === null || limit <= 0) return false
    var used = Math.max(0, numOr(gpt4.numRequests, numOr(gpt4.numRequestsTotal, 0)))
    lines.push(countLine(ctx, "Total Usage", used, limit, cycle))
    lines.push(countLine(ctx, "Requests", used, limit, cycle))
    return true
  }

  function appendSummaryTotal(ctx, summary, cycle, lines) {
    var ind = obj(summary.individualUsage) || {}
    var team = obj(summary.teamUsage) || {}
    var limitType = str(summary.limitType)
    if (limitType !== null && limitType.toLowerCase() === "team") {
      var pooled = dollarMeter(team.pooled)
      if (pooled) {
        lines.push(dollarLine(ctx, "Total Usage", pooled.used, pooled.limit, cycle))
        return
      }
    }
    var pct = num((obj(ind.plan) || {}).totalPercentUsed)
    if (pct !== null) {
      lines.push(percentLine(ctx, "Total Usage", pct, cycle))
      return
    }
    var overall = dollarMeter(ind.overall)
    if (overall) {
      lines.push(dollarLine(ctx, "Total Usage", overall.used, overall.limit, cycle))
      return
    }
    var teamPooled = dollarMeter(team.pooled)
    if (teamPooled) lines.push(dollarLine(ctx, "Total Usage", teamPooled.used, teamPooled.limit, cycle))
  }

  // Request-based summary: used when plan data is unusable (team, enterprise, or no limit).
  function summaryLines(ctx, summary, rest) {
    var cycle = summaryCycle(ctx, summary, rest)
    var lines = []
    if (!appendRequests(ctx, rest, cycle, lines)) appendSummaryTotal(ctx, summary, cycle, lines)
    var ind = summary ? obj(summary.individualUsage) || {} : {}
    var plan = obj(ind.plan) || {}
    var auto = num(plan.autoPercentUsed)
    if (auto !== null) lines.push(percentLine(ctx, "Cursor Models", auto, cycle))
    var api = num(plan.apiPercentUsed)
    if (api !== null) lines.push(percentLine(ctx, "Other Models", api, cycle))
    if (summary) appendOnDemand(ctx, summary, cycle, lines)
    return lines
  }

  function creditsFromStripe(stripe) {
    var balance = stripe ? num(stripe.customerBalance) : null
    return balance !== null && balance < 0 ? -balance : 0
  }

  function grokUsageLine(ctx, u) {
    if (u.usesPooledEnterpriseAllowance === true || u.hasNonZeroIncludedLimit === false || u.includedLimitZero === true) {
      return null
    }
    var percent = num(u.usagePercent)
    if (percent === null || percent < 0) return null
    var reset = isoMs(ctx, u.nextResetTimestampUtc)
    var start = isoMs(ctx, u.currentPeriodStart)
    var periodMs = start !== null && reset !== null && reset > start ? Math.round(reset - start) : WEEK_MS
    return ctx.line.progress({
      label: "Grok Bot",
      used: Math.min(Math.max(percent, 0), 100),
      limit: 100,
      format: { kind: "percent" },
      resetsAt: reset === null ? null : ctx.util.toIso(reset),
      periodDurationMs: periodMs
    })
  }

  function normalizedMembership(value) {
    var s = str(value)
    return s ? s.toLowerCase() : null
  }

  function hasLabel(lines, labels) {
    return lines.some(function (line) {
      return labels.indexOf(line.label) >= 0
    })
  }

  function restSend(ctx, session) {
    var url = REST_USAGE_URL + "?user=" + encodeURIComponent(session ? session.userId : "")
    return function () {
      return cookieGet(ctx, url, session)
    }
  }

  function probe(ctx) {
    var creds = ctx.account && ctx.account.credentials
    if (!creds || !str(creds.accessToken)) throw SIGN_IN

    var nowMs = Date.parse(ctx.nowIso)
    var current = creds
    var expiresAt = numOr(creds.expiresAt, jwtExpMs(ctx, creds.accessToken))
    if (expiresAt !== null && expiresAt - REFRESH_LEAD_MS <= nowMs) {
      try {
        current = refreshAccess(ctx, current)
      } catch (e) {
        if (expiresAt <= nowMs) throw e
        ctx.host.log.warn("Cursor early token refresh failed; keeping the current token: " + String(e))
      }
    }

    var access = current.accessToken
    var usageResp = ctx.util.retryOnceOnAuth({
      request: function (token) {
        if (token) access = token
        return connectPost(ctx, USAGE_URL, access)
      },
      refresh: function () {
        current = refreshAccess(ctx, current)
        return current.accessToken
      }
    })
    if (ctx.util.isAuthStatus(usageResp.status)) throw SIGN_IN
    if (usageResp.status < 200 || usageResp.status >= 300) {
      throw "Cursor usage request failed (HTTP " + usageResp.status + "). Try again later."
    }
    var usage = obj(ctx.util.tryParseJson(usageResp.bodyText))
    if (!usage) throw "Cursor usage response was invalid. Try again later."

    var session = cursorSession(ctx, access)
    var planBody = optionalJson(ctx, "plan", function () { return connectPost(ctx, PLAN_URL, access) })
    var planInfo = planBody ? obj(planBody.planInfo) : null
    var planName = planInfo ? str(planInfo.planName) : null
    var summary = optionalJson(ctx, "usage-summary", function () { return cookieGet(ctx, USAGE_SUMMARY_URL, session) })
    var membership = summary ? normalizedMembership(summary.membershipType) : null
    var isOrgSeat = membership === "enterprise" || membership === "team"

    var f = planFacts(usage)
    var fallback = requestFallbackMessage(f, isOrgSeat ? membership : planName)
    var lines = null
    if (fallback !== null) {
      var restUsage = optionalJson(ctx, "request-based usage", restSend(ctx, session))
      lines = summaryLines(ctx, summary, restUsage)
      if (lines.length === 0) throw fallback
    } else if (f.shouldTryGenericRequestFallback) {
      var generic = optionalJson(ctx, "request-based usage", restSend(ctx, session))
      if (generic) {
        var genericLines = summaryLines(ctx, null, generic)
        if (genericLines.length > 0) lines = genericLines
      }
    }

    if (lines === null) {
      var stripe = optionalJson(ctx, "prepaid-balance", function () { return cookieGet(ctx, STRIPE_URL, session) })
      var credits = optionalJson(ctx, "credit-grants", function () { return connectPost(ctx, CREDITS_URL, access) })
      lines = usageLines(ctx, usage, f, planName, credits, creditsFromStripe(stripe))
      var needsOnDemand = !hasLabel(lines, ON_DEMAND_LABELS)
      if (needsOnDemand && (isOrgSeat || f.isTeamByShape) && summary && hasUsableSummaryPayload(ctx, summary)) {
        appendOnDemand(ctx, summary, summaryCycle(ctx, summary, null), lines)
      }
    }

    var grok = optionalJson(ctx, "Grok Bot usage", function () { return connectPost(ctx, GROK_URL, access) })
    var grokLine = grok ? grokUsageLine(ctx, grok) : null
    if (grokLine) lines.push(grokLine)

    var profile = optionalJson(ctx, "profile", function () { return cookieGet(ctx, PROFILE_URL, session) })
    var email = profile ? str(profile.email) : null
    if (email) ctx.account.setLabel(email)

    var out = { lines: lines }
    var resolved = resolvedPlanName(planName, membership)
    if (resolved) out.plan = ctx.fmt.planLabel(resolved)
    return out
  }

  globalThis.__openusage_plugin = { id: "cursor", probe: probe }
})()
