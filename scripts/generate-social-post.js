#!/usr/bin/env node

"use strict";

const path = require("path");
const { renderPlan, renderPost } = require("./lib/render-social-post");
const { REPO_ROOT, readJson } = require("./lib/social-common");

function parseArgs(argv) {
  const args = {
    outputDir: null,
    plan: null,
    postId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--plan") {
      args.plan = path.resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
    } else if (value === "--post-id") {
      args.postId = argv[index + 1];
      index += 1;
    } else if (value === "--output-dir") {
      args.outputDir = path.resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!args.plan) {
    throw new Error("`--plan` is required.");
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/generate-social-post.js --plan plans/2026-W12/plan.json",
      "  node scripts/generate-social-post.js --plan plans/2026-W12/plan.json --post-id monday",
      "",
      "Behavior:",
      "  - Renders posts from a generated weekly or monthly plan",
      "  - Uses the existing mobile or desktop template based on the selected screenshot",
      "  - Writes PNG, HTML, TXT, and JSON output for each post",
      "",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readJson(args.plan);
  const periodKey = plan.week || plan.month;
  const periodDir = plan.week ? "weeks" : "months";

  if (args.postId) {
    const post = plan.posts.find((entry) => entry.slot === args.postId);
    if (!post) {
      throw new Error(`Could not find slot ${args.postId} in ${args.plan}.`);
    }

    const outputDir =
      args.outputDir ||
      path.join(REPO_ROOT, periodDir, periodKey, post.slot);
    const result = await renderPost(post, outputDir);

    process.stdout.write(
      [
        `Rendered ${post.slot}`,
        `- ${path.relative(REPO_ROOT, result.outputDir)}`,
        `- ${path.relative(REPO_ROOT, result.pngPath)}`,
        "",
      ].join("\n"),
    );
    return;
  }

  const rendered = await renderPlan(plan, {
    periodRoot: args.outputDir || path.join(REPO_ROOT, periodDir, periodKey),
  });

  process.stdout.write(
    [
      `Rendered ${rendered.length} posts from ${path.relative(REPO_ROOT, args.plan)}`,
      `- ${path.relative(REPO_ROOT, args.outputDir || path.join(REPO_ROOT, periodDir, periodKey))}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
