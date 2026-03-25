#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  REPO_ROOT,
  getWeekdayLabel,
  isWeekendDate,
  readJson,
} = require("./lib/social-common");

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
    allowWeekend: false,
    date: todayString(),
    dateRoot: path.join(REPO_ROOT, "previous-posts"),
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (value === "--date-root") {
      args.dateRoot = path.resolve(REPO_ROOT, argv[index + 1]);
      index += 1;
    } else if (value === "--allow-weekend") {
      args.allowWeekend = true;
    } else if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--force") {
      args.force = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
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
      "  node scripts/publish-daily-linkedin.js --date 2026-03-18",
      "  node scripts/publish-daily-linkedin.js --date 2026-03-30 --date-root previous-verified-user-posts",
      "  node scripts/publish-daily-linkedin.js --date 2026-03-29 --date-root previous-verified-user-posts --allow-weekend",
      "  node scripts/publish-daily-linkedin.js --dry-run",
      "",
      "Behavior:",
      "  - Publishes from previous-posts/YYYY-MM-DD by default",
      "  - Can also publish verified-user archives via --date-root previous-verified-user-posts",
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

function getDailyPostDir(args) {
  return path.join(args.dateRoot, args.date);
}

function getRepoArchiveRootName(args) {
  const resolvedDateRoot = path.resolve(args.dateRoot);

  if (resolvedDateRoot === path.join(REPO_ROOT, "previous-posts")) {
    return "previous-posts";
  }

  if (resolvedDateRoot === path.join(REPO_ROOT, "previous-verified-user-posts")) {
    return "previous-verified-user-posts";
  }

  return null;
}

function remoteArchivePublished(args) {
  const archiveRootName = getRepoArchiveRootName(args);

  if (!archiveRootName) {
    return { published: false };
  }

  const remote = process.env.HUSHLINE_SOCIAL_ARCHIVE_REMOTE || "origin";
  const branch = process.env.HUSHLINE_SOCIAL_ARCHIVE_BRANCH || "main";
  const archivePath = `${archiveRootName}/${args.date}/post.json`;
  const remoteRef = `refs/remotes/${remote}/${branch}`;

  try {
    execFileSync("git", ["fetch", "--quiet", remote, `${branch}:${remoteRef}`], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    execFileSync("git", ["cat-file", "-e", `${remote}/${branch}:${archivePath}`], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return { archiveRootName, branch, published: true, remote };
  } catch {
    return { archiveRootName, branch, published: false, remote };
  }
}

function resolveArchivedDailyPost(args) {
  const outputDir = getDailyPostDir(args);
  const postPath = path.join(outputDir, "post.json");
  const imagePath = path.join(outputDir, "social-card@2x.png");
  const archiveRootName = path.basename(args.dateRoot);

  if (!fs.existsSync(postPath)) {
    return null;
  }

  return {
    imagePath,
    outputDir,
    post: readJson(postPath),
    summaryLabel: args.date,
    type: archiveRootName === "previous-verified-user-posts" ? "verified-user-archive" : "daily-archive",
  };
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

  if (isWeekendDate(args.date) && !args.allowWeekend) {
    process.stdout.write(`Skipping LinkedIn publication for weekend date ${args.date} (${getWeekdayLabel(args.date)}).\n`);
    return;
  }

  const resolved = resolveArchivedDailyPost(args);

  if (!resolved) {
    process.stdout.write(`No archived daily LinkedIn post content found for ${args.date}.\n`);
    return;
  }
  const {
    imagePath,
    post,
    summaryLabel,
    type,
  } = resolved;
  const remotePublished = remoteArchivePublished(args);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Rendered image not found for ${post.slot}: ${imagePath}`);
  }

  if (remotePublished.published && !args.force) {
    const archiveLabel = remotePublished.archiveRootName === "previous-verified-user-posts"
      ? "Verified-user archive"
      : "Daily archive";
    process.stdout.write(
      `${archiveLabel} for ${args.date} is already present on ${remotePublished.remote}/${remotePublished.branch}; assuming LinkedIn post already published.\n`,
    );
    return;
  }

  if (args.dryRun) {
    process.stdout.write(
      [
        `Dry run: LinkedIn publication prepared for ${args.date}`,
        `- source: ${type}`,
        `- container: ${summaryLabel}`,
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

  process.stdout.write(
    [
      `Published LinkedIn post for ${post.slot}`,
      `- source: ${type}`,
      `- container: ${summaryLabel}`,
      `- planned date: ${post.planned_date}`,
      `- post id: ${created.postId || "unknown"}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
