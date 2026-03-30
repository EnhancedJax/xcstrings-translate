#!/usr/bin/env bun

import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as OpenCC from "opencc-js";
import {
  applyTranslationsFromCsv,
  autoFillMissingLocaleFromLocale,
  exportTranslatableKeysToCsvDetailed,
} from "./core/index.ts";
import { XcstringsError } from "./core/errors.ts";
import {
  getOptionState,
  getOptionValue,
  hasFlag,
  parsePositiveIntOption,
  parseRegexOption,
  parseStandaloneArgs,
} from "./cli/args.ts";
import { printHelp } from "./cli/help.ts";

const DEFAULT_CHUNK_SIZE = 100;
const DEFAULT_AUTO_RETRIES = 2;
const AUTO_STATUS_INTERVAL_MS = 2000;
const DEFAULT_AUTO_TRANSLATION_MODEL = "claude-haiku-4.5";

const TEMP_SOURCE_FILE_PREFIX = "xct_source";
const TEMP_TRANSLATED_FILE_PREFIX = "xct_translated";

const AUTO_ALLOWED_OPTIONS = new Set([
  "--auto",
  "--out",
  "--export-only",
  "--chunk-size",
  "--model",
  "--retranslate-matching",
]);

const IMPORT_ALLOWED_OPTIONS = new Set(["--import"]);
const CC_ALLOWED_OPTIONS = new Set(["--cc"]);

interface TranslationTask {
  sourceCsvPath: string;
  outCsvPath: string;
  targetLocale: string;
  label: string;
}

function readVersion(): string {
  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printError(error: unknown): void {
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }

  console.error(String(error));
}

function listProvidedOptions(args: ReturnType<typeof parseStandaloneArgs>): string[] {
  return [...new Set([...args.optionValues.keys(), ...args.optionFlags])];
}

function assertAllowedOptions(
  args: ReturnType<typeof parseStandaloneArgs>,
  allowedOptions: Set<string>,
): void {
  for (const optionName of listProvidedOptions(args)) {
    if (!allowedOptions.has(optionName)) {
      throw new XcstringsError("INVALID_ARGUMENT", `Option ${optionName} is not valid for this workflow.`);
    }
  }
}

function ensureNoExtraPositionals(args: ReturnType<typeof parseStandaloneArgs>): void {
  if (args.positionals.length > 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      `Unexpected positional argument(s): ${args.positionals.map((value) => JSON.stringify(value)).join(", ")}.`,
    );
  }
}

function ensureOutputDirectory(outDir: string): string {
  const resolvedOutDir = path.resolve(outDir);
  mkdirSync(resolvedOutDir, { recursive: true });
  return resolvedOutDir;
}

function buildSourceCsvPath(outDir: string, locale: string, runToken: string): string {
  return path.join(outDir, `${TEMP_SOURCE_FILE_PREFIX}_${locale}_${runToken}.csv`);
}

function buildTranslatedCsvPath(outDir: string, locale: string, runToken: string, index: number): string {
  return path.join(outDir, `${TEMP_TRANSLATED_FILE_PREFIX}_${locale}_${runToken}_${index}.csv`);
}

function parseLocaleList(rawValue: string, optionName: string): string[] {
  const locales: string[] = [];
  const seen = new Set<string>();

  for (const part of rawValue.split(",")) {
    const locale = part.trim();
    if (locale.length === 0 || seen.has(locale)) {
      continue;
    }

    seen.add(locale);
    locales.push(locale);
  }

  if (locales.length === 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      `${optionName} must contain at least one locale (for example: --auto fr,it).`,
    );
  }

  return locales;
}

function validateTranslatedCsvFile(filePath: string, locale: string): { ok: boolean; reason?: string } {
  let text = readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const expected = `key,${locale}`;

  if (firstLine.trim() !== expected) {
    return {
      ok: false,
      reason: `unexpected CSV header ${JSON.stringify(firstLine)} (expected ${JSON.stringify(expected)})`,
    };
  }

  return { ok: true };
}

function buildAgentPrompt(args: {
  sourceCsvPath: string;
  outCsvPath: string;
  targetLocale: string;
}): string {
  return [
    "You are localizing an iOS app String Catalog CSV.",
    "",
    `Read input CSV at: ${args.sourceCsvPath}`,
    `Write output CSV at: ${args.outCsvPath}`,
    `Target locale tag: ${args.targetLocale}`,
    "",
    "Requirements:",
    `- Output header must be exactly: key,${args.targetLocale}`,
    "- Keep the key column byte-for-byte unchanged.",
    "- Translate each source key string into the target locale in column 2.",
    "- Use comment/context column only to understand meaning; do not output comments.",
    "- Preserve placeholders and markup exactly: %@, %1$@, %d, %%, \\n, tags.",
    "- Keep row count and row order exactly the same as input.",
    "- RFC-4180 CSV formatting.",
    "- Output only the CSV file content to the destination file.",
    "",
    "Perform the task now and save the output file.",
  ].join("\n");
}

async function runCopilotTranslationJob(
  prompt: string,
  model: string,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "copilot",
      [
        "--model",
        model,
        "--allow-all",
        "--output-format",
        "text",
        "--stream",
        "off",
        "--no-color",
        "-p",
        prompt,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runAgentTranslationWithRetries(task: TranslationTask, model: string): Promise<void> {
  const totalAttempts = DEFAULT_AUTO_RETRIES + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const startedAt = Date.now();
    console.error(`Agent ${task.label}: Working... (attempt ${attempt}/${totalAttempts})`);

    const ticker = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      console.error(`Agent ${task.label}: Working... (${elapsedSeconds}s)`);
    }, AUTO_STATUS_INTERVAL_MS);

    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await runCopilotTranslationJob(
        buildAgentPrompt({
          sourceCsvPath: task.sourceCsvPath,
          outCsvPath: task.outCsvPath,
          targetLocale: task.targetLocale,
        }),
        model,
      );
    } catch (error) {
      clearInterval(ticker);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new XcstringsError(
          "MISSING_DEPENDENCY",
          "copilot CLI is not installed or not available in PATH.",
        );
      }
      throw error;
    }

    clearInterval(ticker);

    const validation = validateTranslatedCsvFile(task.outCsvPath, task.targetLocale);
    if (result.exitCode === 0 && validation.ok) {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      console.error(`Agent ${task.label}: Done in ${elapsedSeconds}s -> ${task.outCsvPath}`);
      return;
    }

    const reason = validation.reason ?? `copilot exited with code ${result.exitCode}`;
    console.error(`Agent ${task.label}: Failed (${reason})`);

    if (result.stdout.trim().length > 0) {
      console.error(result.stdout.trim().split(/\r?\n/).slice(-8).join("\n"));
    }

    if (result.stderr.trim().length > 0) {
      console.error(result.stderr.trim().split(/\r?\n/).slice(-8).join("\n"));
    }

    if (attempt < totalAttempts) {
      console.error(`Agent ${task.label}: Retrying...`);
    }
  }

  throw new XcstringsError(
    "AUTO_TRANSLATION_FAILED",
    `Agent ${task.label} failed after ${totalAttempts} attempt(s).`,
  );
}

function runImportOnlyWorkflow(catalogPath: string, args: ReturnType<typeof parseStandaloneArgs>): void {
  assertAllowedOptions(args, IMPORT_ALLOWED_OPTIONS);
  ensureNoExtraPositionals(args);

  const importPath = getOptionState(args, "--import").value;
  if (importPath == null) {
    throw new XcstringsError("INVALID_ARGUMENT", "--import requires a CSV path value.");
  }

  const result = applyTranslationsFromCsv({
    xcstringsPath: catalogPath,
    translationsCsvPath: importPath,
  });

  console.error(`Updated ${result.updated} localization unit(s).`);
  if (result.skippedMissingKey.length > 0) {
    console.error(`Skipped missing key(s): ${result.skippedMissingKey.length}`);
  }
  if (result.warnings.length > 0) {
    console.error(`Warnings: ${result.warnings.length}`);
  }
}

function runCcWorkflow(catalogPath: string, args: ReturnType<typeof parseStandaloneArgs>): void {
  assertAllowedOptions(args, CC_ALLOWED_OPTIONS);
  ensureNoExtraPositionals(args);

  const ccValue = getOptionState(args, "--cc").value;
  if (ccValue == null) {
    throw new XcstringsError("INVALID_ARGUMENT", "--cc requires a locale value (zh-Hans or zh-Hant).");
  }

  let sourceLocale: string;
  let targetLocale: string;
  let openccFrom: OpenCC.OpenCCVariant;
  let openccTo: OpenCC.OpenCCVariant;

  if (ccValue === "zh-Hans") {
    sourceLocale = "zh-Hant";
    targetLocale = "zh-Hans";
    openccFrom = "tw";
    openccTo = "cn";
  } else if (ccValue === "zh-Hant") {
    sourceLocale = "zh-Hans";
    targetLocale = "zh-Hant";
    openccFrom = "cn";
    openccTo = "tw";
  } else {
    throw new XcstringsError("INVALID_ARGUMENT", "--cc must be one of: zh-Hans, zh-Hant.");
  }

  const converter = OpenCC.Converter({ from: openccFrom, to: openccTo });
  const result = autoFillMissingLocaleFromLocale({
    xcstringsPath: catalogPath,
    sourceLocale,
    targetLocale,
    transform: (text) => converter(text),
  });

  console.error(`Updated ${result.updated} key(s).`);
  console.error(`Skipped (missing ${sourceLocale}) ${result.skippedMissingSource} key(s)`);
  console.error(`Skipped (already had ${targetLocale}) ${result.skippedAlreadyTranslated} key(s)`);
  console.error(`Skipped (shouldTranslate=false) ${result.skippedNotTranslatable} key(s)`);
}

async function runAutoWorkflow(
  catalogPath: string,
  args: ReturnType<typeof parseStandaloneArgs>,
): Promise<void> {
  assertAllowedOptions(args, AUTO_ALLOWED_OPTIONS);
  ensureNoExtraPositionals(args);

  const autoState = getOptionState(args, "--auto");
  if (autoState.value == null) {
    throw new XcstringsError("INVALID_ARGUMENT", "--auto requires a comma-separated locale list.");
  }

  const locales = parseLocaleList(autoState.value, "--auto");
  const outDir = ensureOutputDirectory(getOptionValue(args, "--out") ?? tmpdir());
  const chunkSize = parsePositiveIntOption(args, "--chunk-size") ?? DEFAULT_CHUNK_SIZE;
  const keyRegex = parseRegexOption(args, "--retranslate-matching");
  const exportOnly = hasFlag(args, "--export-only");
  const modelState = getOptionState(args, "--model");
  if (modelState.present && modelState.value == null) {
    throw new XcstringsError("INVALID_ARGUMENT", "--model requires a model name value.");
  }
  const model = modelState.value ?? DEFAULT_AUTO_TRANSLATION_MODEL;

  const runToken = `${Date.now()}_${process.pid}`;
  const tasks: TranslationTask[] = [];

  for (const locale of locales) {
    const sourceBasePath = buildSourceCsvPath(outDir, locale, runToken);
    const exportResult = exportTranslatableKeysToCsvDetailed({
      xcstringsPath: catalogPath,
      outCsvPath: sourceBasePath,
      onlyMissingLocale: locale,
      keyRegex,
      chunkSize,
    });

    if (exportResult.count === 0 || exportResult.writtenCsvPaths.length === 0) {
      console.error(`No missing rows for locale ${locale}; skipping.`);
      continue;
    }

    console.error(
      `Prepared ${exportResult.writtenCsvPaths.length} file(s) for ${locale} (${exportResult.count} row(s)).`,
    );

    for (const sourceCsvPath of exportResult.writtenCsvPaths) {
      tasks.push({
        sourceCsvPath,
        outCsvPath: buildTranslatedCsvPath(outDir, locale, runToken, tasks.length + 1),
        targetLocale: locale,
        label: `${tasks.length + 1} (${locale})`,
      });
    }
  }

  if (tasks.length === 0) {
    console.error("No rows to process.");
    return;
  }

  if (exportOnly) {
    console.error("Export-only mode complete. Generated source CSV files:");
    for (const task of tasks) {
      console.error(`- ${task.sourceCsvPath}`);
    }
    return;
  }

  console.error(
    `Auto mode: translating ${tasks.length} chunk(s) across ${locales.length} locale(s) with model ${model}.`,
  );

  const translatedCsvPaths: string[] = [];
  let failedCount = 0;
  let completedCount = 0;

  await Promise.all(
    tasks.map(async (task) => {
      try {
        await runAgentTranslationWithRetries(task, model);
        translatedCsvPaths.push(task.outCsvPath);
      } catch (error) {
        failedCount += 1;
        printError(error);
      } finally {
        completedCount += 1;
        console.error(`Auto mode status: ${completedCount - failedCount} done, ${failedCount} failed.`);
      }
    }),
  );

  if (failedCount > 0) {
    throw new XcstringsError(
      "AUTO_TRANSLATION_FAILED",
      `Auto mode failed: ${failedCount} chunk(s) could not be translated.`,
    );
  }

  let totalUpdated = 0;
  let totalSkippedMissingKey = 0;
  let totalSkippedAlreadyTranslated = 0;
  let totalWarnings = 0;

  for (const translatedCsvPath of translatedCsvPaths) {
    const importResult = applyTranslationsFromCsv({
      xcstringsPath: catalogPath,
      translationsCsvPath: translatedCsvPath,
      onlyIfMissingForTargetLocale: true,
    });

    totalUpdated += importResult.updated;
    totalSkippedMissingKey += importResult.skippedMissingKey.length;
    totalSkippedAlreadyTranslated += importResult.skippedAlreadyTranslated.length;
    totalWarnings += importResult.warnings.length;

    console.error(`Imported ${translatedCsvPath}: updated ${importResult.updated}`);
  }

  console.error(
    `Auto mode complete: updated ${totalUpdated}, unknown keys ${totalSkippedMissingKey}, already translated ${totalSkippedAlreadyTranslated}, warnings ${totalWarnings}.`,
  );
}

async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (argv.length === 1 && argv[0] === "--version") {
    console.log(readVersion());
    return 0;
  }

  const catalogPath = argv[0];
  if (catalogPath == null || catalogPath.startsWith("--")) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      "First argument must be the .xcstrings path. Example: xct ./Localizable.xcstrings --auto fr,it",
    );
  }

  const args = parseStandaloneArgs(argv.slice(1));
  const hasImport = hasFlag(args, "--import");
  const hasCc = hasFlag(args, "--cc");
  const hasAuto = hasFlag(args, "--auto");

  const selectedWorkflows = [hasImport, hasCc, hasAuto].filter(Boolean).length;
  if (selectedWorkflows === 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      "Choose one workflow: --auto <locales>, --import <csv>, or --cc <zh-Hans|zh-Hant>.",
    );
  }

  if (selectedWorkflows > 1) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      "--auto, --import, and --cc are mutually exclusive workflows.",
    );
  }

  if (hasImport) {
    runImportOnlyWorkflow(catalogPath, args);
    return 0;
  }

  if (hasCc) {
    runCcWorkflow(catalogPath, args);
    return 0;
  }

  await runAutoWorkflow(catalogPath, args);
  return 0;
}

try {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
} catch (error) {
  printError(error);
  process.exit(1);
}
