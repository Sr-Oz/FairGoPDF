#!/usr/bin/env python3
"""Check every page for the mistakes that go unnoticed on a static site. Exit 1 if any is found.

    python scripts/check-site.py

- internal href/src links that point at nothing
- duplicate <title>s, canonical links that don't match the page's own URL, images without alt text
- JSON-LD blocks that aren't valid JSON
- sitemap.xml entries with no page, and pages missing from the sitemap
"""
import collections
import json
import os
import re
import sys
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", ".claude", "node_modules"}
NOT_IN_SITEMAP = ("404.html", "partials/", "design-system/")
SITE = "https://fairgopdf.au"


def exists(url):
    path = unquote(urlparse(url).path)
    fp = os.path.join(ROOT, path.lstrip("/"))
    if path.endswith("/"):
        return os.path.isfile(os.path.join(fp, "index.html"))
    return os.path.isfile(fp) or os.path.isfile(os.path.join(fp, "index.html")) or os.path.isfile(fp + ".html")


def read(path):
    return open(path, encoding="utf-8", errors="replace").read()


def main():
    pages = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        pages += [os.path.join(base, f) for f in files if f.endswith(".html")]

    problems = []
    titles = collections.defaultdict(list)
    served = set()
    for path in sorted(pages):
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        html = read(path)
        for url in sorted(set(re.findall(r'(?:href|src)="(/[^"#?]*)', html))):
            if not exists(url):
                problems.append(f"{rel}: broken link {url}")
        title = re.search(r"<title>(.*?)</title>", html, re.S)
        if title:
            titles[title.group(1).strip()].append(rel)
        canon = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        url_path = "/" + (rel[: -len("index.html")] if rel.endswith("index.html") else rel)
        if canon and rel != "404.html" and canon.group(1) != SITE + url_path:
            problems.append(f"{rel}: canonical is {canon.group(1)}, expected {SITE + url_path}")
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
            try:
                json.loads(block)
            except ValueError as e:
                problems.append(f"{rel}: invalid JSON-LD ({str(e)[:60]})")
        if re.search(r"<img(?![^>]*\balt=)[^>]*>", html):
            problems.append(f"{rel}: image without alt text")
        if not rel.startswith(NOT_IN_SITEMAP):
            served.add(url_path)

    problems += [f"duplicate title {t!r}: {', '.join(v)}" for t, v in titles.items() if len(v) > 1]

    listed = set(re.findall(r"<loc>" + re.escape(SITE) + r"([^<]*)</loc>", read(os.path.join(ROOT, "sitemap.xml"))))
    problems += [f"sitemap lists {u}, which has no page" for u in sorted(listed) if not exists(u)]
    problems += [f"{u} is missing from sitemap.xml" for u in sorted(served - listed)]

    print(f"{len(pages)} pages checked, {len(problems)} problem(s)")
    for p in problems:
        print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
