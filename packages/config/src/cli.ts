/**
 * switchboard.yaml CLI.
 *
 *   switchboard-config check [file]   validate only (CI-friendly, no database)
 *   switchboard-config apply [file]   validate, then write to DATABASE_URL
 *
 * The file defaults to $SWITCHBOARD_CONFIG, then ./switchboard.yaml.
 * Exit code 1 on any validation or apply error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "@switchboard/db";
import { applyConfig } from "./apply.js";
import { loadConfig } from "./load.js";

// The .env in the working directory (the repo root for npm scripts), when
// present; real environment variables win.
if (existsSync(".env")) process.loadEnvFile(".env");

const [command, fileArg] = process.argv.slice(2);
if (command !== "check" && command !== "apply") {
  console.error("Usage: switchboard-config <check|apply> [path/to/switchboard.yaml]");
  process.exit(2);
}

const file = path.resolve(fileArg ?? process.env.SWITCHBOARD_CONFIG ?? "switchboard.yaml");
let text: string;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(`Config file not found: ${file}`);
  process.exit(1);
}

const result = loadConfig(text, file, (absolutePath) => readFileSync(absolutePath, "utf8"));
if (!result.ok) {
  const shown = path.relative(process.cwd(), file);
  console.error(`✗ ${shown && !shown.startsWith("..") ? shown : file} has ${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}:`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
for (const warning of result.warnings) console.warn(`  ! ${warning}`);
const { plan } = result;
console.log(
  `✓ ${plan.org.name}: ${plan.reps.length} rep${plan.reps.length === 1 ? "" : "s"}, ${plan.teams.length} team${plan.teams.length === 1 ? "" : "s"}, ${plan.forms.length} form${plan.forms.length === 1 ? "" : "s"}`,
);
if (command === "check") process.exit(0);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const db = createDb(url);
try {
  const summary = await applyConfig(db, plan);
  console.log(
    `✓ applied: reps +${summary.reps.created} ~${summary.reps.updated}, forms +${summary.forms.created} ~${summary.forms.updated}, ${summary.ruleSetVersionsCreated} new rule set version${summary.ruleSetVersionsCreated === 1 ? "" : "s"}`,
  );
  if (summary.teams.removed.length > 0) {
    console.log(`  removed teams: ${summary.teams.removed.join(", ")}`);
  }
  if (summary.reps.notInConfig.length > 0) {
    console.warn(`  ! reps in the database but not in the file (kept): ${summary.reps.notInConfig.join(", ")}`);
  }
  if (summary.forms.notInConfig.length > 0) {
    console.warn(`  ! forms in the database but not in the file (kept): ${summary.forms.notInConfig.join(", ")}`);
  }
} catch (error) {
  console.error(`✗ apply failed, nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
