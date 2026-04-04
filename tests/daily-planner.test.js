const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chooseTemplateName,
  filterCandidatesForArchiveHistory,
  filterCandidatesForTemplateName,
  inferTopicFamily,
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
        topic_family: "directory",
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
    template_selection: {
      available_templates: [
        "hushline-daily-desktop-template.html",
        "hushline-daily-mobile-template.html",
        "hushline-daily-mobile-template-2.html",
      ],
      desired_template_name: "hushline-daily-desktop-template.html",
      desired_template_type: "desktop",
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

test("parseArgs accepts suffixed archive keys for the same planned date", () => {
  const args = parseArgs(["--date", "2026-03-20", "--archive-key", "2026-03-20-1"]);
  assert.equal(args.archiveKey, "2026-03-20-1");
});

test("parseArgs rejects archive keys outside the requested planned date", () => {
  assert.throws(
    () => parseArgs(["--date", "2026-03-20", "--archive-key", "2026-03-21-1"]),
    /`--archive-key` must start with the requested `--date`\./,
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
  assert.equal(validated.post.template_name, "hushline-daily-desktop-template.html");
  assert.equal(validated.post.topic_family, "directory");
  assert.deepEqual(validated.post.matched_pull_requests, [{ number: 1765, title: "Fix guest screenshot" }]);
});

test("chooseTemplateName picks randomly from the available daily templates", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.6;

  try {
    const selected = chooseTemplateName(
      [],
      [
        "hushline-daily-desktop-template.html",
        "hushline-daily-mobile-template.html",
        "hushline-daily-mobile-template-2.html",
      ],
    );

    assert.equal(selected, "hushline-daily-mobile-template.html");
  } finally {
    Math.random = originalRandom;
  }
});

test("filterCandidatesForTemplateName narrows the shortlist to the chosen template type", () => {
  const filtered = filterCandidatesForTemplateName(
    [
      {
        content_key: "guest-directory-verified",
        file: "guest/guest-directory-verified-desktop-light-fold.png",
        viewport: "desktop",
      },
      {
        content_key: "auth-artvandelay-settings-authentication",
        file: "auth/auth-artvandelay-settings-authentication-mobile-light-fold.png",
        viewport: "mobile",
      },
    ],
    "hushline-daily-mobile-template-2.html",
  );

  assert.deepEqual(
    filtered.map((candidate) => candidate.content_key),
    ["auth-artvandelay-settings-authentication"],
  );
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
        topic_family: "admin-inbox",
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

test("inferTopicFamily groups onboarding directory screenshots under the directory family", () => {
  assert.equal(
    inferTopicFamily({
      content_key: "auth-newman-onboarding-directory",
      path: "/onboarding?step=directory",
      title: "Onboarding - Step 4 Directory (newman)",
    }),
    "directory",
  );
});

test("filterCandidatesForArchiveHistory removes same-screen variants from recent archive history", () => {
  const archiveHistory = [
    {
      concept_key: "directory-verified",
      content_key: "guest-directory-verified",
      date: "2026-03-20",
      screenshot_file: "guest/guest-directory-verified.png",
      screen_key: "directory-index",
      topic_family: "directory",
    },
  ];

  const candidates = [
    {
      concept_key: "directory-all",
      content_key: "guest-directory-all",
      path: "/directory",
    },
    {
      concept_key: "directory-securedrop",
      content_key: "guest-directory-securedrop",
      path: "/directory",
    },
    {
      concept_key: "directory-attorney-adam-j-levitt",
      content_key: "guest-directory-attorney-adam-j-levitt",
      path: "/directory/public-records/public-record~adam-j-levitt",
    },
    {
      concept_key: "encryption-settings",
      content_key: "auth-artvandelay-settings-encryption",
      path: "/settings/encryption",
    },
    {
      concept_key: "notifications-settings",
      content_key: "auth-artvandelay-settings-notifications",
      path: "/settings/notifications",
    },
    {
      concept_key: "admin-guidance",
      content_key: "auth-admin-settings-guidance",
      path: "/settings/guidance",
    },
  ];

  const filtered = filterCandidatesForArchiveHistory(candidates, archiveHistory);

  assert.equal(filtered.length, 4);
  assert.deepEqual(
    filtered.map((candidate) => candidate.content_key),
    [
      "guest-directory-attorney-adam-j-levitt",
      "auth-artvandelay-settings-encryption",
      "auth-artvandelay-settings-notifications",
      "auth-admin-settings-guidance",
    ],
  );
});

test("filterCandidatesForArchiveHistory falls back to repeated screens when needed but still blocks exact content repeats", () => {
  const archiveHistory = [
    {
      concept_key: "directory-all",
      content_key: "guest-directory-all",
      date: "2026-03-20",
      screenshot_file: "guest/guest-directory-all.png",
      screen_key: "directory-index",
      topic_family: "directory",
    },
  ];

  const candidates = [
    {
      concept_key: "directory-verified",
      content_key: "guest-directory-verified",
      path: "/directory",
      topic_family: "directory",
    },
    {
      concept_key: "directory-all",
      content_key: "guest-directory-all",
      path: "/directory",
      topic_family: "directory",
    },
  ];

  const filtered = filterCandidatesForArchiveHistory(candidates, archiveHistory);

  assert.equal(filtered.length, 1);
  assert.deepEqual(
    filtered.map((candidate) => candidate.content_key),
    ["guest-directory-verified"],
  );
});
