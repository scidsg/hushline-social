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
  detectTemplate,
  excerptText,
  getWeekdayLabel,
  inferScreenKey,
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
      "  - Reads audience context from Hush Line docs and ../hushline/AGENTS.md",
      "  - Builds an eligible screenshot pool from hushline-screenshots/releases/latest",
      "  - Randomly preselects one screenshot after excluding recent repeats of the same screen",
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
      const postCopyPath = path.join(DAILY_POSTS_ROOT, archiveKey, "post-copy.txt");
      let post = null;

      if (fs.existsSync(postPath)) {
        post = readJson(postPath);
      }

      if (!post && !fs.existsSync(postCopyPath)) {
        return null;
      }
      const postCopy = fs.existsSync(postCopyPath)
        ? fs.readFileSync(postCopyPath, "utf8")
        : "";
      const templateMatch = postCopy.match(/^Template:\s+(.+)$/m);

      return {
        archive_key: archiveKey,
        concept_key: (post && (post.concept_key || normalizeConceptKey(post.content_key))) || "",
        content_key: (post && post.content_key) || "",
        date: archiveKeyDate(archiveKey),
        headline: (post && post.headline) || "",
        screen_key: (post && (post.screen_key || inferScreenKey(post))) || "",
        screenshot_file: (post && post.screenshot_file) || "",
        template_name: (post && post.template_name) || (templateMatch ? templateMatch[1].trim() : ""),
        topic_family: (post && (post.topic_family || inferTopicFamily(post))) || "",
      };
    })
    .filter(Boolean);
}

function listDailyTemplateNames() {
  return fs.readdirSync(path.join(REPO_ROOT, "templates"))
    .filter((name) => /^hushline-daily-.*\.html$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function templateTypeForName(templateName) {
  if (/^hushline-daily-mobile-template(?:-.+)?\.html$/.test(templateName)) {
    return "mobile";
  }

  if (/^hushline-daily-desktop-template(?:-.+)?\.html$/.test(templateName)) {
    return "desktop";
  }

  return null;
}

function detectCandidateTemplateType(candidate) {
  try {
    return detectTemplate(candidate.file || candidate.screenshot_file);
  } catch (_error) {
    if (candidate.viewport === "mobile" || candidate.viewport === "desktop") {
      return candidate.viewport;
    }

    return null;
  }
}

function chooseTemplateName(_archiveHistory, templateNames) {
  if (templateNames.length === 0) {
    throw new Error("No daily templates are available.");
  }

  return templateNames[Math.floor(Math.random() * templateNames.length)];
}

function filterCandidatesForTemplateName(candidates, templateName) {
  const desiredType = templateTypeForName(templateName);

  if (!desiredType) {
    return candidates;
  }

  const matchingCandidates = candidates.filter(
    (candidate) => detectCandidateTemplateType(candidate) === desiredType,
  );

  return matchingCandidates.length > 0 ? matchingCandidates : candidates;
}

function chooseTemplateNameForCandidate(candidate, context) {
  if (
    !context.template_selection ||
    !Array.isArray(context.template_selection.available_templates) ||
    context.template_selection.available_templates.length === 0
  ) {
    const fallbackType = detectCandidateTemplateType(candidate);
    const fallbackTemplates = listDailyTemplateNames().filter(
      (templateName) => templateTypeForName(templateName) === fallbackType,
    );

    return fallbackTemplates[0] || null;
  }

  const candidateType = detectCandidateTemplateType(candidate);
  const desiredTemplateType = context.template_selection.desired_template_type;

  if (
    candidateType &&
    candidateType === desiredTemplateType &&
    context.template_selection.desired_template_name
  ) {
    return context.template_selection.desired_template_name;
  }

  const matchingTemplateNames = context.template_selection.available_templates.filter(
    (templateName) => templateTypeForName(templateName) === candidateType,
  );

  if (matchingTemplateNames.length > 0) {
    return matchingTemplateNames[0];
  }

  return context.template_selection.desired_template_name;
}

function filterCandidatesForArchiveHistory(candidates, archiveHistory) {
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    screen_key: candidate.screen_key || inferScreenKey(candidate),
    topic_family: candidate.topic_family || inferTopicFamily(candidate),
  }));
  const usedContentKeys = new Set(archiveHistory.map((entry) => entry.content_key));
  const usedScreenKeys = new Set(
    archiveHistory.map((entry) => entry.screen_key || inferScreenKey(entry)),
  );

  const strict = normalizedCandidates.filter((candidate) => {
    return !usedContentKeys.has(candidate.content_key) && !usedScreenKeys.has(candidate.screen_key);
  });
  if (strict.length > 0) {
    return strict;
  }

  const relaxed = normalizedCandidates.filter((candidate) => !usedContentKeys.has(candidate.content_key));
  if (relaxed.length > 0) {
    return relaxed;
  }

  return normalizedCandidates;
}

function pickRandomCandidates(candidates, count = 1) {
  const shuffled = candidates.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
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
  const templateNames = listDailyTemplateNames();
  const desiredTemplateName = chooseTemplateName(archiveHistory, templateNames);
  const variedCandidates = filterCandidatesForArchiveHistory(
    planningContext.candidate_screenshots,
    archiveHistory,
  );
  const filteredCandidates = filterCandidatesForTemplateName(variedCandidates, desiredTemplateName);
  const selectedCandidates = pickRandomCandidates(filteredCandidates, 1);

  if (selectedCandidates.length === 0) {
    throw new Error(`No eligible screenshot candidates remain for ${args.date}.`);
  }

  return {
    audience_docs: planningContext.audience_docs,
    candidate_screenshots: selectedCandidates,
    daily_posts_root: path.relative(REPO_ROOT, DAILY_POSTS_ROOT),
    date: args.date,
    dark_ratio: args.darkRatio,
    hushline_agent_context: readHushlineAgentExcerpt(),
    recent_archive_history: archiveHistory,
    screenshot_captured_at: planningContext.screenshot_captured_at,
    screenshot_release: planningContext.screenshot_release,
    slot: {
      planned_date: args.date,
      slot: getWeekdayLabel(args.date),
    },
    template_selection: {
      available_templates: templateNames,
      desired_template_name: desiredTemplateName,
      desired_template_type: templateTypeForName(desiredTemplateName),
    },
    week,
  };
}

function buildPromptPayload(context) {
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
      "You are writing one daily social post for Hush Line around a preselected screenshot.",
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
      `Target template for this run: ${context.template_selection.desired_template_name}`,
      `Screenshot release from local latest folder: ${context.screenshot_release}`,
      `Screenshots captured at: ${context.screenshot_captured_at}`,
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
      "- Use the provided screenshot only.",
      "- The screenshot was preselected at random from the current eligible pool after excluding recent repeats of the same screen and matching the target template for this run.",
      "- Produce exactly one post for the requested date.",
      "- Do not talk about recent releases, recent merges, or product recency unless the prompt explicitly gives you that information.",
      "- Avoid repeating a content theme or route that was used recently in archived daily posts.",
      "- Treat screenshots in the same topic family as repeats even when the exact content_key differs. For example, directory-all, directory-verified, and onboarding-directory all count as directory posts for variation purposes.",
      "- The provided screenshot already fits the target template for this run.",
      "- Match the copy to the candidate audience scope. Public screens should read public-facing. Recipient-shared screens should read like recipient workflows. Admin-only screens must clearly say admin or team context.",
      "- Headline and subtext should be concise and straightforward.",
      "- Each network copy should say the same core thing in a native way, not copy-paste the same sentence three times.",
      "- The alt text should describe the final image asset, not just the raw UI screenshot.",
      "- Set `source_pr_numbers` to an empty array unless the prompt explicitly provides PR numbers to cite.",
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
        `screen_key: ${candidate.screen_key}`,
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
    "- Use only the provided screenshot.",
    "- Do not render images yourself.",
    "- Do not mention recent release timing, recent PRs, or recency-based product claims unless the prompt explicitly includes that evidence.",
    "- Use `source_pr_numbers: []` unless the prompt explicitly gives you PR numbers to cite.",
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
      screen_key: candidate.screen_key || inferScreenKey(candidate),
      screenshot_file: candidate.file,
      social: {
        bluesky: post.social.bluesky.trim(),
        linkedin: post.social.linkedin.trim(),
        mastodon: post.social.mastodon.trim(),
      },
      template_name: chooseTemplateNameForCandidate(candidate, context),
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
  chooseTemplateName,
  filterCandidatesForArchiveHistory,
  filterCandidatesForTemplateName,
  inferTopicFamily,
  parseArgs,
  planDay,
  renderDailyPlan,
  validatePlan,
};
