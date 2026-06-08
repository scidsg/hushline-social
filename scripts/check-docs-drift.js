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

function assertSingleSchedule(plistText, label, { weekday, hour, minute }) {
  assertIncludes(plistText, `<key>Weekday</key>\n    <integer>${weekday}</integer>`, label);
  assertIncludes(plistText, `<key>Hour</key>\n    <integer>${hour}</integer>`, label);
  assertIncludes(plistText, `<key>Minute</key>\n    <integer>${minute}</integer>`, label);
}

function main() {
  const readme = read("README.md");
  const agents = read("AGENTS.md");
  const packageJson = JSON.parse(read("package.json"));
  const plannerPlist = read("deploy/launchd/com.hushline.social.daily-planner.plist");
  const linkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.daily.plist");
  const articlePlist = read("deploy/launchd/com.hushline.social.weekly-article.plist");
  const articleLinkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.weekly-article.plist");
  const daemonPlannerPlist = read("deploy/launchd/com.hushline.social.daily-planner.daemon.plist");
  const daemonLinkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.daily.daemon.plist");
  const daemonArticlePlist = read("deploy/launchd/com.hushline.social.weekly-article.daemon.plist");
  const daemonArticleLinkedinPlist = read("deploy/launchd/com.hushline.social.linkedin.weekly-article.daemon.plist");

  assertIncludes(readme, "Monday through Friday", "README.md");
  assertIncludes(readme, "Weekend dates are intentionally skipped", "README.md");
  assertIncludes(readme, "sudo ./social/scripts/install_launch_agent.sh --scope daemon", "README.md");
  assertIncludes(readme, "./social/scripts/check_launchd_prereqs.sh --scope daemon", "README.md");

  assertIncludes(agents, "06:00` local time, Monday through Friday", "AGENTS.md");
  assertIncludes(agents, "06:10` local time, Monday through Friday", "AGENTS.md");
  assertIncludes(agents, "11:50` local time every Wednesday", "AGENTS.md");
  assertIncludes(agents, "12:00` local time every Wednesday", "AGENTS.md");
  assertIncludes(agents, "Weekend dates are excluded from the daily planner and daily LinkedIn publisher.", "AGENTS.md");
  assertIncludes(agents, "sudo ./social/scripts/install_launch_agent.sh --scope daemon", "AGENTS.md");

  if (packageJson.scripts["check:docs-drift"] !== "node scripts/check-docs-drift.js") {
    throw new Error("package.json is missing the expected check:docs-drift script");
  }

  if (packageJson.scripts["install:launch-agent"] !== "../hushline-agents/social/scripts/install_launch_agent.sh") {
    throw new Error("package.json install:launch-agent must use hushline-agents");
  }

  if (packageJson.scripts["install:launch-daemon"] !== "sudo ../hushline-agents/social/scripts/install_launch_agent.sh --scope daemon") {
    throw new Error("package.json install:launch-daemon must use hushline-agents");
  }

  if (packageJson.scripts["check:launchd"] !== "../hushline-agents/social/scripts/check_launchd_prereqs.sh") {
    throw new Error("package.json check:launchd must use hushline-agents");
  }

  assertWeekdayArray(plannerPlist, "deploy/launchd/com.hushline.social.daily-planner.plist");
  assertWeekdayArray(linkedinPlist, "deploy/launchd/com.hushline.social.linkedin.daily.plist");
  assertWeekdayArray(daemonPlannerPlist, "deploy/launchd/com.hushline.social.daily-planner.daemon.plist");
  assertWeekdayArray(daemonLinkedinPlist, "deploy/launchd/com.hushline.social.linkedin.daily.daemon.plist");
  assertSingleSchedule(articlePlist, "deploy/launchd/com.hushline.social.weekly-article.plist", { weekday: "3", hour: "11", minute: "50" });
  assertSingleSchedule(articleLinkedinPlist, "deploy/launchd/com.hushline.social.linkedin.weekly-article.plist", { weekday: "3", hour: "12", minute: "0" });
  assertSingleSchedule(daemonArticlePlist, "deploy/launchd/com.hushline.social.weekly-article.daemon.plist", { weekday: "3", hour: "11", minute: "50" });
  assertSingleSchedule(daemonArticleLinkedinPlist, "deploy/launchd/com.hushline.social.linkedin.weekly-article.daemon.plist", { weekday: "3", hour: "12", minute: "0" });

  process.stdout.write("Docs and launchd schedule are in sync.\n");
}

main();
