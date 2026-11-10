#!/usr/bin/env python3
"""Apply Private mode to every page, from the one switch in site-config.json.

    python scripts/privacy_mode.py            # rewrite pages that do not match the switch
    python scripts/privacy_mode.py --check    # report only; exit 1 if any page differs

The site has no build step, so the switch works the way sync-partials.py does: this script
rewrites the pages, and the result is committed. With "privateMode": true it
  - tightens every page's Content Security Policy so nothing can load from any other site
    (with it false, only /contact/ may reach Web3Forms and hCaptcha, and no other page may),
  - adds <meta name="referrer" content="no-referrer"> so outbound links say nothing about this site,
  - swaps the marked regions (the contact form, the badge in the footer, the matching privacy-policy,
    terms and connections-page wording) for their private versions.
A region is the text between "<!-- fgp:mode NAME -->" and "<!-- /fgp:mode NAME -->" on their own lines;
its two versions are scripts/privacy-mode/NAME.open.html and NAME.private.html.
build-faq.py calls render() too, so the generated FAQ pages follow the switch.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", ".claude", ".github", ".hallmark", "assets", "design-system", "docs", "scripts", "tests", "worker"}
FRAGMENTS = os.path.join(ROOT, "scripts", "privacy-mode")

# What the contact page needs and nothing else does: Web3Forms to send, hCaptcha to check it is a person.
FORM_SCRIPT = " https://web3forms.com https://hcaptcha.com https://*.hcaptcha.com"
FORM_STYLE = " https://hcaptcha.com https://*.hcaptcha.com"
FORM_CONNECT = " https://api.web3forms.com https://hcaptcha.com https://*.hcaptcha.com"
FORM_FRAME = "https://hcaptcha.com https://*.hcaptcha.com"

REGION = re.compile(r"(?P<indent>[ \t]*)<!-- fgp:mode (?P<name>[\w-]+) -->\n(?P<body>.*?)(?P=indent)<!-- /fgp:mode (?P=name) -->", re.S)
CSP_META = re.compile(r'(?P<line><meta http-equiv="Content-Security-Policy" content=")(?P<csp>[^"]*)(?P<end>">)')
REFERRER = '<meta name="referrer" content="no-referrer">'


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def is_private():
    return bool(json.loads(read(os.path.join(ROOT, "site-config.json"))).get("privateMode"))


def csp_for(rel, private, existing=""):
    """The Content Security Policy a page should carry. 'unsafe-eval' stays where a page already needs it (the HEIC converters)."""
    form = rel == "contact/index.html" and not private
    ev = " 'unsafe-eval'" if "'unsafe-eval'" in existing else ""
    script, style, connect = (FORM_SCRIPT, FORM_STYLE, FORM_CONNECT) if form else ("", "", "")
    frame = FORM_FRAME if form else "'none'"
    return (
        f"default-src 'self'; script-src 'self' 'unsafe-inline'{ev}{script}; "
        f"style-src 'self' 'unsafe-inline'{style}; font-src 'self'; img-src 'self' data: blob:; "
        f"connect-src 'self'{connect}; frame-src {frame}; "
        "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"
    )


def fragment(name, private):
    path = os.path.join(FRAGMENTS, f"{name}.{'private' if private else 'open'}.html")
    if not os.path.exists(path):
        sys.exit(f"missing {os.path.relpath(path, ROOT)}")
    return read(path).replace("\r\n", "\n")


def render(rel, text, private):
    """One page's text as it should be for the current mode. rel is the page path from the repo root, with forward slashes."""
    eol = "\r\n" if "\r\n" in text else "\n"
    t = text.replace("\r\n", "\n")

    def swap(m):
        body = fragment(m["name"], private)
        indented = "".join((m["indent"] + line if line.strip() else line) for line in body.splitlines(True))
        if indented and not indented.endswith("\n"):
            indented += "\n"
        return f'{m["indent"]}<!-- fgp:mode {m["name"]} -->\n{indented}{m["indent"]}<!-- /fgp:mode {m["name"]} -->'

    t = REGION.sub(swap, t)
    t = CSP_META.sub(lambda m: m["line"] + csp_for(rel, private, m["csp"]) + m["end"], t)
    t = re.sub(r"\n" + re.escape(REFERRER), "", t)
    if private:
        t = CSP_META.sub(lambda m: m.group(0) + "\n" + REFERRER, t, count=1)
    return t.replace("\n", eol)


def pages():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for filename in filenames:
            if filename.endswith(".html"):
                path = os.path.join(dirpath, filename)
                yield path, os.path.relpath(path, ROOT).replace("\\", "/")


def main():
    check_only = "--check" in sys.argv[1:]
    private = is_private()
    changed = []
    for path, rel in pages():
        old = read(path)
        new = render(rel, old, private)
        if new != old:
            changed.append(rel)
            if not check_only:
                write(path, new)
    mode = "on" if private else "off"
    if not changed:
        print(f"Private mode is {mode}; every page already matches.")
    elif check_only:
        print(f"Private mode is {mode}, but {len(changed)} page(s) do not match; run: python scripts/privacy_mode.py")
        for rel in changed[:20]:
            print("  " + rel)
        sys.exit(1)
    else:
        print(f"Private mode is {mode}; updated {len(changed)} page(s).")


if __name__ == "__main__":
    main()
