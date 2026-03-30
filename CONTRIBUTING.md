# Contributing

Thanks for helping improve `xcstrings-translate`. This document covers how to set up the project on your machine and run it locally.

## Prerequisites

- [Bun](https://bun.sh) **1.1.0 or newer** (see `engines` in `package.json`).
- For machine-translation workflows against a real catalog, the [`copilot` CLI](https://github.com/features/copilot/cli) must be on your `PATH`.

## Install and run locally

1. **Clone the repository** (use your fork’s URL if you forked first).

   ```bash
   git clone https://github.com/EnhancedJax/xcstrings-translate.git
   cd xcstrings-translate
   ```

2. **Install dependencies.**

   ```bash
   bun install
   ```

3. **Run the CLI from the repo** (uses the local `src/cli.ts`).

   ```bash
   bun run xct -- --help
   ```

   Pass arguments after `--` so they are forwarded to the CLI. Example:

   ```bash
   bun run xct -- path/to/Localizable.xcstrings --auto fr,it
   ```

   You can also invoke the entry point directly:

   ```bash
   bun run src/cli.ts path/to/Localizable.xcstrings --cc zh-Hans
   ```

## Verify your changes

Run the full check (tests plus TypeScript compile):

```bash
bun run check
```

Individual steps:

```bash
bun test
bun run build
```

## Suggested workflow for contributions

- Open an issue or discuss larger changes before investing heavy time, when practical.
- Keep pull requests focused: one logical change per PR is easier to review.
- Ensure `bun run check` passes before you submit.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project ([MIT](./LICENSE)).
