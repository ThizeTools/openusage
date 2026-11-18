//! Structured classification of a failed (or rate-limited) probe.
//!
//! The frontend schedules refreshes and backoffs from `PluginOutput.failure`, so the runtime
//! reports why a probe did not succeed instead of leaving the UI to parse error strings.
//!
//! Signals come from two places:
//! - the host HTTP API records whether the last request failed at the transport level
//!   (connect, DNS, timeout, reset) or got an HTTP response;
//! - plugins call `ctx.host.signalRateLimit(retryAfterSeconds?)` when the provider asks to wait.
//!
//! A probe runs start to finish on one thread, so the signals live in a thread-local that
//! `reset` clears when a probe starts.

use serde::{Deserialize, Serialize};
use std::cell::RefCell;

/// A provider asking us to wait is never honoured for longer than this.
pub const RETRY_AFTER_CAP_SECS: u64 = 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    /// The provider asked us to slow down (HTTP 429 or equivalent).
    RateLimited,
    /// The request never got an HTTP response: no network, DNS, connect, timeout.
    Unreachable,
    /// Anything else: bad credentials, bad payload, plugin error.
    Refused,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeFailure {
    pub kind: FailureKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
}

impl ProbeFailure {
    fn of(kind: FailureKind) -> Self {
        Self {
            kind,
            retry_after_seconds: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpOutcome {
    /// The last request failed before any HTTP response arrived.
    Transport,
    /// The last request got a response with this status.
    Status(u16),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProbeSignals {
    pub last_http: Option<HttpOutcome>,
    /// Set by `ctx.host.signalRateLimit`. The inner value is the Retry-After wait in seconds.
    pub rate_limit: Option<Option<u64>>,
}

thread_local! {
    static SIGNALS: RefCell<ProbeSignals> = RefCell::new(ProbeSignals::default());
}

/// Clears the signals. Called when a probe starts.
pub fn reset() {
    SIGNALS.with(|s| *s.borrow_mut() = ProbeSignals::default());
}

pub fn current() -> ProbeSignals {
    SIGNALS.with(|s| s.borrow().clone())
}

pub fn record_http_transport_failure() {
    SIGNALS.with(|s| s.borrow_mut().last_http = Some(HttpOutcome::Transport));
}

pub fn record_http_status(status: u16) {
    SIGNALS.with(|s| s.borrow_mut().last_http = Some(HttpOutcome::Status(status)));
}

/// Records that the provider asked us to wait. Non-positive or non-finite waits are ignored (the
/// signal still counts, the wait is just unknown) and waits over an hour are capped.
pub fn record_rate_limit(retry_after_seconds: Option<f64>) {
    let wait = retry_after_seconds
        .filter(|secs| secs.is_finite() && *secs > 0.0)
        .map(|secs| (secs.ceil() as u64).min(RETRY_AFTER_CAP_SECS));
    SIGNALS.with(|s| s.borrow_mut().rate_limit = Some(wait));
}

/// True when a reqwest error means no HTTP response ever arrived.
pub fn is_transport_error(err: &reqwest::Error) -> bool {
    err.is_connect() || err.is_timeout() || (err.is_request() && !err.is_builder())
}

/// The failure of a probe that returned lines normally, or None when it needs no backoff. Only an
/// explicit rate-limit signal marks a successful probe as a failure.
pub fn failure_of_returned_probe() -> Option<ProbeFailure> {
    rate_limit_failure(&current())
}

/// Classifies a probe that failed with `message`.
pub fn classify(message: &str) -> ProbeFailure {
    classify_with(message, &current())
}

pub fn classify_with(message: &str, signals: &ProbeSignals) -> ProbeFailure {
    if let Some(failure) = rate_limit_failure(signals) {
        return failure;
    }
    let lower = message.to_lowercase();
    if lower.starts_with("probe timed out") {
        return ProbeFailure::of(FailureKind::Refused);
    }
    if mentions_rate_limit(&lower) {
        return ProbeFailure::of(FailureKind::RateLimited);
    }
    if signals.last_http == Some(HttpOutcome::Transport) || mentions_network_failure(&lower) {
        return ProbeFailure::of(FailureKind::Unreachable);
    }
    ProbeFailure::of(FailureKind::Refused)
}

fn rate_limit_failure(signals: &ProbeSignals) -> Option<ProbeFailure> {
    signals.rate_limit.map(|retry_after_seconds| ProbeFailure {
        kind: FailureKind::RateLimited,
        retry_after_seconds,
    })
}

fn mentions_rate_limit(lower: &str) -> bool {
    lower.contains("rate limit")
        || lower.contains("rate-limit")
        || lower.contains("too many requests")
        || contains_number(lower, "429")
}

fn mentions_network_failure(lower: &str) -> bool {
    lower.contains("check your connection")
        || lower.contains("network error")
}

/// True when `needle` appears in `haystack` as a whole number, not inside a longer digit run.
fn contains_number(haystack: &str, needle: &str) -> bool {
    haystack.match_indices(needle).any(|(start, _)| {
        let before = haystack[..start].chars().next_back();
        let after = haystack[start + needle.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_digit()) && !after.is_some_and(|c| c.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(message: &str, signals: &ProbeSignals) -> FailureKind {
        classify_with(message, signals).kind
    }

    #[test]
    fn plain_errors_are_refused() {
        let none = ProbeSignals::default();
        assert_eq!(kind("Not logged in. Sign in again.", &none), FailureKind::Refused);
        assert_eq!(
            kind("Usage request failed (HTTP 500). Try again later.", &none),
            FailureKind::Refused
        );
        assert_eq!(kind("runtime error", &none), FailureKind::Refused);
    }

    #[test]
    fn http_429_and_rate_limit_text_are_rate_limited() {
        let none = ProbeSignals::default();
        for message in [
            "Antigravity request failed (HTTP 429). Try again later.",
            "429 Too Many Requests",
            "Rate limited, try again later",
            "You hit the rate limit",
            "rate-limit exceeded",
        ] {
            assert_eq!(kind(message, &none), FailureKind::RateLimited, "{message}");
        }
    }

    #[test]
    fn digits_containing_429_are_not_rate_limits() {
        let none = ProbeSignals::default();
        assert_eq!(kind("Request id 14290 failed", &none), FailureKind::Refused);
        assert_eq!(kind("code 4291", &none), FailureKind::Refused);
    }

    #[test]
    fn transport_failure_signal_makes_unreachable() {
        let signals = ProbeSignals {
            last_http: Some(HttpOutcome::Transport),
            rate_limit: None,
        };
        assert_eq!(
            kind("Usage request failed. Something odd.", &signals),
            FailureKind::Unreachable
        );
    }

    #[test]
    fn a_later_http_response_clears_the_transport_failure() {
        let signals = ProbeSignals {
            last_http: Some(HttpOutcome::Status(500)),
            rate_limit: None,
        };
        assert_eq!(kind("Usage request failed", &signals), FailureKind::Refused);
    }

    #[test]
    fn network_messages_without_a_signal_are_unreachable() {
        let none = ProbeSignals::default();
        assert_eq!(
            kind("Network error. Check your connection.", &none),
            FailureKind::Unreachable
        );
        assert_eq!(
            kind("Request failed. Check your connection.", &none),
            FailureKind::Unreachable
        );
    }

    #[test]
    fn probe_timeout_is_refused_even_after_a_transport_timeout() {
        let signals = ProbeSignals {
            last_http: Some(HttpOutcome::Transport),
            rate_limit: None,
        };
        assert_eq!(kind("probe timed out after 30s", &signals), FailureKind::Refused);
    }

    #[test]
    fn explicit_rate_limit_signal_wins_and_carries_retry_after() {
        let signals = ProbeSignals {
            last_http: Some(HttpOutcome::Transport),
            rate_limit: Some(Some(120)),
        };
        let failure = classify_with("Network error. Check your connection.", &signals);
        assert_eq!(failure.kind, FailureKind::RateLimited);
        assert_eq!(failure.retry_after_seconds, Some(120));
    }

    #[test]
    fn rate_limit_signal_without_wait_has_no_retry_after() {
        let signals = ProbeSignals {
            last_http: None,
            rate_limit: Some(None),
        };
        let failure = classify_with("boom", &signals);
        assert_eq!(failure.kind, FailureKind::RateLimited);
        assert_eq!(failure.retry_after_seconds, None);
    }

    #[test]
    fn record_rate_limit_caps_and_sanitises_the_wait() {
        reset();
        record_rate_limit(Some(90.2));
        assert_eq!(current().rate_limit, Some(Some(91)));
        record_rate_limit(Some(99_999.0));
        assert_eq!(current().rate_limit, Some(Some(RETRY_AFTER_CAP_SECS)));
        record_rate_limit(Some(-5.0));
        assert_eq!(current().rate_limit, Some(None));
        record_rate_limit(Some(f64::NAN));
        assert_eq!(current().rate_limit, Some(None));
        record_rate_limit(None);
        assert_eq!(current().rate_limit, Some(None));
        reset();
        assert_eq!(current(), ProbeSignals::default());
    }

    #[test]
    fn returned_probe_is_a_failure_only_with_a_rate_limit_signal() {
        reset();
        assert_eq!(failure_of_returned_probe(), None);
        record_http_transport_failure();
        assert_eq!(failure_of_returned_probe(), None);
        record_rate_limit(Some(30.0));
        assert_eq!(
            failure_of_returned_probe(),
            Some(ProbeFailure {
                kind: FailureKind::RateLimited,
                retry_after_seconds: Some(30)
            })
        );
        reset();
    }

    #[test]
    fn serialises_as_camel_case() {
        let json = serde_json::to_value(ProbeFailure {
            kind: FailureKind::RateLimited,
            retry_after_seconds: Some(5),
        })
        .unwrap();
        assert_eq!(json["kind"], "rateLimited");
        assert_eq!(json["retryAfterSeconds"], 5);
        let json = serde_json::to_value(ProbeFailure::of(FailureKind::Unreachable)).unwrap();
        assert_eq!(json["kind"], "unreachable");
        assert!(json.get("retryAfterSeconds").is_none());
    }
}
