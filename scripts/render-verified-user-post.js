#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  VERIFIED_USER_POSTS_ROOT,
  buildVerifiedUserSocialPrompt,
  composeVerifiedUserSocialCopy,
  parseArgs,
  prepareVerifiedUserRun,
  renderVerifiedUserPost,
  validateVerifiedUserSocialParagraphs,
} = require("./lib/verified-user-post");
const { REPO_ROOT } = require("./lib/social-common");

const CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.4";
const CODEX_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || "high";

function requireCommand(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function generateVerifiedUserCopy(run, outputDir) {
  requireCommand("codex");
  const copyPath = path.join(outputDir, "copy.json");
  const promptPath = path.join(outputDir, "copy-prompt.txt");
  fs.mkdirSync(outputDir, { recursive: true });
  let feedback = "";
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const codexOutputPath = path.join(os.tmpdir(), `verified-user-codex-output-${process.pid}-${Date.now()}-${attempt}.txt`);
    if (fs.existsSync(copyPath)) {
      fs.unlinkSync(copyPath);
    }
    const prompt = buildVerifiedUserSocialPrompt({
      date: run.date,
      feedback,
      outputPath: path.relative(REPO_ROOT, copyPath),
      selectedUser: run.selectedUser,
    });
    fs.writeFileSync(promptPath, `${prompt}\n`);

    const result = spawnSync(
      "codex",
      [
        "exec",
        "--model",
        CODEX_MODEL,
        "-c",
        `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "-C",
        REPO_ROOT,
        "-o",
        codexOutputPath,
        "-",
      ],
      {
        encoding: "utf8",
        input: prompt,
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    if (result.status !== 0) {
      const stderr = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(stderr || `Codex copy generation failed with exit ${result.status}.`);
    }

    if (!fs.existsSync(copyPath)) {
      throw new Error(`Codex did not write verified-user copy to ${copyPath}.`);
    }

    try {
      const generated = JSON.parse(fs.readFileSync(copyPath, "utf8"));
      const paragraphs = validateVerifiedUserSocialParagraphs(generated, run.selectedUser);
      return {
        copyPath,
        promptPath,
        social: {
          bluesky: composeVerifiedUserSocialCopy("bluesky", run.selectedUser, paragraphs.bluesky),
          linkedin: composeVerifiedUserSocialCopy("linkedin", run.selectedUser, paragraphs.linkedin),
          mastodon: composeVerifiedUserSocialCopy("mastodon", run.selectedUser, paragraphs.mastodon),
        },
      };
    } catch (error) {
      lastError = error;
      feedback = `The previous draft failed validation: ${error.message} Rewrite it more directly and avoid profile-meta phrasing.`;
    }
  }

  throw lastError || new Error("Codex copy generation failed validation.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const run = await prepareVerifiedUserRun(args);
  const outputDir = path.join(VERIFIED_USER_POSTS_ROOT, args.date);
  const generatedCopy = generateVerifiedUserCopy(run, outputDir);
  run.post.social = generatedCopy.social;
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
