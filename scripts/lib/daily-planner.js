"use strict";

const fs = require("fs");
const path = require("path");
const { renderPost } = require("./render-social-post");
const { buildPlanningContext } = require("./planning-context");
const {
  HUSHLINE_ROOT,
  LIMITS,
  REPO_ROOT,
  archiveKeyDate,
  compareArchiveKeys,
  excerptText,
  getWeekdayLabel,
  isValidArchiveKey,
  isWeekendDate,
  readJson,
  writeJson,
} = require("./social-common");

const DAILY_POSTS_ROOT = path.join(REPO_ROOT, "previous-posts");
const ADMIN_COPY_PATTERNS = [
  /\badmin\b/i,
  /\badmins\b/i,
  /\badministrator\b/i,
  /\badministrators\b/i,
  /\boperator\b/i,
  /\boperators\b/i,
  /\bmoderation\b/i,
  /\bmoderators\b/i,
  /\bteam\b/i,
  /\bteams\b/i,
];

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatIsoWeek(date) {
  const cursor = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((cursor - yearStart) / 86400000) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function normalizeConceptKey(contentKey) {
  return String(contentKey || "")
    .replace(/^(auth-(admin|artvandelay|newman)|guest)-/, "")
    .replace(/^-+/, "");
}

function inferTopicFamily(item) {
  const pathValue = String(item.path || "");
  const text = [
    item.title,
    item.content_key,
    item.contentKey,
    item.screenshot_file,
    item.file,
    pathValue,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bdirectory\b/.test(text) || /^\/directory\b/.test(pathValue)) {
    return "directory";
  }

  if (/\bencryption\b|\bpgp\b/.test(text) || /^\/settings\/encryption\b/.test(pathValue)) {
    return "encryption";
  }

  if (/\bnotification(s)?\b/.test(text) || /^\/settings\/notifications\b/.test(pathValue)) {
    return "notifications";
  }

  if (
    /\bauthentication\b|\b2fa\b|\btwo[- ]factor\b|\bsettings[- ]auth\b/.test(text) ||
    /^\/settings\/auth\b/.test(pathValue)
  ) {
    return "authentication";
  }

  if (/\balias(es)?\b/.test(text) || /^\/settings\/aliases\b/.test(pathValue)) {
    return "aliases";
  }

  if (/\bguidance\b/.test(text) || /^\/settings\/guidance\b/.test(pathValue)) {
    return "guidance";
  }

  if (/\bregistration\b/.test(text) || /^\/settings\/registration\b/.test(pathValue)) {
    return "registration";
  }

  if (/\bbranding\b/.test(text) || /^\/settings\/branding\b/.test(pathValue)) {
    return "branding";
  }

  if (/\bmessage statuses\b|\breplies\b/.test(text) || /^\/settings\/replies\b/.test(pathValue)) {
    return "message-statuses";
  }

  if (/\bvision\b/.test(text) || /^\/vision\b/.test(pathValue)) {
    return "vision";
  }

  if (/\bemail[- ]headers\b/.test(text) || /^\/email-headers\b/.test(pathValue)) {
    return "email-headers";
  }

  if (/\bprofile\b/.test(text) || /^\/to\//.test(pathValue) || /^\/settings\/profile\b/.test(pathValue)) {
    return "profile";
  }

  if (/\bonboarding\b/.test(text) || /^\/onboarding\b/.test(pathValue)) {
    return "onboarding";
  }

  return normalizeConceptKey(item.content_key || item.contentKey);
}

function findSaturatedTopicFamilies(archiveHistory, windowSize = 4) {
  const recentWindow = archiveHistory.slice(-windowSize);
  const counts = new Map();

  for (const entry of recentWindow) {
    const family = entry.topic_family || inferTopicFamily(entry);
    counts.set(family, (counts.get(family) || 0) + 1);
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([family]) => family),
  );
}

function parseArgs(argv) {
  const args = {
    archiveKey: null,
    candidateCount: 12,
    darkRatio: 0.2,
    date: todayString(),
    noRender: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (value === "--archive-key") {
      args.archiveKey = argv[index + 1];
      index += 1;
    } else if (value === "--candidate-count") {
      args.candidateCount = Number(argv[index + 1]);
      index += 1;
    } else if (value === "--dark-ratio") {
      args.darkRatio = Number(argv[index + 1]);
      index += 1;
    } else if (value === "--no-render") {
      args.noRender = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("`--date` must use YYYY-MM-DD format.");
  }

  args.archiveKey = args.archiveKey || args.date;

  if (!isValidArchiveKey(args.archiveKey)) {
    throw new Error("`--archive-key` must use YYYY-MM-DD or YYYY-MM-DD-N format.");
  }

  if (archiveKeyDate(args.archiveKey) !== args.date) {
    throw new Error("`--archive-key` must start with the requested `--date`.");
  }

  if (!Number.isInteger(args.candidateCount) || args.candidateCount < 4 || args.candidateCount > 20) {
    throw new Error("`--candidate-count` must be an integer from 4 to 20.");
  }

  if (Number.isNaN(args.darkRatio) || args.darkRatio < 0 || args.darkRatio > 1) {
    throw new Error("`--dark-ratio` must be a number from 0 to 1.");
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/plan-day.js --date 2026-03-19",
      "  node scripts/plan-day.js --date 2026-03-19 --candidate-count 12",
      "  node scripts/plan-day.js --date 2026-03-19 --archive-key 2026-03-19-1",
      "",
      "Behavior:",
      "  - Reads recent merged PRs from the local Hush Line repo and GitHub CLI",
      "  - Reads audience context from Hush Line docs and ../hushline/AGENTS.md",
      "  - Builds a candidate screenshot inventory from hushline-screenshots/releases/latest",
      "  - Writes daily planning context and a Codex prompt to previous-posts/<archive-key>",
      "  - Expects one high-value post for the requested day",
      "",
    ].join("\n"),
  );
}

function loadArchiveHistory(currentArchiveKey) {
  if (!fs.existsSync(DAILY_POSTS_ROOT)) {
    return [];
  }

  return fs
    .readdirSync(DAILY_POSTS_ROOT, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() &&
        isValidArchiveKey(entry.name) &&
        compareArchiveKeys(entry.name, currentArchiveKey) < 0,
    )
    .map((entry) => entry.name)
    .sort(compareArchiveKeys)
    .slice(-20)
    .map((archiveKey) => {
      const postPath = path.join(DAILY_POSTS_ROOT, archiveKey, "post.json");
      if (!fs.existsSync(postPath)) {
        return null;
      }

      const post = readJson(postPath);
      return {
        archive_key: archiveKey,
        concept_key: post.concept_key || normalizeConceptKey(post.content_key),
        content_key: post.content_key,
        date: archiveKeyDate(archiveKey),
        headline: post.headline,
        screenshot_file: post.screenshot_file,
        topic_family: post.topic_family || inferTopicFamily(post),
      };
    })
    .filter(Boolean);
}

function filterCandidatesForArchiveHistory(candidates, archiveHistory) {
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    topic_family: candidate.topic_family || inferTopicFamily(candidate),
  }));
  const usedContentKeys = new Set(archiveHistory.map((entry) => entry.content_key));
  const usedConceptKeys = new Set(archiveHistory.map((entry) => entry.concept_key));
  const saturatedTopicFamilies = findSaturatedTopicFamilies(archiveHistory);

  const strict = normalizedCandidates.filter((candidate) => {
    return !usedContentKeys.has(candidate.content_key) && !usedConceptKeys.has(candidate.concept_key);
  });
  const strictVaried = strict.filter(
    (candidate) => !saturatedTopicFamilies.has(candidate.topic_family),
  );
  if (strictVaried.length >= 4) {
    return strictVaried;
  }

  if (strict.length >= 4) {
    return strict;
  }

  const relaxed = normalizedCandidates.filter((candidate) => !usedContentKeys.has(candidate.content_key));
  const relaxedVaried = relaxed.filter(
    (candidate) => !saturatedTopicFamilies.has(candidate.topic_family),
  );
  if (relaxedVaried.length >= 4) {
    return relaxedVaried;
  }

  if (relaxed.length >= 4) {
    return relaxed;
  }

  return normalizedCandidates;
}

function readHushlineAgentExcerpt() {
  const filePath = path.join(HUSHLINE_ROOT, "AGENTS.md");
  if (!fs.existsSync(filePath)) {
    return "";
  }

  return excerptText(fs.readFileSync(filePath, "utf8"), 2600);
}

function buildDailyContext(args) {
  const parsedDate = new Date(`${args.date}T12:00:00`);
  const week = formatIsoWeek(parsedDate);
  const planningContext = buildPlanningContext({
    candidateCount: args.candidateCount,
    darkRatio: args.darkRatio,
    week,
  });
  const archiveHistory = loadArchiveHistory(args.archiveKey);
  const filteredCandidates = filterCandidatesForArchiveHistory(
    planningContext.candidate_screenshots,
    archiveHistory,
  );

  return {
    audience_docs: planningContext.audience_docs,
    candidate_screenshots: filteredCandidates,
    daily_posts_root: path.relative(REPO_ROOT, DAILY_POSTS_ROOT),
    date: args.date,
    dark_ratio: args.darkRatio,
    hushline_agent_context: readHushlineAgentExcerpt(),
    recent_archive_history: archiveHistory,
    recent_pull_requests: planningContext.recent_pull_requests,
    screenshot_captured_at: planningContext.screenshot_captured_at,
    screenshot_release: planningContext.screenshot_release,
    slot: {
      planned_date: args.date,
      slot: getWeekdayLabel(args.date),
    },
    week,
  };
}

function buildPromptPayload(context) {
  const pullRequests = context.recent_pull_requests
    .map((pr) => {
      const number = pr.number ? `#${pr.number}` : "local";
      return `${number} | ${pr.mergedAt} | ${pr.title}`;
    })
    .join("\n");
  const docs = context.audience_docs
    .map((doc) => `${doc.file}\n${doc.excerpt}`)
    .join("\n\n");
  const archiveHistory = context.recent_archive_history.length === 0
    ? "No prior archived daily posts were found."
    : context.recent_archive_history
        .map((entry) => `${entry.archive_key}: ${entry.content_key} [${entry.topic_family}] (${entry.screenshot_file})`)
        .join("\n");

  return {
    system: [
      "You are planning one daily social post for Hush Line.",
      "Choose a single high-value feature that reflects recent shipped work and Hush Line's documented user needs.",
      "Write in plain language. No marketing-speak, no hype, no filler.",
      "Social copy must be end-user-facing. Do not confuse post copy with alt text.",
      "Avoid empty-state screens, duplicate content themes, and repeated scenes across mobile/desktop variants.",
      "If a screenshot is admin-only, the copy must explicitly say that it is for admins or teams running Hush Line.",
      "LinkedIn is the first automated publishing target, so LinkedIn copy should be especially ready for production use.",
    ].join(" "),
    user: [
      `Plan date: ${context.date}`,
      `Week context: ${context.week}`,
      `Slot label: ${context.slot.slot}`,
      "",
      "Character limits:",
      `LinkedIn ${LIMITS.linkedin}`,
      `Mastodon ${LIMITS.mastodon}`,
      `Bluesky ${LIMITS.bluesky}`,
      "",
      `Target dark-mode share for this run: ${context.dark_ratio}`,
      `Screenshot release from local latest folder: ${context.screenshot_release}`,
      `Screenshots captured at: ${context.screenshot_captured_at}`,
      "",
      "Recently merged Hush Line PRs:",
      pullRequests,
      "",
      "Audience and user-base context from docs:",
      docs,
      "",
      "Additional Hush Line AGENTS guidance:",
      context.hushline_agent_context || "No additional AGENTS guidance was found.",
      "",
      "Recent archived daily posts to avoid repeating:",
      archiveHistory,
      "",
      "Instructions:",
      "- Pick exactly one screenshot from the provided candidates only.",
      "- Prioritize recent shipped work that appears clearly in the screenshot.",
      "- Favor screenshots that matter to journalists, lawyers, whistleblowers, sources, and other trusted recipients.",
      "- Produce exactly one post for the requested date.",
      "- Avoid repeating a content theme or route that was used recently in archived daily posts.",
      "- Treat screenshots in the same topic family as repeats even when the exact content_key differs. For example, directory-all, directory-verified, and onboarding-directory all count as directory posts for variation purposes.",
      "- If recent archive history is dominated by one topic family, choose a different family unless there is no strong alternative in the shortlist.",
      "- Match the copy to the candidate audience scope. Public screens should read public-facing. Recipient-shared screens should read like recipient workflows. Admin-only screens must clearly say admin or team context.",
      "- Headline and subtext should be concise and straightforward.",
      "- Each network copy should say the same core thing in a native way, not copy-paste the same sentence three times.",
      "- The alt text should describe the final image asset, not just the raw UI screenshot.",
      "",
      "Return strict JSON matching the schema.",
    ].join("\n"),
  };
}

function buildResponseSchema(context) {
  return {
    additionalProperties: false,
    properties: {
      date: {
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        type: "string",
      },
      post: {
        additionalProperties: false,
        properties: {
          content_key: {
            type: "string",
          },
          headline: {
            type: "string",
          },
          image_alt_text: {
            type: "string",
          },
          planned_date: {
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            type: "string",
          },
          rationale: {
            type: "string",
          },
          screenshot_file: {
            type: "string",
          },
          slot: {
            type: "string",
          },
          social: {
            additionalProperties: false,
            properties: {
              bluesky: { type: "string" },
              linkedin: { type: "string" },
              mastodon: { type: "string" },
            },
            required: ["linkedin", "mastodon", "bluesky"],
            type: "object",
          },
          source_pr_numbers: {
            items: {
              type: "integer",
            },
            type: "array",
          },
          subtext: {
            type: "string",
          },
        },
        required: [
          "slot",
          "planned_date",
          "screenshot_file",
          "content_key",
          "headline",
          "subtext",
          "image_alt_text",
          "social",
          "rationale",
          "source_pr_numbers",
        ],
        type: "object",
      },
      summary: {
        type: "string",
      },
    },
    required: ["date", "summary", "post"],
    type: "object",
  };
}

function buildCodexPrompt(context, planPath) {
  const prompt = buildPromptPayload(context);
  const candidates = context.candidate_screenshots
    .map((candidate, index) => {
      return [
        `Candidate ${index + 1}`,
        `file: ${candidate.file}`,
        `topic_family: ${candidate.topic_family}`,
        `concept_key: ${candidate.concept_key}`,
        `content_key: ${candidate.content_key}`,
        `title: ${candidate.title}`,
        `route: ${candidate.path}`,
        `session: ${candidate.session}`,
        `audience_scope: ${candidate.audience_scope}`,
        `copy_brief: ${candidate.copy_brief}`,
        `viewport: ${candidate.viewport}`,
        `theme: ${candidate.theme}`,
        `score: ${candidate.score}`,
        `matched_prs: ${
          candidate.matched_pull_requests.length === 0
            ? "none"
            : candidate.matched_pull_requests
                .map((pr) => `${pr.number ? `#${pr.number}` : "local"} ${pr.title}`)
                .join(" | ")
        }`,
        `absolute_path: ${candidate.absolute_path}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    prompt.system,
    "",
    prompt.user,
    "",
    "Candidate screenshots:",
    candidates,
    "",
    `Read planning context from: ${path.join("previous-posts", context.date, "context.json")}`,
    `Write the finished plan JSON to: ${planPath}`,
    "",
    "Output requirements:",
    "- Write valid JSON only to the target file.",
    "- Do not write markdown fences.",
    "- Use exactly this JSON schema:",
    JSON.stringify(buildResponseSchema(context), null, 2),
    "",
    "Execution requirements:",
    "- Use only the provided candidate screenshots.",
    "- Choose the single highest-value post for the requested date.",
    "- Do not render images yourself.",
    "- Do not pick a candidate that duplicates a recent archived concept unless no stronger option exists.",
    "- Do not treat directory variants as meaningfully different just because the exact content_key changed.",
    "- If the chosen candidate has audience_scope `admin-only`, make that admin audience explicit in the copy.",
  ].join("\n");
}

function validatePlan(modelPlan, context) {
  const candidateMap = new Map(
    context.candidate_screenshots.map((candidate) => [candidate.file, candidate]),
  );

  if (modelPlan.date !== context.date) {
    throw new Error(`Model returned date ${modelPlan.date}, expected ${context.date}.`);
  }

  if (!modelPlan.post || typeof modelPlan.post !== "object") {
    throw new Error("Model did not return a `post` object.");
  }

  const post = modelPlan.post;
  if (post.slot !== context.slot.slot) {
    throw new Error(`Model returned slot ${post.slot}, expected ${context.slot.slot}.`);
  }

  if (post.planned_date !== context.slot.planned_date) {
    throw new Error(
      `Post expected planned date ${context.slot.planned_date}, received ${post.planned_date}.`,
    );
  }

  const candidate = candidateMap.get(post.screenshot_file);
  if (!candidate) {
    throw new Error(`Model selected screenshot outside shortlist: ${post.screenshot_file}`);
  }

  if (post.content_key !== candidate.content_key) {
    throw new Error(
      `Model content key mismatch for ${post.screenshot_file}: expected ${candidate.content_key}, received ${post.content_key}.`,
    );
  }

  if (!post.social || typeof post.social !== "object") {
    throw new Error("Post is missing a social copy object.");
  }

  for (const network of Object.keys(LIMITS)) {
    if (String(post.social[network] || "").length > LIMITS[network]) {
      throw new Error(`${network} copy exceeds limit for ${context.date}.`);
    }
  }

  if (candidate.audience_scope === "admin-only") {
    const combinedCopy = [
      post.headline,
      post.subtext,
      post.social.linkedin,
      post.social.mastodon,
      post.social.bluesky,
    ].join(" ");

    if (!ADMIN_COPY_PATTERNS.some((pattern) => pattern.test(combinedCopy))) {
      throw new Error(
        `Admin-only screenshot ${post.screenshot_file} needs copy that explicitly signals admin/team context.`,
      );
    }
  }

  return {
    date: modelPlan.date,
    post: {
      ...post,
      audience_scope: candidate.audience_scope,
      concept_key: candidate.concept_key,
      copy_brief: candidate.copy_brief,
      matched_pull_requests: candidate.matched_pull_requests,
      screenshot_file: candidate.file,
      social: {
        bluesky: post.social.bluesky.trim(),
        linkedin: post.social.linkedin.trim(),
        mastodon: post.social.mastodon.trim(),
      },
      theme: candidate.theme,
      title: candidate.title,
      topic_family: candidate.topic_family || inferTopicFamily(candidate),
      viewport: candidate.viewport,
    },
    summary: modelPlan.summary,
  };
}

function writeContextArtifacts(archiveKey, context) {
  const postRoot = path.join(DAILY_POSTS_ROOT, archiveKey);
  fs.mkdirSync(postRoot, { recursive: true });
  const contextPath = path.join(postRoot, "context.json");
  const promptPath = path.join(postRoot, "prompt.txt");
  const planPath = path.join(postRoot, "plan.json");
  writeJson(contextPath, context);
  fs.writeFileSync(promptPath, `${buildCodexPrompt(context, path.join("previous-posts", archiveKey, "plan.json"))}\n`);
  return {
    contextPath,
    planPath,
    postRoot,
    promptPath,
  };
}

async function renderDailyPlan(plan, archiveKey = plan.date) {
  const outputDir = path.join(DAILY_POSTS_ROOT, archiveKey);
  return renderPost(plan.post, outputDir);
}

async function planDay(args) {
  if (isWeekendDate(args.date)) {
    throw new Error(`Weekend dates are excluded from the daily planner: ${args.date} (${getWeekdayLabel(args.date)}).`);
  }

  const context = buildDailyContext(args);
  const artifacts = writeContextArtifacts(args.archiveKey, context);

  return {
    context,
    contextPath: artifacts.contextPath,
    plan: null,
    planPath: artifacts.planPath,
    postRoot: artifacts.postRoot,
    promptPath: artifacts.promptPath,
  };
}

module.exports = {
  DAILY_POSTS_ROOT,
  buildDailyContext,
  filterCandidatesForArchiveHistory,
  inferTopicFamily,
  parseArgs,
  planDay,
  renderDailyPlan,
  validatePlan,
};
