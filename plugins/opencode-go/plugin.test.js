import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAccount, makeCtx } from "../test-helpers.js";

const SIGN_IN = "Sign in again in Settings → Accounts.";

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

const json = (status, body) => ({ status, headers: {}, bodyText: JSON.stringify(body) });

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const USAGE_BODY = {
  usage: {
    rolling: { percent: 25, resetsAt: inHours(3) },
    weekly: { percent: 40, resetsAt: inHours(48) },
    monthly: { percent: 10, resetsAt: inHours(400) },
  },
};

// Runs a sync probe and returns what it threw.
const thrown = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected probe to throw");
};

// Routes ctx.host.http.request by "METHOD url". Unlisted routes fail the test.
const routeHttp = (ctx, routes) => {
  ctx.host.http.request.mockImplementation((opts) => {
    const key = (opts.method || "GET") + " " + opts.url;
    if (!(key in routes)) throw new Error("unexpected request " + key);
    const r = routes[key];
    return typeof r === "function" ? r(opts) : r;
  });
};

const FUTURE = () => Date.now() + 3600 * 1000;

describe("opencode-go plugin", () => {
  let ctx;
  let probe;

  beforeEach(async () => {
    ctx = makeCtx();
    probe = (await loadPlugin()).probe;
  });

  it("throws the sign-in message without credentials", () => {
    ctx.account = makeAccount({});
    expect(thrown(() => probe(ctx))).toBe(SIGN_IN);
    expect(ctx.host.http.request).not.toHaveBeenCalled();
  });

  it("returns session, weekly and monthly lines with the plan and account label", () => {
    ctx.account = makeAccount({ access_token: "tok", org_id: "org_1", expiresAt: FUTURE() });
    routeHttp(ctx, {
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(200, USAGE_BODY),
      [`GET https://opencode.ai/console/api/go/status`]: json(200, { product: "go" }),
      [`GET https://opencode.ai/console/api/user`]: json(200, { id: "u1", email: "me@example.com" }),
    });

    const result = probe(ctx);

    expect(result.plan).toBe("Go");
    expect(result.lines.map((l) => l.label)).toEqual(["Session", "Weekly", "Monthly"]);
    expect(result.lines[0]).toMatchObject({ type: "progress", used: 25, limit: 100, periodDurationMs: 5 * 3600 * 1000 });
    expect(result.lines[1]).toMatchObject({ used: 40, periodDurationMs: 7 * 24 * 3600 * 1000 });
    expect(result.lines[2]).toMatchObject({ used: 10 });
    expect(ctx.account.setLabel).toHaveBeenCalledWith("me@example.com");

    const usageCall = ctx.host.http.request.mock.calls.find(([o]) => o.url.endsWith("/usage"))[0];
    expect(usageCall.headers.Authorization).toBe("Bearer tok");
    expect(usageCall.headers["x-opencode-org-id"]).toBe("org_1");
  });

  it("refreshes before expiry and saves the merged credentials", () => {
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "r1",
      org_id: "org_1",
      expiresAt: Date.now() + 60 * 1000,
    });
    routeHttp(ctx, {
      [`POST https://opencode.ai/console/auth/device/token`]: json(200, {
        access_token: "new",
        expires_in: 3600,
      }),
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(200, USAGE_BODY),
      [`GET https://opencode.ai/console/api/go/status`]: json(200, { product: "go-plus" }),
      [`GET https://opencode.ai/console/api/user`]: json(200, { id: "u1", email: "me@example.com" }),
    });

    const result = probe(ctx);

    expect(result.plan).toBe("Go Plus");
    const tokenCall = ctx.host.http.request.mock.calls.find(([o]) => o.method === "POST")[0];
    expect(tokenCall.bodyText).toContain("grant_type=refresh_token");
    expect(tokenCall.bodyText).toContain("refresh_token=r1");
    expect(tokenCall.bodyText).toContain("client_id=opencode-cli");

    expect(ctx.account.saveCredentials).toHaveBeenCalledTimes(1);
    const saved = ctx.account.saved;
    expect(saved.access_token).toBe("new");
    expect(saved.refresh_token).toBe("r1");
    expect(saved.org_id).toBe("org_1");
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
    expect(typeof saved.obtainedAt).toBe("number");

    const usageCall = ctx.host.http.request.mock.calls.find(([o]) => o.url.endsWith("/usage"))[0];
    expect(usageCall.headers.Authorization).toBe("Bearer new");
  });

  it("renews once after a 401 and retries with the new token", () => {
    ctx.account = makeAccount({ access_token: "old", refresh_token: "r1", org_id: "org_1", expiresAt: FUTURE() });
    routeHttp(ctx, {
      [`GET https://opencode.ai/zen/go/v1/usage`]: (opts) =>
        opts.headers.Authorization === "Bearer new" ? json(200, USAGE_BODY) : json(401, {}),
      [`POST https://opencode.ai/console/auth/device/token`]: json(200, {
        access_token: "new",
        refresh_token: "r2",
        expires_in: 3600,
      }),
      [`GET https://opencode.ai/console/api/go/status`]: json(500, {}),
      [`GET https://opencode.ai/console/api/user`]: json(200, { id: "u1", email: "me@example.com" }),
    });

    const result = probe(ctx);

    expect(result.lines).toHaveLength(3);
    expect(result.plan).toBeUndefined();
    expect(ctx.account.saved.refresh_token).toBe("r2");
    expect(ctx.host.http.request.mock.calls.filter(([o]) => o.url.endsWith("/usage"))).toHaveLength(2);
  });

  it("throws the sign-in message on 401 when there is no refresh token", () => {
    ctx.account = makeAccount({ access_token: "old", org_id: "org_1", expiresAt: FUTURE() });
    routeHttp(ctx, {
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(401, {}),
    });

    expect(thrown(() => probe(ctx))).toBe(SIGN_IN);
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled();
  });

  it("throws the sign-in message when an expired token's refresh is refused", () => {
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "r1",
      org_id: "org_1",
      expiresAt: Date.now() - 1000,
    });
    routeHttp(ctx, {
      [`POST https://opencode.ai/console/auth/device/token`]: json(400, { error: "invalid_grant" }),
    });

    expect(thrown(() => probe(ctx))).toBe(SIGN_IN);
  });

  it("keeps the current token when an early renewal fails and the token is still valid", () => {
    ctx.account = makeAccount({
      access_token: "old",
      refresh_token: "r1",
      org_id: "org_1",
      expiresAt: Date.now() + 60 * 1000,
    });
    routeHttp(ctx, {
      [`POST https://opencode.ai/console/auth/device/token`]: json(500, {}),
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(200, USAGE_BODY),
      [`GET https://opencode.ai/console/api/go/status`]: json(200, { product: "go" }),
      [`GET https://opencode.ai/console/api/user`]: json(200, {}),
    });

    const result = probe(ctx);

    expect(result.lines).toHaveLength(3);
    expect(ctx.host.log.warn).toHaveBeenCalled();
    expect(ctx.account.saveCredentials).not.toHaveBeenCalled();
  });

  it("shows a badge when the account has no OpenCode Go entitlement", () => {
    ctx.account = makeAccount({ access_token: "tok", org_id: "org_1", expiresAt: FUTURE() });
    routeHttp(ctx, {
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(403, {
        error: { type: "EntitlementError" },
      }),
      [`GET https://opencode.ai/console/api/user`]: json(200, {}),
    });

    const result = probe(ctx);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      type: "badge",
      text: "No OpenCode Go subscription on this account.",
    });
  });

  it("omits the session reset while the rolling window is untouched", () => {
    ctx.account = makeAccount({ access_token: "tok", org_id: "org_1", expiresAt: FUTURE() });
    routeHttp(ctx, {
      [`GET https://opencode.ai/zen/go/v1/usage`]: json(200, {
        usage: {
          rolling: { percent: 0, resetsAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString() },
          weekly: { percent: 0, resetsAt: inHours(48) },
          monthly: { percent: 0, resetsAt: inHours(400) },
        },
      }),
      [`GET https://opencode.ai/console/api/go/status`]: json(200, { product: "go" }),
      [`GET https://opencode.ai/console/api/user`]: json(200, {}),
    });

    const result = probe(ctx);

    expect(result.lines[0].resetsAt).toBeUndefined();
    expect(result.lines[1].resetsAt).toBeDefined();
  });
});
