import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { XcstringsError } from "./errors.ts";
import { stringifyAppleJson } from "./json.ts";
import type { XCStringCatalog } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCatalog(value: unknown): value is XCStringCatalog {
  if (!isRecord(value)) {
    return false;
  }

  return isRecord(value.strings);
}

function normalizeBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readCatalog(filePath: string): XCStringCatalog {
  const resolvedPath = path.resolve(filePath);
  const raw = normalizeBom(readFileSync(resolvedPath, "utf8"));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new XcstringsError("INVALID_CATALOG", `Failed to parse JSON at ${resolvedPath}: ${reason}`);
  }

  if (!isCatalog(parsed)) {
    throw new XcstringsError(
      "INVALID_CATALOG",
      `Catalog at ${resolvedPath} is missing object field "strings".`,
    );
  }

  return parsed;
}

export function writeCatalog(filePath: string, catalog: XCStringCatalog): void {
  const resolvedPath = path.resolve(filePath);
  const normalized = JSON.parse(JSON.stringify(catalog)) as unknown;
  const content = `${stringifyAppleJson(normalized)}\n`;
  writeFileSync(resolvedPath, content, "utf8");
}
