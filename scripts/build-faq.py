#!/usr/bin/env python3
"""Generate the FAQ section: the /faq/ hub, one page per category, one page per
question, the FAQ-only search index (assets/faq-data.js) and the FAQ entries in
sitemap.xml.

The site has no build step, so the generated pages are committed. This file is
the single source of truth for the FAQ copy: edit the content below, then run

    python scripts/build-faq.py

The header and footer come from partials/, so run scripts/sync-partials.py
--check afterwards if those change.
"""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://fairgopdf.au"
LASTMOD = "2026-10-05"

GROUPS = [
    ("privacy", "Files &amp; privacy", "Your files and privacy",
     "How Fair Go PDF handles your files, and how to check it for yourself.", [
        ("Do you store or see my files?",
         "No. Every tool runs as JavaScript inside your own browser tab. Your files are read, processed and saved on your device, and they are never uploaded, because the tools don't have a server to upload them to. The site is hosted on Vercel, which only delivers the page."),
        ("How can I check that nothing is uploaded?",
         "Don't take it on trust, test it. Open a tool, switch off your Wi-Fi, then process a file. It still works, because nothing needs to be sent anywhere. For the technical version, open your browser's developer tools and watch the Network tab while a tool runs: no request carries your file."),
        ("Is my data used to train AI models?",
         "No, and it can't be. Every tool runs entirely in your browser, so your files never reach a server in the first place, and there's nothing to collect, store, or feed into an AI model, by Fair Go PDF or anyone else. No server means no training data."),
        ("Do you use analytics, ads, or tracking?",
         "There are no ads, and no session recording or heatmap tools. The only optional extra is Google Analytics, which loads only if you accept the cookie banner. It counts which pages get visited so the site can be improved, and it never sees your files. Reject the banner or ignore it and Google Analytics doesn't load at all. You can change your choice any time from Cookie Preferences on the <a href=\"/privacy-policy/\">Privacy Policy</a>, which also covers the other outside requests, such as Google Fonts for text and icons."),
     ]),
    ("cost", "Cost &amp; accounts", "Cost and accounts",
     "What it costs, how it's funded, and what you do and don't need to hand over.", [
        ("Is this actually free?",
         "Yes. No account, no email gate, no trial that runs out, and no paywalled features. Every tool on the site is free to use."),
        ("How does Fair Go PDF pay for itself?",
         "It's a one-person project, kept going by optional coffees from people who find it useful (see <a href=\"/support/\">Support</a>) and, where it's a good fit, clearly labelled sponsors (see <a href=\"/partnerships/\">Partner With Us</a>). One rule doesn't bend: nothing, sponsorship included, adds tracking scripts or ad networks, or touches how your files are processed."),
        ("Do I need to create an account?",
         "No. There's no sign-up, login or email required for any tool, and the site never asks for your name or other personal details. The only times anything personal is sent is if you choose to write via the <a href=\"/contact/\">Contact</a> page or chip in through Stripe on the Support page."),
        ("Will my output be watermarked or lower quality?",
         "No forced watermarks, ever. Where a tool has quality or compression settings, you control them with sliders. A few tools change the file by design (Redact PDF flattens marked pages to images, for example), and each tool page says so."),
     ]),
    ("tools", "Using the tools", "Using the tools",
     "Limits, browsers, offline use, file names and how the tools work together.", [
        ("What can Fair Go PDF do?",
         "More than 75 free tools: PDF tools (merge, split, compress, edit, sign, protect, and convert to and from other formats), image tools (compress, resize, convert, remove a background, strip hidden photo data) and everyday utilities such as a QR code generator and a password generator. Browse them on the <a href=\"/\">home page</a>, or use the magnifying glass at the top of any page to search."),
        ("Is there a file size limit?",
         "There's no limit set by the site. The practical limit is your device's memory and browser, because everything is processed locally. Very large PDFs and images can be slow on older or lower-powered devices, and a computer will cope better than a phone."),
        ("Does it work without an internet connection?",
         "Once a tool page has fully loaded, yes: disconnect and keep working, because processing happens on your device. A connection is needed to load the page the first time, and Remove Background downloads a small (about 10MB) on-device AI model on first use, then keeps it for next time."),
        ("Which browsers and devices are supported?",
         "Recent versions of Chrome, Firefox, Edge and Safari, on desktop, phone or tablet. The tools use standard modern browser features (Canvas, Web Workers, ES modules), so keeping your browser up to date helps."),
        ("Can I process several files at once?",
         "Many image tools handle a whole batch in one go. PDF tools mostly work on one PDF at a time, except those built to combine files, such as Merge PDF and Images to PDF."),
        ("What will my downloaded file be called?",
         "Downloads are named FairGoPDF, then the tool, then your original file name, for example FairGoPDF-CompressPDF-invoice.pdf. That makes processed copies easy to spot, and your original file is never changed."),
        ("What is \"Keep it sorted\"?",
         "When a tool produces a single file, a \"Keep it sorted\" panel suggests a few relevant next tools. Pick one and the file carries straight over, so you can compress, then number the pages, then protect, without downloading and re-adding it each time. While it waits, the file sits in your browser's own storage (IndexedDB) on your device for up to 10 minutes, and it's deleted the moment you use it or dismiss it. It is never uploaded anywhere."),
        ("Can it read text from a scanned PDF?",
         "Not at the moment. Tools that work with a PDF's text, such as Extract PDF Text, PDF to Word, Compare PDFs and Read Aloud, need selectable text. A scan is a picture of text, so they won't find any. Fair Go PDF doesn't do OCR (turning a scan into text) yet."),
        ("A tool isn't working or my file won't open. What now?",
         "If the PDF itself is damaged, try <a href=\"/repair-pdf/\">Repair PDF</a>. Otherwise, update your browser or try a different one, since that fixes most problems. Still stuck? <a href=\"/contact/\">Get in touch</a> with the tool name, your browser and what happened. There's no need to send the file itself."),
     ]),
    ("security", "Security", "Security and sensitive documents",
     "Passwords, redaction, and cleaning hidden data out of files before you share them.", [
        ("Can I use Fair Go PDF for sensitive or confidential documents?",
         "Because files never leave your browser, there's no upload that could expose them in transit or on a server, which removes the biggest risk with online tools. What's left sits on your side: the security of your device, and browser extensions, which can read what's on a page. For highly sensitive work, use a clean browser profile and close the tab when you're done."),
        ("How strong is the encryption in Protect PDF?",
         "<a href=\"/protect-pdf/\">Protect PDF</a> uses AES-256 encryption, applied in your browser. The password you choose is the weak point, so make it long and unique. Fair Go PDF never sees it and can't recover it: forget it and the file stays locked. The optional restrictions (no printing, no copying) rely on the viewing software honouring them, so it's the open password that actually locks the file."),
        ("Can Unlock PDF crack a password I've forgotten?",
         "No. <a href=\"/unlock-pdf/\">Unlock PDF</a> only removes protection when you enter the correct password. It's for files you're allowed to open, not for getting past one you don't know."),
        ("Does Redact PDF really remove what's underneath?",
         "Yes. A lot of redaction tools just draw a black box over the text, which is still there to be copied or recovered. <a href=\"/redact-pdf/\">Redact PDF</a> flattens every page you mark into a picture with the boxes baked in, so there's no text layer left to extract. The trade-off is that those pages stop being searchable and the file grows a little. Before you send it, open the result and try selecting and searching the redacted areas."),
        ("How do I strip hidden information before sharing a file?",
         "For PDFs, <a href=\"/sanitise-pdf/\">Sanitise PDF</a> removes embedded scripts, auto-actions, attachments and metadata such as author and title. For photos, <a href=\"/remove-exif-data/\">Remove Photo Metadata</a> shows you what's hiding in the file, including camera model, date taken and GPS location, then strips it."),
     ]),
    ("government", "Government &amp; compliance", "Government, legal and compliance",
     "Using Fair Go PDF in government, legal and accessibility work across Australia and New Zealand.", [
        ("Can government agencies and public servants use Fair Go PDF?",
         "The way it works suits that kind of job: files stay on the device, there are no accounts, and no document is sent to a third party. But Fair Go PDF isn't certified or listed under any government security framework, such as an IRAP assessment, so whether it's allowed on your network is a decision for your agency's IT and security teams. For classified or sensitive material (for example OFFICIAL: Sensitive and above), follow your agency's own handling rules."),
        ("Does using Fair Go PDF raise issues under the Privacy Act or NZ Privacy Act 2020?",
         "The tools don't create the risk that upload-based tools can. Cross-border disclosure rules (APP 8 in Australia, IPP 12 in New Zealand) are about personal information being sent overseas, and a tool that runs entirely on your device sends nothing anywhere. Your wider obligations for collecting, storing, securing and retaining that information still apply. This is general information, not legal advice. For the longer version, read <a href=\"/blog/privacy-law-document-uploads-anz/\">what the privacy laws say about uploading documents</a>."),
        ("Can I use it to prepare FOI or Official Information Act releases?",
         "Redaction is what <a href=\"/redact-pdf/\">Redact PDF</a> is built for, whether the request is a Freedom of Information request in Australia or an Official Information Act request in New Zealand. It's a tool, not a procedure, so keep your agency's own redaction and sign-off process: have a second person check the output, and run the file through Sanitise PDF to clear metadata before it goes out."),
        ("Is a signature added with Sign PDF legally valid?",
         "<a href=\"/sign-pdf/\">Sign PDF</a> stamps a drawn or typed image of your signature onto the page. It's a visual signature, not a certificate-based digital signature with an audit trail. Whether it's accepted depends on the document and who's asking. Some forms, contracts, and government or court documents specify how they must be signed, so check the instructions before you sign."),
        ("Can it check that my PDF meets accessibility requirements?",
         "The <a href=\"/pdf-accessibility-checker/\">Accessibility Checker</a> is a quick first pass over the basics screen readers rely on: tagging, document language, title, image alt text and form field descriptions. It doesn't certify PDF/UA or WCAG conformity, and it skips colour contrast, reading order and table headers. For a legal, procurement or published government document, follow up with a full audit using a dedicated tool such as the free PAC. There's more in <a href=\"/blog/why-pdf-accessibility-checker-exists/\">why the checker exists</a>."),
        ("Where can I find official guidance on staying safe online?",
         "In Australia, <a href=\"https://www.scamwatch.gov.au/\" target=\"_blank\" rel=\"noopener\">Scamwatch</a> and the Australian Signals Directorate's <a href=\"https://www.cyber.gov.au/\" target=\"_blank\" rel=\"noopener\">Cyber Security Centre</a> cover scams and cyber security, and the <a href=\"https://www.oaic.gov.au/\" target=\"_blank\" rel=\"noopener\">OAIC</a> covers privacy. In New Zealand, try <a href=\"https://www.ownyouronline.govt.nz/\" target=\"_blank\" rel=\"noopener\">Own Your Online</a> and the <a href=\"https://www.privacy.org.nz/\" target=\"_blank\" rel=\"noopener\">Privacy Commissioner</a>. For a plain-English start, see <a href=\"/blog/is-it-safe-free-online-pdf-tools/\">is it safe to use free online PDF tools?</a>"),
        ("Is Fair Go PDF open to working with government organisations?",
         "Yes. Australian and New Zealand government organisations doing citizen-facing work in digital literacy, scam awareness, privacy education or accessibility are welcome to start a conversation. It isn't pitched as paid sponsorship for public bodies. See <a href=\"/partnerships/\">Partner With Us</a> or <a href=\"/contact/\">get in touch</a>."),
     ]),
    ("about", "About", "About Fair Go PDF",
     "Who built Fair Go PDF, and how to suggest a tool or lend a hand.", [
        ("Who is behind Fair Go PDF?",
         "One person, in Perth, Western Australia. There's no support queue or sales team, so a message sent through the <a href=\"/contact/\">Contact</a> page gets a real reply from the person who built the site."),
        ("Can I suggest a new tool or report a problem?",
         "Please do. Use the <a href=\"/contact/\">Contact</a> page and say what you were trying to do. Requests that would help plenty of people, and that can run entirely in the browser, are the ones most likely to get built."),
        ("How can I support Fair Go PDF?",
         "Tell a colleague or friend, using the share button at the bottom of any tool page, or <a href=\"/support/\">shout a coffee</a>. Both help, and neither is expected. Businesses and organisations that share the privacy-first approach can look at <a href=\"/partnerships/\">Partner With Us</a>."),
     ]),
]

# Extra words people might search for that don't appear in the question itself.
# They feed the FAQ-only search index and are never shown on the page.
ALIASES = {
    "Do you store or see my files?": "privacy upload server stored private",
    "How can I check that nothing is uploaded?": "upload server network verify proof",
    "Is my data used to train AI models?": "ai training machine learning chatgpt",
    "Do you use analytics, ads, or tracking?": "cookies google analytics cookie banner consent tracker",
    "Is this actually free?": "cost price pay paid subscription trial premium",
    "How does Fair Go PDF pay for itself?": "funding sponsor sponsorship donate coffee money revenue",
    "Do I need to create an account?": "sign up signup login register email",
    "Will my output be watermarked or lower quality?": "quality compress compression resolution",
    "What can Fair Go PDF do?": "tools list features convert merge split compress",
    "Is there a file size limit?": "large big memory slow mb gb maximum",
    "Does it work without an internet connection?": "offline no internet wifi disconnected",
    "Which browsers and devices are supported?": "chrome firefox safari edge mobile phone ios android ipad",
    "Can I process several files at once?": "batch bulk multiple many",
    "What will my downloaded file be called?": "filename rename naming download",
    "What is \"Keep it sorted\"?": "chain continue next tool indexeddb carry stash",
    "Can it read text from a scanned PDF?": "ocr scan image text recognition",
    "A tool isn't working or my file won't open. What now?": "bug error broken help support problem fix troubleshoot",
    "Can I use Fair Go PDF for sensitive or confidential documents?": "confidential private secure safe security",
    "How strong is the encryption in Protect PDF?": "password encrypt aes encryption lock",
    "Can Unlock PDF crack a password I've forgotten?": "forgot forgotten remove password recover",
    "Does Redact PDF really remove what's underneath?": "blackout black out censor remove text foi",
    "How do I strip hidden information before sharing a file?": "metadata exif gps author scrub clean sanitise",
    "Can government agencies and public servants use Fair Go PDF?": "agency public servant department irap protected classified pspf",
    "Does using Fair Go PDF raise issues under the Privacy Act or NZ Privacy Act 2020?": "app 8 ipp 12 law legal cross-border overseas offshore",
    "Can I use it to prepare FOI or Official Information Act releases?": "redaction release oia freedom of information",
    "Is a signature added with Sign PDF legally valid?": "signature esign e-signature digital signature sign",
    "Can it check that my PDF meets accessibility requirements?": "wcag pdf/ua screen reader disability accessible",
    "Where can I find official guidance on staying safe online?": "scamwatch acsc oaic scam cyber safe government",
    "Is Fair Go PDF open to working with government organisations?": "partnership collaborate agency council department",
    "Who is behind Fair Go PDF?": "author founder owner perth developer creator",
    "Can I suggest a new tool or report a problem?": "request feature idea bug report feedback",
    "How can I support Fair Go PDF?": "donate coffee share sponsor help",
}

COMMON_SEARCHES = ["Free", "Offline", "Uploaded", "Password", "Redact", "Government"]

HUB_DESC = "Straight answers on privacy, cost, file limits and security, plus how Fair Go PDF fits government, legal and accessibility work in Australia and New Zealand."
HUB_TITLE = "FAQ: Privacy, Security &amp; Government Use | Fair Go PDF"

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://web3forms.com "
       "https://hcaptcha.com https://*.hcaptcha.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com "
       "https://hcaptcha.com https://*.hcaptcha.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; "
       "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://api.web3forms.com "
       "https://hcaptcha.com https://*.hcaptcha.com; frame-src https://hcaptcha.com https://*.hcaptcha.com; "
       "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'")


def plain(h):
    return html.unescape(re.sub(r"<[^>]+>", "", h))


def esc(s):
    return html.escape(s, quote=False)


def attr(s):
    return html.escape(s, quote=True)


def slugify(q, used):
    s = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-")
    if len(s) > 60:
        s = s[:60].rsplit("-", 1)[0]
    base, n = s, 2
    while s in used:
        s, n = f"{base}-{n}", n + 1
    used.add(s)
    return s


def short_desc(text, limit=155):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    m = max(cut.rfind(". "), cut.rfind("? "))
    if m > 60:
        return cut[: m + 1]
    return cut.rsplit(" ", 1)[0] + "..."


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="") as f:
        f.write(text)


HEADER = read("partials/header.html").strip("\n")
FOOTER = read("partials/footer.html").strip("\n")

# Normalise the content model: every question gets a slug and URLs.
CATS = []
for gid, short, title, intro, items in GROUPS:
    used = set()
    qs = []
    for q, a in items:
        slug = slugify(q, used)
        qs.append({"q": q, "a": a, "slug": slug, "url": f"/faq/{gid}/{slug}/"})
    CATS.append({"id": gid, "short": short, "title": title, "intro": intro, "qs": qs, "url": f"/faq/{gid}/"})


def ld(obj):
    return '<script type="application/ld+json">\n' + json.dumps(obj, ensure_ascii=False, indent=2) + "\n</script>"


def breadcrumb_ld(trail):
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": SITE + url}
            for i, (name, url) in enumerate(trail)
        ],
    }


def head(title_html, desc, url, extra_ld):
    t = attr(plain(title_html))
    d = attr(desc)
    u = SITE + url
    return f"""<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="author" content="Oscar Monsalve">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>try{{if(localStorage.getItem('theme')==='dark')document.documentElement.setAttribute('data-theme','dark');}}catch(e){{}}</script>
<title>{title_html}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{u}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fair Go PDF">
<meta property="og:locale" content="en_AU">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{u}">
<meta property="og:image" content="{SITE}/assets/img/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Fair Go PDF, free PDF and image tools made in Australia">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;family=Manrope:wght@400;500;600;700;800&amp;family=Roboto+Condensed:wght@700;800&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">

<!-- Analytics consent gate: loads Google Analytics only after the
     visitor accepts the cookie banner. See assets/consent.js and
     /privacy-policy/. -->
<script src="/assets/consent.js"></script>
{chr(10).join(extra_ld)}
</head>
<body>
<a href="#main-content" class="skip-link">Skip to content</a>

{HEADER}

"""


TAIL = """
{footer}

<button class="back-to-top" id="backToTop" type="button" aria-label="Back to top">
  <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
</button>

<script src="/assets/faq-data.js"></script>
<script src="/assets/faq.js"></script>
<script src="/assets/search-data.js"></script>
<script src="/assets/search.js"></script>
<script src="/assets/site.js"></script>
</body>
</html>
"""


def search_box():
    return """<form class="faq-search" role="search" autocomplete="off">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <label class="visually-hidden" for="faqSearch">Search the FAQ</label>
      <input id="faqSearch" type="search" placeholder="Search the FAQ&hellip;" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="faqResults" aria-autocomplete="list">
      <ul class="faq-results" id="faqResults" role="listbox" hidden></ul>
    </form>"""


def contact_box():
    return """<aside class="faq-contact">
      <div>
        <h2>Haven't found what you need?</h2>
        <p>Get in touch, a real person replies.</p>
      </div>
      <a class="faq-contact-btn" href="/contact/">Contact us</a>
    </aside>"""


def crumbs(items):
    parts = []
    for i, (name, url) in enumerate(items):
        if i == len(items) - 1:
            parts.append(f'<span class="current">{esc(name)}</span>')
        else:
            parts.append(f'<a href="{url}">{esc(name)}</a>')
    return '<nav class="breadcrumbs" aria-label="Breadcrumb">\n      ' + '<span class="sep">/</span>'.join(parts) + "\n    </nav>"


def sidebar(active_cat, active_q=None):
    out = ['<aside class="faq-side">', '      <nav aria-label="FAQ categories">', "        <ul>"]
    for c in CATS:
        is_active = c is active_cat
        cur = ' aria-current="true"' if is_active and not active_q else ""
        cls = ' class="active"' if is_active else ""
        out.append(f'          <li><a{cls}{cur} href="{c["url"]}">{c["short"]}</a>')
        if is_active:
            out.append('            <ul class="faq-side-sub">')
            for q in c["qs"]:
                c2 = ' aria-current="page"' if q is active_q else ""
                out.append(f'              <li><a{c2} href="{q["url"]}">{esc(q["q"])}</a></li>')
            out.append("            </ul>")
        out.append("          </li>")
    out += ["        </ul>", "      </nav>", "    </aside>"]
    return "\n".join(out)


def rows(qs):
    out = ['<ul class="faq-rows">']
    for q in qs:
        out.append(
            f'      <li><a href="{q["url"]}"><span class="material-symbols-outlined" aria-hidden="true">article</span>'
            f'<span class="t">{esc(q["q"])}</span>'
            f'<span class="material-symbols-outlined go" aria-hidden="true">arrow_forward</span></a></li>'
        )
    out.append("    </ul>")
    return "\n".join(out)


def hub():
    cards = []
    for c in CATS:
        items = "\n".join(
            f'          <li><a href="{q["url"]}"><span>{esc(q["q"])}</span>'
            f'<span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></a></li>'
            for q in c["qs"][:3]
        )
        more = ""
        if len(c["qs"]) > 3:
            more = f'\n        <a class="faq-card-more" href="{c["url"]}">See all {len(c["qs"])} questions</a>'
        cards.append(f"""      <section class="faq-card">
        <a class="faq-card-head" href="{c["url"]}">
          <h2>{c["short"]}</h2>
          <span class="faq-arrow"><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></span>
        </a>
        <ul class="faq-card-list">
{items}
        </ul>{more}
      </section>""")
    chips = "\n".join(f'        <button type="button" data-faq-search="{attr(w)}">{esc(w)}</button>' for w in COMMON_SEARCHES)
    body = f"""<main id="main-content">
  <div class="container faq-hub">
    {crumbs([("Home", "/"), ("FAQ", "/faq/")])}

    <div class="tool-page-header">
      <h1>Frequently asked questions</h1>
      <p>Straight answers on privacy, security and how the tools work, including for government and regulated work in Australia and New Zealand.</p>
    </div>

    {search_box()}
    <div class="faq-common">
      <span>Common searches:</span>
{chips}
    </div>

    <div class="faq-cards">
{chr(10).join(cards)}
    </div>

    {contact_box()}
  </div>
</main>"""
    lds = [ld(breadcrumb_ld([("Home", "/"), ("FAQ", "/faq/")]))]
    return head(HUB_TITLE, HUB_DESC, "/faq/", lds) + body + TAIL.format(footer=FOOTER)


def category_page(c):
    trail = [("Home", "/"), ("FAQ", "/faq/"), (plain(c["short"]), c["url"])]
    body = f"""<main id="main-content">
  <div class="container">
    <div class="faq-bar">
    {crumbs(trail)}
    {search_box()}
    </div>
    <div class="faq-layout">
    {sidebar(c)}
      <div class="faq-main">
        <h1>{c["title"]}</h1>
        <p class="faq-lede">{esc(c["intro"])}</p>
        <h2 class="faq-sub">In this section</h2>
    {rows(c["qs"])}
    {contact_box()}
      </div>
    </div>
  </div>
</main>"""
    title = f'{c["title"]}: FAQ | Fair Go PDF'
    lds = [ld(breadcrumb_ld(trail))]
    return head(title, c["intro"], c["url"], lds) + body + TAIL.format(footer=FOOTER)


def question_page(c, q):
    trail = [("Home", "/"), ("FAQ", "/faq/"), (plain(c["short"]), c["url"]), (q["q"], q["url"])]
    related = [x for x in c["qs"] if x is not q][:4]
    rel = ""
    if related:
        rel = f'\n        <h2 class="faq-sub">More in {esc(plain(c["short"]))}</h2>\n    {rows(related)}'
    body = f"""<main id="main-content">
  <div class="container">
    <div class="faq-bar">
    {crumbs(trail)}
    {search_box()}
    </div>
    <div class="faq-layout">
    {sidebar(c, q)}
      <div class="faq-main">
        <h1>{esc(q["q"])}</h1>
        <div class="faq-answer">
          <p>{q["a"]}</p>
        </div>{rel}
    {contact_box()}
      </div>
    </div>
  </div>
</main>"""
    faq_ld = {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": plain(q["a"])}}],
    }
    title = f'{esc(q["q"])} | Fair Go PDF'
    lds = [ld(breadcrumb_ld(trail)), ld(faq_ld)]
    return head(title, short_desc(plain(q["a"])), q["url"], lds) + body + TAIL.format(footer=FOOTER)


def search_index():
    data = [
        {"q": q["q"], "a": plain(q["a"]), "k": ALIASES.get(q["q"], ""), "cat": plain(c["short"]), "url": q["url"]}
        for c in CATS for q in c["qs"]
    ]
    return ("// Generated by scripts/build-faq.py. Index for the FAQ-only search box (assets/faq.js),\n"
            "// deliberately separate from the site-wide search in search-data.js.\n"
            "window.FAQ_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")


def update_sitemap():
    path = "sitemap.xml"
    s = read(path)
    s = re.sub(r"[ \t]*<url><loc>https://fairgopdf\.au/faq/[^<]*</loc>[^\n]*</url>\n", "", s)
    entries = [f'  <url><loc>{SITE}/faq/</loc><lastmod>{LASTMOD}</lastmod></url>\n']
    for c in CATS:
        entries.append(f'  <url><loc>{SITE}{c["url"]}</loc><lastmod>{LASTMOD}</lastmod></url>\n')
        for q in c["qs"]:
            entries.append(f'  <url><loc>{SITE}{q["url"]}</loc><lastmod>{LASTMOD}</lastmod></url>\n')
    anchor = re.search(r"[ \t]*<url><loc>https://fairgopdf\.au/privacy-policy/</loc>[^\n]*\n", s)
    s = s[: anchor.start()] + "".join(entries) + s[anchor.start():]
    write(path, s)


def main():
    known = {q["q"] for c in CATS for q in c["qs"]}
    missing = set(ALIASES) - known
    if missing:
        raise SystemExit(f"ALIASES keys without a matching question: {sorted(missing)}")
    write("faq/index.html", hub())
    n = 1
    for c in CATS:
        write(f"faq/{c['id']}/index.html", category_page(c))
        n += 1
        for q in c["qs"]:
            write(f"faq{q['url'][4:]}index.html", question_page(c, q))
            n += 1
    write("assets/faq-data.js", search_index())
    update_sitemap()
    print(f"Wrote {n} FAQ pages, assets/faq-data.js and sitemap entries.")


if __name__ == "__main__":
    main()
