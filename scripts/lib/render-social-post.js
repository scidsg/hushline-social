"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { pathToFileURL } = require("url");
const {
  LIMITS,
  LOCAL_LOGO,
  REPO_ROOT,
  clampText,
  detectTemplate,
  ensureLatestFoldScreenshot,
  findChrome,
} = require("./social-common");

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

function validatePost(post) {
  const requiredFields = [
    "headline",
    "subtext",
    "image_alt_text",
    "slot",
    "planned_date",
    "screenshot_file",
  ];

  for (const field of requiredFields) {
    if (!String(post[field] || "").trim()) {
      throw new Error(`Missing required post field: ${field}`);
    }
  }

  if (!post.social || typeof post.social !== "object") {
    throw new Error("Post must include a `social` object.");
  }

  const networks = ["linkedin", "mastodon", "bluesky"];
  for (const network of networks) {
    const value = String(post.social[network] || "").trim();
    if (!value) {
      throw new Error(`Missing social copy for ${network}.`);
    }

    if (value.length > LIMITS[network]) {
      throw new Error(
        `${network} copy exceeds ${LIMITS[network]} characters for slot ${post.slot}.`,
      );
    }
  }
}

function buildTxt(post, screenshotPath, templateType) {
  const linkedin = clampText(post.social.linkedin, LIMITS.linkedin);
  const mastodon = clampText(post.social.mastodon, LIMITS.mastodon);
  const bluesky = clampText(post.social.bluesky, LIMITS.bluesky);

  return [
    `Slot: ${post.slot}`,
    `Planned date: ${post.planned_date}`,
    `Template: ${templateType}`,
    `Screenshot: ${screenshotPath}`,
    `Content key: ${post.content_key || ""}`.trimEnd(),
    `Headline: ${post.headline.replace(/\n/g, " ")}`,
    `Subtext: ${post.subtext}`,
    "",
    "Image alt text",
    post.image_alt_text,
    "",
    "Social post copy",
    "",
    `LinkedIn (${linkedin.length}/${LIMITS.linkedin})`,
    linkedin,
    "",
    `Mastodon (${mastodon.length}/${LIMITS.mastodon})`,
    mastodon,
    "",
    `Bluesky (${bluesky.length}/${LIMITS.bluesky})`,
    bluesky,
    "",
  ].join("\n");
}

function renderHtml(templatePath, post, screenshotFilename, logoFilename) {
  let html = fs.readFileSync(templatePath, "utf8");

  html = html.replace(
    /^\s*<link rel="preconnect"[\s\S]*?display=swap" rel="stylesheet">\n/m,
    "",
  );

  html = html.replace(
    /<h1 class="headline">[\s\S]*?<\/h1>/,
    `<h1 class="headline">${escapeHtml(post.headline).replace(/\n/g, "<br />")}</h1>`,
  );

  html = html.replace(
    /<p class="subtext">[\s\S]*?<\/p>/,
    `<p class="subtext">\n          ${escapeHtml(post.subtext)}\n        </p>`,
  );

  html = html.replace(
    /<img src="[^"]+" alt="Hush Line onboarding screen" \/>/,
    `<img src="./${escapeAttribute(screenshotFilename)}" alt="${escapeAttribute(post.image_alt_text)}" />`,
  );

  html = html.replace(
    /<img src="https:\/\/hushline\.app\/assets\/img\/social\/logo-tips\.png" alt="" \/>/,
    `<img src="./${escapeAttribute(logoFilename)}" alt="" />`,
  );

  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(post.headline.replace(/\n/g, " "))}</title>`,
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
      "--hide-scrollbars",
      "--no-first-run",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });

    const canvas = await page.$(".canvas");
    if (!canvas) {
      throw new Error("Could not find `.canvas` in the rendered HTML.");
    }

    await canvas.screenshot({ path: outputPath });
  } finally {
    await browser.close();
  }
}

async function renderPost(post, outputDir) {
  validatePost(post);

  const screenshotPath = ensureLatestFoldScreenshot(
    path.isAbsolute(post.screenshot_file)
      ? post.screenshot_file
      : path.join(REPO_ROOT, "..", "hushline-screenshots", "releases", "latest", post.screenshot_file),
  );
  const templateType = detectTemplate(screenshotPath);
  const templatePath = path.join(
    REPO_ROOT,
    "templates",
    `hushline-social-${templateType}-template.html`,
  );
  const screenshotFilename = path.basename(screenshotPath);
  const logoFilename = path.basename(LOCAL_LOGO);
  const htmlPath = path.join(outputDir, "social-card.html");
  const txtPath = path.join(outputDir, "post-copy.txt");
  const pngPath = path.join(outputDir, "social-card@2x.png");
  const postPath = path.join(outputDir, "post.json");

  if (!fs.existsSync(LOCAL_LOGO)) {
    throw new Error(`Missing local logo asset: ${LOCAL_LOGO}`);
  }

  const html = renderHtml(templatePath, post, screenshotFilename, logoFilename);
  const txt = buildTxt(post, screenshotPath, templateType);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(screenshotPath, path.join(outputDir, screenshotFilename));
  fs.copyFileSync(LOCAL_LOGO, path.join(outputDir, logoFilename));
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(txtPath, txt);
  fs.writeFileSync(postPath, `${JSON.stringify(post, null, 2)}\n`);
  await renderPng(htmlPath, pngPath);

  return {
    htmlPath,
    outputDir,
    pngPath,
    postPath,
    screenshotPath,
    txtPath,
  };
}

async function renderPlan(plan, options = {}) {
  const periodKey = plan.week || plan.month;
  const periodRoot =
    options.periodRoot ||
    path.join(REPO_ROOT, plan.week ? "weeks" : "months", periodKey);
  const outputs = [];

  for (const post of plan.posts) {
    const outputDir = path.join(periodRoot, post.slot);
    outputs.push(await renderPost(post, outputDir));
  }

  return outputs;
}

module.exports = {
  renderPlan,
  renderPost,
};
