"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCREENSHOTS_REPO_ROOT = path.resolve(
  process.env.HUSHLINE_SCREENSHOTS_REPO_DIR || path.join(REPO_ROOT, "..", "hushline-screenshots"),
);
const SCREENSHOTS_ROOT = path.join(SCREENSHOTS_REPO_ROOT, "releases", "latest");
const SCREENSHOT_MANIFEST = path.join(SCREENSHOTS_ROOT, "manifest.json");
const HUSHLINE_ROOT = path.resolve(process.env.HUSHLINE_ROOT || path.join(REPO_ROOT, "..", "hushline"));
const HUSHLINE_DOCS_ROOT = path.resolve(process.env.HUSHLINE_DOCS_ROOT || HUSHLINE_ROOT);
const HUSHLINE_DOCS_DIRS = [...new Set([
  path.join(HUSHLINE_ROOT, "docs"),
  path.join(HUSHLINE_DOCS_ROOT, "docs"),
])];
const LOCAL_LOGO = path.join(REPO_ROOT, "assets", "logo-tips.png");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");

const LIMITS = {
  linkedin: 3000,
  mastodon: 500,
  bluesky: 300,
};

const USER_APPLICATIONS = process.env.HOME
  ? path.join(process.env.HOME, "Applications")
  : null;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  USER_APPLICATIONS && path.join(USER_APPLICATIONS, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
  USER_APPLICATIONS && path.join(USER_APPLICATIONS, "Brave Browser.app", "Contents", "MacOS", "Brave Browser"),
].filter(Boolean);

const STOPWORDS = new Set([
  "about",
  "after",
  "align",
  "also",
  "an",
  "and",
  "are",
  "at",
  "auth",
  "but",
  "can",
  "choose",
  "core",
  "does",
  "for",
  "from",
  "full",
  "gap",
  "gaps",
  "has",
  "have",
  "how",
  "into",
  "its",
  "just",
  "line",
  "month",
  "more",
  "new",
  "now",
  "only",
  "our",
  "out",
  "phase",
  "public",
  "remaining",
  "rollout",
  "screen",
  "settings",
  "social",
  "that",
  "the",
  "their",
  "them",
  "this",
  "through",
  "use",
  "user",
  "using",
  "with",
  "wtforms",
]);

const WEEKDAY_LABELS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseLocalDate(date) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return parsed;
}

function getWeekdayLabel(date) {
  return WEEKDAY_LABELS[parseLocalDate(date).getDay()];
}

function isWeekendDate(date) {
  const day = parseLocalDate(date).getDay();
  return day === 0 || day === 6;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function listFilesRecursive(rootDir, predicate = () => true) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const found = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (predicate(nextPath)) {
        found.push(nextPath);
      }
    }
  }

  return found.sort();
}

function findChrome() {
  const executable = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

  if (!executable) {
    throw new Error("No Chrome-compatible browser was found in /Applications or ~/Applications.");
  }

  return executable;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function uniqueTokens(value) {
  return [...new Set(tokenize(value))];
}

function sharedTokenCount(left, right) {
  const leftSet = new Set(uniqueTokens(left));
  const rightSet = new Set(uniqueTokens(right));
  let count = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      count += 1;
    }
  }

  return count;
}

function sentenceCase(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stripFrontmatter(markdown) {
  return String(markdown || "").replace(/^---\n[\s\S]*?\n---\n/, "");
}

function stripMarkdown(markdown) {
  return stripFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptText(markdown, maxLength = 1800) {
  const text = stripMarkdown(markdown);
  if (text.length <= maxLength) {
    return text;
  }

  const clipped = text.slice(0, maxLength);
  const lastPeriod = clipped.lastIndexOf(". ");
  if (lastPeriod > Math.floor(maxLength * 0.6)) {
    return clipped.slice(0, lastPeriod + 1);
  }

  return `${clipped.trimEnd()}…`;
}

function ensureLatestFoldScreenshot(screenshotPath) {
  const resolved = path.resolve(screenshotPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Screenshot not found: ${resolved}`);
  }

  if (
    !resolved.startsWith(`${SCREENSHOTS_ROOT}${path.sep}`) ||
    !path.basename(resolved).endsWith("-fold.png")
  ) {
    throw new Error(
      "Screenshot must come from the local `hushline-screenshots/releases/latest` folder and use an above-the-fold `-fold` capture.",
    );
  }

  return resolved;
}

function resolveScreenshotPath(filePath) {
  const candidate = path.isAbsolute(filePath)
    ? filePath
    : path.join(SCREENSHOTS_ROOT, filePath);

  return ensureLatestFoldScreenshot(candidate);
}

function detectTemplate(screenshotPath) {
  const filename = path.basename(screenshotPath);

  if (filename.includes("-mobile-")) {
    return "mobile";
  }

  if (filename.includes("-desktop-")) {
    return "desktop";
  }

  throw new Error(`Could not infer template type from screenshot name: ${filename}`);
}

function compareTemplateNames(left, right) {
  const leftBase = /^hushline-social-(mobile|desktop)-template\.html$/.test(left);
  const rightBase = /^hushline-social-(mobile|desktop)-template\.html$/.test(right);

  if (leftBase && !rightBase) {
    return -1;
  }

  if (!leftBase && rightBase) {
    return 1;
  }

  return left.localeCompare(right, undefined, { numeric: true });
}

function listTemplateVariants(templateType, templatesDir = TEMPLATES_DIR) {
  const prefix = `hushline-social-${templateType}-template`;
  const pattern = new RegExp(`^${prefix}(?:-.+)?\\.html$`);

  return fs.readdirSync(templatesDir)
    .filter((name) => pattern.test(name))
    .sort(compareTemplateNames)
    .map((name) => path.join(templatesDir, name));
}

function stableIndex(seed, count) {
  let hash = 0;

  for (const char of String(seed || "")) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }

  return count > 0 ? hash % count : 0;
}

function resolveTemplateVariant(post, screenshotPath, templatesDir = TEMPLATES_DIR) {
  const templateType = detectTemplate(screenshotPath);
  const variants = listTemplateVariants(templateType, templatesDir);

  if (variants.length === 0) {
    throw new Error(`No template variants found for type: ${templateType}`);
  }

  const seed = [
    post && post.planned_date,
    post && post.content_key,
    path.basename(screenshotPath),
  ].filter(Boolean).join("\n");
  const templatePath = variants[stableIndex(seed || path.basename(screenshotPath), variants.length)];

  return {
    templateName: path.basename(templatePath),
    templatePath,
    templateType,
  };
}

function clampText(text, limit) {
  const value = String(text || "").trim();
  if (value.length <= limit) {
    return value;
  }

  const clipped = value.slice(0, Math.max(0, limit - 1)).trimEnd();
  return `${clipped}…`;
}

function execJson(command, args, options = {}) {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  });

  return JSON.parse(output);
}

module.exports = {
  CHROME_CANDIDATES,
  HUSHLINE_DOCS_DIRS,
  HUSHLINE_DOCS_ROOT,
  HUSHLINE_ROOT,
  LIMITS,
  LOCAL_LOGO,
  REPO_ROOT,
  SCREENSHOT_MANIFEST,
  SCREENSHOTS_ROOT,
  TEMPLATES_DIR,
  clampText,
  detectTemplate,
  ensureLatestFoldScreenshot,
  excerptText,
  execJson,
  findChrome,
  getWeekdayLabel,
  isWeekendDate,
  listFilesRecursive,
  listTemplateVariants,
  parseLocalDate,
  readJson,
  resolveTemplateVariant,
  resolveScreenshotPath,
  sentenceCase,
  sharedTokenCount,
  stripMarkdown,
  tokenize,
  uniqueTokens,
  writeJson,
};
