import { XcstringsError } from "./errors.ts";
import type { TranslationRow } from "./types.ts";

function csvEscapeField(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function formatCsvRow(cells: readonly string[]): string {
  return cells.map(csvEscapeField).join(",");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let justClosedQuote = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };

  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
        continue;
      }

      cell += char;
      continue;
    }

    if (char === '"') {
      if (cell.length > 0 || justClosedQuote) {
        throw new XcstringsError(
          "INVALID_CSV",
          "CSV has an invalid quote in an unquoted field.",
        );
      }
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      justClosedQuote = false;
      pushCell();
      continue;
    }

    if (char === "\n") {
      justClosedQuote = false;
      pushCell();
      pushRow();
      continue;
    }

    if (char === "\r") {
      justClosedQuote = false;
      if (text[index + 1] === "\n") {
        index += 1;
      }
      pushCell();
      pushRow();
      continue;
    }

    if (justClosedQuote) {
      throw new XcstringsError(
        "INVALID_CSV",
        "CSV has trailing characters after a quoted field before delimiter.",
      );
    }

    cell += char;
  }

  if (inQuotes) {
    throw new XcstringsError(
      "INVALID_CSV",
      "CSV has an unterminated quoted field.",
    );
  }

  pushCell();
  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

export function parseTranslationsCsv(rows: string[][]): TranslationRow[] {
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0]!.map((cell) => cell.trim());
  if (header.length !== 2) {
    throw new XcstringsError(
      "INVALID_CSV",
      "Translation CSV header must be exactly two columns: key,<locale>.",
    );
  }

  if (header[0]!.toLowerCase() !== "key") {
    throw new XcstringsError(
      "INVALID_CSV",
      'Translation CSV first column must be named "key".',
    );
  }

  const locale = header[1]!;
  if (locale.length === 0) {
    throw new XcstringsError(
      "INVALID_CSV",
      "Translation CSV locale header is empty.",
    );
  }

  const translations: TranslationRow[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    const key = row[0] ?? "";
    const value = row[1] ?? "";

    if (key.length === 0) {
      continue;
    }

    translations.push({
      key,
      locale,
      value,
    });
  }

  return translations;
}
