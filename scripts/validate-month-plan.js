#!/usr/bin/env node

"use strict";

const path = require("path");
const { renderPlan } = require("./lib/render-social-post");
const { buildPlanningContext, parseArgs, validatePlan } = require("./lib/monthly-planner");
const { REPO_ROOT, readJson, writeJson } = require("./lib/social-common");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = buildPlanningContext(args);
  const planPath = path.join(REPO_ROOT, "plans", args.month, "plan.json");
  const rawPlan = readJson(planPath);
  const validatedPlan = validatePlan(rawPlan, context);

  writeJson(planPath, validatedPlan);

  let rendered = [];
  if (!args.noRender) {
    rendered = await renderPlan(validatedPlan);
  }

  process.stdout.write(
    [
      `Validated monthly plan for ${validatedPlan.month}`,
      `- ${path.relative(REPO_ROOT, planPath)}`,
      args.noRender
        ? "- rendering skipped"
        : `- rendered ${rendered.length} posts into ${path.relative(REPO_ROOT, path.join(REPO_ROOT, "months", validatedPlan.month))}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
