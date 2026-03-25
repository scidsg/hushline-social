const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const scriptPath = path.join(REPO_ROOT, "scripts", "publish-daily-linkedin.js");

function runPublisher(args) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

test("publisher skips weekend dates cleanly", () => {
  const output = runPublisher(["--date", "2026-03-21", "--dry-run"]);
  assert.match(output, /Skipping LinkedIn publication for weekend date 2026-03-21 \(saturday\)\./);
});

test("publisher allows explicit weekend overrides for verified-user archives", () => {
  const tempRootParent = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-publish-"));
  const tempRoot = path.join(tempRootParent, "previous-verified-user-posts");
  const postDir = path.join(tempRoot, "2026-03-21");
  fs.mkdirSync(postDir, { recursive: true });

  fs.writeFileSync(
    path.join(postDir, "post.json"),
    JSON.stringify({
      slot: "verified-user-weekly",
      planned_date: "2026-03-21",
      image_alt_text: "A rendered verified-user social card.",
      social: {
        linkedin: "🤩 Verified Member Highlight!\n\nJordan is an investigative reporter.\n\nTo send Jordan a tip, go to https://tips.hushline.app/to/jordan.",
      },
    }),
  );
  fs.writeFileSync(path.join(postDir, "social-card@2x.png"), "png");

  try {
    const output = runPublisher([
      "--date",
      "2026-03-21",
      "--date-root",
      tempRoot,
      "--allow-weekend",
      "--dry-run",
    ]);
    assert.match(output, /Dry run: LinkedIn publication prepared for 2026-03-21/);
    assert.match(output, /source: verified-user-archive/);
  } finally {
    fs.rmSync(tempRootParent, { force: true, recursive: true });
  }
});

test("publisher can dry-run from a local daily archive without a publication record", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-publish-"));
  const postDir = path.join(tempRoot, "2026-03-20");
  fs.mkdirSync(postDir, { recursive: true });

  fs.writeFileSync(
    path.join(postDir, "post.json"),
    JSON.stringify({
      slot: "friday",
      planned_date: "2026-03-20",
      image_alt_text: "A rendered Hush Line social card.",
      social: {
        linkedin: "Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.",
      },
    }),
  );
  fs.writeFileSync(path.join(postDir, "social-card@2x.png"), "png");

  try {
    const output = runPublisher(["--date", "2026-03-20", "--date-root", tempRoot, "--dry-run"]);
    assert.match(output, /Dry run: LinkedIn publication prepared for 2026-03-20/);
    assert.match(output, /source: daily-archive/);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("publisher reports when no archived daily post exists for the requested date", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-publish-"));

  try {
    const output = runPublisher(["--date", "2026-03-20", "--date-root", tempRoot]);
    assert.match(output, /No archived daily LinkedIn post content found for 2026-03-20\./);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
