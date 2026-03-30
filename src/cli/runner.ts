import { readFileSync } from "node:fs";
import { XcstringsError } from "../core/errors.ts";
import { parseCliArgs } from "./args.ts";
import { handleExportCommand } from "./export-command.ts";
import { printHelp } from "./help.ts";
import { handleImportCommand } from "./import-command.ts";

function readVersion(): string {
  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printError(error: unknown): void {
  if (error instanceof XcstringsError) {
    console.error(error.message);
    return;
  }

  if (error instanceof Error) {
    if (process.env.DEBUG != null) {
      console.error(error.stack ?? error.message);
      return;
    }

    console.error(error.message);
    return;
  }

  console.error(String(error));
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (argv.length === 1 && argv[0] === "--version") {
    console.log(readVersion());
    return 0;
  }

  const parsedArgs = parseCliArgs(argv);

  try {
    switch (parsedArgs.command) {
      case "export":
        await handleExportCommand(parsedArgs);
        return 0;
      case "import":
        handleImportCommand(parsedArgs);
        return 0;
      default:
        throw new XcstringsError(
          "INVALID_ARGUMENT",
          `Unknown command ${JSON.stringify(parsedArgs.command)}. Use \"export\" or \"import\".`,
        );
    }
  } catch (error) {
    printError(error);
    return 1;
  }
}
