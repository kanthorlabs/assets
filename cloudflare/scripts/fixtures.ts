import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { marked } from "marked";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const FIXTURE_FILES = ["readme.html", "readme.pdf", "readme.txt"] as const;

const README = new URL("../../README.md", import.meta.url).pathname;
const FIXTURES = new URL("../e2e-fixtures/", import.meta.url).pathname;
const TITLE = "Assets README";
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
const PAGE = { width: 612, height: 792, margin: 54 };
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;
const LINE_CHARS = Math.floor((PAGE.width - 2 * PAGE.margin) / (0.6 * FONT_SIZE));

function renderHtml(markdown: string): string {
  const body = marked.parse(markdown, { async: false });
  return `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${TITLE}</title></head>\n<body>\n${body}</body>\n</html>\n`;
}

function wrap(line: string): string[] {
  if (line.length <= LINE_CHARS) return [line];
  const parts: string[] = [];
  for (let start = 0; start < line.length; start += LINE_CHARS) {
    parts.push(line.slice(start, start + LINE_CHARS));
  }
  return parts;
}

async function renderPdf(markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(TITLE);
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const font = await pdf.embedFont(StandardFonts.Courier);
  const lines = markdown.replace(/\n$/, "").split("\n").flatMap(wrap);
  const perPage = Math.floor((PAGE.height - 2 * PAGE.margin) / LINE_HEIGHT);
  for (let first = 0; first < lines.length; first += perPage) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    lines.slice(first, first + perPage).forEach((line, index) => {
      page.drawText(line, {
        x: PAGE.margin,
        y: PAGE.height - PAGE.margin - FONT_SIZE - index * LINE_HEIGHT,
        size: FONT_SIZE,
        font,
      });
    });
  }
  return pdf.save();
}

export async function writeFixtures(readmePath: string, outDir: string): Promise<void> {
  const bytes = await readFile(readmePath);
  const markdown = bytes.toString("utf8");
  await writeFile(join(outDir, "readme.html"), renderHtml(markdown));
  await writeFile(join(outDir, "readme.pdf"), await renderPdf(markdown));
  await writeFile(join(outDir, "readme.txt"), bytes);
}

if (import.meta.main) {
  await writeFixtures(README, FIXTURES);
  console.log(`Wrote ${FIXTURE_FILES.join(", ")} to e2e-fixtures/.`);
}
