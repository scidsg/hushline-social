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

test("publisher respects the local duplicate-post guard before attempting any network call", () => {
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
  fs.writeFileSync(
    path.join(postDir, "linkedin-publication.json"),
    JSON.stringify({ post_id: "urn:li:share:12345" }),
  );

  try {
    const output = runPublisher(["--date", "2026-03-20", "--date-root", tempRoot]);
    assert.match(output, /LinkedIn post for friday on 2026-03-20 already published: urn:li:share:12345/);
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
