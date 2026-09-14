// Contact form: client-side validation + honeypot + a minimum-fill-time check,
// then a relay through Web3Forms so no destination email address ever ships in
// this file or the page's HTML. Get a free Access Key at https://web3forms.com —
// it's a public identifier by design (safe to expose client-side), the actual
// inbox it forwards to is configured in your Web3Forms dashboard, not here.
const WEB3FORMS_ACCESS_KEY = "c6713af2-1cc2-489a-ba5c-69aae4ba13a3";
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

// Bots that submit faster than a human could plausibly read and fill the form
// are almost certainly scripted. This is a soft, client-side-only signal —
// real protection is Web3Forms' own server-side spam filtering plus the
// honeypot field below — but it's a free extra layer with no server needed.
const MIN_FILL_TIME_MS = 3000;
const pageLoadedAt = Date.now();

const form = document.getElementById("contactForm");
const statusEl = document.getElementById("cfStatus");
const submitBtn = document.getElementById("cfSubmit");
const captchaError = document.getElementById("cfCaptchaError");

// hCaptcha (via Web3Forms' zero-config proxy, see /assets/contact.js script tag
// in contact/index.html) writes its verification token into this hidden
// textarea once solved. There's no sitekey to manage here, Web3Forms injects it.
function getHcaptchaToken() {
  const el = form.querySelector('textarea[name="h-captcha-response"]');
  return el ? el.value : "";
}

function resetHcaptcha() {
  if (window.hcaptcha && typeof window.hcaptcha.reset === "function") {
    window.hcaptcha.reset();
  }
}

const fields = {
  name: {
    input: document.getElementById("cfName"),
    error: document.getElementById("cfNameError"),
    validate: (v) => (v.trim().length >= 2 ? "" : "Please enter your full name."),
  },
  email: {
    input: document.getElementById("cfEmail"),
    error: document.getElementById("cfEmailError"),
    validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Please enter a valid email address."),
  },
  subject: {
    input: document.getElementById("cfSubject"),
    error: document.getElementById("cfSubjectError"),
    validate: (v) => (v.trim().length >= 3 ? "" : "Please enter a subject."),
  },
  message: {
    input: document.getElementById("cfMessage"),
    error: document.getElementById("cfMessageError"),
    validate: (v) => (v.trim().length >= 10 ? "" : "Message needs to be at least 10 characters."),
  },
};

function showFieldError(field, message) {
  field.input.closest(".field").classList.toggle("has-error", Boolean(message));
  field.input.setAttribute("aria-invalid", message ? "true" : "false");
  field.error.textContent = message;
  field.error.hidden = !message;
}

function validateField(key) {
  const field = fields[key];
  const message = field.validate(field.input.value);
  showFieldError(field, message);
  return !message;
}

// Live-validate only after a field has been touched once, so errors don't
// appear the instant the page loads.
Object.keys(fields).forEach((key) => {
  const field = fields[key];
  let touched = false;
  field.input.addEventListener("blur", () => {
    touched = true;
    validateField(key);
  });
  field.input.addEventListener("input", () => {
    if (touched) validateField(key);
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Honeypot: invisible to real visitors, so only a bot filling every field
  // blindly would ever populate it. Fail silently, no error shown, don't
  // let the bot learn anything from the response.
  const honeypot = document.getElementById("cfWebsite");
  if (honeypot.value.trim() !== "") {
    form.reset();
    setStatus(statusEl, "Sorted — thanks for reaching out, we'll get back to you soon.", "success");
    return;
  }

  if (Date.now() - pageLoadedAt < MIN_FILL_TIME_MS) {
    setStatus(statusEl, "That was quick! Give the form a moment, then try again.", "error");
    return;
  }

  const allValid = Object.keys(fields)
    .map((key) => validateField(key))
    .every(Boolean);
  if (!allValid) {
    setStatus(statusEl, "Please fix the highlighted fields.", "error");
    return;
  }

  const hcaptchaToken = getHcaptchaToken();
  captchaError.hidden = Boolean(hcaptchaToken);
  captchaError.textContent = hcaptchaToken ? "" : "Please complete the captcha.";
  if (!hcaptchaToken) {
    setStatus(statusEl, "Please complete the captcha before sending.", "error");
    return;
  }

  if (WEB3FORMS_ACCESS_KEY === "YOUR_WEB3FORMS_ACCESS_KEY") {
    setStatus(statusEl, "This form isn't wired up to an inbox yet, contact the site owner directly.", "error");
    console.warn("contact.js: set WEB3FORMS_ACCESS_KEY before this form can send anything.");
    return;
  }

  submitBtn.disabled = true;
  setStatus(statusEl, "Sending…", "");

  try {
    const res = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        name: fields.name.input.value.trim(),
        email: fields.email.input.value.trim(),
        subject: `[FairGo PDF] ${fields.subject.input.value.trim()}`,
        message: fields.message.input.value.trim(),
        "h-captcha-response": hcaptchaToken,
      }),
    });
    const result = await res.json();

    if (result.success) {
      form.reset();
      Object.keys(fields).forEach((key) => showFieldError(fields[key], ""));
      setStatus(statusEl, "Sorted — thanks for reaching out, we'll get back to you soon.", "success");
    } else {
      setStatus(statusEl, "Something went wrong sending that, mind trying again in a moment?", "error");
    }
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Couldn't reach the server, check your connection and try again.", "error");
  } finally {
    submitBtn.disabled = false;
    resetHcaptcha();
  }
});
