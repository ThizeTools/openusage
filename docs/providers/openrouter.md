# OpenRouter

Tracks OpenRouter spend, credit balance and key limits with an API key. A Management key shows the whole account; a standard key shows its own spend.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://openrouter.ai/api/v1`
- **Auth:** API key pasted in Settings → Accounts, sent as `Authorization: Bearer <key>`
- **Usage unit:** US dollars (spend, balance, budgets) and requests (free model requests)
- **Plan source:** `GET /key` (`is_free_tier`)

## Setup

1. Create a key at [openrouter.ai/settings/management-keys](https://openrouter.ai/settings/management-keys). A Management key shows the whole account; a standard key shows only its own spend.
2. In OpenUsage, open Settings → Accounts, add an OpenRouter account and paste the key.

## Endpoints

### GET /api/v1/key

Decides the key kind and reads its limits.

Used fields: `is_management_key` (kind), `is_free_tier` (plan: `Free` or `Pay-as-you-go`), `usage_daily`, `usage_weekly`, `usage_monthly` (standard key spend), `limit`, `limit_remaining`, `limit_reset` (Key Limit), `effective_budget.limit_usd`, `effective_budget.spend_usd`, `effective_budget.reset_interval` (Budget), `free_model_daily_requests.limit`, `free_model_daily_requests.used` (Free Requests).

### GET /api/v1/credits (Management keys only)

Used fields: `total_credits`, `total_usage`. Balance = credits bought minus spent, floored at zero.

A `403` means a workspace-scoped Management key, which OpenRouter does not allow to read credits. The Balance row is then left out and the spend rows add up that workspace's keys.

### GET /api/v1/keys?include_disabled=true&include_expired=true&offset={n} (Management keys only)

Paged by 100, at most 50 pages. Used per key: `usage_daily`, `usage_weekly`, `usage_monthly`. Disabled and expired keys count.

BYOK spend (`byok_usage_*`) is never added to the spend rows.

### GET /api/v1/activity (Management keys only)

Last 30 finished UTC days, one row per day and model. Used per row: `date`, `model`, `usage`, `prompt_tokens`, `completion_tokens`. Yesterday and Prior 30 Days sum the rows by day. A failed or malformed read is logged and leaves those two rows out.

## Displayed Lines

| Line | Management key | Standard key |
|------|----------------|--------------|
| Balance | Credits bought minus spent (no bar); omitted on a workspace-scoped key | not shown |
| Today | Spend of all listed keys today (UTC) | This key's spend today |
| Yesterday | From activity | `$0.00` |
| This Week | Spend of all listed keys this week (Monday start, UTC) | This key's spend this week |
| This Month | Spend of all listed keys this month | This key's spend this month |
| Prior 30 Days | From activity, the 30 UTC days before today | `$0.00` |
| Key Limit | Only when the key has a limit | Only when the key has a limit |
| Budget | Only when a guardrail or workspace budget applies | Same |
| Free Requests | Only when the key has a daily free-model limit | Same |

Key Limit, Budget and Free Requests reset at midnight UTC (daily), on Monday (weekly) or on the first of the month (monthly), as OpenRouter reports them.

## Errors

| Condition | Message |
|-----------|---------|
| No API key saved | "Sign in again in Settings → Accounts." |
| 401/403 (except `/credits` 403 above) | "Invalid API key. Replace it in Settings → Accounts." |
| Network error | "OpenRouter request failed. Check your connection." |
| Other HTTP error | "OpenRouter request failed (HTTP {status}). Try again later." |
| Malformed `/key` or `/keys` response | "OpenRouter response invalid. Try again later." |

## Log Redaction

Response fields that carry identity or secrets: none are read as identity. `/keys` items also carry key names, labels and hashes; the plugin reads only the usage fields above and never logs them. The API key appears only in the request header.
