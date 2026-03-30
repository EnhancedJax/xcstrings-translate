import { applyTranslationsFromCsv } from "../core/index.ts";
import { hasFlag, type ParsedArgs, getOptionValue, getRequiredOptionValue } from "./args.ts";

export function handleImportCommand(args: ParsedArgs): void {
  const xcstringsPath = getRequiredOptionValue(args, "--xcstrings");
  const translationsCsvPath = getRequiredOptionValue(args, "--csv");

  const result = applyTranslationsFromCsv({
    xcstringsPath,
    translationsCsvPath,
    outXcstringsPath: getOptionValue(args, "--out"),
    strictKeys: hasFlag(args, "--strict-keys"),
    onlyIfMissingForTargetLocale: hasFlag(args, "--only-if-missing"),
  });

  console.error(`Updated ${result.updated} localization unit(s) -> ${getOptionValue(args, "--out") ?? xcstringsPath}`);

  if (result.skippedMissingKey.length > 0) {
    console.error(`Skipped missing key(s): ${result.skippedMissingKey.length}`);
  }

  if (result.skippedAlreadyTranslated.length > 0) {
    console.error(`Skipped already-translated key(s): ${result.skippedAlreadyTranslated.length}`);
  }

  if (result.warnings.length > 0) {
    console.error(`Warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.error(`- ${warning}`);
    }
  }
}
