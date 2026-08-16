/**
 * Report exports, written for the program that actually opens these files: Excel on Windows.
 *
 * <p>Two copies of a hand-rolled CSV serialiser had drifted into the app (the Reports screen
 * and the quotation price comparison), and both shared the same four defects. They are
 * collected here so there is one place to be right.
 *
 * <p><b>Prefer {@link downloadXlsx}.</b> A correct CSV is still only a text file: Windows
 * hides the extension, so whichever editor claimed `.csv` opens it, and on a developer's
 * machine that is usually a code editor rather than Excel. A real workbook opens in a
 * spreadsheet because of what it is, carries genuinely typed numeric cells, and has no
 * encoding question at all. CSV stays for anything that has to be fed to another system.
 */

/** What a cell may hold. A JS number becomes a numeric cell; everything else stays text. */
export type CellValue = string | number | null | undefined;

/**
 * One field, per RFC 4180: quoted only when it has to be, with any embedded quote doubled.
 *
 * <p><b>Why not just quote everything.</b> Wrapping every field in quotes — which is what
 * both previous versions did — makes Excel import the entire sheet as text. Quantities,
 * rupee amounts and margins arrive left-aligned with a green warning triangle, and summing a
 * column returns 0. The first thing anyone does with a GST or profit export is total it, so
 * the file was arriving unusable even though it looked correct in a text editor.
 *
 * <p><b>Why the doubling matters.</b> A single {@code "} inside an unescaped field closes it
 * early and shifts every remaining column of that row across by one. That does not look like
 * corruption when opened — it looks like data, which is worse.
 */
export function csvField(value: CellValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Leading/trailing spaces are quoted too, or a reader is free to trim them away.
  return /[",\r\n]/.test(text) || text !== text.trim()
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/** Serialise rows to RFC 4180 text, CRLF-terminated. Exported for tests. */
export function toCsv(rows: CellValue[][]): string {
  return rows.map(row => row.map(csvField).join(",")).join("\r\n");
}

/**
 * Build a CSV and hand it to the browser as a download.
 *
 * <p>The leading U+FEFF is not decoration. Excel on Windows opens a UTF-8 file with no byte
 * order mark using the system ANSI codepage, so every non-ASCII character arrives as
 * mojibake — "Surplus (₹)" came out as "Surplus (â¹)", and the quotation comparison mangled
 * its ₹, ★ and — alike. Any customer or medicine name that is not plain Latin went the same
 * way.
 */
export function downloadCsv(filename: string, rows: CellValue[][]) {
  downloadBlob(filename, new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" }));
}

/**
 * Column widths sized to the longest cell in each column, so nothing opens as `####`.
 *
 * <p>Excel's default width truncates almost every medicine name and turns any currency
 * column wide enough to matter into hashes, which reads as a broken file rather than a
 * narrow column. Capped so one long note cannot push a column off the screen.
 */
function columnWidths(rows: CellValue[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      widths[i] = Math.max(widths[i] ?? 0, len);
    });
  }
  return widths.map(w => ({ wch: Math.min(Math.max(w + 2, 8), 42) }));
}

/**
 * Write a real `.xlsx` workbook and hand it to the browser.
 *
 * <p>This is the export a pharmacist should get. It opens in Excel because of its file type
 * rather than because of a filename association — the CSV was arriving correct and still
 * opening in a code editor, because Windows hides the extension and `.csv` belongs to
 * whatever claimed it. Numeric cells are genuinely numeric, so a column totals without
 * anyone re-typing it, and there is no byte-order-mark question because the format is
 * zip+XML and always UTF-8.
 *
 * <p>The library is imported lazily. It is ~500 KB, it is already a dependency (three import
 * screens read uploads with it), and nobody should pay for it on first paint just because
 * a report screen has an export button.
 */
export async function downloadXlsx(filename: string, rows: CellValue[][], sheetName = "Report") {
  const XLSX = await import("@e965/xlsx");
  // aoa_to_sheet types each cell from its JS value, so pass real numbers for anything that
  // should be summable and strings for anything that only looks numeric — a phone number
  // written as a number loses any leading zero and can render in scientific notation.
  const sheet = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(cell => cell ?? "")));
  sheet["!cols"] = columnWidths(rows);

  const book = XLSX.utils.book_new();
  // Excel rejects a sheet name over 31 characters or containing []:*?/\ — a caller passing a
  // date range would otherwise produce a workbook that will not open at all.
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[[\]:*?/\\]/g, "-").slice(0, 31));

  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(filename, new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
}

/** The download mechanics both formats share. */
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  // Firefox ignores click() on an anchor that is not in the document, so the previous
  // versions silently downloaded nothing there while working perfectly in Chrome.
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Deferred, not immediate: revoking the object URL in the same tick can cancel a download
  // that has not started reading it yet, which surfaces as a missing or zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
