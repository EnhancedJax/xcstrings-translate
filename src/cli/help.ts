export function printHelp(): void {
  console.log(`xcstrings-translate - export/import String Catalog strings via CSV

Usage:
  xcstrings-translate export --xcstrings <path> --out <csv> [options]
  xcstrings-translate import --xcstrings <path> --csv <csv> [options]

Export options:
  --only-missing-locale [locale]  Limit rows to keys missing this locale.
                                  If no locale is provided, requires --auto and scopes per target locale.
  --retranslate-key-regex <regex> Include only keys matching regex.
  --chunk <n>                     Split output into exactly n files.
  --auto <locales>                Translate via Copilot CLI (comma-separated locales).
  --auto-retries <n>              Retry count per failed auto-translation job (default: 2).

Import options:
  --out <path>          Output catalog path (default: overwrite --xcstrings).
  --strict-keys         Fail if CSV contains a key not found in the catalog.
  --only-if-missing     Skip rows where target locale already has a translation.

General options:
  -h, --help            Show help.
  --version             Show package version.
`);
}

export function printZhHansHelp(): void {
  console.log(`xcstrings-translate-zh-hans - auto-fill missing locale values using OpenCC conversion

Usage:
  xcstrings-translate-zh-hans --xcstrings <path> [options]

Options:
  --out <path>                Output catalog path (default: overwrite --xcstrings).
  --source-locale <locale>    Source locale (default: zh-Hant).
  --target-locale <locale>    Target locale (default: zh-Hans).
  --opencc-from <value>       OpenCC source variant: hk, tw, twp, jp (default: tw).
  --opencc-to <value>         OpenCC target variant: cn (default: cn).
  -h, --help                  Show help.
`);
}
