# xcstrings-translate

`xcstrings-translate` is a Bun-based CLI and TypeScript library for Apple String Catalog (`.xcstrings`) translation workflows.

It supports:
- Exporting translatable keys to CSV.
- Importing translated CSV back into `.xcstrings`.
- Optional auto-translation orchestration via Copilot CLI.
- Auto-filling `zh-Hans` from `zh-Hant` with OpenCC.

## Requirements

- Bun `>= 1.1.0`
- For auto mode: Copilot CLI available as `copilot` in `PATH`

## Install

```bash
bun install
```

## CLI Usage

### Export

Export all translatable keys (`shouldTranslate !== false`) to CSV:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./keys.csv
```

Export only keys missing a locale:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./fr-missing.csv \
  --only-missing-locale fr
```

Chunk into multiple files:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./keys.csv \
  --chunk 5
```

Filter by key regex:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./keys.csv \
  --retranslate-key-regex '^checkout\\.'
```

### Import

Import CSV shaped as `key,<locale>`:

```bash
bun run src/cli.ts import \
  --xcstrings ./Localizable.xcstrings \
  --csv ./translations-fr.csv
```

Safe partial import (only fill missing target-locale entries):

```bash
bun run src/cli.ts import \
  --xcstrings ./Localizable.xcstrings \
  --csv ./translations-fr.csv \
  --only-if-missing
```

Strict key checking:

```bash
bun run src/cli.ts import \
  --xcstrings ./Localizable.xcstrings \
  --csv ./translations-fr.csv \
  --strict-keys
```

### Auto Mode (Copilot CLI)

Run export, auto-translate, and import in one flow:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./keys.csv \
  --chunk 4 \
  --auto fr,it,ja
```

With locale-specific missing-only export:

```bash
bun run src/cli.ts export \
  --xcstrings ./Localizable.xcstrings \
  --out ./keys.csv \
  --chunk 4 \
  --auto fr,it,ja \
  --only-missing-locale
```

### zh-Hans Auto-fill (OpenCC)

```bash
bun run src/cli-zh-hans.ts \
  --xcstrings ./Localizable.xcstrings
```

Optional flags:
- `--out <path>`
- `--source-locale <locale>` (default: `zh-Hant`)
- `--target-locale <locale>` (default: `zh-Hans`)
- `--opencc-from <hk|tw|twp|jp>` (default: `tw`)
- `--opencc-to <cn>` (default: `cn`)

## Library API

```ts
import {
  readCatalog,
  writeCatalog,
  parseCsv,
  formatCsvRow,
  exportTranslatableKeysToCsvDetailed,
  applyTranslationsFromCsv,
  autoFillMissingLocaleFromLocale,
} from "xcstrings-translate";
```

Core exported types include:
- `XCStringCatalog`
- `StringEntry`
- `LocalizationEntry`
- `TranslationRow`
- `ExportTranslatableOptions`
- `ApplyTranslationsOptions`

## Development

Run tests:

```bash
bun test
```

Run full checks:

```bash
bun run check
```

## Notes

- CSV parsing supports RFC-4180 quoting semantics.
- Import normalization includes placeholder safety for full-width percent forms (for example `％@` -> `%@`).
- Catalog writes preserve Xcode-style JSON spacing (`"key" : value`).

## License

MIT. See [LICENSE](./LICENSE).
