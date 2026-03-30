#!/usr/bin/env bun

import * as OpenCC from "opencc-js";
import { autoFillMissingLocaleFromLocale } from "./core/index.ts";
import { XcstringsError } from "./core/errors.ts";
import { getOptionValue, getRequiredOptionValue, parseStandaloneArgs } from "./cli/args.ts";
import { printZhHansHelp } from "./cli/help.ts";

const OPENCC_FROM_VALUES = ["hk", "tw", "twp", "jp"] as const;
const OPENCC_TO_VALUES = ["cn"] as const;

type OpenCCFrom = (typeof OPENCC_FROM_VALUES)[number];
type OpenCCTo = (typeof OPENCC_TO_VALUES)[number];

function parseOpenCcFrom(raw: string | undefined): OpenCCFrom {
  const value = (raw ?? "tw").trim();
  if (OPENCC_FROM_VALUES.includes(value as OpenCCFrom)) {
    return value as OpenCCFrom;
  }

  throw new XcstringsError(
    "INVALID_ARGUMENT",
    `Invalid --opencc-from value ${JSON.stringify(value)}. Allowed: ${OPENCC_FROM_VALUES.join(", ")}.`,
  );
}

function parseOpenCcTo(raw: string | undefined): OpenCCTo {
  const value = (raw ?? "cn").trim();
  if (OPENCC_TO_VALUES.includes(value as OpenCCTo)) {
    return value as OpenCCTo;
  }

  throw new XcstringsError(
    "INVALID_ARGUMENT",
    `Invalid --opencc-to value ${JSON.stringify(value)}. Allowed: ${OPENCC_TO_VALUES.join(", ")}.`,
  );
}

function printError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }

  console.error(String(error));
}

function run(argv: string[]): number {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printZhHansHelp();
    return 0;
  }

  const args = parseStandaloneArgs(argv);

  try {
    const xcstringsPath = getRequiredOptionValue(args, "--xcstrings");
    const outXcstringsPath = getOptionValue(args, "--out");
    const sourceLocale = getOptionValue(args, "--source-locale") ?? "zh-Hant";
    const targetLocale = getOptionValue(args, "--target-locale") ?? "zh-Hans";

    const converter = OpenCC.Converter({
      from: parseOpenCcFrom(getOptionValue(args, "--opencc-from")),
      to: parseOpenCcTo(getOptionValue(args, "--opencc-to")),
    });

    const result = autoFillMissingLocaleFromLocale({
      xcstringsPath,
      outXcstringsPath,
      sourceLocale,
      targetLocale,
      transform: (sourceText) => converter(sourceText),
    });

    console.error(`Updated ${result.updated} key(s) -> ${outXcstringsPath ?? xcstringsPath}`);
    console.error(`Skipped (missing ${sourceLocale}) ${result.skippedMissingSource} key(s)`);
    console.error(`Skipped (already had ${targetLocale}) ${result.skippedAlreadyTranslated} key(s)`);
    console.error(`Skipped (shouldTranslate=false) ${result.skippedNotTranslatable} key(s)`);

    return 0;
  } catch (error) {
    printError(error);
    return 1;
  }
}

process.exit(run(process.argv.slice(2)));
