/**
 * Extracts tabular text from a "digital" PDF — one with real selectable text,
 * not a scanned/photographed image — without any OCR or AI.
 *
 * PDF.js gives every fragment of text its own x/y position. We cluster
 * fragments into visual rows by y-coordinate, order each row left-to-right by
 * x-coordinate, and join with tabs — producing the same tab-separated shape
 * `parseRawRows` already expects from a pasted Excel selection.
 *
 * Supplier invoice PDFs have letterhead/address/invoice-number text above the
 * actual item table, so the first reconstructed line usually isn't the table
 * header. We scan for the first line whose cells look like known column
 * names (medicine/batch/qty/rate/etc.) and discard everything above it.
 *
 * Returns "" when nothing usable is found — e.g. a scanned PDF has no text
 * fragments at all. Callers must treat that as "fall back to manual entry",
 * never as an error.
 */

const Y_TOLERANCE = 3; // px — fragments within this band are treated as one line

const HEADER_HINT_WORDS = [
  "medicine", "drug", "item", "product", "particular", "description",
  "batch", "lot",
  "expiry", "exp",
  "qty", "quantity",
  "rate", "price", "cost",
  "mrp",
  "gst", "tax",
  "free", "bonus",
  "disc",
];

type TextFragment = { x: number; y: number; str: string };

function looksLikeHeaderRow(line: string): boolean {
  const cells = line.toLowerCase().split("\t");
  const hits  = cells.filter((c) => HEADER_HINT_WORDS.some((w) => c.includes(w))).length;
  return hits >= 2;
}

export async function extractPdfTableText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;

  const lines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const frags: TextFragment[] = [];
    for (const it of content.items) {
      const str = (it as { str?: unknown }).str;
      const transform = (it as { transform?: unknown }).transform;
      if (typeof str !== "string" || !Array.isArray(transform) || str.trim().length === 0) continue;
      frags.push({ x: transform[4] as number, y: transform[5] as number, str: str.trim() });
    }

    if (frags.length === 0) continue;

    // Top-to-bottom (PDF y grows upward, so sort descending), then left-to-right.
    frags.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows: TextFragment[][] = [];
    for (const f of frags) {
      const row = rows.find((r) => Math.abs(r[0]!.y - f.y) <= Y_TOLERANCE);
      if (row) row.push(f);
      else rows.push([f]);
    }

    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      lines.push(row.map((f) => f.str).join("\t"));
    }
  }

  if (lines.length === 0) return ""; // scanned PDF — no extractable text at all

  const headerIdx = lines.findIndex(looksLikeHeaderRow);
  if (headerIdx === -1) return ""; // found text, but nothing that looks like an item table

  return lines.slice(headerIdx).join("\n");
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
