//! HTTP helpers shared by the hand-rolled listeners.
//!
//! All three servers in this crate - the control API ([`crate::api`]), the
//! hook receiver ([`crate::hooks`]) and the web interface
//! ([`crate::web_interface`]) - are built on `std::net` without a framework,
//! so the small pieces of HTTP they all need live here once, instead of
//! drifting apart as three copies. That includes their self-defence: the size
//! limits every request is held to, and the admission control that keeps "one
//! thread per connection" from becoming "as many threads as a wedged client
//! asks for".

use std::io::Write;
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// The most connections one server holds open at once. Each of the three
/// servers gets its own budget of this size.
///
/// Thread-per-connection is a fine model until something opens connections
/// without ever finishing a request - a wedged local process on the loopback
/// servers, a scanner on the LAN the web interface may be bound to. Every
/// thread costs real memory, so admission is capped: the connection past the
/// limit gets a fast 503 from the accept loop instead of a thread.
pub const MAX_CONNECTIONS: usize = 64;

/// The most bytes a request head - request line plus headers - may span.
///
/// 16 KiB is far beyond anything these servers legitimately receive (the
/// largest real head is a hook post with a secret header). Capping the head
/// separately from the body is what turns "client drips one byte per
/// read-timeout window" from an unbounded wait into a bounded one: the read
/// timeout bounds a single `read`, this bounds all of them together.
pub const MAX_HEAD: usize = 16 * 1024;

/// The most bytes a request body may span. A hook payload is a few hundred
/// bytes; the API's largest body is a `send` text, and 64 KiB of chat text is
/// already absurd. Anything larger is refused rather than truncated.
pub const MAX_BODY: usize = 64 * 1024;

/// Decode `%XX` escapes. `+` is left alone: these are path and query values
/// carrying ids, not submitted form fields.
///
/// The whole walk is over bytes, never over `&str` slices, and that is the
/// point rather than a style choice. `%` is never a UTF-8 continuation byte, so
/// the `%` itself always sits on a character boundary - but the byte three
/// further along need not, and `&raw[i + 1..i + 3]` used to panic there. A
/// query as ordinary as `?a=%€` reaches this function before either server has
/// looked at the token, so that panic was reachable unauthenticated; and since
/// the head arrives through `String::from_utf8_lossy`, every invalid byte turns
/// into a three-byte `U+FFFD` that triggers it just as well.
///
/// An escape that is not two hex digits is passed through verbatim, as before.
pub fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_nibble(bytes[i + 1]), hex_nibble(bytes[i + 2])) {
                out.push(high << 4 | low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One hex digit as its value, or `None` for any other byte.
///
/// Stricter than the `u8::from_str_radix` this replaced, which also accepted a
/// leading sign and read `%+f` as `0x0f`. Percent-encoding has no sign.
fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Compare two secrets without a data-dependent early exit.
///
/// `String ==` returns at the first differing byte, so its timing says how
/// long the matching prefix is. On a loopback token that is a small worry,
/// but the fix is cheap: fold every byte's difference into one accumulator -
/// lengths included - and answer at the end. Only the length still leaks,
/// which no comparison can hide.
pub fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= usize::from(x ^ y);
    }
    diff == 0
}

// -- admission control -------------------------------------------------------

/// A server's budget of live connections.
///
/// tokio's semaphore inside deliberately synchronous servers needs a word of
/// defence: `try_acquire` is a plain synchronous call that wants no runtime,
/// tokio is already a dependency (the web interface shuts down through a
/// tokio oneshot), and std has no semaphore. A hand-rolled condvar counter
/// just to avoid this paragraph would be worse code, not better.
pub type ConnectionLimiter = Arc<Semaphore>;

/// A limiter with the production budget of [`MAX_CONNECTIONS`] connections.
pub fn connection_limiter() -> ConnectionLimiter {
    connection_limiter_with(MAX_CONNECTIONS)
}

/// A limiter with `max` slots. The servers take [`connection_limiter`]; the
/// tests take a small one, so "the connection past the limit" is the third,
/// not the sixty-fifth.
pub fn connection_limiter_with(max: usize) -> ConnectionLimiter {
    Arc::new(Semaphore::new(max))
}

/// Admit one connection if a slot is free. The permit releases itself on
/// drop, so a handler cannot forget to give its slot back - not even on a
/// panic path.
pub fn try_acquire_connection(limiter: &ConnectionLimiter) -> Option<OwnedSemaphorePermit> {
    // `try_acquire_owned` wants the Arc by value; a refcount bump is the
    // whole price of not taking the limiter from the accept loop.
    limiter.clone().try_acquire_owned().ok()
}

/// How long the accept loop waits on a refused connection's 503 before just
/// dropping it. Short, because the accept loop has other customers: a client
/// that will not read must not stall admission for everyone else.
const OVERLOAD_WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// Tell a connection the server is full and hang up, without spending a
/// thread. Runs on the accept loop itself, which is why the answer is a fixed
/// string written on a short fuse.
pub fn answer_overloaded(mut stream: TcpStream) {
    let _ = stream.set_write_timeout(Some(OVERLOAD_WRITE_TIMEOUT));
    let _ = stream.write_all(
        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
    let _ = stream.flush();
}

/// Poll until the limiter shows `expected` free slots. Permits are taken and
/// released on the accept loop's and the handlers' threads, so a test has to
/// wait for the state to settle rather than assume it.
#[cfg(test)]
pub(crate) fn wait_for_permits(limiter: &ConnectionLimiter, expected: usize) {
    for _ in 0..500 {
        if limiter.available_permits() == expected {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("connection slots never settled at {expected}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_escapes_decode() {
        assert_eq!(percent_decode("wk%2D1"), "wk-1");
        assert_eq!(percent_decode("a+b"), "a+b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn tokens_compare_equal_only_byte_for_byte() {
        assert!(token_eq("s3cret", "s3cret"));
        assert!(token_eq("", ""));
        assert!(!token_eq("s3cret", "s3creT"), "one byte differs");
        assert!(!token_eq("s3cret", "s3cret2"), "the length differs");
        assert!(!token_eq("s3cret2", "s3cret"), "in both directions");
        assert!(!token_eq("", "x"), "empty against non-empty");
        // Same length, a differing byte at each end, so no prefix or suffix
        // shortcut can pass either.
        assert!(!token_eq("aaaa", "baaa"));
        assert!(!token_eq("aaaa", "aaab"));
    }

    /// The escapes the old byte-indexed `&str` slice panicked on: three- and
    /// four-byte characters straight after the `%`, cut in half by
    /// `raw[i + 1..i + 3]`.
    #[test]
    fn a_broken_escape_is_passed_through_instead_of_panicking() {
        assert_eq!(percent_decode("%\u{20ac}"), "%\u{20ac}");
        assert_eq!(percent_decode("a=%\u{20ac}&b=1"), "a=%\u{20ac}&b=1");
        assert_eq!(percent_decode("%\u{1f980}"), "%\u{1f980}");
        // Two bytes was always short enough to survive; it still does.
        assert_eq!(percent_decode("%\u{e4}"), "%\u{e4}");
        // Escapes running off the end of the input.
        assert_eq!(percent_decode("wk-1%"), "wk-1%");
        assert_eq!(percent_decode("wk-1%2"), "wk-1%2");
        // A sign is not a hex digit, whatever `u8::from_str_radix` thought.
        assert_eq!(percent_decode("%+f"), "%+f");
        // A broken escape does not stop the ones behind it from decoding.
        assert_eq!(percent_decode("%\u{20ac}%2D"), "%\u{20ac}-");
    }

    #[test]
    fn the_default_budget_is_the_documented_limit() {
        assert_eq!(connection_limiter().available_permits(), MAX_CONNECTIONS);
    }

    #[test]
    fn a_full_limiter_refuses_and_a_dropped_permit_reopens_the_slot() {
        let limiter = connection_limiter_with(2);
        let first = try_acquire_connection(&limiter).expect("first slot");
        let second = try_acquire_connection(&limiter).expect("second slot");
        assert!(
            try_acquire_connection(&limiter).is_none(),
            "the connection past the limit must be refused, not queued"
        );

        drop(first);
        assert!(
            try_acquire_connection(&limiter).is_some(),
            "a finished connection hands its slot back"
        );
        drop(second);
    }
}
