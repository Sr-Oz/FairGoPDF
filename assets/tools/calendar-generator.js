import { PDFLib } from "/assets/tools/pdf-common.js";

const yearInput = document.getElementById("calYear");
const weekStartSelect = document.getElementById("weekStart");
const pageSizeSelect = document.getElementById("pageSize");
const highlightWeekendsInput = document.getElementById("highlightWeekends");
const customDatesInput = document.getElementById("customDates");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGIN = 36;
const HEADER_HEIGHT = 22;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

yearInput.value = String(new Date().getFullYear());

function parseCustomDates(text) {
  // key "M-D" (no zero padding) -> [{ label, year: number|null }]
  const map = new Map();
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      let m = line.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(.+)$/);
      let year = null, month, day, label;
      if (m) {
        year = Number(m[1]);
        month = Number(m[2]);
        day = Number(m[3]);
        label = m[4].trim();
      } else {
        m = line.match(/^(\d{1,2})-(\d{1,2})\s+(.+)$/);
        if (!m) return;
        month = Number(m[1]);
        day = Number(m[2]);
        label = m[3].trim();
      }
      if (month < 1 || month > 12 || day < 1 || day > 31) return;
      const key = `${month}-${day}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ label, year });
    });
  return map;
}

function buildMonthGrid(year, monthIndex, weekStartsMonday) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let firstWeekday = new Date(year, monthIndex, 1).getDay(); // 0=Sun..6=Sat
  if (weekStartsMonday) firstWeekday = (firstWeekday + 6) % 7; // 0=Mon..6=Sun

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function truncateToWidth(text, font, size, maxWidth) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = "";
  for (const ch of text) {
    const candidate = result + ch + "…";
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) break;
    result += ch;
  }
  return result + "…";
}

function drawMonthPage(doc, font, boldFont, pageW, pageH, year, monthIndex, opts) {
  const page = doc.addPage([pageW, pageH]);
  const { weekStartsMonday, highlightWeekends, customDates } = opts;

  page.drawText(`${MONTH_NAMES[monthIndex]} ${year}`, {
    x: MARGIN,
    y: pageH - MARGIN - 6,
    size: 20,
    font: boldFont,
    color: PDFLib.rgb(0.1, 0.1, 0.1),
  });

  const gridLeft = MARGIN;
  const gridRight = pageW - MARGIN;
  const gridWidth = gridRight - gridLeft;
  const gridTop = pageH - MARGIN - 46;
  const gridBottom = MARGIN;
  const colWidth = gridWidth / 7;

  const weekdayLabels = weekStartsMonday ? WEEKDAYS_MON : WEEKDAYS_SUN;
  weekdayLabels.forEach((label, i) => {
    const x = gridLeft + i * colWidth;
    page.drawText(label, {
      x: x + 6,
      y: gridTop - 15,
      size: 9,
      font: boldFont,
      color: PDFLib.rgb(0.45, 0.45, 0.45),
    });
  });

  const rows = buildMonthGrid(year, monthIndex, weekStartsMonday);
  const bodyTop = gridTop - HEADER_HEIGHT;
  const rowHeight = (bodyTop - gridBottom) / rows.length;

  rows.forEach((row, r) => {
    row.forEach((dayNum, c) => {
      const x = gridLeft + c * colWidth;
      const yTop = bodyTop - r * rowHeight;
      const yBottom = yTop - rowHeight;
      const isWeekend = weekStartsMonday ? c >= 5 : c === 0 || c === 6;

      if (highlightWeekends && isWeekend) {
        page.drawRectangle({
          x, y: yBottom, width: colWidth, height: rowHeight,
          color: PDFLib.rgb(0.965, 0.955, 0.93),
        });
      }

      page.drawRectangle({
        x, y: yBottom, width: colWidth, height: rowHeight,
        borderColor: PDFLib.rgb(0.83, 0.83, 0.8),
        borderWidth: 0.75,
      });

      if (dayNum === null) return;

      page.drawText(String(dayNum), {
        x: x + 6,
        y: yTop - 16,
        size: 11,
        font,
        color: PDFLib.rgb(0.15, 0.15, 0.15),
      });

      const marks = customDates.get(`${monthIndex + 1}-${dayNum}`);
      if (marks) {
        const validLabels = marks.filter((m) => m.year === null || m.year === year).map((m) => m.label);
        if (validLabels.length) {
          const text = truncateToWidth(validLabels.join(", "), font, 6.5, colWidth - 10);
          page.drawText(text, {
            x: x + 5,
            y: yBottom + 6,
            size: 6.5,
            font,
            color: PDFLib.rgb(0.72, 0.18, 0.18),
          });
        }
      }
    });
  });

  return page;
}

runBtn.addEventListener("click", async () => {
  const year = Number(yearInput.value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    setStatus(statusEl, "Enter a valid year first.", "error");
    statusEl.classList.add("visible");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusEl, "Building calendar…", "");
  statusEl.classList.add("visible");

  try {
    const [pageW, pageH] = PAGE_SIZES[pageSizeSelect.value];
    const weekStartsMonday = weekStartSelect.value === "monday";
    const highlightWeekends = highlightWeekendsInput.checked;
    const customDates = parseCustomDates(customDatesInput.value);

    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle(`${year} Calendar`);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);

    for (let m = 0; m < 12; m++) {
      setStatus(statusEl, `Drawing ${MONTH_NAMES[m]}…`, "");
      drawMonthPage(doc, font, boldFont, pageW, pageH, year, m, {
        weekStartsMonday, highlightWeekends, customDates,
      });
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, brandFilename("calendar-generator", `${year}-calendar`, "pdf"));
    setStatus(statusEl, `Sorted — created a 12-page ${year} calendar (${formatBytes(blob.size)}).`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", () => {
  yearInput.value = String(new Date().getFullYear());
  weekStartSelect.value = "monday";
  pageSizeSelect.value = "a4";
  highlightWeekendsInput.checked = true;
  customDatesInput.value = "";
  clearStatus(statusEl);
});
