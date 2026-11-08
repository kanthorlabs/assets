import { describe, expect, it } from "vitest";
import { isValidAssetPath } from "../src/validate.ts";

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
