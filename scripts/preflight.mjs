/**
 * Refuses to deploy a wrangler.toml that has not been filled in.
 *
 * Without this, an unedited `database_id` fails inside `wrangler deploy` with a
 * message about a database that cannot be found, several minutes into a build,
 * which is a confusing place to learn that a placeholder was never replaced.
 */

import { readFileSync } from "node:fs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const warnOnly = process.argv.includes("--warn");

let config;
try {
  config = readFileSync("wrangler.toml", "utf8");
} catch {
  fail(["wrangler.toml is missing."]);
}

const problems = [];

const databaseId = config.match(/^\s*database_id\s*=\s*"([^"]*)"/m)?.[1];
if (databaseId === undefined) {
  problems.push(
    "wrangler.toml has no database_id.\n" +
      "  Add a [[d1_databases]] block, or remove the D1 binding if you meant to.",
  );
} else if (!UUID.test(databaseId)) {
  problems.push(
    `database_id in wrangler.toml is still "${databaseId}", which is not a real database.\n` +
      "\n" +
      "  1. npx wrangler d1 create finance-monitor\n" +
      "  2. copy the database_id it prints\n" +
      "  3. paste it into wrangler.toml, replacing that value\n" +
      "  4. commit and push (the id is not a secret — it belongs in the repo)\n",
  );
}

if (problems.length === 0) process.exit(0);

if (warnOnly) {
  console.warn(`\n⚠  Not ready to deploy:\n\n${problems.join("\n")}\n`);
  process.exit(0);
}
fail(problems);

function fail(list) {
  console.error(`\n✕ Cannot deploy yet.\n\n${list.join("\n")}`);
  console.error("Run `npm run dev:cf` to use the app locally without deploying.\n");
  process.exit(1);
}
