import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readCatalog, writeCatalog } from "./catalog.ts";
import { formatCsvRow, parseCsv, parseTranslationsCsv } from "./csv.ts";
import { assertNonEmpty, assertPositiveInteger } from "./errors.ts";
import type {
  ApplyTranslationsOptions,
  ApplyTranslationsResult,
  AutoFillMissingLocaleFromLocaleOptions,
  AutoFillMissingLocaleFromLocaleResult,
  ExportTranslatableOptions,
  ExportTranslatableResult,
  StringEntry,
} from "./types.ts";

function shouldIncludeForExport(entry: StringEntry): boolean {
  return entry.shouldTranslate !== false;
}

function translationValue(
  entry: StringEntry,
  locale: string,
): string | undefined {
  const value = entry.localizations?.[locale]?.stringUnit?.value;
  return typeof value === "string" ? value : undefined;
}

function englishTranslation(entry: StringEntry): string | undefined {
  const english = translationValue(entry, "en");
  if (english == null || english.length === 0) {
    return undefined;
  }

  return english;
}

function chunkedCsvPath(basePath: string, index: number): string {
  const parsed = path.parse(basePath);
  const extension = parsed.ext.length > 0 ? parsed.ext : ".csv";
  return path.join(parsed.dir, `${parsed.name}_${index}${extension}`);
}

function regexMatchesKey(regex: RegExp, key: string): boolean {
  regex.lastIndex = 0;
  return regex.test(key);
}

function normalizeAppliedTranslationValue(value: string): string {
  return value.replace(/％(?=(?:\d+\$)?@)/g, "%");
}

function readCsvFile(csvPath: string): string {
  let csvText = readFileSync(path.resolve(csvPath), "utf8");
  if (csvText.charCodeAt(0) === 0xfeff) {
    csvText = csvText.slice(1);
  }
  return csvText;
}

export function isTranslationMissingForLocale(
  entry: StringEntry,
  locale: string,
): boolean {
  const value = translationValue(entry, locale);
  if (value == null) {
    return true;
  }

  return value.trim() === "";
}

export function buildExportComment(entry: StringEntry): string {
  const parts: string[] = [];

  if (entry.comment != null && entry.comment.trim().length > 0) {
    parts.push(entry.comment);
  }

  const english = englishTranslation(entry);
  if (english != null) {
    parts.push(`English reference: ${JSON.stringify(english)}`);
  }

  return parts.join("\n");
}

export function exportTranslatableKeysToCsvDetailed(
  options: ExportTranslatableOptions,
): ExportTranslatableResult {
  const catalogPath = path.resolve(
    assertNonEmpty(options.xcstringsPath, "xcstringsPath"),
  );
  const outPath = path.resolve(
    assertNonEmpty(options.outCsvPath, "outCsvPath"),
  );
  const onlyMissingLocale = options.onlyMissingLocale?.trim();
  const keyRegex = options.keyRegex;

  const catalog = readCatalog(catalogPath);

  const rows: string[] = [];
  let count = 0;

  for (const [key, entry] of Object.entries(catalog.strings)) {
    if (!shouldIncludeForExport(entry)) {
      continue;
    }

    if (keyRegex != null && !regexMatchesKey(keyRegex, key)) {
      continue;
    }

    if (onlyMissingLocale != null && onlyMissingLocale.length > 0) {
      if (!isTranslationMissingForLocale(entry, onlyMissingLocale)) {
        continue;
      }
    }

    rows.push(formatCsvRow([key, buildExportComment(entry)]));
    count += 1;
  }

  if (options.chunkSize == null) {
    if (rows.length === 0) {
      return {
        count,
        writtenCsvPaths: [],
      };
    }

    writeFileSync(outPath, `key,comment\n${rows.join("\n")}\n`, "utf8");
    return {
      count,
      writtenCsvPaths: [outPath],
    };
  }

  if (rows.length === 0) {
    return {
      count,
      writtenCsvPaths: [],
    };
  }

  const chunkSize = assertPositiveInteger(options.chunkSize, "chunkSize");
  const chunkFiles = Math.ceil(rows.length / chunkSize);

  const writtenCsvPaths: string[] = [];

  for (let index = 0; index < chunkFiles; index += 1) {
    const offset = index * chunkSize;
    const outChunkPath = chunkedCsvPath(outPath, index + 1);
    const chunkRows = rows.slice(offset, offset + chunkSize);
    writeFileSync(
      outChunkPath,
      `key,comment\n${chunkRows.join("\n")}\n`,
      "utf8",
    );
    writtenCsvPaths.push(outChunkPath);
  }

  return {
    count,
    writtenCsvPaths,
  };
}

export function exportTranslatableKeysToCsv(
  options: ExportTranslatableOptions,
): number {
  return exportTranslatableKeysToCsvDetailed(options).count;
}

export function parseTranslationsCsvText(csvText: string) {
  return parseTranslationsCsv(parseCsv(csvText));
}

export function applyTranslationsFromCsv(
  options: ApplyTranslationsOptions,
): ApplyTranslationsResult {
  const catalogPath = path.resolve(
    assertNonEmpty(options.xcstringsPath, "xcstringsPath"),
  );
  const translationsCsvPath = path.resolve(
    assertNonEmpty(options.translationsCsvPath, "translationsCsvPath"),
  );
  const outCatalogPath = path.resolve(options.outXcstringsPath ?? catalogPath);

  const catalog = readCatalog(catalogPath);
  const translationRows = parseTranslationsCsvText(
    readCsvFile(translationsCsvPath),
  );

  const skippedMissingKey: string[] = [];
  const skippedAlreadyTranslated: string[] = [];
  const warnings: string[] = [];
  let updated = 0;

  for (const row of translationRows) {
    const entry = catalog.strings[row.key];
    if (entry == null) {
      if (options.strictKeys) {
        throw new Error(`Unknown key in CSV: ${JSON.stringify(row.key)}`);
      }

      skippedMissingKey.push(row.key);
      continue;
    }

    if (!shouldIncludeForExport(entry)) {
      warnings.push(
        `Skipped key with shouldTranslate=false: ${JSON.stringify(row.key)}`,
      );
      continue;
    }

    if (
      options.onlyIfMissingForTargetLocale &&
      !isTranslationMissingForLocale(entry, row.locale)
    ) {
      skippedAlreadyTranslated.push(row.key);
      continue;
    }

    const normalizedValue = normalizeAppliedTranslationValue(row.value);
    if (entry.localizations == null) {
      entry.localizations = {};
    }

    entry.localizations[row.locale] = {
      stringUnit: {
        state: "translated",
        value: normalizedValue,
      },
    };

    updated += 1;
  }

  writeCatalog(outCatalogPath, catalog);

  return {
    updated,
    skippedMissingKey,
    skippedAlreadyTranslated,
    warnings,
  };
}

export function autoFillMissingLocaleFromLocale(
  options: AutoFillMissingLocaleFromLocaleOptions,
): AutoFillMissingLocaleFromLocaleResult {
  const catalogPath = path.resolve(
    assertNonEmpty(options.xcstringsPath, "xcstringsPath"),
  );
  const outCatalogPath = path.resolve(options.outXcstringsPath ?? catalogPath);
  const sourceLocale = assertNonEmpty(options.sourceLocale, "sourceLocale");
  const targetLocale = assertNonEmpty(options.targetLocale, "targetLocale");

  if (sourceLocale === targetLocale) {
    throw new Error("sourceLocale and targetLocale must be different.");
  }

  const catalog = readCatalog(catalogPath);

  let updated = 0;
  let skippedMissingSource = 0;
  let skippedAlreadyTranslated = 0;
  let skippedNotTranslatable = 0;

  for (const entry of Object.values(catalog.strings)) {
    if (!shouldIncludeForExport(entry)) {
      skippedNotTranslatable += 1;
      continue;
    }

    const sourceValue = translationValue(entry, sourceLocale);
    if (sourceValue == null || sourceValue.trim().length === 0) {
      skippedMissingSource += 1;
      continue;
    }

    if (!isTranslationMissingForLocale(entry, targetLocale)) {
      skippedAlreadyTranslated += 1;
      continue;
    }

    if (entry.localizations == null) {
      entry.localizations = {};
    }

    entry.localizations[targetLocale] = {
      stringUnit: {
        state: "translated",
        value: options.transform(sourceValue),
      },
    };

    updated += 1;
  }

  writeCatalog(outCatalogPath, catalog);

  return {
    updated,
    skippedMissingSource,
    skippedAlreadyTranslated,
    skippedNotTranslatable,
  };
}
