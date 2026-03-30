import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyTranslationsFromCsv,
  autoFillMissingLocaleFromLocale,
  exportTranslatableKeysToCsvDetailed,
  parseCsv,
  parseTranslationsCsv,
  readCatalog,
  type XCStringCatalog,
} from "../src/index.ts";

function withTempDir<T>(run: (tempDir: string) => T): T {
  const tempDir = mkdtempSync(path.join(tmpdir(), "xcstrings-translate-test-"));
  try {
    return run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeCatalogFile(tempDir: string, catalog: XCStringCatalog): string {
  const catalogPath = path.join(tempDir, "Localizable.xcstrings");
  writeFileSync(catalogPath, JSON.stringify(catalog), "utf8");
  return catalogPath;
}

describe("CSV parser", () => {
  it("parses quoted fields with commas/newlines and escaped quotes", () => {
    const csv = `key,comment\n"a","line 1\nline 2"\n"b","he said ""hi"""\n`;
    const rows = parseCsv(csv);

    expect(rows).toEqual([
      ["key", "comment"],
      ["a", "line 1\nline 2"],
      ["b", "he said \"hi\""],
    ]);
  });

  it("throws on unterminated quote", () => {
    expect(() => parseCsv('key,comment\n"a","missing end\n')).toThrow(
      "CSV has an unterminated quoted field.",
    );
  });

  it("parses translation CSV headers and rows", () => {
    const rows = parseCsv("key,fr\nhello,bonjour\n\nbye,au revoir\n");
    const parsed = parseTranslationsCsv(rows);

    expect(parsed).toEqual([
      { key: "hello", locale: "fr", value: "bonjour" },
      { key: "bye", locale: "fr", value: "au revoir" },
    ]);
  });
});

describe("catalog export/import", () => {
  it("exports missing rows with regex + chunking", () => {
    withTempDir((tempDir) => {
      const catalogPath = writeCatalogFile(tempDir, {
        strings: {
          "checkout.title": {
            comment: "Checkout title",
            localizations: {
              en: { stringUnit: { state: "translated", value: "Checkout" } },
            },
          },
          "checkout.subtitle": {
            comment: "Subtitle",
            localizations: {
              en: { stringUnit: { state: "translated", value: "Pay now" } },
              fr: { stringUnit: { state: "translated", value: "Payer" } },
            },
          },
          "profile.name": {
            comment: "Name",
            localizations: {
              en: { stringUnit: { state: "translated", value: "Name" } },
            },
          },
          "checkout.hidden": {
            shouldTranslate: false,
            localizations: {
              en: { stringUnit: { state: "translated", value: "Hidden" } },
            },
          },
        },
      });

      const outCsvPath = path.join(tempDir, "keys.csv");
      const result = exportTranslatableKeysToCsvDetailed({
        xcstringsPath: catalogPath,
        outCsvPath,
        onlyMissingLocale: "fr",
        keyRegex: /^checkout\./,
        chunkFiles: 2,
      });

      expect(result.count).toBe(1);
      expect(result.writtenCsvPaths.length).toBe(2);

      const chunk1 = readFileSync(result.writtenCsvPaths[0]!, "utf8");
      const chunk2 = readFileSync(result.writtenCsvPaths[1]!, "utf8");
      expect(chunk1.startsWith("key,comment\n")).toBeTrue();
      expect(chunk1.includes("checkout.title")).toBeTrue();
      expect(chunk2).toBe("key,comment\n\n");
    });
  });

  it("imports translations with only-if-missing and warning/missing tracking", () => {
    withTempDir((tempDir) => {
      const catalogPath = writeCatalogFile(tempDir, {
        strings: {
          welcome: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Welcome" } },
            },
          },
          existing: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Existing" } },
              fr: { stringUnit: { state: "translated", value: "Existant" } },
            },
          },
          hidden: {
            shouldTranslate: false,
            localizations: {
              en: { stringUnit: { state: "translated", value: "Hidden" } },
            },
          },
          percent: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Percent" } },
            },
          },
        },
      });

      const csvPath = path.join(tempDir, "fr.csv");
      writeFileSync(
        csvPath,
        [
          "key,fr",
          "welcome,Salut",
          "existing,Nouveau",
          "hidden,Ne pas toucher",
          "percent,50％@",
          "unknown,??",
        ].join("\n"),
        "utf8",
      );

      const result = applyTranslationsFromCsv({
        xcstringsPath: catalogPath,
        translationsCsvPath: csvPath,
        onlyIfMissingForTargetLocale: true,
      });

      expect(result.updated).toBe(2);
      expect(result.skippedAlreadyTranslated).toEqual(["existing"]);
      expect(result.skippedMissingKey).toEqual(["unknown"]);
      expect(result.warnings.length).toBe(1);

      const updatedCatalog = readCatalog(catalogPath);
      expect(updatedCatalog.strings.welcome?.localizations?.fr?.stringUnit.value).toBe("Salut");
      expect(updatedCatalog.strings.existing?.localizations?.fr?.stringUnit.value).toBe("Existant");
      expect(updatedCatalog.strings.percent?.localizations?.fr?.stringUnit.value).toBe("50%@");
    });
  });

  it("auto-fills from source locale and tracks skip reasons", () => {
    withTempDir((tempDir) => {
      const catalogPath = writeCatalogFile(tempDir, {
        strings: {
          fill_me: {
            localizations: {
              "zh-Hant": { stringUnit: { state: "translated", value: "繁體" } },
            },
          },
          already_done: {
            localizations: {
              "zh-Hant": { stringUnit: { state: "translated", value: "已完成" } },
              "zh-Hans": { stringUnit: { state: "translated", value: "已完成" } },
            },
          },
          no_source: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "No source" } },
            },
          },
          hidden: {
            shouldTranslate: false,
            localizations: {
              "zh-Hant": { stringUnit: { state: "translated", value: "隱藏" } },
            },
          },
        },
      });

      const result = autoFillMissingLocaleFromLocale({
        xcstringsPath: catalogPath,
        sourceLocale: "zh-Hant",
        targetLocale: "zh-Hans",
        transform: (value) => `${value}-simp`,
      });

      expect(result).toEqual({
        updated: 1,
        skippedMissingSource: 1,
        skippedAlreadyTranslated: 1,
        skippedNotTranslatable: 1,
      });

      const updatedCatalog = readCatalog(catalogPath);
      expect(updatedCatalog.strings.fill_me?.localizations?.["zh-Hans"]?.stringUnit.value).toBe(
        "繁體-simp",
      );
    });
  });
});
