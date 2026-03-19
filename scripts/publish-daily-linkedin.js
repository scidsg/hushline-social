#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const {
  REPO_ROOT,
  readJson,
  writeJson,
} = require("./lib/social-common");

function formatIsoWeek(date) {
  const cursor = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((cursor - yearStart) / 86400000) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function defaultLinkedInVersion() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseArgs(argv) {
  const args = {
    date: todayString(),
    dryRun: false,
    force: false,
    plan: null,
    week: formatIsoWeek(new Date()),
    weeksRoot: path.join(REPO_ROOT, "weeks"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--week") {
      args.week = argv[index + 1];
      index += 1;
    } else if (value === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (value === "--plan") {
      args.plan = path.resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
    } else if (value === "--weeks-root") {
      args.weeksRoot = path.resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
    } else if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--force") {
      args.force = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!/^\d{4}-W\d{2}$/.test(args.week)) {
    throw new Error("`--week` must use YYYY-Www format.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("`--date` must use YYYY-MM-DD format.");
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/publish-daily-linkedin.js",
      "  node scripts/publish-daily-linkedin.js --week 2026-W12 --date 2026-03-18",
      "  node scripts/publish-daily-linkedin.js --dry-run",
      "",
      "Environment:",
      "  LINKEDIN_ACCESS_TOKEN    OAuth access token with LinkedIn posting permissions",
      "  LINKEDIN_AUTHOR_URN      urn:li:person:... or urn:li:organization:...",
      "  LINKEDIN_API_VERSION     Optional, defaults to current YYYYMM",
      "",
    ].join("\n"),
  );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getPlanPath(args) {
  return args.plan || path.join(REPO_ROOT, "plans", args.week, "plan.json");
}

function getPostOutputDir(plan, post, weeksRoot) {
  return path.join(weeksRoot, plan.week, post.slot);
}

function getPublicationStatePath(plan, post, weeksRoot) {
  return path.join(getPostOutputDir(plan, post, weeksRoot), "linkedin-publication.json");
}

async function linkedinRequest({ method, pathOrUrl, token, version, body, headers = {} }) {
  const isAbsolute = /^https?:\/\//.test(pathOrUrl);
  const url = isAbsolute ? pathOrUrl : `https://api.linkedin.com/rest${pathOrUrl}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Linkedin-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
      ...headers,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LinkedIn API ${method} ${url} failed with ${response.status}: ${errorText}`);
  }

  return response;
}

async function initializeImageUpload(authorUrn, token, version) {
  const response = await linkedinRequest({
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
      },
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    pathOrUrl: "/images?action=initializeUpload",
    token,
    version,
  });

  return response.json();
}

async function uploadImage(uploadUrl, imagePath, token, version) {
  const imageBuffer = fs.readFileSync(imagePath);
  const response = await linkedinRequest({
    body: imageBuffer,
    headers: {
      "Content-Type": "image/png",
    },
    method: "POST",
    pathOrUrl: uploadUrl,
    token,
    version,
  });

  return response.status;
}

async function waitForImageAvailable(imageUrn, token, version) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await linkedinRequest({
      method: "GET",
      pathOrUrl: `/images/${encodeURIComponent(imageUrn)}`,
      token,
      version,
    });
    const image = await response.json();
    if (image.status === "AVAILABLE") {
      return image;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for LinkedIn image to become AVAILABLE: ${imageUrn}`);
}

async function createLinkedInPost({ authorUrn, commentary, imageUrn, altText, token, version }) {
  const response = await linkedinRequest({
    body: JSON.stringify({
      author: authorUrn,
      commentary,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        media: {
          altText,
          id: imageUrn,
        },
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    pathOrUrl: "/posts",
    token,
    version,
  });

  return {
    postId: response.headers.get("x-restli-id") || "",
    status: response.status,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = getPlanPath(args);

  if (!fs.existsSync(planPath)) {
    throw new Error(`Weekly plan not found: ${planPath}`);
  }

  const plan = readJson(planPath);
  if (!plan.week) {
    throw new Error(`Plan is not a weekly plan: ${planPath}`);
  }

  const post = plan.posts.find((entry) => entry.planned_date === args.date);
  if (!post) {
    process.stdout.write(`No LinkedIn post scheduled for ${args.date} in ${plan.week}.\n`);
    return;
  }

  const outputDir = getPostOutputDir(plan, post, args.weeksRoot);
  const imagePath = path.join(outputDir, "social-card@2x.png");
  const publicationPath = getPublicationStatePath(plan, post, args.weeksRoot);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Rendered image not found for ${post.slot}: ${imagePath}`);
  }

  if (fs.existsSync(publicationPath) && !args.force) {
    const state = readJson(publicationPath);
    process.stdout.write(
      `LinkedIn post for ${post.slot} on ${args.date} already published: ${state.post_id || "unknown"}\n`,
    );
    return;
  }

  if (args.dryRun) {
    process.stdout.write(
      [
        `Dry run: LinkedIn publication prepared for ${args.date}`,
        `- week: ${plan.week}`,
        `- slot: ${post.slot}`,
        `- image: ${path.relative(REPO_ROOT, imagePath)}`,
        `- commentary length: ${post.social.linkedin.length}`,
        "",
      ].join("\n"),
    );
    return;
  }

  const token = requireEnv("LINKEDIN_ACCESS_TOKEN");
  const authorUrn = requireEnv("LINKEDIN_AUTHOR_URN");
  const version = process.env.LINKEDIN_API_VERSION || defaultLinkedInVersion();

  const initialized = await initializeImageUpload(authorUrn, token, version);
  const imageUrn = initialized?.value?.image;
  const uploadUrl = initialized?.value?.uploadUrl;

  if (!imageUrn || !uploadUrl) {
    throw new Error("LinkedIn image initializeUpload response did not include image URN and upload URL.");
  }

  await uploadImage(uploadUrl, imagePath, token, version);
  await waitForImageAvailable(imageUrn, token, version);

  const created = await createLinkedInPost({
    altText: post.image_alt_text,
    authorUrn,
    commentary: post.social.linkedin,
    imageUrn,
    token,
    version,
  });

  writeJson(publicationPath, {
    author_urn: authorUrn,
    commentary: post.social.linkedin,
    image_path: path.relative(REPO_ROOT, imagePath),
    image_urn: imageUrn,
    planned_date: post.planned_date,
    post_id: created.postId,
    posted_at: new Date().toISOString(),
    slot: post.slot,
    status: created.status,
    week: plan.week,
  });

  process.stdout.write(
    [
      `Published LinkedIn post for ${post.slot}`,
      `- week: ${plan.week}`,
      `- planned date: ${post.planned_date}`,
      `- post id: ${created.postId || "unknown"}`,
      `- publication record: ${path.relative(REPO_ROOT, publicationPath)}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
