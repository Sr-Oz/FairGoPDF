// "Keep it sorted" tool-chain registry. Loaded as a plain <script> (not a
// module), same pattern as tools.js and search-data.js.
//
// Each tool entry declares two independent things, kept separate on purpose
// (conflating them caused real mistakes while scoping this feature):
//   - outputKind: what type of file running this tool produces, when it
//     produces exactly one unambiguous file. null means its output is never
//     a single working file (a diff view, a .zip, multiple independent
//     files) and it can never be a *source* for the next step.
//   - acceptsKind: what type of file this tool's dropzone takes as primary
//     input. null means it doesn't take a file at all (pasted text) or needs
//     more than one file to do anything useful (prefillOnly: true below).
//   - prefillOnly: true means a carried file can pre-populate this tool's
//     file list, but the tool still needs the visitor to add more before it
//     can run (Merge, Alternate & Mix Pages, Images to PDF, HEIC to PDF,
//     PDF Scanner, Collage Studio) — never a one-click destination.
//
// Excluded entirely, and why: Compare PDFs (output is a diff, not a file)
// and Colour Palette Generator (output is hex codes on screen, not a file).
window.KEEP_SORTED_TOOLS = {
  // ---- PDF tools: clean single-in/single-out (Tier 1) ----
  "compress-pdf": { title: "Compress PDF", icon: "compress", outputKind: "pdf", acceptsKind: "pdf" },
  "organise-pdf": { title: "Organise PDF Pages", icon: "reorder", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-metadata": { title: "Edit PDF Metadata", icon: "info", outputKind: "pdf", acceptsKind: "pdf" },
  "add-page-numbers": { title: "Add Page Numbers", icon: "format_list_numbered", outputKind: "pdf", acceptsKind: "pdf" },
  "watermark-pdf": { title: "Watermark PDF", icon: "water_drop", outputKind: "pdf", acceptsKind: "pdf" },
  "resize-pdf-pages": { title: "Resize PDF Pages", icon: "straighten", outputKind: "pdf", acceptsKind: "pdf" },
  "crop-pdf": { title: "Crop PDF Pages", icon: "crop", outputKind: "pdf", acceptsKind: "pdf" },
  "fill-pdf-form": { title: "Fill PDF Form", icon: "edit_note", outputKind: "pdf", acceptsKind: "pdf" },
  "sign-pdf": { title: "Sign PDF", icon: "draw", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-colour-filters": { title: "PDF Colour Filters", icon: "tonality", outputKind: "pdf", acceptsKind: "pdf" },
  "flatten-pdf": { title: "Flatten PDF", icon: "layers_clear", outputKind: "pdf", acceptsKind: "pdf" },
  "n-up-pdf": { title: "N-Up PDF", icon: "grid_view", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-booklet": { title: "PDF Booklet Maker", icon: "auto_stories", outputKind: "pdf", acceptsKind: "pdf" },
  "add-stamps": { title: "Add Stamps", icon: "approval", outputKind: "pdf", acceptsKind: "pdf" },
  "repair-pdf": { title: "Repair PDF", icon: "build", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-header-footer": { title: "Header & Footer", icon: "splitscreen", outputKind: "pdf", acceptsKind: "pdf" },
  "redact-pdf": { title: "Redact PDF", icon: "block", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-editor": { title: "PDF Editor", icon: "edit_document", outputKind: "pdf", acceptsKind: "pdf" },
  "add-links-to-pdf": { title: "Add Links to PDF", icon: "link", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-form-builder": { title: "PDF Form Builder", icon: "checklist", outputKind: "pdf", acceptsKind: "pdf" },
  "remove-blank-pages": { title: "Remove Blank Pages", icon: "auto_delete", outputKind: "pdf", acceptsKind: "pdf" },
  "ocr-pdf": { title: "OCR PDF", icon: "find_in_page", outputKind: "pdf", acceptsKind: "pdf" },
  "rotate-pdf-freely": { title: "Rotate PDF Freely", icon: "rotate_right", outputKind: "pdf", acceptsKind: "pdf" },
  "sanitise-pdf": { title: "Sanitise PDF", icon: "cleaning_services", outputKind: "pdf", acceptsKind: "pdf" },
  "remove-annotations": { title: "Remove Annotations", icon: "comments_disabled", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-background-colour": { title: "PDF Background Colour", icon: "format_color_fill", outputKind: "pdf", acceptsKind: "pdf" },
  "divide-pdf-pages": { title: "Divide PDF Pages", icon: "view_agenda", outputKind: "pdf", acceptsKind: "pdf" },
  "posterise-pdf": { title: "Posterise PDF", icon: "grid_on", outputKind: "pdf", acceptsKind: "pdf" },
  "combine-pages-into-one": { title: "Combine Pages Into One", icon: "view_stream", outputKind: "pdf", acceptsKind: "pdf" },
  "pdf-annotator": { title: "PDF Annotator", icon: "draw", outputKind: "pdf", acceptsKind: "pdf" },

  // ---- PDF tools: special-cased ----
  "protect-pdf": { title: "Protect PDF", icon: "lock", outputKind: "pdf-encrypted", acceptsKind: "pdf" },
  "unlock-pdf": { title: "Unlock PDF", icon: "lock_open", outputKind: "pdf", acceptsKind: "pdf-encrypted" },

  // ---- PDF tools: prefill-only destinations (need 2+ files to run) ----
  "merge-pdf": { title: "Merge PDF", icon: "call_merge", outputKind: "pdf", acceptsKind: "pdf", prefillOnly: true },
  "alternate-mix-pages": { title: "Alternate & Mix Pages", icon: "shuffle", outputKind: "pdf", acceptsKind: "pdf", prefillOnly: true },
  "images-to-pdf": { title: "Images to PDF", icon: "picture_as_pdf", outputKind: "pdf", acceptsKind: "image", prefillOnly: true },
  "heic-to-pdf": { title: "HEIC to PDF", icon: "smartphone", outputKind: "pdf", acceptsKind: null, prefillOnly: true },
  // acceptsKind is null (not "image"): PDF Scanner's camera/upload UI has no
  // dropzone to hook a resume prompt into, so it's wired as a source only.
  "pdf-scanner": { title: "PDF Scanner", icon: "document_scanner", outputKind: "pdf", acceptsKind: null },

  // ---- PDF tools: entry-point sources only (produce a PDF, but nothing here
  // produces a .docx/.csv/.xlsx/.rtf/.epub/.cbz/pasted-text for them to accept) ----
  "text-to-pdf": { title: "Text to PDF", icon: "notes", outputKind: "pdf", acceptsKind: null },
  "markdown-to-pdf": { title: "Markdown to PDF", icon: "markdown", outputKind: "pdf", acceptsKind: null },
  "word-to-pdf": { title: "Word to PDF", icon: "description", outputKind: "pdf", acceptsKind: null },
  "csv-to-pdf": { title: "CSV to PDF", icon: "table_chart", outputKind: "pdf", acceptsKind: null },
  "excel-to-pdf": { title: "Excel to PDF", icon: "table_view", outputKind: "pdf", acceptsKind: null },
  "rtf-to-pdf": { title: "RTF to PDF", icon: "text_snippet", outputKind: "pdf", acceptsKind: null },
  "epub-to-pdf": { title: "EPUB to PDF", icon: "auto_stories", outputKind: "pdf", acceptsKind: null },
  "cbz-to-pdf": { title: "CBZ to PDF", icon: "auto_stories", outputKind: "pdf", acceptsKind: null },

  // ---- PDF tools: exit-only terminals (accept a PDF, but their output type
  // isn't continuable in this system) ----
  "extract-pdf-text": { title: "Extract PDF Text", icon: "text_fields", outputKind: null, acceptsKind: "pdf" },
  "pdf-to-word": { title: "PDF to Word", icon: "swap_horiz", outputKind: null, acceptsKind: "pdf" },
  "extract-pdf-images": { title: "Extract Images", icon: "photo_library", outputKind: null, acceptsKind: "pdf" },

  // ---- PDF tools: conditional (only a source/destination when the actual
  // run produced/used exactly one file — checked at call time, not here) ----
  "pdf-to-images": { title: "PDF to Images", icon: "image", outputKind: "image", acceptsKind: "pdf", conditional: true },

  // ---- Image tools: clean single-in/single-out (Tier 2, unconditional) ----
  "crop-rotate-image": { title: "Crop & Rotate Image", icon: "crop", outputKind: "image", acceptsKind: "image" },
  "image-colour-filters": { title: "Image Colour Filters", icon: "palette", outputKind: "image", acceptsKind: "image" },
  "round-corners-image": { title: "Round Corners / Circle Crop", icon: "rounded_corner", outputKind: "image", acceptsKind: "image" },
  "social-media-cropper": { title: "Social Media Cropper", icon: "photo_size_select_large", outputKind: "image", acceptsKind: "image" },
  "remove-background": { title: "Remove Background", icon: "background_replace", outputKind: "image", acceptsKind: "image" },

  // ---- Image tools: conditional (batch-capable, only source/destination
  // when exactly one file was processed) ----
  "compress-image": { title: "Compress Image", icon: "compress", outputKind: "image", acceptsKind: "image", conditional: true },
  "convert-image": { title: "Convert Image Format", icon: "sync_alt", outputKind: "image", acceptsKind: "image", conditional: true },
  "resize-image": { title: "Resize Image", icon: "aspect_ratio", outputKind: "image", acceptsKind: "image", conditional: true },
  "add-border-to-image": { title: "Add Border to Image", icon: "border_style", outputKind: "image", acceptsKind: "image", conditional: true },
  "watermark-image": { title: "Watermark Image", icon: "water_drop", outputKind: "image", acceptsKind: "image", conditional: true },
  "remove-exif-data": { title: "Remove Photo Metadata", icon: "location_off", outputKind: "image", acceptsKind: "image", conditional: true },

  // ---- Image tools: entry-point source only (nothing produces HEIC output) ----
  "heic-to-jpg": { title: "HEIC to JPG", icon: "smartphone", outputKind: "image", acceptsKind: null },

  // ---- Image tools: prefill-only destination (needs 2+ images to run) ----
  "collage-studio": { title: "Collage Studio", icon: "auto_awesome_mosaic", outputKind: "image", acceptsKind: "image", prefillOnly: true },
};

// Curated suggestions per source tool, ordered by relevance, capped at 3-4.
// Deliberately not "every tool that accepts this output type" — that's noise,
// not help. A tool absent from this map falls back to a sensible default
// pool (see keep-sorted.js), minus itself and minus anything already listed.
window.KEEP_SORTED_SUGGESTIONS = {
  // Security-aware special case: only Unlock PDF can open what Protect PDF
  // just produced, so that's the only honest suggestion.
  "protect-pdf": [
    { tool: "unlock-pdf", reason: "if you ever need to remove this password" },
  ],
  "unlock-pdf": [
    { tool: "protect-pdf" },
    { tool: "sign-pdf" },
    { tool: "compress-pdf" },
  ],

  // Form-building workflow: build the form, then test it by filling it in.
  "pdf-form-builder": [
    { tool: "fill-pdf-form", reason: "to try the form fields you just added" },
    { tool: "protect-pdf" },
  ],
  // Fill it in, then lock the values so they can't be edited further.
  "fill-pdf-form": [
    { tool: "flatten-pdf", reason: "to lock in the values you just filled" },
    { tool: "sign-pdf" },
    { tool: "protect-pdf" },
  ],
  "flatten-pdf": [
    { tool: "protect-pdf" },
    { tool: "compress-pdf" },
  ],

  // Now the file has a text layer, so the text tools finally have something to read.
  "ocr-pdf": [
    { tool: "extract-pdf-text", reason: "now there's real text to pull out" },
    { tool: "pdf-to-word" },
    { tool: "compress-pdf", reason: "the scan images keep the file large" },
    { tool: "protect-pdf" },
  ],

  "merge-pdf": [
    { tool: "add-page-numbers" },
    { tool: "compress-pdf" },
    { tool: "protect-pdf" },
  ],
  "alternate-mix-pages": [
    { tool: "add-page-numbers" },
    { tool: "compress-pdf" },
  ],
  "images-to-pdf": [
    { tool: "ocr-pdf", reason: "to make scanned text searchable" },
    { tool: "compress-pdf", reason: "photos can make a PDF large" },
    { tool: "add-page-numbers" },
    { tool: "protect-pdf" },
  ],
  "heic-to-pdf": [
    { tool: "ocr-pdf", reason: "to make scanned text searchable" },
    { tool: "compress-pdf", reason: "photos can make a PDF large" },
    { tool: "add-page-numbers" },
    { tool: "protect-pdf" },
  ],
  "pdf-scanner": [
    { tool: "ocr-pdf", reason: "to make the scan searchable" },
    { tool: "compress-pdf", reason: "scans are often large" },
    { tool: "sign-pdf" },
    { tool: "add-page-numbers" },
  ],
  "repair-pdf": [
    { tool: "compress-pdf", reason: "a repaired file can still be bulky" },
    { tool: "organise-pdf" },
  ],

  // Image tools
  "compress-image": [
    { tool: "convert-image" },
    { tool: "watermark-image" },
    { tool: "add-border-to-image" },
  ],
  "convert-image": [
    { tool: "compress-image" },
    { tool: "watermark-image" },
  ],
  "resize-image": [
    { tool: "compress-image" },
    { tool: "convert-image" },
  ],
  "crop-rotate-image": [
    { tool: "resize-image" },
    { tool: "compress-image" },
  ],
  "add-border-to-image": [
    { tool: "compress-image" },
    { tool: "watermark-image" },
  ],
  "image-colour-filters": [
    { tool: "compress-image" },
    { tool: "add-border-to-image" },
  ],
  "round-corners-image": [
    { tool: "add-border-to-image" },
    { tool: "compress-image" },
  ],
  "watermark-image": [
    { tool: "compress-image" },
    { tool: "convert-image" },
  ],
  "social-media-cropper": [
    { tool: "compress-image" },
    { tool: "watermark-image" },
  ],
  "remove-background": [
    { tool: "add-border-to-image" },
    { tool: "compress-image" },
  ],
  "remove-exif-data": [
    { tool: "compress-image" },
    { tool: "convert-image" },
  ],
  "heic-to-jpg": [
    { tool: "compress-image" },
    { tool: "convert-image" },
    { tool: "watermark-image" },
  ],
};

// Fallback pools used when a source tool isn't in the curated map above
// (mostly the plain Tier 1/Tier 2 tools where any of these genuinely is a
// sensible next step). Self is always excluded automatically.
window.KEEP_SORTED_DEFAULT_POOL = {
  pdf: ["compress-pdf", "add-page-numbers", "watermark-pdf", "protect-pdf"],
  "pdf-encrypted": ["unlock-pdf"],
  image: ["compress-image", "convert-image", "watermark-image", "add-border-to-image"],
};
