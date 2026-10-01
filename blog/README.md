# Adding a blog post

The blog follows the same pattern as the rest of the site: plain, hand-authored static HTML, no
build step, no Markdown/frontmatter pipeline. This is a deliberate choice, not an oversight — see
the note on content model below if you're wondering why.

## Steps to add a new post

1. **Pick a slug** — lowercase, hyphenated, descriptive (e.g. `password-protect-a-pdf`).
2. **Create the folder**: `blog/<slug>/index.html`. This gives the post a clean URL:
   `/blog/<slug>/`.
3. **Copy an existing post** as your starting template — `blog/compress-pdf-without-losing-quality/index.html`
   is a good reference since it has all the pieces: breadcrumb, byline, body, FAQ block, CTA,
   related-guides links, and both JSON-LD schema blocks.
4. **Fill in these required pieces**:
   - `<title>` — unique, under ~60 characters, ends with `| Fair Go PDF`.
   - `<meta name="description">` — unique, one or two sentences, no keyword stuffing.
   - `<link rel="canonical">` and the `og:*` / `twitter:card` meta tags — update the URL and copy
     matching the title/description.
   - The `BlogPosting` JSON-LD block — update `headline`, `datePublished`, `description`, and
     `mainEntityOfPage`.
   - If the post has an FAQ section, add a matching `FAQPage` JSON-LD block (see any existing post
     for the shape) — the questions/answers should be word-for-word identical to what's visibly on
     the page.
   - Breadcrumb nav (`Home / Blog / <short title>`).
   - `<p class="byline">` — publish date and a rough read time (~200 words/minute).
   - Body: intro paragraph, `<h2>` subheadings, a `.cta-box` linking to the relevant tool page, an
     FAQ block using `.faq-item` (`<details><summary>`) if 2–3 questions fit naturally, and a
     "Related guides" list linking to at least one other post.
   - Header and footer — copy verbatim from another post; don't hand-edit them (they should be
     identical across every page on the site).
5. **Add a card to `blog/index.html`** — copy one of the existing `.tool-card` entries, update the
   icon (any [Material Symbols](https://fonts.google.com/icons) name), link, category tag, date,
   read time, title and excerpt.
6. **Add the URL to `/sitemap.xml`** at the repo root.
7. **Cross-link**: add a link to the new post from at least one existing related post's "Related
   guides" section, and make sure the new post links to at least one tool page and one other post.
8. **Test locally** (see the main [README](../README.md) for how to run a local server), then check
   the page in a browser: breadcrumb, FAQ accordion (if present) expands/collapses, all links work.

## Content requirements

- 700–1,200 words of actual prose (not counting HTML/nav/footer).
- Correct, hedge anything you're not fully confident about rather than guessing — no invented
  statistics, no fake testimonials.
- At least one internal link to a tool page and one to another blog post.
- No filler images — only include a diagram/graphic if it adds real clarity, and always give it
  descriptive alt text.

## Why static HTML instead of Markdown + a generator

A Markdown-with-frontmatter pipeline (rendered at build time) would make future posts faster to
write, but it's a real architecture change: this site is currently zero-build, and adding a
generator means introducing a build step that has to run somewhere. For a modest number of posts,
hand-authored HTML costs about the same to write and keeps the whole site's deploy pipeline exactly
as simple as it is today. If the post volume grows large enough that this becomes real friction,
that's worth revisiting — but it should be a deliberate decision, not something that sneaks in
through the blog alone.
