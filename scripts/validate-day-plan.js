#!/usr/bin/env node

"use strict";

const path = require("path");
const {
  buildDailyContext,
  loadSavedDailyContext,
  parseArgs,
  renderDailyPlan,
  validatePlan,
} = require("./lib/daily-planner");
const { REPO_ROOT, readJson, writeJson } = require("./lib/social-common");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = loadSavedDailyContext(args.archiveKey) || buildDailyContext(args);
  const planPath = path.join(REPO_ROOT, "previous-posts", args.archiveKey, "plan.json");
  const rawPlan = readJson(planPath);
  const validatedPlan = validatePlan(rawPlan, context);

  writeJson(planPath, validatedPlan);

  let rendered = null;
  if (!args.noRender) {
    rendered = await renderDailyPlan(validatedPlan, args.archiveKey);
  }

  process.stdout.write(
    [
      `Validated daily plan for ${validatedPlan.date}`,
      `- ${path.relative(REPO_ROOT, planPath)}`,
      args.noRender
        ? "- rendering skipped"
        : `- rendered into ${path.relative(REPO_ROOT, rendered.outputDir)}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
