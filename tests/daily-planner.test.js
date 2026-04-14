const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DAILY_POSTS_ROOT,
  chooseTemplateName,
  filterCandidatesForArchiveHistory,
  filterCandidatesForWeeklyCaps,
  filterCandidatesForTemplateName,
  inferTopicFamily,
  loadSavedDailyContext,
  parseArgs,
  planDay,
  validatePlan,
} = require("../scripts/lib/daily-planner");
const { assignVariantsToConcepts } = require("../scripts/lib/planning-context");

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

test("loadSavedDailyContext returns the archived context for validation reruns", () => {
  const archiveKey = "2099-03-20-99";
  const archiveDir = path.join(DAILY_POSTS_ROOT, archiveKey);
  const contextPath = path.join(archiveDir, "context.json");
  const savedContext = buildContext({
    date: "2099-03-20",
    candidate_screenshots: [
      {
        audience_scope: "recipient-shared",
        concept_key: "vision-tool",
        content_key: "auth-artvandelay-tools-vision",
        copy_brief: "Write for recipients and staff using Hush Line day to day.",
        file: "artvandelay/auth-artvandelay-tools-vision-mobile-light-fold.png",
        matched_pull_requests: [],
        topic_family: "vision",
        viewport: "mobile",
      },
    ],
  });

  fs.mkdirSync(archiveDir, { recursive: true });

  try {
    fs.writeFileSync(contextPath, JSON.stringify(savedContext, null, 2));
    assert.deepEqual(loadSavedDailyContext(archiveKey), savedContext);
  } finally {
    fs.rmSync(archiveDir, { force: true, recursive: true });
  }
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

test("chooseTemplateName prefers the least-used daily template from the prior month", () => {
  const selected = chooseTemplateName(
    [
      { archive_key: "2026-03-03", template_name: "hushline-daily-desktop-template.html" },
      { archive_key: "2026-03-04", template_name: "hushline-daily-desktop-template.html" },
      { archive_key: "2026-03-05", template_name: "hushline-daily-mobile-template.html" },
    ],
    [
      "hushline-daily-desktop-template.html",
      "hushline-daily-mobile-template.html",
      "hushline-daily-mobile-template-2.html",
    ],
  );

  assert.equal(selected, "hushline-daily-mobile-template-2.html");
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

test("filterCandidatesForArchiveHistory ranks less-repetitive candidates ahead of recent archive themes", () => {
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

  assert.equal(filtered.length, 6);
  assert.deepEqual(
    filtered.slice(0, 3).map((candidate) => candidate.content_key),
    [
      "auth-admin-settings-guidance",
      "auth-artvandelay-settings-encryption",
      "auth-artvandelay-settings-notifications",
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

test("filterCandidatesForWeeklyCaps blocks a second admin or dark post in the same ISO week", () => {
  const archiveHistory = [
    {
      archive_key: "2026-04-06",
      audience_scope: "admin-only",
      date: "2026-04-06",
      screenshot_file: "admin/auth-admin-settings-guidance-mobile-light-fold.png",
      theme: "light",
    },
    {
      archive_key: "2026-04-07",
      audience_scope: "recipient-shared",
      date: "2026-04-07",
      screenshot_file: "artvandelay/auth-artvandelay-settings-notifications-mobile-dark-fold.png",
      theme: "dark",
    },
  ];

  const filtered = filterCandidatesForWeeklyCaps(
    [
      {
        audience_scope: "admin-only",
        content_key: "auth-admin-settings-registration",
        file: "admin/auth-admin-settings-registration-mobile-light-fold.png",
        theme: "light",
      },
      {
        audience_scope: "recipient-shared",
        content_key: "auth-artvandelay-tools-vision",
        file: "artvandelay/auth-artvandelay-tools-vision-mobile-dark-fold.png",
        theme: "dark",
      },
      {
        audience_scope: "recipient-shared",
        content_key: "auth-artvandelay-settings-encryption",
        file: "artvandelay/auth-artvandelay-settings-encryption-mobile-light-fold.png",
        theme: "light",
      },
    ],
    archiveHistory,
    "2026-04-10",
  );

  assert.deepEqual(
    filtered.map((candidate) => candidate.content_key),
    ["auth-artvandelay-settings-encryption"],
  );
});

test("validatePlan rejects messaging that duplicates a recent archive angle", () => {
  const context = buildContext({
    recent_archive_history: [
      {
        archive_key: "2026-03-19",
        headline: "Let sources verify a recipient before they send a tip",
        linkedin_copy: "Sources can verify trust signals before sending a tip. Learn more at https://hushline.app/.",
        screen_key: "directory-index",
        subtext: "The public directory highlights verified accounts before a message is sent.",
        topic_family: "directory",
      },
    ],
  });

  assert.throws(
    () => validatePlan(buildModelPlan(), context),
    /duplicates recent archive headline/,
  );
});

test("validatePlan allows a distinct directory message that only shares generic public-directory wording", () => {
  const context = buildContext({
    candidate_screenshots: [
      {
        absolute_path: "/tmp/guest-directory-attorney-adam-j-levitt-mobile-light-fold.png",
        audience_scope: "public",
        concept_key: "directory-attorney-adam-j-levitt",
        content_key: "guest-directory-attorney-adam-j-levitt",
        copy_brief: "Write for sources and public users evaluating or using Hush Line.",
        file: "guest/guest-directory-attorney-adam-j-levitt-mobile-light-fold.png",
        matched_pull_requests: [],
        path: "/directory/public-records/public-record~adam-j-levitt",
        screen_key: "directory-public-record",
        theme: "light",
        title: "Directory - Attorney listing (Adam J. Levitt)",
        topic_family: "directory",
        viewport: "mobile",
      },
    ],
    date: "2026-04-14",
    recent_archive_history: [
      {
        archive_key: "2026-03-20",
        audience_scope: "public",
        bluesky_copy: "Need to verify who you're contacting before you send a tip? Hush Line's public directory shows verified profiles so you can compare recipients first. Learn more at https://hushline.app/.",
        date: "2026-03-20",
        headline: "Check verified tip lines before you reach out",
        linkedin_copy: "When you need to contact a journalist, lawyer, or other trusted recipient, the first question is whether you found the right person. Hush Line's public directory lets you browse verified profiles before you send anything, so you can check who runs the tip line and choose a better match for your situation. Learn more at https://hushline.app/.",
        mastodon_copy: "If you're deciding where to send a tip, Hush Line's public directory helps you start with verified profiles. You can compare recipients and check who runs the tip line before you reach out. Learn more at https://hushline.app/.",
        screen_key: "directory-index",
        subtext: "The public directory helps sources compare verified profiles and choose a tip line that matches the person they need.",
        theme: "light",
        topic_family: "directory",
      },
    ],
    slot: {
      planned_date: "2026-04-14",
      slot: "tuesday",
    },
    template_selection: {
      available_templates: ["hushline-daily-mobile-template.html"],
      desired_template_name: "hushline-daily-mobile-template.html",
      desired_template_type: "mobile",
    },
  });

  const plan = {
    date: "2026-04-14",
    summary: "Public-facing attorney listing post.",
    post: {
      slot: "tuesday",
      planned_date: "2026-04-14",
      screenshot_file: "guest/guest-directory-attorney-adam-j-levitt-mobile-light-fold.png",
      content_key: "guest-directory-attorney-adam-j-levitt",
      headline: "Review a whistleblower law listing before you reach out",
      subtext: "This public attorney listing shows bar-registration details, location, and firm links so a source can judge whether a law office fits the disclosure they need to make.",
      image_alt_text: "A portrait Hush Line social graphic built from a light-mode mobile public directory screen. It shows an attorney listing with a law firm name, location, practice description, and links to the lawyer's site and source record.",
      social: {
        linkedin: "Sometimes the hardest part of asking for legal help is figuring out which office actually handles the kind of disclosure you need to make.\n\nHush Line's public attorney listings can point people to bar-record details, locations, and firm links before first contact, so they can compare legal options with more context instead of guessing.\n\nLearn more at https://hushline.app.",
        mastodon: "Legal intake starts before the first message.\n\nHush Line's public attorney listings show record details, locations, and firm links so people can compare law offices with more context before they reach out.\n\nLearn more at https://hushline.app.",
        bluesky: "Finding the right law office can be part of the hard part.\n\nHush Line's public attorney listings show record details, location, and firm links before first contact.\n\nLearn more at https://hushline.app.",
      },
      rationale: "This uses the attorney listing screen and stays focused on legal-fit context instead of general directory browsing.",
      source_pr_numbers: [],
    },
  };

  assert.doesNotThrow(() => validatePlan(plan, context));
});

test("validatePlan rejects a second admin-only post in the same ISO week", () => {
  const context = buildContext({
    candidate_screenshots: [
      {
        audience_scope: "admin-only",
        concept_key: "settings-guidance",
        content_key: "auth-admin-settings-guidance",
        copy_brief: "Write for admins.",
        file: "admin/auth-admin-settings-guidance-mobile-light-fold.png",
        matched_pull_requests: [],
        topic_family: "guidance",
        theme: "light",
        title: "Settings - User Guidance (admin)",
        viewport: "mobile",
      },
    ],
    date: "2026-04-10",
    recent_archive_history: [
      {
        archive_key: "2026-04-06",
        audience_scope: "admin-only",
        date: "2026-04-06",
        screenshot_file: "admin/auth-admin-settings-branding-mobile-light-fold.png",
        theme: "light",
      },
    ],
    slot: {
      planned_date: "2026-04-10",
      slot: "friday",
    },
    template_selection: {
      available_templates: ["hushline-daily-mobile-template.html"],
      desired_template_name: "hushline-daily-mobile-template.html",
      desired_template_type: "mobile",
    },
  });

  const plan = buildModelPlan({
    date: "2026-04-10",
    post: {
      ...buildModelPlan().post,
      planned_date: "2026-04-10",
      screenshot_file: "admin/auth-admin-settings-guidance-mobile-light-fold.png",
      content_key: "auth-admin-settings-guidance",
      slot: "friday",
    },
  });

  assert.throws(
    () => validatePlan(plan, context),
    /Weekly admin-only cap already reached/,
  );
});

test("validatePlan rejects a second dark-mode post in the same ISO week", () => {
  const context = buildContext({
    candidate_screenshots: [
      {
        audience_scope: "recipient-shared",
        concept_key: "settings-notifications",
        content_key: "auth-artvandelay-settings-notifications",
        copy_brief: "Write for recipients.",
        file: "artvandelay/auth-artvandelay-settings-notifications-mobile-dark-fold.png",
        matched_pull_requests: [],
        topic_family: "notifications",
        theme: "dark",
        title: "Settings - Notifications",
        viewport: "mobile",
      },
    ],
    date: "2026-04-10",
    recent_archive_history: [
      {
        archive_key: "2026-04-07",
        audience_scope: "recipient-shared",
        date: "2026-04-07",
        screenshot_file: "artvandelay/auth-artvandelay-settings-encryption-mobile-dark-fold.png",
        theme: "dark",
      },
    ],
    slot: {
      planned_date: "2026-04-10",
      slot: "friday",
    },
    template_selection: {
      available_templates: ["hushline-daily-mobile-template.html"],
      desired_template_name: "hushline-daily-mobile-template.html",
      desired_template_type: "mobile",
    },
  });

  const plan = buildModelPlan({
    date: "2026-04-10",
    post: {
      ...buildModelPlan().post,
      planned_date: "2026-04-10",
      screenshot_file: "artvandelay/auth-artvandelay-settings-notifications-mobile-dark-fold.png",
      content_key: "auth-artvandelay-settings-notifications",
      slot: "friday",
    },
  });

  assert.throws(
    () => validatePlan(plan, context),
    /Weekly dark-mode cap already reached/,
  );
});

test("assignVariantsToConcepts preserves light candidates when the concept set is smaller than the target count", () => {
  const selectedConcepts = Array.from({ length: 17 }, (_, index) => ({
    variants: [
      {
        file: `guest/example-${index + 1}-desktop-light-fold.png`,
        score: 10,
        theme: "light",
        viewport: "desktop",
      },
      {
        file: `guest/example-${index + 1}-desktop-dark-fold.png`,
        score: 11,
        theme: "dark",
        viewport: "desktop",
      },
    ],
  }));

  const shortlist = assignVariantsToConcepts(selectedConcepts, 200, 0.25);
  const darkCount = shortlist.filter((candidate) => candidate.theme === "dark").length;
  const lightCount = shortlist.filter((candidate) => candidate.theme === "light").length;

  assert.equal(shortlist.length, 17);
  assert.equal(darkCount, 4);
  assert.equal(lightCount, 13);
});
