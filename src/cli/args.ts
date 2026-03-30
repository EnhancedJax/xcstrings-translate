import { XcstringsError } from "../core/errors.ts";

export interface ParsedArgs {
  command?: string;
  optionValues: Map<string, string>;
  optionFlags: Set<string>;
  positionals: string[];
}

export interface FlagState {
  present: boolean;
  value?: string;
}

function parseOptionTokens(command: string | undefined, rest: string[]): ParsedArgs {
  const optionValues = new Map<string, string>();
  const optionFlags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const next = rest[index + 1];
    if (next == null || next.startsWith("--")) {
      optionFlags.add(token);
      continue;
    }

    optionValues.set(token, next);
    index += 1;
  }

  return {
    command,
    optionValues,
    optionFlags,
    positionals,
  };
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  return parseOptionTokens(command, rest);
}

export function parseStandaloneArgs(argv: string[]): ParsedArgs {
  return parseOptionTokens(undefined, argv);
}

export function hasFlag(args: ParsedArgs, optionName: string): boolean {
  return args.optionFlags.has(optionName) || args.optionValues.has(optionName);
}

export function getOptionValue(args: ParsedArgs, optionName: string): string | undefined {
  return args.optionValues.get(optionName);
}

export function getRequiredOptionValue(args: ParsedArgs, optionName: string): string {
  const value = args.optionValues.get(optionName)?.trim();
  if (value == null || value.length === 0) {
    throw new XcstringsError("INVALID_ARGUMENT", `Missing required option ${optionName}.`);
  }

  return value;
}

export function getOptionState(args: ParsedArgs, optionName: string): FlagState {
  if (args.optionValues.has(optionName)) {
    const raw = args.optionValues.get(optionName)!;
    const value = raw.trim();
    if (value.length === 0) {
      throw new XcstringsError("INVALID_ARGUMENT", `${optionName} must be non-empty.`);
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
    throw new XcstringsError("INVALID_ARGUMENT", `${optionName} must be a positive integer.`);
  }

  return value;
}

export function parseRegexOption(args: ParsedArgs, optionName: string): RegExp | undefined {
  const raw = args.optionValues.get(optionName)?.trim();
  if (raw == null || raw.length === 0) {
    return undefined;
  }

  try {
    return new RegExp(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new XcstringsError("INVALID_ARGUMENT", `${optionName} is not a valid regex: ${reason}`);
  }
}

export function parseCsvLocaleListOption(args: ParsedArgs, optionName: string): string[] {
  const raw = args.optionValues.get(optionName)?.trim();
  if (raw == null || raw.length === 0) {
    return [];
  }

  const uniqueLocales: string[] = [];
  const seen = new Set<string>();

  for (const part of raw.split(",")) {
    const locale = part.trim();
    if (locale.length === 0 || seen.has(locale)) {
      continue;
    }

    seen.add(locale);
    uniqueLocales.push(locale);
  }

  if (uniqueLocales.length === 0) {
    throw new XcstringsError(
      "INVALID_ARGUMENT",
      `${optionName} must contain at least one locale (for example: --auto ja or --auto fr,it).`,
    );
  }

  return uniqueLocales;
}
