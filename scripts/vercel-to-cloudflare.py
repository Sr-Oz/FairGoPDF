#!/usr/bin/env python3
"""Turn vercel.json (redirects and headers) into Cloudflare's _redirects and _headers files, and check that they agree.

While the site is moving from Vercel to Cloudflare, vercel.json stays the single place to edit the redirects and response
headers; this writes the Cloudflare copies from it.

    python scripts/vercel-to-cloudflare.py            # write _redirects and _headers
    python scripts/vercel-to-cloudflare.py --check    # report only; exit 1 if they differ from vercel.json, or break a Cloudflare limit

Once Vercel is gone, delete vercel.json and this script, and edit _redirects and _headers directly.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Cloudflare's limits for these files (Workers static assets and Pages)
MAX_REDIRECTS = 2000
MAX_HEADER_RULES = 100
MAX_LINE = 2000

GENERATED = "# Written by scripts/vercel-to-cloudflare.py from vercel.json: edit vercel.json, then run the script."


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def cloudflare_path(source):
    """A Vercel path pattern as a Cloudflare one. Only a trailing (.*) is understood, and anything else is an error."""
    if source.endswith("(.*)"):
        source = source[: -len("(.*)")] + "*"
    if re.search(r"[():?+\[\]\\]", source):
        sys.exit(f"vercel.json path {source!r} uses a pattern this script does not translate")
    return source


def build():
    config = json.loads(read("vercel.json"))
    lines = [GENERATED, ""]
    for r in config.get("redirects", []):
        if not r.get("permanent", False) and "statusCode" not in r:
            sys.exit(f"redirect {r['source']!r} is not permanent: say which status code it should use")
        status = r.get("statusCode") or 301
        lines.append(f"{cloudflare_path(r['source'])} {r['destination']} {status}")
    redirects = "\n".join(lines) + "\n"

    out = [GENERATED, ""]
    for rule in config.get("headers", []):
        out.append(cloudflare_path(rule["source"]))
        for h in rule["headers"]:
            out.append(f"  {h['key']}: {h['value']}")
        out.append("")
    headers = "\n".join(out)
    return redirects, headers.rstrip("\n") + "\n", config


def problems(redirects, headers, config):
    found = []
    n_redirects = sum(1 for l in redirects.splitlines() if l and not l.startswith("#"))
    n_rules = sum(1 for l in headers.splitlines() if l and not l.startswith("#") and not l.startswith(" "))
    if n_redirects > MAX_REDIRECTS:
        found.append(f"{n_redirects} redirects, more than Cloudflare's {MAX_REDIRECTS}")
    if n_rules > MAX_HEADER_RULES:
        found.append(f"{n_rules} header rules, more than Cloudflare's {MAX_HEADER_RULES}")
    for line in (redirects + headers).splitlines():
        if len(line) > MAX_LINE:
            found.append(f"a line of {len(line)} characters, more than Cloudflare's {MAX_LINE}: {line[:60]}...")
    if n_redirects != len(config.get("redirects", [])):
        found.append("the number of redirects written differs from vercel.json")
    if n_rules != len(config.get("headers", [])):
        found.append("the number of header rules written differs from vercel.json")

    # everything .vercelignore keeps out of the site must be kept out of the Cloudflare upload too
    ignored = {l.strip().lstrip("/") for l in read(".vercelignore").splitlines() if l.strip() and not l.startswith("#")}
    assets = {l.strip().lstrip("/") for l in read(".assetsignore").splitlines() if l.strip() and not l.startswith("#")}
    missing = sorted(ignored - assets)
    if missing:
        found.append(f".assetsignore is missing what .vercelignore leaves out: {', '.join(missing)}")
    return found


def main():
    check_only = "--check" in sys.argv[1:]
    redirects, headers, config = build()
    found = problems(redirects, headers, config)
    stale = []
    for name, text in (("_redirects", redirects), ("_headers", headers)):
        path = os.path.join(ROOT, name)
        if check_only:
            if not os.path.exists(path) or read(name) != text:
                stale.append(name)
        else:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            print(f"wrote {name}")
    if stale:
        found.append(f"{' and '.join(stale)} no longer match vercel.json: run python scripts/vercel-to-cloudflare.py")
    for f in found:
        print(f"problem: {f}")
    if check_only:
        print("Cloudflare config matches vercel.json" if not found else f"{len(found)} problem(s)")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
