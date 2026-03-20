const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  planDay,
  validatePlan,
} = require("../scripts/lib/daily-planner");

function buildContext(overrides = {}) {
  return {
    candidate_screenshots: [
      {
        audience_scope: "public",
        concept_key: "directory-verified",
        content_key: "guest-directory-verified",
        copy_brief: "Write for sources and public users evaluating or using Hush Line.",
        file: "guest/guest-directory-verified-desktop-light-fold.png",
        matched_pull_requests: [{ number: 1765, title: "Fix guest screenshot" }],
        theme: "light",
        title: "Directory - Verified",
        viewport: "desktop",
      },
    ],
    date: "2026-03-20",
    slot: {
      planned_date: "2026-03-20",
      slot: "friday",
    },
    ...overrides,
  };
}

function buildModelPlan(overrides = {}) {
  return {
    date: "2026-03-20",
    summary: "Public directory trust signals",
    post: {
      content_key: "guest-directory-verified",
      headline: "Let sources verify a recipient before they send a tip",
      image_alt_text: "A social graphic showing the verified directory view.",
      planned_date: "2026-03-20",
      rationale: "It reflects recent public-facing shipped work.",
      screenshot_file: "guest/guest-directory-verified-desktop-light-fold.png",
      slot: "friday",
      social: {
        bluesky: "  Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.  ",
        linkedin: "  Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.  ",
        mastodon: "  Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.  ",
      },
      source_pr_numbers: [1765],
      subtext: "The public directory highlights verified accounts before a message is sent.",
    },
    ...overrides,
  };
}

test("parseArgs rejects malformed dates", () => {
  assert.throws(
    () => parseArgs(["--date", "2026/03/20"]),
    /`--date` must use YYYY-MM-DD format/,
  );
});

test("planDay rejects weekend dates before planning context is built", async () => {
  await assert.rejects(
    () => planDay({
      candidateCount: 12,
      darkRatio: 0.2,
      date: "2026-03-21",
      noRender: false,
    }),
    /Weekend dates are excluded from the daily planner: 2026-03-21 \(saturday\)\./,
  );
});

test("validatePlan trims social copy and enriches the selected candidate metadata", () => {
  const validated = validatePlan(buildModelPlan(), buildContext());

  assert.equal(validated.post.social.linkedin, "Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.");
  assert.equal(validated.post.screenshot_file, "guest/guest-directory-verified-desktop-light-fold.png");
  assert.equal(validated.post.audience_scope, "public");
  assert.equal(validated.post.concept_key, "directory-verified");
  assert.deepEqual(validated.post.matched_pull_requests, [{ number: 1765, title: "Fix guest screenshot" }]);
});

test("validatePlan rejects admin-only screenshots when the copy never says admin or team", () => {
  const context = buildContext({
    candidate_screenshots: [
      {
        audience_scope: "admin-only",
        concept_key: "admin-inbox",
        content_key: "auth-admin-inbox",
        copy_brief: "Write for admins.",
        file: "admin/admin-inbox-desktop-light-fold.png",
        matched_pull_requests: [],
        theme: "light",
        title: "Admin Inbox",
        viewport: "desktop",
      },
    ],
  });
  const plan = buildModelPlan({
    post: {
      ...buildModelPlan().post,
      content_key: "auth-admin-inbox",
      screenshot_file: "admin/admin-inbox-desktop-light-fold.png",
    },
  });

  assert.throws(
    () => validatePlan(plan, context),
    /needs copy that explicitly signals admin\/team context/,
  );
});
