"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");
const {
  LOCAL_LOGO,
  REPO_ROOT,
  findChrome,
  getWeekdayLabel,
  isWeekendDate,
  readJson,
  writeJson,
} = require("./social-common");

const VERIFIED_USER_POSTS_ROOT = path.join(REPO_ROOT, "previous-verified-user-posts");
const VERIFIED_USER_TEMPLATE = path.join(REPO_ROOT, "templates", "hushline-social-verified-user-template.html");
const QR_GENERATOR_SCRIPT = path.join(REPO_ROOT, "scripts", "generate_qr_code.swift");
const DEFAULT_DIRECTORY_SOURCE = process.env.HUSHLINE_VERIFIED_USERS_SOURCE || "https://tips.hushline.app/directory/users.json";
const DEFAULT_TIPS_BASE_URL = process.env.HUSHLINE_VERIFIED_USERS_BASE_URL || "https://tips.hushline.app";
const QR_FILENAME = "verified-user-qr.png";

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/render-verified-user-post.js --date 2026-03-30",
      "  node scripts/render-verified-user-post.js --date 2026-03-30 --source ./verified-users.json",
      "",
      "Behavior:",
      "  - Reads verified directory listings from a JSON file or URL",
      "  - Selects one verified user for the requested Monday",
      "  - Fills the verified-user social template with display name, bio, URL, and QR code",
      "  - Writes artifacts under previous-verified-user-posts/YYYY-MM-DD",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_TIPS_BASE_URL,
    date: todayString(),
    noRender: false,
    source: DEFAULT_DIRECTORY_SOURCE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (value === "--source") {
      args.source = argv[index + 1];
      index += 1;
    } else if (value === "--base-url") {
      args.baseUrl = argv[index + 1];
      index += 1;
    } else if (value === "--no-render") {
      args.noRender = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("`--date` must use YYYY-MM-DD format.");
  }

  try {
    new URL(args.baseUrl);
  } catch {
    throw new Error("`--base-url` must be an absolute URL.");
  }

  if (!String(args.source || "").trim()) {
    throw new Error("`--source` must not be empty.");
  }

  return args;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSortValue(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function fetchRemoteJson(source) {
  const client = source.startsWith("https://") ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(source, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        const redirected = new URL(response.headers.location, source).toString();
        resolve(fetchRemoteJson(redirected));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to fetch verified-user directory JSON: ${source} (${response.statusCode})`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Verified-user directory source is not valid JSON: ${source}: ${error.message}`));
        }
      });
    });

    request.on("error", (error) => {
      reject(new Error(`Failed to fetch verified-user directory JSON: ${source}: ${error.message}`));
    });
  });
}

async function readDirectoryPayload(source) {
  if (/^https?:\/\//i.test(source)) {
    return fetchRemoteJson(source);
  }

  const resolvedPath = path.isAbsolute(source) ? source : path.resolve(REPO_ROOT, source);
  return readJson(resolvedPath);
}

function extractDirectoryEntries(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    for (const key of ["users", "entries", "results", "items", "data"]) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
  }

  throw new Error("Verified-user directory JSON must be an array or an object containing `users`, `entries`, `results`, `items`, or `data`.");
}

function buildUserUrl(entry, baseUrl) {
  const rawUrl = normalizeWhitespace(entry.profile_url || entry.user_url || entry.url);
  const username = normalizeWhitespace(entry.primary_username || entry.username);
  let userUrl = "";

  if (rawUrl) {
    userUrl = new URL(rawUrl, baseUrl).toString();
  } else if (username) {
    userUrl = new URL(`/to/${username}`, baseUrl).toString();
  } else {
    throw new Error("Verified user entry is missing both `profile_url` and `primary_username`.");
  }

  const pathname = new URL(userUrl).pathname;
  if (!pathname.startsWith("/to/")) {
    throw new Error(`Verified user URL must point to /to/...: ${userUrl}`);
  }

  return userUrl;
}

function normalizeVerifiedUsers(payload, baseUrl) {
  const entries = extractDirectoryEntries(payload);
  const users = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (entry.entry_type && entry.entry_type !== "user") {
      continue;
    }

    if (!entry.is_verified) {
      continue;
    }

    if (entry.is_admin) {
      continue;
    }

    const displayName = normalizeWhitespace(entry.display_name || entry.name || entry.primary_username || entry.username);
    const bio = normalizeWhitespace(entry.bio || entry.description);
    const username = normalizeWhitespace(entry.primary_username || entry.username);

    if (!displayName || !bio) {
      continue;
    }

    const userUrl = buildUserUrl(entry, baseUrl);
    users.push({
      bio,
      display_name: displayName,
      is_admin: Boolean(entry.is_admin),
      primary_username: username || new URL(userUrl).pathname.replace(/^\/to\//, ""),
      profile_url: normalizeWhitespace(entry.profile_url || ""),
      user_url: userUrl,
    });
  }

  if (users.length === 0) {
    throw new Error("No eligible verified users were found in the directory JSON.");
  }

  return users.sort((left, right) => {
    const leftKey = `${normalizeSortValue(left.display_name)} ${normalizeSortValue(left.primary_username)}`;
    const rightKey = `${normalizeSortValue(right.display_name)} ${normalizeSortValue(right.primary_username)}`;
    return leftKey.localeCompare(rightKey);
  });
}

function loadArchiveHistory(currentDate, archiveRoot = VERIFIED_USER_POSTS_ROOT) {
  if (!fs.existsSync(archiveRoot)) {
    return [];
  }

  return fs
    .readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name < currentDate)
    .map((entry) => entry.name)
    .sort()
    .map((date) => {
      const postPath = path.join(archiveRoot, date, "post.json");
      if (!fs.existsSync(postPath)) {
        return null;
      }

      const post = readJson(postPath);
      return {
        date,
        display_name: post.display_name,
        primary_username: post.primary_username,
        user_url: post.user_url,
      };
    })
    .filter(Boolean);
}

function shuffleKey(user) {
  return crypto
    .createHash("sha256")
    .update(`${user.primary_username}\n${user.user_url}`)
    .digest("hex");
}

function selectVerifiedUser(users, archiveHistory) {
  const postedUsernames = new Set(
    archiveHistory
      .map((entry) => entry.primary_username)
      .filter(Boolean),
  );
  const unseenUsers = users.filter((user) => !postedUsernames.has(user.primary_username));

  if (unseenUsers.length === 0) {
    throw new Error(
      "No unposted verified users remain in the current directory dataset. Refusing to create a duplicate weekly verified-user post.",
    );
  }

  return unseenUsers
    .slice()
    .sort((left, right) => {
      const leftKey = shuffleKey(left);
      const rightKey = shuffleKey(right);
      if (leftKey === rightKey) {
        return left.primary_username.localeCompare(right.primary_username);
      }
      return leftKey.localeCompare(rightKey);
    })[0];
}

function buildPost({ date, selectedUser, source }) {
  return {
    date,
    display_name: selectedUser.display_name,
    headline: selectedUser.display_name,
    image_alt_text: `A social card featuring verified Hush Line user ${selectedUser.display_name}, their bio, their tip line URL, and a QR code that links to the same URL.`,
    planned_date: date,
    primary_username: selectedUser.primary_username,
    qr_code_file: QR_FILENAME,
    slot: "monday-noon",
    source,
    subtext: selectedUser.bio,
    user_link: selectedUser.user_url,
    user_url: selectedUser.user_url,
  };
}

function buildContext({ date, archiveHistory, selectedUser, source, verifiedUsers }) {
  return {
    archive_root: path.relative(REPO_ROOT, VERIFIED_USER_POSTS_ROOT),
    date,
    eligible_verified_user_count: verifiedUsers.length,
    recent_archive_history: archiveHistory.slice(-20),
    selected_user: selectedUser,
    source,
  };
}

function renderHtml(post, qrFilename, logoFilename) {
  let html = fs.readFileSync(VERIFIED_USER_TEMPLATE, "utf8");

  html = html.replace(
    /<h1 class="headline">[\s\S]*?<\/h1>/,
    `<h1 class="headline">${escapeHtml(post.headline)}</h1>`,
  );

  html = html.replace(
    /<p class="subtext">[\s\S]*?<\/p>/,
    `<p class="subtext">\n          ${escapeHtml(post.subtext)}\n        </p>`,
  );

  html = html.replace(
    /<p class="user-link">[\s\S]*?<\/p>/,
    `<p class="user-link">${escapeHtml(post.user_link)}</p>`,
  );

  html = html.replace(
    /<img src="assets\/example-qr\.svg" alt="[^"]*" \/>/,
    `<img src="./${escapeAttribute(qrFilename)}" alt="${escapeAttribute(`QR code for ${post.user_link}`)}" />`,
  );

  html = html.replace(
    /<img src="https:\/\/hushline\.app\/assets\/img\/social\/logo-tips\.png" alt="" \/>/,
    `<img src="./${escapeAttribute(logoFilename)}" alt="" />`,
  );

  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(post.headline)}</title>`,
  );

  html = html.replace(
    "</head>",
    [
      "  <style>",
      "    html, body {",
      "      width: 1024px;",
      "      height: 768px;",
      "      overflow: hidden;",
      "      background: white;",
      "    }",
      "",
      "    body {",
      "      display: block;",
      "      min-height: 0;",
      "    }",
      "",
      "    .canvas {",
      "      margin: 0;",
      "    }",
      "  </style>",
      "</head>",
    ].join("\n"),
  );

  return html;
}

async function renderPng(htmlPath, outputPath) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    defaultViewport: {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
    },
    args: [
      "--allow-file-access-from-files",
      "--disable-background-networking",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-sandbox",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });

    const canvas = await page.$(".canvas");
    if (!canvas) {
      throw new Error("Could not find `.canvas` in the verified-user HTML.");
    }

    await canvas.screenshot({ path: outputPath });
  } finally {
    await browser.close();
  }
}

function generateQrCode(url, outputPath, size = 720) {
  if (!fs.existsSync(QR_GENERATOR_SCRIPT)) {
    throw new Error(`Missing QR generator script: ${QR_GENERATOR_SCRIPT}`);
  }

  const moduleCachePath = path.join("/tmp", "hushline-social-swift-module-cache");
  fs.mkdirSync(moduleCachePath, { recursive: true });

  try {
    execFileSync("swift", [
      "-module-cache-path",
      moduleCachePath,
      QR_GENERATOR_SCRIPT,
      url,
      outputPath,
      String(size),
    ], {
      stdio: "pipe",
    });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    throw new Error(stderr || `Failed to generate QR code for ${url}.`);
  }
}

async function renderVerifiedUserPost(run, options = {}) {
  const archiveRoot = options.archiveRoot || VERIFIED_USER_POSTS_ROOT;
  const outputDir = path.join(archiveRoot, run.date);
  const htmlPath = path.join(outputDir, "social-card.html");
  const pngPath = path.join(outputDir, "social-card@2x.png");
  const postPath = path.join(outputDir, "post.json");
  const contextPath = path.join(outputDir, "context.json");
  const qrPath = path.join(outputDir, QR_FILENAME);
  const logoFilename = path.basename(LOCAL_LOGO);

  if (!fs.existsSync(LOCAL_LOGO)) {
    throw new Error(`Missing local logo asset: ${LOCAL_LOGO}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(contextPath, run.context);
  writeJson(postPath, run.post);

  if (run.noRender) {
    return {
      contextPath,
      outputDir,
      postPath,
      rendered: false,
    };
  }

  fs.copyFileSync(LOCAL_LOGO, path.join(outputDir, logoFilename));
  generateQrCode(run.post.user_url, qrPath);

  const html = renderHtml(run.post, path.basename(qrPath), logoFilename);
  fs.writeFileSync(htmlPath, html);
  await renderPng(htmlPath, pngPath);

  return {
    contextPath,
    htmlPath,
    outputDir,
    pngPath,
    postPath,
    qrPath,
    rendered: true,
  };
}

async function prepareVerifiedUserRun(args, options = {}) {
  if (isWeekendDate(args.date) || getWeekdayLabel(args.date) !== "monday") {
    throw new Error(`Verified-user weekly posts run only on Mondays: ${args.date} (${getWeekdayLabel(args.date)}).`);
  }

  const payload = await readDirectoryPayload(args.source);
  const verifiedUsers = normalizeVerifiedUsers(payload, args.baseUrl);
  const archiveHistory = loadArchiveHistory(args.date, options.archiveRoot);
  const selectedUser = selectVerifiedUser(verifiedUsers, archiveHistory);

  return {
    context: buildContext({
      archiveHistory,
      date: args.date,
      selectedUser,
      source: args.source,
      verifiedUsers,
    }),
    date: args.date,
    noRender: args.noRender,
    post: buildPost({
      date: args.date,
      selectedUser,
      source: args.source,
    }),
    selectedUser,
  };
}

module.exports = {
  DEFAULT_DIRECTORY_SOURCE,
  DEFAULT_TIPS_BASE_URL,
  QR_FILENAME,
  VERIFIED_USER_POSTS_ROOT,
  buildPost,
  loadArchiveHistory,
  normalizeVerifiedUsers,
  parseArgs,
  prepareVerifiedUserRun,
  renderHtml,
  renderVerifiedUserPost,
  selectVerifiedUser,
};
