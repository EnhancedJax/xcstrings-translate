# xcstrings-translate 🌍

`xct` is a CLI util to machine-translate Apple String Catalog (.xcstrings).

## Features

- Machine-translate .xcstrings to target locales via Copilot CLI.
- Importing translated CSV back into .xcstrings.
- Auto-filling zh-Hans from zh-Hant with OpenCC.

## Requirements

- `copilot` CLI in `PATH`. [Learn more](https://github.com/features/copilot/cli)

## Usage

> 💡 Turn on "Automatically generate string catalog comments" in XCode for best machine translation results.

### Machine translation workflow

```bash
xct ./Localizable.xcstrings --auto fr,it
```

Options:

- `--out <directory>`
  - Directory for temporary CSV files.
  - Defaults to the OS temp directory (`os.tmpdir()`), so it is cross-platform.
- `--export-only`
  - Export temp CSV files only, skip translation/import.
- `--chunk-size <n>`
  - Number of rows per temp CSV chunk.
  - Default: `100`.
- `--model <name>`
  - Optional model override for auto-translation.
  - Default: `claude-haiku-4.5`.
  - Recommend to use 0.33x models for best results. For no usage drain, use 0x models like `gpt-4.1`
- `--retranslate-matching <regex>`
  - Only process keys matching the regex.

### Import-only workflow

```bash
xct ./Localizable.xcstrings --import ./translations_fr.csv
```

### Chinese conversion workflow

```bash
xct ./Localizable.xcstrings --cc zh-Hans
xct ./Localizable.xcstrings --cc zh-Hant
```

Options:

- `--cc zh-Hans`: fill missing `zh-Hans` from `zh-Hant`
- `--cc zh-Hant`: fill missing `zh-Hant` from `zh-Hans`

## Development

```bash
bun install
bun run check
```

## License

MIT. See [LICENSE](./LICENSE).
