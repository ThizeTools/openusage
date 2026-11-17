# Ollama

Tracks Ollama Cloud plan limits, purchased credits and usage history with an API key.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://ollama.com`
- **Auth:** API key pasted in Settings → Accounts, sent as `Authorization: Bearer <key>`
- **Plan and email source:** `POST /api/me`
- **Usage unit:** dollars (credit value) and input/output tokens per UTC day, plus request counts

## Setup

1. Create a key at [ollama.com/settings/keys](https://ollama.com/settings/keys).
2. In OpenUsage, open Settings → Accounts, add an Ollama account and paste the key.

The account is named after the email from `/api/me` when the plan read succeeds. Rename it in Settings at any time; a rename is kept.

## Endpoints

### GET /api/balance

Plan windows and purchased credits.

Used fields:

- `included.session.remaining_percent`, `included.session.resets_at` (legacy plans)
- `included.weekly.remaining_percent`, `included.weekly.resets_at` (legacy plans)
- `included.allowance_usd`, `included.balance_usd`, `included.period.from`, `included.period.until` (monthly allowance)
- `purchased.balance_usd` (purchased credits)

### POST /api/me

Account read. No body.

Used fields: `Plan` or `plan` (plan name), `Email` or `email` (account label). A failed read is logged and skipped; the card still shows usage.

### GET /api/usage?range=30d&group_by=model

Per-UTC-day buckets for the last 30 days.

Used fields per bucket: `from`, `until` (UTC day), `request_count`, `usage_usd`, `input_tokens`, `output_tokens`. Tokens are input plus output (cached input is part of input).

A malformed bucket makes the whole history unreadable; the history rows are then left out and the balance rows still show.

## Displayed Lines

| Line | Scope | Description |
|------|-------|-------------|
| Session | overview | Percent of the 5-hour window used (resets when reported) |
| Weekly | overview | Percent of the weekly window used |
| Monthly | overview | Dollars used of the monthly allowance |
| Purchased Credits | overview | Purchased credit balance, `$X left` (shown even at `$0`) |
| Today | overview | Dollars and input/output tokens for today (UTC) |
| Yesterday | detail | Same for yesterday (UTC) |
| Last 30 Days | overview | Same for today and the 29 days before it |
| Requests | detail | Request count over the last 30 days |

Rows that need usage data show `No data` when the window has no reported figures. A legacy plan that reports only requests shows the Requests row alone.

## Errors

| Condition | Message |
|-----------|---------|
| No API key saved | "Sign in again in Settings → Accounts." |
| 401/403 | "Invalid API key. Replace it in Settings → Accounts." |
| Network error | "Ollama request failed. Check your connection." |
| Other HTTP error | "Ollama request failed (HTTP {status}). Try again later." |
| Balance response without `included` or any usable line | "Ollama response invalid. Try again later." |

## Log Redaction

Response fields that carry identity: `Email` / `email` (from `/api/me`). `Plan` / `plan` names the plan only. The API key appears only in the request header.
