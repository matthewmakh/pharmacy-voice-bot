/**
 * PDF generation service.
 *
 * Two strategies:
 *   fillCIVSC70()  — builds the official NYC Commercial Claims (CIV-SC-70) form
 *                    from scratch using pdf-lib, faithfully replicating the layout.
 *                    No external download required.
 *
 *   htmlToPDF()    — converts Claude-generated HTML to a CPLR-compliant PDF
 *                    (8.5×11, 1-inch margins, 12pt Times New Roman, double-spaced)
 *                    using Puppeteer + @sparticuz/chromium-min.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import puppeteer from 'puppeteer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CIVFormData {
  /** Claimant (plaintiff) */
  claimantName?: string | null;
  claimantBusiness?: string | null;
  claimantAddress?: string | null;
  claimantPhone?: string | null;

  /** Defendant (debtor) */
  debtorName?: string | null;
  debtorBusiness?: string | null;
  debtorAddress?: string | null;
  debtorPhone?: string | null;

  /** Claim */
  amountClaimed?: string | null;      // e.g. "4,500.00"
  serviceDescription?: string | null;
  invoiceNumber?: string | null;
  agreementDate?: string | null;       // ISO date or display string
  invoiceDate?: string | null;

  /** Court routing */
  county?: string | null;              // "New York", "Kings", "Queens", "Bronx", "Richmond"
}

// ─── Helper: draw a labeled field box ────────────────────────────────────────

function drawField(
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number = 28,
) {
  const { r, g, b } = { r: 0, g: 0, b: 0 };

  // Box outline
  page.drawRectangle({
    x, y,
    width, height,
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
  });

  // Label (tiny, inside top-left corner)
  page.drawText(label, {
    x: x + 3,
    y: y + height - 9,
    size: 6,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  // Value
  if (value) {
    page.drawText(truncate(value, width, 9, font), {
      x: x + 4,
      y: y + 7,
      size: 9,
      font: boldFont,
      color: rgb(r, g, b),
    });
  }
}

/** Truncate text to fit within a given pixel width */
function truncate(text: string, maxWidth: number, fontSize: number, font: PDFFont): string {
  const ellipsis = '…';
  let out = text;
  while (out.length > 1) {
    const w = font.widthOfTextAtSize(out, fontSize);
    if (w <= maxWidth - 8) return out;
    out = out.slice(0, -1);
  }
  return ellipsis;
}

function fmt(v: string | null | undefined): string {
  return v?.trim() ?? '';
}

// ─── fillCIVSC70 ─────────────────────────────────────────────────────────────

/**
 * Builds a NYC Commercial Claims (CIV-SC-70) filing form as a PDF.
 * The layout faithfully replicates the official form's sections and field order.
 */
export async function fillCIVSC70(data: CIVFormData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold     = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic   = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const { width, height } = page.getSize();
  const m = 40; // margin

  let y = height - m;

  // ── Header ──────────────────────────────────────────────────────────────────

  // Court seal placeholder
  page.drawRectangle({ x: m, y: y - 50, width: 60, height: 60, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  page.drawText('COURT', { x: m + 10, y: y - 20, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawText('SEAL', { x: m + 14, y: y - 32, size: 7, font, color: rgb(0.5, 0.5, 0.5) });

  // Title block (centered)
  page.drawText('THE CIVIL COURT OF THE CITY OF NEW YORK', {
    x: m + 65,
    y: y - 12,
    size: 11,
    font: bold,
    color: rgb(0, 0, 0),
  });
  page.drawText('COMMERCIAL CLAIMS PART', {
    x: m + 65,
    y: y - 26,
    size: 10,
    font: bold,
    color: rgb(0, 0, 0),
  });
  page.drawText('NOTICE OF CLAIM — CIV-SC-70', {
    x: m + 65,
    y: y - 40,
    size: 9,
    font: italic,
    color: rgb(0.2, 0.2, 0.2),
  });

  // Form number top-right
  page.drawText('CIV-SC-70 (Rev. 1/22)', {
    x: width - m - 110,
    y: height - m,
    size: 7,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  y -= 65;

  // ── County row ──────────────────────────────────────────────────────────────

  page.drawText('COUNTY OF:', { x: m, y, size: 8, font: bold, color: rgb(0, 0, 0) });
  const counties = ['New York', 'Kings', 'Queens', 'Bronx', 'Richmond'];
  let cx = m + 80;
  for (const county of counties) {
    const isSelected = (data.county ?? 'New York') === county;
    page.drawRectangle({ x: cx, y: y - 3, width: 10, height: 10, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.8, color: isSelected ? rgb(0, 0, 0) : rgb(1, 1, 1) });
    if (isSelected) {
      page.drawText('✓', { x: cx + 1, y: y - 1, size: 9, font: bold, color: rgb(1, 1, 1) });
    }
    page.drawText(county, { x: cx + 14, y, size: 8, font, color: rgb(0, 0, 0) });
    cx += county.length * 5.5 + 22;
  }

  y -= 22;
  page.drawLine({ start: { x: m, y }, end: { x: width - m, y }, thickness: 1, color: rgb(0, 0, 0) });
  y -= 16;

  // ── Section label helper ─────────────────────────────────────────────────────
  function sectionLabel(text: string) {
    page.drawRectangle({ x: m, y: y - 2, width: width - 2 * m, height: 14, color: rgb(0.88, 0.88, 0.88) });
    page.drawText(text, { x: m + 4, y: y + 1, size: 8, font: bold, color: rgb(0, 0, 0) });
    y -= 18;
  }

  // ── Claimant (plaintiff) section ─────────────────────────────────────────────

  sectionLabel('CLAIMANT (Plaintiff — the party suing):');

  const colW = (width - 2 * m - 8) / 2;

  drawField(page, font, bold, 'Name of Individual', fmt(data.claimantName), m, y - 28, colW);
  drawField(page, font, bold, 'Business Name (if applicable)', fmt(data.claimantBusiness), m + colW + 8, y - 28, colW);
  y -= 38;

  drawField(page, font, bold, 'Address (Street, City, State, ZIP)', fmt(data.claimantAddress), m, y - 28, colW + colW / 2);
  drawField(page, font, bold, 'Phone', fmt(data.claimantPhone), m + colW + colW / 2 + 8, y - 28, colW / 2 - 8);
  y -= 44;

  // ── Defendant (debtor) section ───────────────────────────────────────────────

  sectionLabel('DEFENDANT (the party being sued):');

  drawField(page, font, bold, 'Name of Individual / Authorized Officer', fmt(data.debtorName), m, y - 28, colW);
  drawField(page, font, bold, 'Business Name', fmt(data.debtorBusiness), m + colW + 8, y - 28, colW);
  y -= 38;

  drawField(page, font, bold, 'Address where service should be made (Street, City, State, ZIP)', fmt(data.debtorAddress), m, y - 28, colW + colW / 2);
  drawField(page, font, bold, 'Phone', fmt(data.debtorPhone), m + colW + colW / 2 + 8, y - 28, colW / 2 - 8);
  y -= 44;

  // ── Claim details section ────────────────────────────────────────────────────

  sectionLabel('CLAIM DETAILS:');

  // Amount
  page.drawText('Amount Claimed: $', { x: m, y: y - 14, size: 9, font, color: rgb(0, 0, 0) });
  const amtX = m + 105;
  page.drawRectangle({ x: amtX, y: y - 20, width: 110, height: 20, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5, color: rgb(1, 1, 1) });
  if (data.amountClaimed) {
    page.drawText(data.amountClaimed, { x: amtX + 4, y: y - 15, size: 11, font: bold, color: rgb(0, 0, 0) });
  }

  // Note about limit
  page.drawText('(Maximum: $10,000 for commercial claims)', {
    x: amtX + 118, y: y - 14, size: 7.5, font: italic, color: rgb(0.4, 0.4, 0.4),
  });
  y -= 32;

  // Description
  const descLabel = 'Nature of Claim / Basis for Amount (what goods or services were provided and not paid for):';
  page.drawText(descLabel, { x: m, y, size: 8, font, color: rgb(0, 0, 0) });
  y -= 14;

  // Description box (taller)
  const descH = 54;
  page.drawRectangle({ x: m, y: y - descH, width: width - 2 * m, height: descH, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5, color: rgb(1, 1, 1) });
  if (data.serviceDescription) {
    // Word-wrap description into up to 3 lines
    const lines = wrapText(data.serviceDescription, width - 2 * m - 10, 9, font);
    lines.slice(0, 3).forEach((line, i) => {
      page.drawText(line, { x: m + 5, y: y - 14 - i * 16, size: 9, font: bold, color: rgb(0, 0, 0) });
    });
  }
  y -= descH + 12;

  // Invoice / date row
  const f3 = (width - 2 * m - 16) / 3;
  drawField(page, font, bold, 'Invoice / Reference Number', fmt(data.invoiceNumber), m, y - 28, f3);
  drawField(page, font, bold, 'Agreement / Service Date', fmt(data.agreementDate), m + f3 + 8, y - 28, f3);
  drawField(page, font, bold, 'Invoice Date', fmt(data.invoiceDate), m + 2 * (f3 + 8), y - 28, f3);
  y -= 44;

  // ── Statement and signature section ──────────────────────────────────────────

  sectionLabel('STATEMENT & CERTIFICATION:');

  const statText =
    'I certify that the above-named claimant has a just claim against the above-named defendant in the amount stated above, ' +
    'that there is no other action pending in any court on this claim, and that the information provided is true to the best ' +
    'of my knowledge. I understand that commercial claims may be heard by a court-designated arbitrator whose decision, ' +
    'if accepted, will be final and binding.';

  const stLines = wrapText(statText, width - 2 * m - 10, 8, font);
  stLines.forEach((line, i) => {
    page.drawText(line, { x: m + 5, y: y - 10 - i * 12, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
  });
  y -= stLines.length * 12 + 18;

  // Signature / date row
  const sigW = (width - 2 * m - 8) * 0.6;
  const dateW = (width - 2 * m - 8) * 0.38;
  drawField(page, font, bold, 'Signature of Claimant or Authorized Officer', '', m, y - 34, sigW, 34);
  drawField(page, font, bold, 'Date', fmt(new Date().toLocaleDateString('en-US')), m + sigW + 8, y - 34, dateW, 34);
  y -= 48;

  page.drawText('Print Name: ___________________________________   Title: _______________________', {
    x: m, y, size: 8, font, color: rgb(0, 0, 0),
  });
  y -= 20;

  // ── For court use ────────────────────────────────────────────────────────────

  page.drawLine({ start: { x: m, y }, end: { x: width - m, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  y -= 14;
  page.drawText('FOR COURT USE ONLY', { x: m, y, size: 7.5, font: bold, color: rgb(0.5, 0.5, 0.5) });
  y -= 14;

  const f4 = (width - 2 * m - 24) / 4;
  for (const [i, label] of ['Index Number', 'Calendar Number', 'Hearing Date', 'Courtroom'].entries()) {
    drawField(page, font, bold, label, '', m + i * (f4 + 8), y - 26, f4);
  }
  y -= 40;

  // ── Filing instructions ──────────────────────────────────────────────────────

  page.drawLine({ start: { x: m, y }, end: { x: width - m, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  y -= 14;
  page.drawText('FILING INSTRUCTIONS', { x: m, y, size: 7.5, font: bold, color: rgb(0.3, 0.3, 0.3) });
  y -= 11;

  const instructions = [
    '1. Bring TWO (2) copies of this completed form to the Commercial Claims clerk at the courthouse for your county.',
    '2. Filing fee: $25 for claims up to $1,000; $35 for claims over $1,000. Payable by money order or credit card.',
    '3. After filing, the clerk will schedule your hearing (typically 30–70 days out) and serve the defendant by mail.',
    '4. Bring all evidence to your hearing: invoices, contracts, emails, photos, and any other supporting documents.',
  ];
  for (const inst of instructions) {
    const iLines = wrapText(inst, width - 2 * m - 10, 7.5, font);
    iLines.forEach((line) => {
      page.drawText(line, { x: m + 5, y, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 11;
    });
  }

  // ── Footer ───────────────────────────────────────────────────────────────────

  page.drawText(
    'NYC Civil Court — Commercial Claims Part  |  nycourts.gov  |  (646) 386-5710',
    { x: m, y: 20, size: 7, font, color: rgb(0.5, 0.5, 0.5) },
  );
  page.drawText(
    `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    { x: width - m - 130, y: 20, size: 7, font, color: rgb(0.5, 0.5, 0.5) },
  );

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── htmlToPDF ────────────────────────────────────────────────────────────────

/**
 * Converts Claude-generated HTML to a CPLR-compliant PDF.
 * Uses Puppeteer's bundled Chromium with container-safe launch flags.
 */
export async function htmlToPDF(html: string): Promise<Buffer> {
  const wrapped = wrapWithPrintCSS(html);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // Critical: prevents Chrome crash in containers with small /dev/shm
      '--disable-gpu',
      '--disable-extensions',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(wrapped, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function wrapWithPrintCSS(html: string): string {
  // If the content is already a full HTML document, inject print styles into <head>
  if (/<html/i.test(html)) {
    return html.replace(
      /<\/head>/i,
      `<style>${PRINT_CSS}</style></head>`,
    );
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html}</body></html>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 2;
    color: #000;
    margin: 0;
    padding: 0;
  }
  @page {
    size: letter;
    margin: 1in;
  }
  p { margin: 0 0 0.5em; }
  h1, h2, h3 { font-family: 'Times New Roman', Times, serif; }
  .no-print { display: none !important; }
  a { color: #000; text-decoration: none; }
`;

// ─── Utility: word-wrap ───────────────────────────────────────────────────────

function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
