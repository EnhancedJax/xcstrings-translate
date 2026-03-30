export function printHelp(): void {
  console.log(`xct - XCStrings translation utility

Base workflow:
  xct <xcstrings-path> --auto <locale-list>
  Example: xct ./Localizable.xcstrings --auto fr,it

Options for auto workflow:
  --out <directory>               Directory for temporary CSV files (default: OS temp directory).
  --export-only                   Export CSV files only; do not translate/import.
  --chunk-size <n>                Rows per CSV chunk (default: 100).
  --model <name>                  Translation model (default: claude-haiku-4.5).
  --retranslate-matching <regex>  Restrict translation to keys matching regex.

Import-only workflow:
  xct <xcstrings-path> --import <csv-path>
  This workflow does not accept any other options.

Chinese conversion workflow:
  xct <xcstrings-path> --cc zh-Hans
  xct <xcstrings-path> --cc zh-Hant

General options:
  -h, --help                      Show help.
  --version                       Show package version.
`);
}
