#!/usr/bin/env node

"use strict";

const path = require("path");
const {
  VERIFIED_USER_POSTS_ROOT,
  parseArgs,
  prepareVerifiedUserRun,
  renderVerifiedUserPost,
} = require("./lib/verified-user-post");
const { REPO_ROOT } = require("./lib/social-common");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const run = await prepareVerifiedUserRun(args);
  const rendered = await renderVerifiedUserPost(run);
  const archiveRel = path.relative(REPO_ROOT, path.join(VERIFIED_USER_POSTS_ROOT, args.date));

  process.stdout.write(
    [
      `Prepared verified-user weekly post for ${args.date}`,
      `- selected ${run.selectedUser.display_name} (@${run.selectedUser.primary_username})`,
      `- archive: ${archiveRel}`,
      args.noRender ? "- rendering skipped" : `- rendered into ${path.relative(REPO_ROOT, rendered.outputDir)}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
