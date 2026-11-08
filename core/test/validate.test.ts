import { describe, expect, it } from "vitest";
import { isValidAssetPath, isValidForwardPath } from "../src/validate.ts";

describe("isValidAssetPath", () => {
  it.each([
    "index.html",
    "img/Logo.SVG",
    "v1.2/app_main-3.js",
    "a/b/c/d/e/f/g/h.css",
    `${"x".repeat(995)}.html`,
  ])("accepts %s", (path) => {
    expect(isValidAssetPath(path)).toBe(true);
  });

  it.each([
    ["empty path", ""],
    ["parent segment", "../f/x.pdf"],
    ["inner parent segment", "img/../x.html"],
    ["current segment", "./x.html"],
    ["encoded dots", "%2e%2e/x.html"],
    ["encoded slash", "x%2Fy.html"],
    ["percent sign", "x%00.html"],
    ["empty segment", "img//x.html"],
    ["leading slash", "/x.html"],
    ["backslash", "img\\x.html"],
    ["dotfile", ".env"],
    ["dotfile with extension", "img/.hidden.html"],
    ["space", "a b.html"],
    ["control character", "x\n.html"],
    ["non-ASCII", "café.html"],
    ["nine segments", "a/b/c/d/e/f/g/h/i.css"],
    ["overlong path", `${"x".repeat(996)}.html`],
  ])("rejects %s", (_name, path) => {
    expect(isValidAssetPath(path)).toBe(false);
  });
});

describe("isValidForwardPath", () => {
  const ID = "7d444840-9dc0-41dc-9b52-0b2a3f3b1e4a";

  it.each([
    `${ID}/report.pdf`,
    `${ID}/Demo_Clip-2.MP4`,
    `${ID}/README`,
    "00000000-0000-4000-8000-000000000000/a",
  ])("accepts %s", (path) => {
    expect(isValidForwardPath(path)).toBe(true);
  });

  it.each([
    ["id only", ID],
    ["empty basename", `${ID}/`],
    ["three segments", `${ID}/x/report.pdf`],
    ["uppercase id", `${ID.toUpperCase()}/report.pdf`],
    ["UUIDv1", "7d444840-9dc0-11dc-9b52-0b2a3f3b1e4a/report.pdf"],
    ["wrong variant", "7d444840-9dc0-41dc-7b52-0b2a3f3b1e4a/report.pdf"],
    ["id without hyphens", "7d4448409dc041dc9b520b2a3f3b1e4a/report.pdf"],
    ["braced id", `{${ID}}/report.pdf`],
    ["short id", "7d444840-9dc0-41dc-9b52-0b2a3f3b1e4/report.pdf"],
    ["dotfile basename", `${ID}/.env`],
    ["parent basename", `${ID}/..`],
    ["encoded basename", `${ID}/a%20b.pdf`],
    ["backslash basename", `${ID}/a\\b.pdf`],
    ["non-ASCII basename", `${ID}/café.pdf`],
  ])("rejects %s", (_name, path) => {
    expect(isValidForwardPath(path)).toBe(false);
  });
});
