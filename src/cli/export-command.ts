import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  applyTranslationsFromCsv,
  exportTranslatableKeysToCsvDetailed,
} from "../core/index.ts";
import { XcstringsError } from "../core/errors.ts";
import type { ExportTranslatableResult } from "../core/types.ts";
import {
  type ParsedArgs,
  getOptionState,
  getOptionValue,
  getRequiredOptionValue,
  parseCsvLocaleListOption,
  parsePositiveIntOption,
  parseRegexOption,
} from "./args.ts";

const AUTO_RETRY_COUNT_DEFAULT = 2;
const AUTO_STATUS_INTERVAL_MS = 2000;
const AUTO_TRANSLATION_MODEL = "claude-haiku-4.5";

interface ExportSet {
  locale: string;
  count: number;
  writtenCsvPaths: string[];
}

interface TranslationTask {
  sourceCsvPath: string;
  outCsvPath: string;
  targetLocale: string;
  label: string;
}

function translatedCsvPath(sourceCsvPath: string, targetLocale: string): string {
  const parsed = path.parse(sourceCsvPath);
  const extension = parsed.ext.length > 0 ? parsed.ext : ".csv";
  return path.join(parsed.dir, `${parsed.name}_translated_${targetLocale}${extension}`);
}

function localeScopedSourceCsvPath(sourceCsvPath: string, locale: string): string {
  const parsed = path.parse(sourceCsvPath);
  const extension = parsed.ext.length > 0 ? parsed.ext : ".csv";
  return path.join(parsed.dir, `${parsed.name}_${locale}${extension}`);
}

function validateTranslatedCsvFile(filePath: string, locale: string): { ok: boolean; reason?: string } {
  if (!existsSync(filePath)) {
    return { ok: false, reason: "output file was not created" };
  }

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

async function runCopilotTranslationJob(prompt: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "copilot",
      [
        "--model",
        AUTO_TRANSLATION_MODEL,
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

async function runAgentTranslationWithRetries(task: TranslationTask, retries: number): Promise<void> {
  const totalAttempts = retries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const startedAt = Date.now();
    const prompt = buildAgentPrompt(task);

    console.error(`Agent ${task.label}: Working... (attempt ${attempt}/${totalAttempts})`);
    const ticker = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      console.error(`Agent ${task.label}: Working... (${elapsedSeconds}s)`);
    }, AUTO_STATUS_INTERVAL_MS);

    let exitCode = 1;
    let stdout = "";
    let stderr = "";

    try {
      const result = await runCopilotTranslationJob(prompt);
      exitCode = result.exitCode;
      stdout = result.stdout;
      stderr = result.stderr;
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
    if (exitCode === 0 && validation.ok) {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      console.error(`Agent ${task.label}: Done in ${elapsedSeconds}s -> ${task.outCsvPath}`);
      return;
    }

    const reason = validation.reason ?? `copilot exited with code ${exitCode}`;
    console.error(`Agent ${task.label}: Failed (${reason})`);

    if (stdout.trim().length > 0) {
      console.error(`Agent ${task.label} stdout (tail):`);
      console.error(stdout.trim().split(/\r?\n/).slice(-8).join("\n"));
    }

    if (stderr.trim().length > 0) {
      console.error(`Agent ${task.label} stderr (tail):`);
      console.error(stderr.trim().split(/\r?\n/).slice(-8).join("\n"));
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

function describeExportResult(
  label: string,
  result: ExportTranslatableResult,
  chunkFiles: number | undefined,
  filters: string[],
): void {
  const suffix = filters.length > 0 ? ` (${filters.join(", ")})` : "";

  if (chunkFiles != null) {
    console.error(`Wrote ${result.count} keys to ${chunkFiles} file(s) based on ${label}${suffix}`);
    return;
  }

  console.error(`Wrote ${result.count} keys to ${label}${suffix}`);
}

export async function handleExportCommand(args: ParsedArgs): Promise<void> {
  const xcstringsPath = getRequiredOptionValue(args, "--xcstrings");
  const outCsvPath = getRequiredOptionValue(args, "--out");

  const chunkFiles = parsePositiveIntOption(args, "--chunk");
  const autoLocales = parseCsvLocaleListOption(args, "--auto");
  const autoRetries = parsePositiveIntOption(args, "--auto-retries") ?? AUTO_RETRY_COUNT_DEFAULT;
  const onlyMissingState = getOptionState(args, "--only-missing-locale");
  const retranslateRegex = parseRegexOption(args, "--retranslate-key-regex");
  const retranslateRegexSource = getOptionValue(args, "--retranslate-key-regex")?.trim();

  let onlyMissingLocale: string | undefined;
  let onlyMissingPerAutoLocale = false;

  if (onlyMissingState.present) {
    if (onlyMissingState.value == null || onlyMissingState.value === "auto") {
      onlyMissingPerAutoLocale = true;
    } else {
      onlyMissingLocale = onlyMissingState.value;
    }
  }

  if (onlyMissingPerAutoLocale && autoLocales.length === 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      "--only-missing-locale without a value requires --auto.",
    );
  }

  const exportSets: ExportSet[] = [];

  if (autoLocales.length > 0 && onlyMissingPerAutoLocale) {
    let total = 0;

    for (const locale of autoLocales) {
      const localePath = localeScopedSourceCsvPath(outCsvPath, locale);
      const result = exportTranslatableKeysToCsvDetailed({
        xcstringsPath,
        outCsvPath: localePath,
        onlyMissingLocale: locale,
        keyRegex: retranslateRegex,
        chunkFiles,
      });

      exportSets.push({
        locale,
        count: result.count,
        writtenCsvPaths: result.writtenCsvPaths,
      });

      total += result.count;
    }

    const filters: string[] = ["only missing each auto locale"];
    if (retranslateRegexSource != null && retranslateRegexSource.length > 0) {
      filters.push(`key regex ${retranslateRegexSource}`);
    }

    const suffix = filters.length > 0 ? ` (${filters.join(", ")})` : "";
    if (chunkFiles != null) {
      console.error(
        `Wrote ${total} keys across ${autoLocales.length} locale-specific export set(s) to ${chunkFiles} file(s) each based on ${outCsvPath}${suffix}`,
      );
    } else {
      console.error(
        `Wrote ${total} keys across ${autoLocales.length} locale-specific export file(s) based on ${outCsvPath}${suffix}`,
      );
    }

    for (const exportSet of exportSets) {
      console.error(`  - ${exportSet.locale}: ${exportSet.count} key(s)`);
    }
  } else {
    const result = exportTranslatableKeysToCsvDetailed({
      xcstringsPath,
      outCsvPath,
      onlyMissingLocale,
      keyRegex: retranslateRegex,
      chunkFiles,
    });

    const filters: string[] = [];
    if (onlyMissingLocale != null && onlyMissingLocale.length > 0) {
      filters.push(`only missing ${onlyMissingLocale}`);
    }
    if (retranslateRegexSource != null && retranslateRegexSource.length > 0) {
      filters.push(`key regex ${retranslateRegexSource}`);
    }

    describeExportResult(outCsvPath, result, chunkFiles, filters);

    if (autoLocales.length > 0) {
      for (const locale of autoLocales) {
        exportSets.push({
          locale,
          count: result.count,
          writtenCsvPaths: result.writtenCsvPaths,
        });
      }
    }
  }

  if (autoLocales.length === 0) {
    return;
  }

  const activeSets = exportSets.filter((set) => set.count > 0 && set.writtenCsvPaths.length > 0);
  for (const set of exportSets) {
    if (set.count === 0 || set.writtenCsvPaths.length === 0) {
      console.error(`Auto mode: ${set.locale} has no rows to translate; skipping.`);
    }
  }

  if (activeSets.length === 0) {
    console.error("Auto mode: no rows to translate; skipping agent and import.");
    return;
  }

  const tasks: TranslationTask[] = [];
  for (const set of activeSets) {
    for (let index = 0; index < set.writtenCsvPaths.length; index += 1) {
      const sourceCsvPath = set.writtenCsvPaths[index]!;
      tasks.push({
        sourceCsvPath,
        outCsvPath: translatedCsvPath(sourceCsvPath, set.locale),
        targetLocale: set.locale,
        label: `${tasks.length + 1} (${set.locale} chunk ${index + 1})`,
      });
    }
  }

  console.error(
    `Auto mode: translating ${tasks.length} job(s) across ${autoLocales.length} locale(s) with copilot CLI (model ${AUTO_TRANSLATION_MODEL}, max parallel).`,
  );

  const translatedCsvPaths: string[] = [];
  let failed = 0;
  let completed = 0;

  await Promise.all(
    tasks.map(async (task) => {
      try {
        await runAgentTranslationWithRetries(task, autoRetries);
        translatedCsvPaths.push(task.outCsvPath);
      } catch (error) {
        failed += 1;
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        completed += 1;
        console.error(`Auto mode status: ${completed - failed} done, ${failed} failed.`);
      }
    }),
  );

  if (failed > 0) {
    throw new XcstringsError(
      "AUTO_TRANSLATION_FAILED",
      `Auto mode failed: ${failed} chunk(s) could not be translated.`,
    );
  }

  console.error("Auto mode: importing translated CSV files...");

  let totalUpdated = 0;
  let totalSkippedMissingKey = 0;
  let totalSkippedAlreadyTranslated = 0;
  let totalWarnings = 0;

  const shouldOnlyImportMissing = retranslateRegex == null;
  if (!shouldOnlyImportMissing) {
    console.error("Auto mode: retranslate regex is enabled; importing with overwrite for matched keys.");
  }

  for (const translatedCsvPathValue of translatedCsvPaths) {
    const importResult = applyTranslationsFromCsv({
      xcstringsPath,
      translationsCsvPath: translatedCsvPathValue,
      onlyIfMissingForTargetLocale: shouldOnlyImportMissing,
    });

    totalUpdated += importResult.updated;
    totalSkippedMissingKey += importResult.skippedMissingKey.length;
    totalSkippedAlreadyTranslated += importResult.skippedAlreadyTranslated.length;
    totalWarnings += importResult.warnings.length;

    console.error(`Imported ${translatedCsvPathValue}: updated ${importResult.updated}`);
  }

  console.error(
    `Auto mode import complete: updated ${totalUpdated}, unknown keys ${totalSkippedMissingKey}, already translated ${totalSkippedAlreadyTranslated}, warnings ${totalWarnings}.`,
  );
}
