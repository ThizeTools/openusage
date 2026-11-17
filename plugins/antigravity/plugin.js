(function () {
  var SIGN_IN = "Sign in again in Settings → Accounts."
  var UNAVAILABLE = "Antigravity usage is temporarily unavailable. Try again shortly."
  var TOKEN_URL = "https://oauth2.googleapis.com/token"
  var CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
  var CLIENT_SECRET = "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"
  var USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json"
  var PROD_URL = "https://cloudcode-pa.googleapis.com"
  var DAILY_URL = "https://daily-cloudcode-pa.googleapis.com"
  var LOAD_PATH = "/v1internal:loadCodeAssist"
  var QUOTA_PATH = "/v1internal:retrieveUserQuotaSummary"
  var USER_AGENT = "antigravity/hub/2.24.0 (aidev_client; os_type=windows; arch=amd64)"
  var LOAD_PAYLOAD = { metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }
  var TIMEOUT_MS = 15000
  var REFRESH_MARGIN_MS = 5 * 60 * 1000
  var HOUR_MS = 60 * 60 * 1000
  var SESSION_MS = 5 * HOUR_MS
  var WEEK_MS = 7 * 24 * HOUR_MS
  var ARGON_GROUP = "Gemini 4 Argon"
  var ARGON_LABEL = "Argon weekly"
  var BUCKETS = [
    { id: "gemini-5h", label: "Gemini 5h", periodMs: SESSION_MS },
    { id: "gemini-weekly", label: "Gemini weekly", periodMs: WEEK_MS },
    { id: "3p-5h", label: "Claude 5h", periodMs: SESSION_MS },
    { id: "3p-weekly", label: "Claude weekly", periodMs: WEEK_MS }
  ]
  var PAID_TIER_PLANS = {
    "g1-pro-tier": "Google AI Pro",
    "g1-ultra-tier": "Google AI Ultra",
    "g1-ultra-lite-tier": "Google AI Ultra Lite"
  }
  var RENEWAL_REFUSED = ["invalid_grant", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"]

  function obj(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : null
  }

  function arr(v) {
    return Array.isArray(v) ? v : []
  }

  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : null
  }

  function str(v) {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null
  }

  function isBucket(id) {
    for (var i = 0; i < BUCKETS.length; i++) {
      if (BUCKETS[i].id === id) return true
    }
    return false
  }

  function errorCode(body) {
    if (typeof body.error === "string") return body.error
    var err = obj(body.error)
    if (err && typeof err.code === "string") return err.code
    return typeof body.code === "string" ? body.code : null
  }

  // Trades the refresh token for a new access token and saves the merged credentials.
  function refreshGoogle(ctx, creds) {
    var refreshToken = str(creds.refresh_token)
    if (!refreshToken) throw SIGN_IN
    var form = "client_id=" + encodeURIComponent(CLIENT_ID) +
      "&client_secret=" + encodeURIComponent(CLIENT_SECRET) +
      "&refresh_token=" + encodeURIComponent(refreshToken) +
      "&grant_type=refresh_token"
    var resp = ctx.host.http.request({
      method: "POST",
      url: TOKEN_URL,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      bodyText: form,
      timeoutMs: TIMEOUT_MS
    })
    var body = obj(ctx.util.tryParseJson(resp.bodyText))
    if (resp.status < 200 || resp.status >= 300) {
      var code = body ? errorCode(body) : null
      if ([400, 401, 403].indexOf(resp.status) >= 0 && RENEWAL_REFUSED.indexOf(code) >= 0) throw SIGN_IN
      throw "Antigravity sign-in renewal failed (HTTP " + resp.status + "). Try again later."
    }
    var access = body ? str(body.access_token) : null
    if (!access) throw "Antigravity sign-in renewal returned an invalid response. Try again later."
    var expiresIn = num(body.expires_in) === null ? 3600 : body.expires_in
    var next = Object.assign({}, creds, body, {
      access_token: access,
      expiresAt: Date.parse(ctx.nowIso) + expiresIn * 1000
    })
    ctx.account.saveCredentials(JSON.stringify(next))
    return next
  }

  function cloudCodePost(ctx, url, token, payload) {
    return ctx.host.http.request({
      method: "POST",
      url: url,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "User-Agent": USER_AGENT
      },
      bodyText: JSON.stringify(payload),
      timeoutMs: TIMEOUT_MS
    })
  }

  function isOk(resp) {
    return resp.status >= 200 && resp.status < 300
  }

  // loadCodeAssist gives the plan and the project. Null when unavailable or refused.
  function loadCodeAssist(ctx, token) {
    var bases = [PROD_URL, DAILY_URL]
    for (var i = 0; i < bases.length; i++) {
      var resp = null
      try {
        resp = cloudCodePost(ctx, bases[i] + LOAD_PATH, token, LOAD_PAYLOAD)
      } catch (e) {
        continue
      }
      if (resp.status === 401 || resp.status === 403) return null
      if (isOk(resp)) return obj(ctx.util.tryParseJson(resp.bodyText))
    }
    return null
  }

  function requiresSubscription(resp, body) {
    if (resp.status !== 403 || !body) return false
    var err = obj(body.error)
    var details = err ? arr(err.details) : []
    for (var i = 0; i < details.length; i++) {
      if (obj(details[i]) && details[i].reason === "SUBSCRIPTION_REQUIRED") return true
    }
    return false
  }

  // Quota bodies (daily first, production for missing buckets). Null when the token is refused.
  function quotaBodies(ctx, token, project) {
    var payload = project === null ? {} : { project: project }
    var bases = [DAILY_URL, PROD_URL]
    var responses = []
    var transportError = null
    for (var i = 0; i < bases.length; i++) {
      var resp = null
      try {
        resp = cloudCodePost(ctx, bases[i] + QUOTA_PATH, token, payload)
      } catch (e) {
        transportError = e
        continue
      }
      responses.push(resp)
      if (i === 0 && isOk(resp) && isCompleteSummary(obj(ctx.util.tryParseJson(resp.bodyText)))) break
    }
    if (responses.length === 0 && transportError !== null) throw transportError

    var bodies = []
    var parsed = responses.map(function (r) {
      return obj(ctx.util.tryParseJson(r.bodyText))
    })
    for (var j = 0; j < responses.length; j++) {
      if (isOk(responses[j])) bodies.push(parsed[j])
    }
    if (bodies.length > 0) return bodies

    var refused = responses.some(function (r) { return r.status === 401 })
    if (refused) return null
    for (var k = 0; k < responses.length; k++) {
      if (requiresSubscription(responses[k], parsed[k])) {
        throw project === null
          ? "Antigravity couldn't find a project with quota access for this account. Try again shortly."
          : "Google reports no Antigravity quota subscription for this project."
      }
    }
    if (responses.some(function (r) { return r.status === 403 })) throw SIGN_IN
    var limited = responses.filter(function (r) { return r.status === 429 })
    if (limited.length > 0) throw "Antigravity request failed (HTTP 429). Try again later."
    throw UNAVAILABLE
  }

  function summaryGroups(body) {
    if (!body) return null
    var resp = obj(body.response)
    var groups = resp && Array.isArray(resp.groups) ? resp.groups : body.groups
    if (!Array.isArray(groups)) return null
    return groups.filter(function (g) { return obj(g) !== null })
  }

  function isCompleteSummary(body) {
    var groups = summaryGroups(body)
    if (!groups) return false
    var usable = {}
    groups.forEach(function (g) {
      if (g.displayName === ARGON_GROUP) return
      arr(g.buckets).forEach(function (b) {
        if (obj(b) && num(b.remainingFraction) !== null) usable[b.bucketId] = true
      })
    })
    return BUCKETS.every(function (spec) { return usable[spec.id] === true })
  }

  function usageLine(ctx, label, fraction, resetTime, periodMs) {
    var clamped = Math.max(0, Math.min(1, fraction))
    return ctx.line.progress({
      label: label,
      used: (1 - clamped) * 100,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetTime ? ctx.util.toIso(resetTime) : null,
      periodDurationMs: periodMs
    })
  }

  // The separate Argon weekly bucket, from its own group.
  function argonWeeklyLine(ctx, groups) {
    var argonGroups = groups.filter(function (g) { return g.displayName === ARGON_GROUP })
    if (argonGroups.length === 0) return null
    var buckets = []
    argonGroups.forEach(function (g) {
      arr(g.buckets).forEach(function (b) {
        if (obj(b)) buckets.push(b)
      })
    })
    var weekly = buckets.filter(function (b) { return b.window === "weekly" })
    if (weekly.length !== 1) return null
    var bucket = weekly[0]
    var id = str(bucket.bucketId)
    if (!id || isBucket(id)) return null
    if (bucket.disabled !== undefined && bucket.disabled !== null && typeof bucket.disabled !== "boolean") return null
    if (bucket.disabled === true) return null
    var fraction = num(bucket.remainingFraction)
    if (fraction === null) return null
    return usageLine(ctx, ARGON_LABEL, fraction, str(bucket.resetTime), WEEK_MS)
  }

  function parseQuota(ctx, bodies) {
    var groupLists = bodies.map(summaryGroups).filter(function (g) { return g !== null })
    if (groupLists.length === 0) return null

    var pooled = {}
    groupLists.forEach(function (groups) {
      groups.forEach(function (g) {
        if (g.displayName === ARGON_GROUP) return
        arr(g.buckets).forEach(function (b) {
          if (!obj(b) || !isBucket(b.bucketId) || pooled[b.bucketId]) return
          var fraction = num(b.remainingFraction)
          if (fraction === null) return
          pooled[b.bucketId] = { fraction: fraction, resetTime: str(b.resetTime) }
        })
      })
    })

    var lines = []
    BUCKETS.forEach(function (spec) {
      var entry = pooled[spec.id]
      if (entry) lines.push(usageLine(ctx, spec.label, entry.fraction, entry.resetTime, spec.periodMs))
    })

    var argon = null
    for (var i = 0; i < groupLists.length && argon === null; i++) {
      argon = argonWeeklyLine(ctx, groupLists[i])
    }
    if (argon) {
      var index = lines.length
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].label === "Claude 5h" || lines[j].label === "Claude weekly") {
          index = j
          break
        }
      }
      lines.splice(index, 0, argon)
    }
    return lines
  }

  function formatPlan(ctx, raw) {
    if (!raw) return null
    var lower = raw.toLowerCase()
    var tiers = ["Ultra Lite", "Ultra", "Pro"]
    for (var i = 0; i < tiers.length; i++) {
      if (lower.indexOf(tiers[i].toLowerCase()) >= 0) return "Google AI " + tiers[i]
    }
    return ctx.fmt.planLabel(raw)
  }

  function parsePlan(ctx, codeAssist) {
    var paid = obj(codeAssist.paidTier)
    var current = obj(codeAssist.currentTier)
    if (paid && str(paid.id) && PAID_TIER_PLANS[paid.id]) return PAID_TIER_PLANS[paid.id]
    return formatPlan(ctx, (paid && str(paid.name)) || (current && str(current.name)))
  }

  function fetchLabel(ctx, token) {
    var resp = null
    try {
      resp = ctx.host.http.request({
        method: "GET",
        url: USERINFO_URL,
        headers: { Authorization: "Bearer " + token },
        timeoutMs: TIMEOUT_MS
      })
    } catch (e) {
      ctx.host.log.warn("Antigravity account lookup failed: " + String(e))
      return null
    }
    if (!isOk(resp)) {
      ctx.host.log.warn("Antigravity account lookup returned HTTP " + resp.status)
      return null
    }
    var info = obj(ctx.util.tryParseJson(resp.bodyText))
    return info ? str(info.email) : null
  }

  function probe(ctx) {
    var creds = ctx.account && ctx.account.credentials
    if (!creds || !str(creds.access_token)) throw SIGN_IN

    var nowMs = Date.parse(ctx.nowIso)
    var current = creds
    var expiresAt = num(creds.expiresAt)
    if (str(creds.refresh_token) && expiresAt !== null && expiresAt <= nowMs + REFRESH_MARGIN_MS) {
      try {
        current = refreshGoogle(ctx, current)
      } catch (e) {
        if (expiresAt <= nowMs) throw e
        ctx.host.log.warn("Antigravity early token refresh failed; keeping the current token: " + String(e))
      }
    }

    var codeAssist = loadCodeAssist(ctx, current.access_token)
    var project = codeAssist ? str(codeAssist.cloudaicompanionProject) : null
    var bodies = quotaBodies(ctx, current.access_token, project)
    if (bodies === null) {
      // The token was refused: renew once and read again. A second refusal is an expired sign-in.
      current = refreshGoogle(ctx, current)
      bodies = quotaBodies(ctx, current.access_token, project)
      if (bodies === null) throw SIGN_IN
    }

    var lines = parseQuota(ctx, bodies)
    if (lines === null) throw "Antigravity returned an invalid usage response. Try again later."

    var email = fetchLabel(ctx, current.access_token)
    if (email) ctx.account.setLabel(email)

    var out = { lines: lines }
    var plan = codeAssist ? parsePlan(ctx, codeAssist) : null
    if (plan) out.plan = plan
    return out
  }

  globalThis.__openusage_plugin = { id: "antigravity", probe: probe }
})()
