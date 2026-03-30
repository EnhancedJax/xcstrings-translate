import { Command, CommanderError, Option } from "commander";
import { XcstringsError } from "../core/errors.ts";

export interface ParsedArgs {
  optionValues: Map<string, string>;
  optionFlags: Set<string>;
  positionals: string[];
}

export interface FlagState {
  present: boolean;
  value?: string;
}

interface CommanderOptionSpec {
  longName: string;
  optionKey: string;
}

const COMMANDER_OPTIONS: CommanderOptionSpec[] = [
  { longName: "--auto", optionKey: "auto" },
  { longName: "--import", optionKey: "import" },
  { longName: "--cc", optionKey: "cc" },
  { longName: "--out", optionKey: "out" },
  { longName: "--chunk-size", optionKey: "chunkSize" },
  { longName: "--model", optionKey: "model" },
  { longName: "--retranslate-matching", optionKey: "retranslateMatching" },
  { longName: "--export-only", optionKey: "exportOnly" },
];

function normalizeCommanderError(error: CommanderError): never {
  let message = error.message.replace(/^error:\s*/i, "").trim();

  if (message.includes("unknown option")) {
    throw new XcstringsError("INVALID_ARGUMENT", message);
  }

  const missingModelArg = /option '--model(?:\s|\b).*argument missing/i.test(
    message,
  );
  if (missingModelArg) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      "--model requires a model name value.",
    );
  }

  if (message.length === 0) {
    message = "Invalid command line arguments.";
  }

  throw new XcstringsError("INVALID_ARGUMENT", message);
}

function parseOptionTokens(rest: string[]): ParsedArgs {
  const parser = new Command()
    .exitOverride()
    .allowUnknownOption(false)
    .allowExcessArguments(true)
    .argument("[positionals...]")
    .addOption(new Option("--auto [locale-list]"))
    .addOption(new Option("--import [csv-path]"))
    .addOption(new Option("--cc [locale]"))
    .addOption(new Option("--out [directory]"))
    .addOption(new Option("--export-only"))
    .addOption(new Option("--chunk-size [n]"))
    .addOption(new Option("--model [name]"))
    .addOption(new Option("--retranslate-matching [regex]"));

  parser.configureOutput({
    writeErr: () => {},
    writeOut: () => {},
  });

  try {
    parser.parse(rest, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      normalizeCommanderError(error);
    }

    throw error;
  }

  const optionValues = new Map<string, string>();
  const optionFlags = new Set<string>();
  const options = parser.opts<Record<string, unknown>>();

  for (const spec of COMMANDER_OPTIONS) {
    const value = options[spec.optionKey];
    if (typeof value === "string") {
      optionValues.set(spec.longName, value);
      continue;
    }

    if (value === true) {
      optionFlags.add(spec.longName);
    }
  }

  const positionals =
    (parser.processedArgs[0] as string[] | undefined)?.slice() ?? [];

  return {
    optionValues,
    optionFlags,
    positionals,
  };
}

export function parseStandaloneArgs(argv: string[]): ParsedArgs {
  return parseOptionTokens(argv);
}

export function hasFlag(args: ParsedArgs, optionName: string): boolean {
  return args.optionFlags.has(optionName) || args.optionValues.has(optionName);
}

export function getOptionValue(
  args: ParsedArgs,
  optionName: string,
): string | undefined {
  return args.optionValues.get(optionName);
}

export function getOptionState(
  args: ParsedArgs,
  optionName: string,
): FlagState {
  if (args.optionValues.has(optionName)) {
    const raw = args.optionValues.get(optionName)!;
    const value = raw.trim();
    if (value.length === 0) {
      throw new XcstringsError(
        "INVALID_ARGUMENT",
        `${optionName} must be non-empty.`,
      );
    }

    return { present: true, value };
  }

  if (args.optionFlags.has(optionName)) {
    return { present: true };
  }

  return { present: false };
}

export function parsePositiveIntOption(
  args: ParsedArgs,
  optionName: string,
): number | undefined {
  const raw = args.optionValues.get(optionName);
  if (raw == null) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      `${optionName} must be a positive integer.`,
    );
  }

  return value;
}

export function parseRegexOption(
  args: ParsedArgs,
  optionName: string,
): RegExp | undefined {
  const raw = args.optionValues.get(optionName)?.trim();
  if (raw == null || raw.length === 0) {
    return undefined;
  }

  try {
    return new RegExp(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      `${optionName} is not a valid regex: ${reason}`,
    );
  }
}
