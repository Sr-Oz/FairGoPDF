#!/usr/bin/env python3
"""Keep the shared site header and footer identical on every page.

The site has no build step, so each page carries its own copy of the header and
footer markup. partials/header.html and partials/footer.html are the single
source of truth: edit those, then run this script to copy them into every page.

    python scripts/sync-partials.py            # rewrite pages that are out of date
    python scripts/sync-partials.py --check    # report only; exit 1 if any page differs

404.html is skipped on purpose (it has a reduced header and no footer).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", ".claude", ".github", "assets", "design-system", "partials", "scripts"}
SKIP_FILES = {"404.html"}

BLOCKS = {
    "header": re.compile(r'<header class="site-header">.*?</header>', re.S),
    "footer": re.compile(r'<footer class="site-footer">.*?</footer>', re.S),
}


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def load_partials():
    partials = {}
    for name in BLOCKS:
        text = read(os.path.join(ROOT, "partials", f"{name}.html")).replace("\r\n", "\n").strip("\n")
        if not BLOCKS[name].fullmatch(text):
            sys.exit(f"partials/{name}.html must contain exactly one <{name} class=\"site-{name}\"> block")
        partials[name] = text
    return partials


def main():
    check_only = "--check" in sys.argv[1:]
    partials = load_partials()
    changed, unchanged, problems = [], 0, []

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for filename in filenames:
            if not filename.endswith(".html") or filename in SKIP_FILES:
                continue
            path = os.path.join(dirpath, filename)
            rel = os.path.relpath(path, ROOT).replace("\\", "/")
            original = read(path)
            eol = "\r\n" if "\r\n" in original else "\n"
            updated = original
            for name, pattern in BLOCKS.items():
                matches = pattern.findall(updated)
                if len(matches) != 1:
                    problems.append(f"{rel}: expected 1 {name} block, found {len(matches)}")
                    break
                replacement = partials[name].replace("\n", eol)
                updated = pattern.sub(lambda _m, r=replacement: r, updated, count=1)
            else:
                if updated != original:
                    changed.append(rel)
                    if not check_only:
                        write(path, updated)
                else:
                    unchanged += 1

    verb = "out of date" if check_only else "updated"
    print(f"{len(changed)} page(s) {verb}, {unchanged} already in sync, {len(problems)} problem(s)")
    for rel in changed:
        print(f"  {verb}: {rel}")
    for problem in problems:
        print(f"  PROBLEM: {problem}")
    sys.exit(1 if (problems or (check_only and changed)) else 0)


if __name__ == "__main__":
    main()
