// The text inside each kind of QR code. A wrong character here makes a code that scans but does nothing, so the exact strings are checked.
import test from "node:test";
import assert from "node:assert/strict";
import { encode, normalizePhone, normaliseUrl, defaultValues, TYPES, SOCIAL_NETWORKS } from "../assets/tools/qr-content.js";

const text = (type, data, now) => encode(type, data, now).text;

test("url: adds https when there is no scheme, keeps one that is there", () => {
  assert.equal(text("url", { url: "example.com/a" }), "https://example.com/a");
  assert.equal(text("url", { url: "http://example.com" }), "http://example.com");
  assert.equal(text("url", { url: "  " }), "");
  assert.equal(normaliseUrl("mailto:a@b.co"), "mailto:a@b.co");
});

test("text: used exactly as typed", () => {
  assert.equal(text("text", { text: "Kia ora, āe!" }), "Kia ora, āe!");
});

test("wifi: escapes the characters the format reserves", () => {
  assert.equal(text("wifi", { ssid: "Home", encryption: "WPA", password: "pass123" }), "WIFI:T:WPA;S:Home;P:pass123;;");
  assert.equal(text("wifi", { ssid: 'Cafe;Free:"wifi"', encryption: "WPA", password: "a;b,c\\d" }), 'WIFI:T:WPA;S:Cafe\\;Free\\:\\"wifi\\";P:a\\;b\\,c\\\\d;;');
  assert.equal(text("wifi", { ssid: "Guest", encryption: "nopass", password: "ignored" }), "WIFI:T:nopass;S:Guest;;");
  assert.equal(text("wifi", { ssid: "Secret", encryption: "WPA", password: "x", hidden: true }), "WIFI:T:WPA;S:Secret;P:x;H:true;;");
  assert.equal(text("wifi", { ssid: "", encryption: "WPA" }), "");
});

test("vcard: version 3.0 with a full name, escaped text and normalised numbers", () => {
  const out = text("vcard", { firstName: "Oscar", lastName: "Monsalve", company: "Fair Go, PDF", phoneMobile: "+61 (400) 000-000", email: "o@example.com", website: "example.com", note: "Line 1\nLine 2; ok" });
  assert.equal(out.split("\r\n")[0], "BEGIN:VCARD");
  for (const line of ["VERSION:3.0", "N:Monsalve;Oscar;;;", "FN:Oscar Monsalve", "ORG:Fair Go\\, PDF", "TEL;TYPE=CELL:+61400000000", "EMAIL;TYPE=INTERNET:o@example.com", "URL:https://example.com", "NOTE:Line 1\\nLine 2\\; ok", "END:VCARD"]) {
    assert.ok(out.split("\r\n").includes(line), `missing ${line}`);
  }
  assert.equal(text("vcard", {}), "");
  assert.ok(text("vcard", { company: "Only Co" }).includes("FN:Only Co"));
});

test("email: only the parts that were filled in, encoded", () => {
  assert.equal(text("email", { to: "a@b.co" }), "mailto:a@b.co");
  assert.equal(text("email", { to: "a@b.co", subject: "Hi there", body: "Line 1\nLine 2" }), "mailto:a@b.co?subject=Hi%20there&body=Line%201%0ALine%202");
  assert.equal(encode("email", { to: "nope" }).problems.length, 1);
});

test("location: coordinates, address only, and bad numbers", () => {
  assert.equal(text("location", { latitude: "-31.9523", longitude: "115.8613" }), "geo:-31.9523,115.8613");
  assert.equal(text("location", { latitude: "-31.9523", longitude: "115.8613", address: "Perth WA" }), "geo:-31.9523,115.8613?q=Perth%20WA");
  assert.equal(text("location", { address: "1 Example St" }), "https://www.google.com/maps/search/?api=1&query=1%20Example%20St");
  assert.equal(encode("location", { latitude: "99", longitude: "1" }).problems.length, 1);
  assert.equal(encode("location", { latitude: "12" }).problems.length, 1);
});

test("event: a calendar entry with escaped text, UTC times and a clear error when it ends before it starts", () => {
  const now = new Date(Date.UTC(2026, 10, 1, 0, 0, 0));
  const data = { title: "Launch, party", start: "2026-11-05T10:00", end: "2026-11-05T12:30", location: "Perth", description: "Cake\nand tea", url: "example.com/rsvp" };
  const out = text("event", data, now).split("\r\n");
  const utc = (v) => new Date(v).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  assert.equal(out[0], "BEGIN:VCALENDAR");
  assert.ok(out.includes("SUMMARY:Launch\\, party"));
  assert.ok(out.includes(`DTSTART:${utc(data.start)}`));
  assert.ok(out.includes(`DTEND:${utc(data.end)}`));
  assert.ok(out.includes("DTSTAMP:20261101T000000Z"));
  assert.ok(out.includes("DESCRIPTION:Cake\\nand tea"));
  assert.ok(out.includes("URL:https://example.com/rsvp"));
  assert.equal(out.at(-1), "END:VCALENDAR");
  assert.equal(encode("event", { ...data, end: "2026-11-05T09:00" }).problems.length, 1);
  assert.equal(text("event", { title: "x" }), "");
});

test("event: an all-day event ends the day after its last day", () => {
  const out = text("event", { title: "Holiday", start: "2026-12-24T00:00", end: "2026-12-26T00:00", allDay: true }, new Date(0)).split("\r\n");
  assert.ok(out.includes("DTSTART;VALUE=DATE:20261224"));
  assert.ok(out.includes("DTEND;VALUE=DATE:20261227"));
});

test("social profile: builds the address for each network, takes a pasted address, rejects odd usernames", () => {
  assert.equal(text("social", { network: "instagram", username: "@fairgopdf" }), "https://www.instagram.com/fairgopdf");
  assert.equal(text("social", { network: "linkedin", username: "oscar-monsalve" }), "https://www.linkedin.com/in/oscar-monsalve");
  assert.equal(text("social", { network: "linkedin-company", username: "fair-go-pdf" }), "https://www.linkedin.com/company/fair-go-pdf");
  assert.equal(text("social", { network: "threads", username: "fairgopdf" }), "https://www.threads.com/@fairgopdf");
  assert.equal(text("social", { network: "youtube", username: "@fairgopdf" }), "https://www.youtube.com/@fairgopdf");
  assert.equal(text("social", { network: "pinterest", username: "fairgo" }), "https://www.pinterest.com/fairgo/");
  assert.equal(text("social", { network: "x", username: "twitter.com/fairgopdf" }), "https://twitter.com/fairgopdf", "a pasted address is used as it is");
  assert.equal(text("social", { network: "x", username: "https://x.com/fairgopdf" }), "https://x.com/fairgopdf");
  assert.equal(encode("social", { network: "x", username: "two words" }).problems.length, 1);
  assert.equal(text("social", { network: "instagram", username: "  " }), "");
  for (const [id] of SOCIAL_NETWORKS) assert.ok(text("social", { network: id, username: "abc" }).startsWith("https://"), id);
});

test("lost and found: a plain message with the owner's details", () => {
  assert.equal(text("lostfound", { item: "Biscuit the dog", owner: "Oscar", phone: "0400 000 000", email: "o@example.com", note: "Please call any time." }),
    "If found, please contact Oscar.\nItem: Biscuit the dog\nPhone: 0400 000 000\nEmail: o@example.com\n\nPlease call any time.");
  assert.equal(text("lostfound", { phone: "0400 000 000" }), "If found, please contact the owner.\nPhone: 0400 000 000");
  assert.equal(encode("lostfound", { item: "Keys" }).problems.length, 1, "no way to reach the owner");
  assert.deepEqual(encode("lostfound", {}).problems, [], "an empty form gives no warning");
  assert.equal(encode("lostfound", { phone: "1", email: "nope" }).problems.length, 1);
});

test("app download: store address from an ID, a package name or a pasted link", () => {
  assert.equal(text("app", { store: "apple", appId: "389801252" }), "https://apps.apple.com/app/id389801252");
  assert.equal(text("app", { store: "apple", appId: "id389801252" }), "https://apps.apple.com/app/id389801252");
  assert.equal(text("app", { store: "google", appId: "com.whatsapp" }), "https://play.google.com/store/apps/details?id=com.whatsapp");
  assert.equal(text("app", { store: "google", appId: "https://play.google.com/store/apps/details?id=a.b" }), "https://play.google.com/store/apps/details?id=a.b");
  assert.equal(encode("app", { store: "apple", appId: "abc" }).problems.length, 1);
  assert.equal(encode("app", { store: "google", appId: "notapackage" }).problems.length, 1);
});

test("phone, sms and whatsapp numbers are cleaned up", () => {
  assert.equal(normalizePhone("+61 (0)400-000 000"), "+610400000000");
  assert.equal(text("phone", { phone: "+61 400 000 000" }), "tel:+61400000000");
  assert.equal(text("phone", { phone: "" }), "");
  assert.equal(text("sms", { phone: "0400 000 000", message: "Hello there" }), "SMSTO:0400000000:Hello there");
  assert.equal(text("whatsapp", { phone: "+61 400 000 000", message: "G'day mate" }), "https://wa.me/61400000000?text=G'day%20mate");
  assert.equal(text("whatsapp", { phone: "+61 400 000 000" }), "https://wa.me/61400000000");
});

test("every kind of content has a form and starts empty", () => {
  assert.equal(TYPES.length, 13);
  assert.equal(TYPES[1].id, "social", "Social profile sits next to URL");
  assert.equal(TYPES.some((x) => x.id === "bank"), false);
  for (const t of TYPES) {
    assert.ok(t.fields.length > 0, t.id);
    assert.equal(encode(t.id, defaultValues(t.id)).text, "", `${t.id} should be empty to start with`);
  }
});
