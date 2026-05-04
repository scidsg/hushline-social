const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const plannerScriptPath = path.join(REPO_ROOT, "scripts", "agent_daily_social_planner.sh");
const updateRunReposLibPath = path.join(REPO_ROOT, "scripts", "lib", "update-run-repos.sh");

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

test("daily planner auto-syncs before rejecting a stale local screenshots manifest", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daily-planner-sync-"));
  const screenshotsRoot = path.join(tempRoot, "hushline-screenshots");
  const latestRoot = path.join(screenshotsRoot, "releases", "latest");
  const upstreamLatestRoot = path.join(tempRoot, "upstream", "releases", "latest");
  const freshCapturedAt = new Date().toISOString();

  fs.mkdirSync(path.join(screenshotsRoot, ".git"), { recursive: true });
  fs.mkdirSync(latestRoot, { recursive: true });
  fs.mkdirSync(path.join(upstreamLatestRoot, "guest"), { recursive: true });

  fs.writeFileSync(
    path.join(latestRoot, "manifest.json"),
    `${JSON.stringify({ capturedAt: "2000-01-01T00:00:00.000Z", release: "old", scenes: [] })}\n`,
  );
  fs.writeFileSync(
    path.join(upstreamLatestRoot, "manifest.json"),
    `${JSON.stringify({
      capturedAt: freshCapturedAt,
      release: "fresh",
      scenes: [{ files: [{ file: "guest/fresh-fold.png", mode: "fold" }] }],
    })}\n`,
  );
  fs.writeFileSync(path.join(upstreamLatestRoot, "guest", "fresh-fold.png"), "png");

  const testScript = [
    "set -euo pipefail",
    `export HUSHLINE_SCREENSHOTS_REPO_DIR=${shellQuote(screenshotsRoot)}`,
    "export HUSHLINE_SCREENSHOT_MAX_AGE_DAYS=21",
    "export HUSHLINE_SCREENSHOT_AUTO_SYNC=1",
    "export HUSHLINE_ALLOW_STALE_SCREENSHOTS=0",
    `export HUSHLINE_SCREENSHOTS_BASE_URL=${shellQuote(`file://${upstreamLatestRoot}`)}`,
    `source ${shellQuote(plannerScriptPath)}`,
    "remote_manifest_status() {",
    "  local manifest_path=\"$1\"",
    "  local release=\"\"",
    "  release=\"$(node -e 'const fs=require(\"fs\"); const m=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\")); process.stdout.write(String(m.release || \"\"));' \"$manifest_path\")\"",
    "  if [[ \"$release\" == \"fresh\" ]]; then",
    "    printf '%s\\n' match",
    "  else",
    "    printf '%s\\n' mismatch",
    "  fi",
    "}",
    "verify_screenshot_source",
    "",
  ].join("\n");

  try {
    const output = execFileSync("bash", ["-c", testScript], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    assert.match(output, /Local latest screenshots manifest is stale\. Syncing upstream latest snapshot\./);
    assert.match(output, /Local latest screenshots folder synced to upstream\./);
    const manifest = JSON.parse(fs.readFileSync(path.join(latestRoot, "manifest.json"), "utf8"));
    assert.equal(manifest.release, "fresh");
    assert.equal(fs.readFileSync(path.join(latestRoot, "guest", "fresh-fold.png"), "utf8"), "png");
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("daily repo update returns failure when either checkout update fails", () => {
  const testScript = [
    "set +e",
    `source ${shellQuote(updateRunReposLibPath)}`,
    "resolve_screenshots_repo_dir() { printf '%s\\n' /tmp/hushline-screenshots; }",
    "update_git_checkout() {",
    "  printf '%s\\n' \"$2\"",
    "  if [[ \"$2\" == \"hushline-social\" ]]; then",
    "    return 1",
    "  fi",
    "  return 0",
    "}",
    "update_daily_planning_repos /tmp/hushline-social 1 1",
    "printf 'rc:%s\\n' \"$?\"",
    "",
  ].join("\n");

  const output = execFileSync("bash", ["-c", testScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  assert.match(output, /hushline-social/);
  assert.match(output, /hushline-screenshots/);
  assert.match(output, /rc:1/);
});
