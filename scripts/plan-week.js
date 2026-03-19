#!/usr/bin/env node

"use strict";

const path = require("path");
const { renderPlan } = require("./lib/render-social-post");
const { parseArgs, planWeek } = require("./lib/weekly-planner");
const { REPO_ROOT } = require("./lib/social-common");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await planWeek(args);

  process.stdout.write(
    [
      `Prepared weekly planning context for ${args.week}`,
      `- ${path.relative(REPO_ROOT, result.contextPath)}`,
      `- ${path.relative(REPO_ROOT, result.promptPath)}`,
      `- target plan path: ${path.relative(REPO_ROOT, result.planPath)}`,
      `- shortlisted ${result.context.candidate_screenshots.length} candidate screenshots`,
      `- planned ${result.context.slots.length} weekday slots`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
