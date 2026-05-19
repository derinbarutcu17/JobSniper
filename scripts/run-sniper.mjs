import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/presentation/cli.ts";

const baseDir = process.env.SNIPER_BASE_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

runCli(process.argv.slice(2), baseDir)
  .then((output) => {
    process.stdout.write(`${output}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
