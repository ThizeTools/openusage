(function () {
  const PROVIDER_ID = "opencode-go";
  const CLIENT_ID = "opencode-cli";
  const TOKEN_URL = "https://opencode.ai/console/auth/device/token";
  const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
  const GO_STATUS_URL = "https://opencode.ai/console/api/go/status";
  const USER_URL = "https://opencode.ai/console/api/user";
  const SIGN_IN_AGAIN = "Sign in again in Settings → Accounts.";
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  const SESSION_MS = 5 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const PLACEHOLDER_TOLERANCE_MS = 2000;
  const RENEWAL_REFUSED = [
    "invalid_grant",
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
  ];

  function numberOf(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function clampPercent(value) {
    return Math.min(Math.max(value, 0), 100);
  }

  function formEncode(fields) {
    return Object.keys(fields)
      .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]))
      .join("&");
  }

  function bearerHeaders(token) {
    return { Authorization: "Bearer " + token, Accept: "application/json" };
  }

  function withOrg(headers, name, orgId) {
    if (orgId) headers[name] = orgId;
    return headers;
  }

  function errorCode(body) {
    if (!body) return null;
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error.code === "string") return body.error.code;
    return typeof body.code === "string" ? body.code : null;
  }

  function errorType(resp, ctx) {
    const body = ctx.util.tryParseJson(resp.bodyText);
    return body && body.error && typeof body.error.type === "string" ? body.error.type : null;
  }

  function planName(product) {
    if (product === "go") return "Go";
    if (product === "go-plus") return "Go Plus";
    if (product === "go-teams") return "Go Teams";
    return null;
  }

  function readCredentials(ctx) {
    const creds = ctx.account && ctx.account.credentials;
    if (!creds || typeof creds.access_token !== "string" || !creds.access_token) {
      throw SIGN_IN_AGAIN;
    }
    return creds;
  }

  function needsRefresh(creds, nowMs) {
    return (
      typeof creds.refresh_token === "string" &&
      creds.refresh_token !== "" &&
      Number.isFinite(creds.expiresAt) &&
      creds.expiresAt <= nowMs + REFRESH_MARGIN_MS
    );
  }

  // Renews through the refresh token, saves the merged credentials and
  // returns the new access token. Returns null when there is no refresh token.
  function renew(ctx, state) {
    const creds = state.creds;
    if (typeof creds.refresh_token !== "string" || creds.refresh_token === "") return null;

    let resp;
    try {
      resp = ctx.util.request({
        method: "POST",
        url: TOKEN_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        bodyText: formEncode({
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: creds.refresh_token,
        }),
        timeoutMs: 10000,
      });
    } catch (e) {
      ctx.host.log.error("sign-in renewal request failed: " + String(e));
      throw "Sign-in renewal failed. Check your connection.";
    }

    const body = ctx.util.tryParseJson(resp.bodyText);
    if (
      [400, 401, 403].indexOf(resp.status) !== -1 &&
      RENEWAL_REFUSED.indexOf(errorCode(body)) !== -1
    ) {
      ctx.host.log.warn("sign-in renewal refused: " + errorCode(body));
      throw SIGN_IN_AGAIN;
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Sign-in renewal failed (HTTP " + resp.status + "). Try again later.";
    }
    if (!body || typeof body.access_token !== "string" || !body.access_token) {
      throw "Sign-in renewal returned an invalid response. Try again later.";
    }

    const nowMs = Date.now();
    const merged = Object.assign({}, creds, body);
    if (typeof body.expires_in === "number") {
      merged.expiresAt = nowMs + body.expires_in * 1000;
    } else {
      delete merged.expiresAt;
    }
    merged.obtainedAt = nowMs;

    if (ctx.account.saveCredentials(JSON.stringify(merged)) === false) {
      ctx.host.log.error("could not save renewed sign-in; the next refresh renews again");
    }
    state.creds = merged;
    return merged.access_token;
  }

  function readWindow(ctx, raw) {
    const percent = raw && typeof raw === "object" ? numberOf(raw.percent) : null;
    const iso = raw && typeof raw.resetsAt === "string" ? ctx.util.toIso(raw.resetsAt) : null;
    if (percent === null || !iso) throw "Usage response invalid. Try again later.";
    return { used: clampPercent(percent), resetMs: Date.parse(iso), iso: iso };
  }

  function capturedMs(resp) {
    const headers = resp.headers || {};
    const date = headers.date || headers.Date;
    const ms = date ? Date.parse(date) : NaN;
    return Number.isFinite(ms) ? ms : Date.now();
  }

  function usageLines(ctx, body, capturedAt) {
    const usage = body && body.usage;
    if (!usage || typeof usage !== "object") throw "Usage response invalid. Try again later.";
    const session = readWindow(ctx, usage.rolling);
    const weekly = readWindow(ctx, usage.weekly);
    const monthly = readWindow(ctx, usage.monthly);

    // An untouched rolling window reports reset = now + 5h; that is a
    // placeholder, not a real reset, so the Session row shows no reset.
    const placeholder =
      session.used === 0 &&
      Math.abs(session.resetMs - capturedAt - SESSION_MS) <= PLACEHOLDER_TOLERANCE_MS;

    return [
      ctx.line.progress({
        label: "Session",
        used: session.used,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: placeholder ? null : session.iso,
        periodDurationMs: SESSION_MS,
      }),
      ctx.line.progress({
        label: "Weekly",
        used: weekly.used,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: weekly.iso,
        periodDurationMs: WEEK_MS,
      }),
      ctx.line.progress({
        label: "Monthly",
        used: monthly.used,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: monthly.iso,
        periodDurationMs: MONTH_MS,
      }),
    ];
  }

  function fetchUsage(ctx, state) {
    try {
      return ctx.util.request({
        method: "GET",
        url: USAGE_URL,
        headers: withOrg(
          bearerHeaders(state.creds.access_token),
          "x-opencode-org-id",
          state.creds.org_id,
        ),
        timeoutMs: 10000,
      });
    } catch (e) {
      ctx.host.log.error("usage request failed: " + String(e));
      throw "Usage request failed. Check your connection.";
    }
  }

  // Soft lookup: the account name only. A failure is logged and skipped.
  function applyLabel(ctx, creds) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: USER_URL,
        headers: withOrg(bearerHeaders(creds.access_token), "x-org-id", creds.org_id),
        timeoutMs: 10000,
      });
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("account lookup failed: HTTP " + resp.status);
        return;
      }
      const body = ctx.util.tryParseJson(resp.bodyText);
      const email = body && typeof body.email === "string" ? body.email.trim() : "";
      if (email) ctx.account.setLabel(email);
    } catch (e) {
      ctx.host.log.warn("account lookup failed: " + String(e));
    }
  }

  // Soft lookup: the plan name. A failure is logged and the plan is left out.
  function fetchPlan(ctx, creds) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: GO_STATUS_URL,
        headers: withOrg(bearerHeaders(creds.access_token), "x-org-id", creds.org_id),
        timeoutMs: 10000,
      });
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("plan lookup failed: HTTP " + resp.status);
        return null;
      }
      const body = ctx.util.tryParseJson(resp.bodyText);
      const plan = planName(body && body.product);
      if (!plan) ctx.host.log.warn("plan lookup: unknown product");
      return plan;
    } catch (e) {
      ctx.host.log.warn("plan lookup failed: " + String(e));
      return null;
    }
  }

  function probe(ctx) {
    const state = { creds: readCredentials(ctx) };

    if (needsRefresh(state.creds, Date.now())) {
      try {
        renew(ctx, state);
      } catch (e) {
        // Early renewal: keep the current token while it is still valid.
        if (state.creds.expiresAt > Date.now()) {
          ctx.host.log.warn("early renewal failed; keeping current token: " + String(e));
        } else {
          throw e;
        }
      }
    }

    // Renews once on 401/403 through the refresh token, then retries.
    const resp = ctx.util.retryOnceOnAuth({
      request: function () {
        return fetchUsage(ctx, state);
      },
      refresh: function () {
        return renew(ctx, state);
      },
    });

    applyLabel(ctx, state.creds);

    if (resp.status === 403 && errorType(resp, ctx) === "EntitlementError") {
      return {
        lines: [
          ctx.line.badge({
            label: "Status",
            text: "No OpenCode Go subscription on this account.",
            color: "#a3a3a3",
          }),
        ],
      };
    }
    if (ctx.util.isAuthStatus(resp.status)) throw SIGN_IN_AGAIN;
    if (resp.status < 200 || resp.status >= 300) {
      throw "Usage request failed (HTTP " + resp.status + "). Try again later.";
    }

    const body = ctx.util.tryParseJson(resp.bodyText);
    const lines = usageLines(ctx, body, capturedMs(resp));
    const plan = fetchPlan(ctx, state.creds);
    return plan ? { plan: plan, lines: lines } : { lines: lines };
  }

  globalThis.__openusage_plugin = { id: PROVIDER_ID, probe: probe };
})();
