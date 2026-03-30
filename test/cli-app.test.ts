import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../src/cli/app.ts";

async function withTempDir<T>(run: (tempDir: string) => Promise<T> | T): Promise<T> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "xct-cli-app-test-"));
  try {
    return await run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createCatalog(tempDir: string, content: unknown): string {
  mkdirSync(tempDir, { recursive: true });
  const catalogPath = path.join(tempDir, "Localizable.xcstrings");
  writeFileSync(catalogPath, JSON.stringify(content), "utf8");
  return catalogPath;
}

async function runCliSilent(args: string[], deps?: Parameters<typeof runCli>[1]): Promise<number> {
  const originalError = console.error;
  const originalLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    return await runCli(args, deps);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

describe("runCli validation", () => {
  it("fails when first positional argument is missing", async () => {
    expect(await runCliSilent(["--auto", "fr"])).toBe(1);
  });

  it("fails when no workflow is selected", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath])).toBe(1);
    });
  });

  it("fails when more than one workflow is selected", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--auto", "fr", "--import", "a.csv"])).toBe(1);
    });
  });

  it("fails when --auto has no value", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--auto"])).toBe(1);
    });
  });

  it("fails when --import has no value", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--import"])).toBe(1);
    });
  });

  it("fails when --cc value is invalid", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--cc", "ja"])).toBe(1);
    });
  });

  it("fails when --chunk-size is invalid", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--auto", "fr", "--chunk-size", "0"])).toBe(1);
    });
  });

  it("fails when --retranslate-matching regex is invalid", async () => {
    await withTempDir(async (tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      expect(await runCliSilent([catalogPath, "--auto", "fr", "--retranslate-matching", "[("])).toBe(1);
    });
  });
});

describe("runCli auto workflow failure handling", () => {
  it("returns failure when mocked copilot runner always exits non-zero", async () => {
    await withTempDir(async (tempDir) => {
      const outDir = path.join(tempDir, "out");
      const catalogPath = createCatalog(tempDir, {
        strings: {
          key: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Hello" } },
            },
          },
        },
      });

      const exitCode = await runCliSilent(
        [catalogPath, "--auto", "fr", "--out", outDir],
        {
          runCopilotTranslationJob: async () => ({
            exitCode: 1,
            stdout: "",
            stderr: "mocked failure",
          }),
          now: () => 123,
          pid: 1,
        },
      );

      expect(exitCode).toBe(1);
    });
  });

  it("returns failure when mocked runner succeeds but does not produce output CSV", async () => {
    await withTempDir(async (tempDir) => {
      const outDir = path.join(tempDir, "out");
      const catalogPath = createCatalog(tempDir, {
        strings: {
          key: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Hello" } },
            },
          },
        },
      });

      const exitCode = await runCliSilent(
        [catalogPath, "--auto", "fr", "--out", outDir],
        {
          runCopilotTranslationJob: async () => ({
            exitCode: 0,
            stdout: "ok",
            stderr: "",
          }),
          now: () => 456,
          pid: 2,
        },
      );

      expect(exitCode).toBe(1);
    });
  });
});
