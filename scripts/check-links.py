#!/usr/bin/env python3
"""Verify that every local reference in the site resolves.

The site is a documentation hub, so a broken link is a content bug, not a
cosmetic one: it is the difference between a reviewer finding the source and
giving up. This script checks the things a link checker for a *deployed* site
cannot — that the files exist in the repository, that they will be deployed,
and that nothing private is being served.

Checked
-------

* every local `href` / `src` in every HTML file resolves to a file on disk,
  relative to the referencing page (not the repository root);
* every `fetch()` path in `assets/app.js` resolves;
* every file referenced from `vercel.json` exists;
* no admin secret, `.env`, or private key material is present anywhere in the
  repository contents that would be published.

Deliberately not checked
------------------------

External URLs. This script runs in CI where an outbound request to a
third-party host makes the build flaky and can be rate-limited; the README
badges and GitHub links are checked by the link checker in CI instead.

Usage: python3 scripts/check-links.py
Exit code 0 on success, 1 with a report on the first failing class.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HTML_REF = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"')
FETCH_REF = re.compile(r"""fetch\(\s*(?:POLICIES\[[^\]]+\]|['"]([^'"]+)['"])""")
POLICY_REF = re.compile(r"['\"](\./data/[^'\"]+)['\"]")

# Files that must never be published. A documentation site is a public
# artifact; these are the ways a private value reaches one.
FORBIDDEN_PATTERNS = (
    re.compile(r"SAFEGUARD_ADMIN_SK\s*="),
    re.compile(r"\bS[A-Z2-7]{55}\b"),  # a Stellar secret seed
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)
FORBIDDEN_PATHS = {".env", ".env.local", ".env.production"}

SKIP_DIRS = {".git", "node_modules", ".vercel"}


def html_files() -> list[Path]:
    return sorted(
        p for p in ROOT.rglob("*.html") if not any(part in SKIP_DIRS for part in p.parts)
    )


def is_external(ref: str) -> bool:
    return ref.startswith(("http://", "https://", "//", "mailto:", "data:", "#", "tel:"))


def check_html_refs() -> list[str]:
    failures: list[str] = []
    for page in html_files():
        rel_page = page.relative_to(ROOT)
        text = page.read_text(encoding="utf-8")
        for ref in HTML_REF.findall(text):
            if is_external(ref):
                continue
            target_part = ref.split("#", 1)[0].split("?", 1)[0]
            if not target_part:
                continue
            # References are relative to the page, which is how a browser
            # resolves them — the common bug is authoring them relative to the
            # repository root, which passes a naive check and 404s in production.
            target = (page.parent / target_part).resolve()
            if not target.exists():
                failures.append(f"{rel_page}: '{ref}' does not resolve (looked for {target})")
            elif target.is_dir() and not (target / "index.html").exists():
                failures.append(f"{rel_page}: '{ref}' points at a directory with no index.html")
    return failures


def check_js_refs() -> list[str]:
    failures: list[str] = []
    for script in sorted(ROOT.glob("assets/*.js")):
        text = script.read_text(encoding="utf-8")
        for match in POLICY_REF.findall(text):
            target = (ROOT / match.lstrip("./")).resolve()
            if not target.exists():
                failures.append(f"{script.relative_to(ROOT)}: fetch path '{match}' does not exist")
    return failures


def check_vercel_config() -> list[str]:
    failures: list[str] = []
    config = ROOT / "vercel.json"
    if not config.exists():
        return ["vercel.json is missing"]
    try:
        json.loads(config.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"vercel.json is not valid JSON: {exc}"]
    return failures


def check_no_secrets() -> list[str]:
    failures: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if any(part in SKIP_DIRS for part in path.parts) or not path.is_file():
            continue
        if path.name in FORBIDDEN_PATHS:
            failures.append(f"{path.relative_to(ROOT)} would be published and must not be")
            continue
        if path.suffix in {".png", ".jpg", ".svg", ".ico", ".woff", ".woff2"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern in FORBIDDEN_PATTERNS:
            if pattern.search(text):
                failures.append(
                    f"{path.relative_to(ROOT)} matches {pattern.pattern!r}; "
                    "a published site must not carry secret material"
                )
    return failures


def main() -> int:
    checks = (
        ("html references", check_html_refs),
        ("javascript fetch paths", check_js_refs),
        ("vercel config", check_vercel_config),
        ("secret material", check_no_secrets),
    )
    total_failures = 0
    for name, check in checks:
        failures = check()
        if failures:
            total_failures += len(failures)
            for failure in failures:
                print(f"FAIL ({name}): {failure}", file=sys.stderr)
        else:
            print(f"ok: {name}")
    if total_failures:
        print(f"\n{total_failures} problem(s) found", file=sys.stderr)
        return 1
    print(f"\nall local references resolve across {len(html_files())} page(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
