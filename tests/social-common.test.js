const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modulePath = require.resolve("../scripts/lib/social-common");

function withFreshSocialCommon(tempScreenshotsRepoDir) {
  const previousScreenshotsRoot = process.env.HUSHLINE_SCREENSHOTS_REPO_DIR;
  process.env.HUSHLINE_SCREENSHOTS_REPO_DIR = tempScreenshotsRepoDir;
  delete require.cache[modulePath];
  const socialCommon = require("../scripts/lib/social-common");

  return {
    cleanup() {
      delete require.cache[modulePath];
      if (previousScreenshotsRoot === undefined) {
        delete process.env.HUSHLINE_SCREENSHOTS_REPO_DIR;
      } else {
        process.env.HUSHLINE_SCREENSHOTS_REPO_DIR = previousScreenshotsRoot;
      }
    },
    socialCommon,
  };
}

test("getWeekdayLabel and isWeekendDate classify weekdays correctly", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "social-common-"));
  const { socialCommon, cleanup } = withFreshSocialCommon(tempRoot);

  try {
    assert.equal(socialCommon.getWeekdayLabel("2026-03-20"), "friday");
    assert.equal(socialCommon.getWeekdayLabel("2026-03-21"), "saturday");
    assert.equal(socialCommon.isWeekendDate("2026-03-20"), false);
    assert.equal(socialCommon.isWeekendDate("2026-03-22"), true);
  } finally {
    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("archive key helpers parse base and suffixed containers correctly", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "social-common-"));
  const { socialCommon, cleanup } = withFreshSocialCommon(tempRoot);

  try {
    assert.equal(socialCommon.isValidArchiveKey("2026-03-26"), true);
    assert.equal(socialCommon.isValidArchiveKey("2026-03-26-2"), true);
    assert.equal(socialCommon.isValidArchiveKey("2026-03-26-extra"), false);
    assert.equal(socialCommon.archiveKeyDate("2026-03-26-2"), "2026-03-26");
    assert.deepEqual(socialCommon.parseArchiveKey("2026-03-26-2"), {
      date: "2026-03-26",
      key: "2026-03-26-2",
      suffix: 2,
    });
    assert.equal(socialCommon.compareArchiveKeys("2026-03-26", "2026-03-26-1"), -1);
    assert.equal(socialCommon.compareArchiveKeys("2026-03-26-2", "2026-03-26-1"), 1);
    assert.equal(socialCommon.compareArchiveKeys("2026-03-27", "2026-03-26-9"), 1);
  } finally {
    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("ensureLatestFoldScreenshot accepts only files under releases/latest ending in -fold.png", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "social-common-"));
  const latestDir = path.join(tempRoot, "releases", "latest", "guest");
  const oldDir = path.join(tempRoot, "releases", "2026-03-01", "guest");
  fs.mkdirSync(latestDir, { recursive: true });
  fs.mkdirSync(oldDir, { recursive: true });

  const validPath = path.join(latestDir, "guest-directory-verified-desktop-light-fold.png");
  const nonFoldPath = path.join(latestDir, "guest-directory-verified-desktop-light.png");
  const stalePath = path.join(oldDir, "guest-directory-verified-desktop-light-fold.png");

  fs.writeFileSync(validPath, "png");
  fs.writeFileSync(nonFoldPath, "png");
  fs.writeFileSync(stalePath, "png");

  const { socialCommon, cleanup } = withFreshSocialCommon(tempRoot);

  try {
    assert.equal(socialCommon.ensureLatestFoldScreenshot(validPath), validPath);
    assert.throws(() => socialCommon.ensureLatestFoldScreenshot(nonFoldPath), /must come from the local `hushline-screenshots\/releases\/latest` folder/);
    assert.throws(() => socialCommon.ensureLatestFoldScreenshot(stalePath), /must come from the local `hushline-screenshots\/releases\/latest` folder/);
  } finally {
    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("listTemplateVariants discovers base and suffixed template files for a type", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "social-common-"));
  const templatesDir = path.join(tempRoot, "templates");
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template.html"), "");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template-2.html"), "");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template-10.html"), "");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-desktop-template.html"), "");

  const { socialCommon, cleanup } = withFreshSocialCommon(tempRoot);

  try {
    const variants = socialCommon.listTemplateVariants("mobile", templatesDir).map((filePath) => path.basename(filePath));
    assert.deepEqual(variants, [
      "hushline-social-mobile-template.html",
      "hushline-social-mobile-template-2.html",
      "hushline-social-mobile-template-10.html",
    ]);
  } finally {
    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("resolveTemplateVariant automatically uses newly added matching template variants", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "social-common-"));
  const latestDir = path.join(tempRoot, "releases", "latest", "guest");
  const templatesDir = path.join(tempRoot, "templates");
  fs.mkdirSync(latestDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  const screenshotPath = path.join(latestDir, "guest-directory-verified-mobile-light-fold.png");
  fs.writeFileSync(screenshotPath, "png");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template.html"), "");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template-2.html"), "");
  fs.writeFileSync(path.join(templatesDir, "hushline-social-mobile-template-3.html"), "");

  const { socialCommon, cleanup } = withFreshSocialCommon(tempRoot);

  try {
    const selections = new Set();
    const allowed = [
      "hushline-social-mobile-template.html",
      "hushline-social-mobile-template-2.html",
      "hushline-social-mobile-template-3.html",
    ];

    for (const plannedDate of ["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-30"]) {
      const selection = socialCommon.resolveTemplateVariant({
        planned_date: plannedDate,
        content_key: "guest-directory-verified",
      }, screenshotPath, templatesDir);
      assert.match(selection.templateName, /^hushline-social-mobile-template(?:-.+)?\.html$/);
      assert.ok(allowed.includes(selection.templateName));
      selections.add(selection.templateName);
    }

    assert.ok(selections.size > 1);
  } finally {
    cleanup();
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
