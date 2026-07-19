/**
 * Privacy hardening + i18n parity checks (aitj-z8q.19).
 * Run: npm run test:privacy
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I18N_DIR = path.join(__dirname, "..", "public", "i18n");
const LANGS = ["en", "ru", "de", "fr", "es"];

describe("i18n key parity (5 languages)", () => {
  it("all locales share the same key set as en", () => {
    const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, "en.json"), "utf8"));
    const enKeys = Object.keys(en).sort();
    assert.ok(enKeys.length >= 157, `expected >=157 en keys, got ${enKeys.length}`);
    for (const lang of LANGS) {
      const data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), "utf8"));
      const keys = Object.keys(data).sort();
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      assert.deepEqual(missing, [], `${lang} missing keys: ${missing.join(",")}`);
      assert.deepEqual(extra, [], `${lang} extra keys: ${extra.join(",")}`);
    }
  });

  it("admin moderation keys are non-empty in every locale", () => {
    const required = [
      "ctaAuth",
      "adminToken",
      "approve",
      "reject",
      "sanctionsTitle",
      "skipToContent",
      "privacyExport"
    ];
    for (const lang of LANGS) {
      const data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), "utf8"));
      for (const k of required) {
        assert.equal(typeof data[k], "string", `${lang}.${k}`);
        assert.ok(data[k].trim().length > 0, `${lang}.${k} empty`);
      }
    }
  });
});

describe("a11y skip-link markup", () => {
  it("index and primary pages include skip-link targeting main-content", () => {
    const pages = ["index.html", "story.html", "forum.html", "research.html"];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(__dirname, "..", "public", page), "utf8");
      assert.match(html, /class="skip-link"/, page);
      assert.match(html, /href="#main-content"/, page);
      assert.match(html, /id="main-content"/, page);
    }
  });

  it("styles define focus-visible and skip-link", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
    assert.match(css, /:focus-visible/);
    assert.match(css, /\.skip-link/);
  });
});

describe("migration 015 present", () => {
  it("loads analytics_events migration", () => {
    const { loadMigrations } = require("../lib/migrate");
    const m = loadMigrations().find((x) => x.version === "015");
    assert.ok(m);
    assert.equal(m.name, "analytics_events");
  });
});
