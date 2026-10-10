#!/usr/bin/env python3
"""Review transport: send one prompt file to every configured reviewer and
write one protocol per reviewer.

    python .pa/review_transport.py <prompt.md> <out-dir> <label> [--author <instance>]

Reviewers are configured only through the environment, numbered from 1 with
no gaps:

    REVIEWER_<n>_NAME   short name, part of the protocol file name (required)
    REVIEWER_<n>_KIND   "openai" (chat completions, default) or "ollama"
                        (/api/generate)
    REVIEWER_<n>_URL    full endpoint URL
    REVIEWER_<n>_MODEL  model id
    REVIEWER_<n>_KEY    optional bearer token; never written anywhere

Result: <out-dir>/review_<label>_<name>.md per reviewer, with "Status: ok"
or "Status: failed". Each protocol is written as soon as that reviewer
finishes; the final stdout summary stays in configuration order.

Concurrency: at most 2 workers. Typical wall time per reviewer is about
2×timeout + 30 s (one Retry-After sleep, capped at 30 s). That bound is not
guaranteed: it excludes DNS lookup, connect retries across dual-stack or
multi-A addresses, and trickling / partial reads (urllib's timeout is per
socket operation). With more than 2 reviewers, total wall time is about
ceil(n/2) times the per-reviewer bound.

Exit 0 only when EVERY configured reviewer answered with text. Exit 1 when at
least one reviewer gave no verdict - its protocol records the failure, and
the remaining reviewers still run. Exit 2 for a usage error, duplicate
reviewer slugs, or when no reviewer is configured: a run without reviewers
is not a review.

A reviewer failure (HTTP error, timeout, no JSON, an error object, no text)
is a finding and is recorded as a plain message. Any other exception may be a
bug in this script; its protocol says so and carries the traceback, so it
cannot pass for a failed provider (docs/decisions.md).
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.request

DEFAULT_TIMEOUT_S = 600


class ReviewerError(Exception):
    """The reviewer did not deliver a verdict. Not a bug in this script."""

    def __init__(self, message, retried_code=None):
        super().__init__(message)
        self.retried_code = retried_code


def configured_reviewers(env):
    reviewers = []
    n = 1
    while env.get(f"REVIEWER_{n}_NAME"):
        prefix = f"REVIEWER_{n}_"
        reviewers.append({
            "index": n,
            "name": env[prefix + "NAME"],
            "kind": (env.get(prefix + "KIND") or "openai").lower(),
            "url": env.get(prefix + "URL", ""),
            "model": env.get(prefix + "MODEL", ""),
            "key": env.get(prefix + "KEY", ""),
        })
        n += 1
    return reviewers


def slug(name):
    return re.sub(r"[^A-Za-z0-9._-]", "-", name) or "reviewer"


def retry_delay(value):
    """Honor seconds or an HTTP date, with a bounded fallback for bad headers."""
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        try:
            seconds = parsedate_to_datetime(value).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            seconds = 1
    return max(0, min(30, seconds))


def post_json(url, payload, key, timeout):
    """POST JSON. Return (parsed body, retried_http_code_or_None)."""
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    retried_code = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            break
        except urllib.error.HTTPError as error:
            with error:
                if attempt == 0 and error.code in (429, 502, 503):
                    delay = retry_delay(error.headers.get("Retry-After"))
                    retried_code = error.code
                else:
                    detail = error.read(500).decode("utf-8", "replace").strip()
                    suffix = " after one retry" if retried_code is not None else ""
                    raise ReviewerError(
                        f"HTTP {error.code}: {detail or error.reason}{suffix}",
                        retried_code=retried_code,
                    ) from None
            time.sleep(delay)
        except urllib.error.URLError as error:
            suffix = " after one retry" if retried_code is not None else ""
            raise ReviewerError(
                f"not reachable: {error.reason}{suffix}", retried_code=retried_code
            ) from None
        except TimeoutError:
            suffix = " after one retry" if retried_code is not None else ""
            raise ReviewerError(
                f"no answer within {timeout} s{suffix}", retried_code=retried_code
            ) from None
    try:
        return json.loads(raw.decode("utf-8", "replace")), retried_code
    except json.JSONDecodeError:
        start = raw[:200].decode("utf-8", "replace").strip()
        suffix = " after one retry" if retried_code is not None else ""
        raise ReviewerError(
            f"answer is not JSON: {start!r}{suffix}", retried_code=retried_code
        ) from None


def _retry_suffix(retried_code):
    return " after one retry" if retried_code is not None else ""


def require_text(text, where, retried_code=None):
    suffix = _retry_suffix(retried_code)
    if text is None:
        raise ReviewerError(f"{where} is null - no verdict{suffix}", retried_code=retried_code)
    if not isinstance(text, str):
        raise ReviewerError(
            f"{where} is {type(text).__name__}, not text - no verdict{suffix}",
            retried_code=retried_code,
        )
    if not text.strip():
        raise ReviewerError(
            f"{where} is empty - no verdict{suffix}", retried_code=retried_code
        )
    return text


def ask(reviewer, prompt, timeout):
    """Return (verdict text, reported model, retried_http_code_or_None). Raises ReviewerError."""
    if not reviewer["url"] or not reviewer["model"]:
        raise ReviewerError("URL or MODEL not configured")
    if reviewer["kind"] == "ollama":
        payload = {"model": reviewer["model"], "prompt": prompt, "stream": False}
    elif reviewer["kind"] == "openai":
        payload = {"model": reviewer["model"], "messages": [{"role": "user", "content": prompt}]}
    else:
        raise ReviewerError(f"unknown KIND {reviewer['kind']!r} (openai | ollama)")
    out, retried_code = post_json(reviewer["url"], payload, reviewer["key"], timeout)
    suffix = _retry_suffix(retried_code)
    if not isinstance(out, dict):
        raise ReviewerError(
            f"answer is JSON {type(out).__name__}, not an object{suffix}",
            retried_code=retried_code,
        )
    if out.get("error"):
        error = out["error"]
        message = error.get("message") if isinstance(error, dict) else error
        raise ReviewerError(
            f"provider error: {message}{suffix}", retried_code=retried_code
        )
    model = out.get("model") or reviewer["model"]
    if reviewer["kind"] == "ollama":
        return require_text(out.get("response"), "response", retried_code), model, retried_code
    choices = out.get("choices")
    if not choices:
        raise ReviewerError(
            f"answer has no choices - no verdict{suffix}", retried_code=retried_code
        )
    # Deliberately unguarded beyond this point: a shape nobody anticipated
    # surfaces as an unexpected error with traceback, not as a provider outage.
    content = choices[0]["message"]["content"]
    return (
        require_text(content, "choices[0].message.content", retried_code),
        model,
        retried_code,
    )


def protocol(reviewer, label, author, prompt_path, prompt, status, reported_model, body, retried_code=None):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
    lines = [
        f"# Review {label} - {reviewer['name']}",
        "",
        f"- Status: {status}",
        f"- Reviewer: {reviewer['name']} (kind {reviewer['kind']})",
        f"- Model requested: {reviewer['model'] or '-'}",
        f"- Model reported: {reported_model or '-'}",
        f"- Author of the candidate: {author or '-'}",
        f"- Prompt: {prompt_path} ({len(prompt)} chars, sha256 {digest})",
        f"- Time: {now}",
    ]
    if retried_code is not None:
        lines.append(f"- Note: retried once after HTTP {retried_code}")
    lines.extend([
        "",
        "---",
        "",
        body.rstrip(),
        "",
    ])
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Send a review prompt to every configured reviewer.")
    parser.add_argument("prompt")
    parser.add_argument("out_dir")
    parser.add_argument("label")
    parser.add_argument("--author", default="")
    args = parser.parse_args(argv)

    reviewers = configured_reviewers(os.environ)
    if not reviewers:
        print("review_transport: no reviewer configured (REVIEWER_1_NAME is unset) - no review.", file=sys.stderr)
        return 2
    seen_slugs = {}
    for reviewer in reviewers:
        name_slug = slug(reviewer["name"])
        prior = seen_slugs.get(name_slug)
        if prior is not None:
            print(
                f"review_transport: duplicate reviewer slug {name_slug!r} "
                f"(REVIEWER_{prior}_NAME and REVIEWER_{reviewer['index']}_NAME) - no review.",
                file=sys.stderr,
            )
            return 2
        seen_slugs[name_slug] = reviewer["index"]
    try:
        with open(args.prompt, encoding="utf-8") as handle:
            prompt = handle.read()
    except OSError as error:
        print(f"review_transport: cannot read prompt {args.prompt}: {error.strerror}", file=sys.stderr)
        return 2
    if not prompt.strip():
        print(f"review_transport: prompt {args.prompt} is empty - no review.", file=sys.stderr)
        return 2
    os.makedirs(args.out_dir, exist_ok=True)
    try:
        timeout = int(os.environ.get("REVIEWER_TIMEOUT_S") or DEFAULT_TIMEOUT_S)
    except ValueError:
        timeout = DEFAULT_TIMEOUT_S

    def review(reviewer):
        reported_model = None
        retried_code = None
        try:
            verdict, reported_model, retried_code = ask(reviewer, prompt, timeout)
            status, body = "ok", verdict
        except ReviewerError as error:
            retried_code = error.retried_code
            status, body = "failed", f"Reviewer failure: {error}\n\nNo verdict. Run again; this is not a review."
        except Exception as error:  # noqa: BLE001 - reported, not hidden
            status = "failed"
            body = (
                f"Unexpected error ({type(error).__name__}: {error}) - moeglicherweise KEIN "
                "Reviewer-Ausfall, sondern ein Fehler in review_transport.py.\n\n"
                "```\n" + traceback.format_exc() + "```"
            )
        return status, reported_model, body, retried_code

    def write_protocol(reviewer, status, reported_model, body, retried_code):
        path = os.path.join(args.out_dir, f"review_{args.label}_{slug(reviewer['name'])}.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(protocol(
                reviewer, args.label, args.author, args.prompt, prompt,
                status, reported_model, body, retried_code=retried_code,
            ))
        return path

    failed = 0
    summaries = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(review, reviewer): reviewer for reviewer in reviewers}
        # Write each protocol as soon as that reviewer finishes so a finished
        # verdict is not lost if a slower peer is killed.
        for future in as_completed(futures):
            reviewer = futures[future]
            status, reported_model, body, retried_code = future.result()
            try:
                path = write_protocol(reviewer, status, reported_model, body, retried_code)
            except OSError as error:
                failed += 1
                path = f"(unwritable: {error.strerror or type(error).__name__})"
                summaries[reviewer["index"]] = (reviewer, "failed", path)
                print(
                    f"review_transport: cannot write protocol for {reviewer['name']}: "
                    f"{error.strerror or type(error).__name__}",
                    file=sys.stderr,
                )
                continue
            summaries[reviewer["index"]] = (reviewer, status, path)
            if status != "ok":
                failed += 1
        # Final summary order stays as configured.
        for reviewer in reviewers:
            _, status, path = summaries[reviewer["index"]]
            print(f"{reviewer['name']}: {status} -> {path}")

    if failed:
        print(f"review_transport: {failed} of {len(reviewers)} reviewer(s) without a verdict.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
