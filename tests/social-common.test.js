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
