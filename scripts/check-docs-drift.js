#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing expected text in ${label}: ${needle}`);
  }
}

function assertWeekdayArray(plistText, label) {
  for (const weekday of ["1", "2", "3", "4", "5"]) {
    const needle = `<key>Weekday</key>\n      <integer>${weekday}</integer>`;
    assertIncludes(plistText, needle, label);
  }

  const weekdayValues = [...plistText.matchAll(/<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>/g)].map((match) => match[1]);
  if (weekdayValues.some((value) => value === "0" || value === "6" || value === "7")) {
    throw new Error(`${label} unexpectedly includes a weekend weekday value`);
  }
}

function main() {
  const readme = read("README.md");
  const agents = read("AGENTS.md");
  const packageJson = JSON.parse(read("package.json"));
  const plannerPlist = read("deploy/launchd/com.hushline.social.daily-planner.plist");
  const linkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.daily.plist");
  const daemonPlannerPlist = read("deploy/launchd/com.hushline.social.daily-planner.daemon.plist");
  const daemonLinkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.daily.daemon.plist");

  assertIncludes(readme, "Monday through Friday", "README.md");
  assertIncludes(readme, "Weekend dates are intentionally skipped", "README.md");
  assertIncludes(readme, "sudo ./scripts/install_launch_agent.sh --scope daemon", "README.md");
  assertIncludes(readme, "./scripts/check_launchd_prereqs.sh --scope daemon", "README.md");

  assertIncludes(agents, "06:00` local time, Monday through Friday", "AGENTS.md");
  assertIncludes(agents, "06:10` local time, Monday through Friday", "AGENTS.md");
  assertIncludes(agents, "Weekend dates are excluded from the daily planner and daily LinkedIn publisher.", "AGENTS.md");
  assertIncludes(agents, "sudo ./scripts/install_launch_agent.sh --scope daemon", "AGENTS.md");

  if (packageJson.scripts["check:docs-drift"] !== "node scripts/check-docs-drift.js") {
    throw new Error("package.json is missing the expected check:docs-drift script");
  }

  assertWeekdayArray(plannerPlist, "deploy/launchd/com.hushline.social.daily-planner.plist");
  assertWeekdayArray(linkedinPlist, "deploy/launchd/com.hushline.social.linkedin.daily.plist");
  assertWeekdayArray(daemonPlannerPlist, "deploy/launchd/com.hushline.social.daily-planner.daemon.plist");
  assertWeekdayArray(daemonLinkedinPlist, "deploy/launchd/com.hushline.social.linkedin.daily.daemon.plist");

  process.stdout.write("Docs and launchd schedule are in sync.\n");
}

main();
