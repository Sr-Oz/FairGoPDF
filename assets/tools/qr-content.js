// What goes inside a QR code, for each kind of content: the form fields to show, and the text to encode.
// Plain functions with no page code, so the tests can run them. The text formats follow the ones the open-source QRcodly
// project uses (MIT, https://github.com/FloB95/qrcodly), rewritten here without its libraries, with special characters
// escaped where the formats require it (Wi-Fi names and passwords, vCard and calendar text). Social profile, Lost and found
// and App download are this site's own.

// Social profile: the visitor types a username and the right address is built. A full address pasted in is used as it is.
export const SOCIAL_NETWORKS = [
  ["instagram", "Instagram", (h) => `https://www.instagram.com/${h}`],
  ["facebook", "Facebook", (h) => `https://www.facebook.com/${h}`],
  ["linkedin", "LinkedIn (person)", (h) => `https://www.linkedin.com/in/${h}`],
  ["linkedin-company", "LinkedIn (company)", (h) => `https://www.linkedin.com/company/${h}`],
  ["x", "X", (h) => `https://x.com/${h}`],
  ["threads", "Threads", (h) => `https://www.threads.com/@${h}`],
  ["youtube", "YouTube", (h) => `https://www.youtube.com/@${h}`],
  ["tiktok", "TikTok", (h) => `https://www.tiktok.com/@${h}`],
  ["snapchat", "Snapchat", (h) => `https://www.snapchat.com/add/${h}`],
  ["pinterest", "Pinterest", (h) => `https://www.pinterest.com/${h}/`],
  ["github", "GitHub", (h) => `https://github.com/${h}`],
  ["telegram", "Telegram", (h) => `https://t.me/${h}`],
];

export const TYPES = [
  {
    id: "url", label: "URL", icon: "link",
    fields: [{ key: "url", label: "Website address", type: "url", placeholder: "https://example.com", required: true, autocomplete: "off" }],
  },
  {
    id: "social", label: "Social profile", icon: "alternate_email",
    fields: [
      { key: "network", label: "Network", type: "select", options: SOCIAL_NETWORKS.map(([id, label]) => [id, label]), value: "instagram" },
      { key: "username", label: "Username", type: "text", required: true, placeholder: "yourname or @yourname", autocomplete: "off" },
    ],
  },
  {
    id: "text", label: "Text", icon: "notes",
    fields: [{ key: "text", label: "Text", type: "textarea", rows: 4, placeholder: "Any text you like", required: true }],
  },
  {
    id: "wifi", label: "Wi-Fi", icon: "wifi",
    fields: [
      { key: "ssid", label: "Network name", type: "text", required: true, autocomplete: "off" },
      { key: "encryption", label: "Security", type: "select", options: [["WPA", "WPA, WPA2 or WPA3"], ["WEP", "WEP"], ["nopass", "None (open network)"]], value: "WPA" },
      { key: "password", label: "Password", type: "text", autocomplete: "off", showWhen: { encryption: ["WPA", "WEP"] } },
      { key: "hidden", label: "Hidden network", type: "checkbox" },
    ],
  },
  {
    id: "vcard", label: "Contact card", icon: "contact_page",
    fields: [
      { key: "firstName", label: "First name", type: "text", autocomplete: "given-name" },
      { key: "lastName", label: "Last name", type: "text", autocomplete: "family-name" },
      { key: "company", label: "Company", type: "text", autocomplete: "organization" },
      { key: "job", label: "Job title", type: "text", autocomplete: "organization-title" },
      { key: "phoneMobile", label: "Mobile", type: "tel", autocomplete: "tel" },
      { key: "phoneWork", label: "Work phone", type: "tel" },
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      { key: "website", label: "Website", type: "url", placeholder: "https://" },
      { key: "street", label: "Street", type: "text", autocomplete: "street-address" },
      { key: "city", label: "City or suburb", type: "text", autocomplete: "address-level2" },
      { key: "state", label: "State or region", type: "text", autocomplete: "address-level1" },
      { key: "zip", label: "Postcode", type: "text", autocomplete: "postal-code" },
      { key: "country", label: "Country", type: "text", autocomplete: "country-name" },
      { key: "note", label: "Note", type: "textarea", rows: 2, wide: true },
    ],
  },
  {
    id: "email", label: "Email", icon: "mail",
    fields: [
      { key: "to", label: "Send to", type: "email", required: true, autocomplete: "off" },
      { key: "subject", label: "Subject", type: "text", wide: true },
      { key: "body", label: "Message", type: "textarea", rows: 4, wide: true },
    ],
  },
  {
    id: "location", label: "Location", icon: "location_on",
    fields: [
      { key: "address", label: "Address or place", type: "text", placeholder: "1 Example Street, Perth WA", wide: true },
      { key: "latitude", label: "Latitude (optional)", type: "text", inputmode: "decimal", placeholder: "-31.9523" },
      { key: "longitude", label: "Longitude (optional)", type: "text", inputmode: "decimal", placeholder: "115.8613" },
    ],
  },
  {
    id: "event", label: "Event", icon: "event",
    fields: [
      { key: "title", label: "Event name", type: "text", required: true, wide: true },
      { key: "start", label: "Starts", type: "datetime-local", required: true },
      { key: "end", label: "Ends", type: "datetime-local", required: true },
      { key: "allDay", label: "All-day event", type: "checkbox", wide: true },
      { key: "location", label: "Where", type: "text", wide: true },
      { key: "description", label: "Details", type: "textarea", rows: 3, wide: true },
      { key: "url", label: "Link", type: "url", placeholder: "https://", wide: true },
    ],
  },
  {
    id: "phone", label: "Phone number", icon: "call",
    fields: [{ key: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+61 400 000 000", autocomplete: "off" }],
  },
  {
    id: "sms", label: "SMS", icon: "sms",
    fields: [
      { key: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+61 400 000 000", autocomplete: "off" },
      { key: "message", label: "Message", type: "textarea", rows: 3, wide: true },
    ],
  },
  {
    id: "whatsapp", label: "WhatsApp", icon: "chat",
    fields: [
      { key: "phone", label: "WhatsApp number, with country code", type: "tel", required: true, placeholder: "+61 400 000 000", autocomplete: "off" },
      { key: "message", label: "Message", type: "textarea", rows: 3, wide: true },
    ],
  },
  {
    id: "lostfound", label: "Lost and found", icon: "backpack",
    fields: [
      { key: "item", label: "What is it?", type: "text", placeholder: "Biscuit the dog, blue backpack, house keys", wide: true },
      { key: "owner", label: "Your name", type: "text", autocomplete: "name" },
      { key: "phone", label: "Phone", type: "tel", autocomplete: "tel" },
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      { key: "note", label: "Message to the finder", type: "textarea", rows: 3, wide: true, placeholder: "Please call any time. Thank you!" },
    ],
  },
  {
    id: "app", label: "App download", icon: "smartphone",
    fields: [
      { key: "store", label: "Store", type: "select", options: [["apple", "Apple App Store (iPhone and iPad)"], ["google", "Google Play (Android)"]], value: "apple", wide: true },
      { key: "appId", label: "App ID or store address", type: "text", required: true, wide: true, placeholder: "389801252, or com.example.app, or a store link", autocomplete: "off" },
    ],
  },
];

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const pad = (n, w = 2) => String(n).padStart(w, "0");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "+61 (400) 000-000" -> "+61400000000"; keeps a leading plus so the number can be dialled as entered
export function normalizePhone(value) {
  const trimmed = clean(value);
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function normaliseUrl(value) {
  const v = clean(value);
  if (!v) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(mailto|tel|sms|geo):/i.test(v) ? v : `https://${v}`;
}

// Wi-Fi codes: backslash, semicolon, comma, colon and double quote must be escaped, or a name like "Cafe;Free" breaks the code
export const escapeWifi = (v) => v.replace(/([\\;,:"])/g, "\\$1");
// vCard and calendar text: backslash, semicolon, comma and line breaks
export const escapeText = (v) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (v) => v.slice(0, 10).replace(/-/g, "");

const ENCODERS = {
  url: (d) => {
    const url = normaliseUrl(d.url);
    return { text: url };
  },

  social: (d) => {
    const raw = clean(d.username);
    if (!raw) return { text: "" };
    if (/[/:]/.test(raw)) return { text: normaliseUrl(raw) }; // a whole address was pasted in
    const handle = raw.replace(/^@/, "");
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return { text: "", problems: ["Usernames use letters, numbers, dots, dashes and underscores, with no spaces."] };
    const network = SOCIAL_NETWORKS.find(([id]) => id === d.network) || SOCIAL_NETWORKS[0];
    return { text: network[2](handle) };
  },

  text: (d) => ({ text: typeof d.text === "string" ? d.text : "" }),

  wifi: (d) => {
    const ssid = clean(d.ssid);
    if (!ssid) return { text: "" };
    const open = d.encryption === "nopass";
    const password = open ? "" : d.password || "";
    const parts = [`T:${d.encryption || "WPA"}`, `S:${escapeWifi(ssid)}`];
    if (password) parts.push(`P:${escapeWifi(password)}`);
    if (d.hidden) parts.push("H:true");
    return { text: `WIFI:${parts.join(";")};;` };
  },

  vcard: (d) => {
    const first = clean(d.firstName), last = clean(d.lastName), company = clean(d.company);
    if (!first && !last && !company) return { text: "" };
    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push(`N:${escapeText(last)};${escapeText(first)};;;`);
    lines.push(`FN:${escapeText([first, last].filter(Boolean).join(" ") || company)}`);
    if (company) lines.push(`ORG:${escapeText(company)}`);
    if (clean(d.job)) lines.push(`TITLE:${escapeText(clean(d.job))}`);
    if (clean(d.phoneMobile)) lines.push(`TEL;TYPE=CELL:${normalizePhone(d.phoneMobile)}`);
    if (clean(d.phoneWork)) lines.push(`TEL;TYPE=WORK:${normalizePhone(d.phoneWork)}`);
    if (clean(d.email)) lines.push(`EMAIL;TYPE=INTERNET:${clean(d.email)}`);
    if (clean(d.website)) lines.push(`URL:${normaliseUrl(d.website)}`);
    if (["street", "city", "state", "zip", "country"].some((k) => clean(d[k]))) {
      lines.push(`ADR;TYPE=WORK:;;${["street", "city", "state", "zip", "country"].map((k) => escapeText(clean(d[k]))).join(";")}`);
    }
    if (clean(d.note)) lines.push(`NOTE:${escapeText(clean(d.note))}`);
    lines.push("END:VCARD");
    const problems = [];
    if (clean(d.email) && !EMAIL.test(clean(d.email))) problems.push("That email address doesn't look right.");
    return { text: lines.join("\r\n"), problems };
  },

  email: (d) => {
    const to = clean(d.to);
    if (!to) return { text: "" };
    if (!EMAIL.test(to)) return { text: "", problems: ["That email address doesn't look right."] };
    const params = [];
    if (clean(d.subject)) params.push(`subject=${encodeURIComponent(clean(d.subject))}`);
    if (clean(d.body)) params.push(`body=${encodeURIComponent(clean(d.body))}`);
    return { text: `mailto:${to}${params.length ? `?${params.join("&")}` : ""}` };
  },

  location: (d) => {
    const address = clean(d.address);
    const lat = clean(d.latitude), lon = clean(d.longitude);
    if (lat || lon) {
      const la = Number(lat), lo = Number(lon);
      if (!lat || !lon || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
        return { text: "", problems: ["Latitude and longitude need to be numbers, for example -31.9523 and 115.8613."] };
      }
      return { text: `geo:${la},${lo}${address ? `?q=${encodeURIComponent(address)}` : ""}` };
    }
    return { text: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "" };
  },

  event: (d, now = new Date()) => {
    const title = clean(d.title);
    if (!title || !d.start || !d.end) return { text: "" };
    const start = new Date(d.start), end = new Date(d.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { text: "" };
    if (end < start) return { text: "", problems: ["The event ends before it starts."] };
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fair Go PDF//QR Code Generator//EN", "BEGIN:VEVENT",
      `UID:${(globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(now.getTime()))}@fairgopdf.au`, `DTSTAMP:${utc(now)}`];
    if (d.allDay) {
      const last = new Date(`${dateOnly(d.end).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() + 1); // the end date of an all-day event is exclusive
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(d.start)}`, `DTEND;VALUE=DATE:${last.getUTCFullYear()}${pad(last.getUTCMonth() + 1)}${pad(last.getUTCDate())}`);
    } else {
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (clean(d.location)) lines.push(`LOCATION:${escapeText(clean(d.location))}`);
    if (clean(d.description)) lines.push(`DESCRIPTION:${escapeText(clean(d.description))}`);
    if (clean(d.url)) lines.push(`URL:${normaliseUrl(d.url)}`);
    lines.push("END:VEVENT", "END:VCALENDAR");
    return { text: lines.join("\r\n") };
  },

  phone: (d) => {
    const phone = normalizePhone(d.phone);
    if (phone.replace(/\D/g, "").length < 3) return { text: "" };
    return { text: `tel:${phone}` };
  },

  sms: (d) => {
    const phone = normalizePhone(d.phone);
    if (phone.replace(/\D/g, "").length < 3) return { text: "" };
    return { text: `SMSTO:${phone}:${d.message || ""}` };
  },

  lostfound: (d) => {
    const item = clean(d.item), owner = clean(d.owner), phone = clean(d.phone), email = clean(d.email), note = clean(d.note);
    if (!phone && !email) {
      return { text: "", problems: item || owner || note ? ["Add a phone number or an email address so whoever finds it can reach you."] : [] };
    }
    if (email && !EMAIL.test(email)) return { text: "", problems: ["That email address doesn't look right."] };
    // what a finder reads when they scan it
    const lines = [`If found, please contact ${owner || "the owner"}.`];
    if (item) lines.push(`Item: ${item}`);
    if (phone) lines.push(`Phone: ${phone}`);
    if (email) lines.push(`Email: ${email}`);
    if (note) lines.push("", note);
    return { text: lines.join("\n") };
  },

  app: (d) => {
    const raw = clean(d.appId);
    if (!raw) return { text: "" };
    if (/^https?:\/\//i.test(raw)) return { text: raw }; // a store link was pasted in
    if (d.store === "google") {
      if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(raw)) return { text: "", problems: ["A Google Play app ID looks like com.example.app."] };
      return { text: `https://play.google.com/store/apps/details?id=${raw}` };
    }
    const id = raw.replace(/^id/i, "");
    if (!/^\d{5,}$/.test(id)) return { text: "", problems: ["An App Store ID is a number, for example 389801252. You can find it in the app's store address after \"id\"."] };
    return { text: `https://apps.apple.com/app/id${id}` };
  },

  whatsapp: (d) => {
    const digits = normalizePhone(d.phone).replace(/^\+/, "");
    if (digits.length < 5) return { text: "" };
    return { text: `https://wa.me/${digits}${clean(d.message) ? `?text=${encodeURIComponent(d.message)}` : ""}` };
  },
};

// -> { text, problems }: text is "" until the form has what that kind of code needs
export function encode(type, data, now) {
  const fn = ENCODERS[type];
  if (!fn) return { text: "", problems: [] };
  const out = fn(data || {}, now);
  return { text: out.text, problems: out.problems || [] };
}

export function defaultValues(type) {
  const t = TYPES.find((x) => x.id === type);
  const values = {};
  for (const f of t ? t.fields : []) values[f.key] = f.type === "checkbox" ? false : f.value || "";
  return values;
}
