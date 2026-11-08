import { describe, expect, it } from "vitest";
import { contentTypeFor } from "../src/content-type.ts";

describe("contentTypeFor", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["index.htm", "text/html; charset=utf-8"],
    ["site.css", "text/css; charset=utf-8"],
    ["app.js", "text/javascript; charset=utf-8"],
    ["app.mjs", "text/javascript; charset=utf-8"],
    ["data.json", "application/json; charset=utf-8"],
    ["notes.txt", "text/plain; charset=utf-8"],
    ["logo.svg", "image/svg+xml; charset=utf-8"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
    ["a.avif", "image/avif"],
    ["favicon.ico", "image/x-icon"],
    ["report.pdf", "application/pdf"],
    ["font.woff2", "font/woff2"],
    ["demo.mp4", "video/mp4"],
    ["demo.webm", "video/webm"],
    ["demo.mov", "video/quicktime"],
    ["song.mp3", "audio/mpeg"],
    ["song.m4a", "audio/mp4"],
    ["song.wav", "audio/wav"],
    ["PHOTO.JPG", "image/jpeg"],
    ["Page.Html", "text/html; charset=utf-8"],
  ])("maps %s to %s", (filename, contentType) => {
    expect(contentTypeFor(filename)).toBe(contentType);
  });

  it.each(["noext", "trailing.", "x.exe", "x.toString", "x.constructor", "x.html.bak"])(
    "returns undefined for %s",
    (filename) => {
      expect(contentTypeFor(filename)).toBeUndefined();
    },
  );
});
