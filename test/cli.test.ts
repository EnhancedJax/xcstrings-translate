import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function withTempDir<T>(run: (tempDir: string) => T): T {
  const tempDir = mkdtempSync(path.join(tmpdir(), "xct-cli-test-"));
  try {
    return run(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runCli(args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const proc = Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString("utf8"),
    stderr: Buffer.from(proc.stderr).toString("utf8"),
  };
}

function createCatalog(tempDir: string, content: unknown): string {
  mkdirSync(tempDir, { recursive: true });
  const catalogPath = path.join(tempDir, "Localizable.xcstrings");
  writeFileSync(catalogPath, JSON.stringify(content), "utf8");
  return catalogPath;
}

describe("xct cli", () => {
  it("supports export-only auto workflow with chunk-size and default missing-only behavior", () => {
    withTempDir((tempDir) => {
      const outDir = path.join(tempDir, "out");
      const catalogPath = createCatalog(tempDir, {
        strings: {
          "checkout.title": {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Checkout" } },
            },
          },
          "checkout.subtitle": {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Subtitle" } },
            },
          },
          translated: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Done" } },
              fr: { stringUnit: { state: "translated", value: "Fait" } },
            },
          },
        },
      });

      const result = runCli([
        catalogPath,
        "--auto",
        "fr",
        "--export-only",
        "--out",
        outDir,
        "--chunk-size",
        "1",
        "--model",
        "claude-haiku-4.5",
        "--retranslate-matching",
        "^checkout\\.",
      ]);

      expect(result.exitCode).toBe(0);
      const files = readdirSync(outDir).filter((file) =>
        file.startsWith("xct_source_fr_"),
      );
      expect(files.length).toBe(2);
    });
  });

  it("enforces import-only workflow without extra options", () => {
    withTempDir((tempDir) => {
      const outDir = path.join(tempDir, "out");
      const catalogPath = createCatalog(tempDir, { strings: {} });
      const csvPath = path.join(tempDir, "fr.csv");
      writeFileSync(csvPath, "key,fr\nhello,bonjour\n", "utf8");

      const result = runCli([
        catalogPath,
        "--import",
        csvPath,
        "--out",
        outDir,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Option --out is not valid for this workflow.",
      );
    });
  });

  it("requires a value for --model in auto workflow", () => {
    withTempDir((tempDir) => {
      const catalogPath = createCatalog(tempDir, { strings: {} });
      const result = runCli([catalogPath, "--auto", "fr", "--model"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--model requires a model name value.");
    });
  });

  it("imports CSV via import-only workflow", () => {
    withTempDir((tempDir) => {
      const catalogPath = createCatalog(tempDir, {
        strings: {
          hello: {
            localizations: {
              en: { stringUnit: { state: "translated", value: "Hello" } },
            },
          },
        },
      });

      const csvPath = path.join(tempDir, "fr.csv");
      writeFileSync(csvPath, "key,fr\nhello,bonjour\n", "utf8");

      const result = runCli([catalogPath, "--import", csvPath]);
      expect(result.exitCode).toBe(0);

      const updatedCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
        strings: {
          hello?: {
            localizations?: { fr?: { stringUnit?: { value?: string } } };
          };
        };
      };

      expect(
        updatedCatalog.strings.hello?.localizations?.fr?.stringUnit?.value,
      ).toBe("bonjour");
    });
  });

  it("supports --cc zh-Hans and --cc zh-Hant", () => {
    withTempDir((tempDir) => {
      const toHansPath = createCatalog(path.join(tempDir, "a"), {
        strings: {
          key: {
            localizations: {
              "zh-Hant": { stringUnit: { state: "translated", value: "測試" } },
            },
          },
        },
      });

      const hansResult = runCli([toHansPath, "--cc", "zh-Hans"]);
      expect(hansResult.exitCode).toBe(0);

      const toHantPath = createCatalog(path.join(tempDir, "b"), {
        strings: {
          key: {
            localizations: {
              "zh-Hans": { stringUnit: { state: "translated", value: "测试" } },
            },
          },
        },
      });

      const hantResult = runCli([toHantPath, "--cc", "zh-Hant"]);
      expect(hantResult.exitCode).toBe(0);

      const updatedHant = JSON.parse(readFileSync(toHantPath, "utf8")) as {
        strings: {
          key?: {
            localizations?: { "zh-Hant"?: { stringUnit?: { value?: string } } };
          };
        };
      };
      expect(
        updatedHant.strings.key?.localizations?.["zh-Hant"]?.stringUnit?.value
          ?.length ?? 0,
      ).toBeGreaterThan(0);
    });
  });
});
