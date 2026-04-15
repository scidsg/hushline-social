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
  parseLocalDate,
  readJson,
  uniqueTokens,
  writeJson,
} = require("./social-common");

const DAILY_POSTS_ROOT = path.join(REPO_ROOT, "previous-posts");
const ARCHIVE_LOOKBACK_DAYS = 31;
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
const GENERIC_MESSAGE_TOKENS = new Set([
  "a",
  "account",
  "accounts",
  "admin",
  "admins",
  "an",
  "and",
  "anonymous",
  "app",
  "at",
  "attorney",
  "attorneys",
  "before",
  "browser",
  "by",
  "can",
  "compare",
  "deployment",
  "deployments",
  "contact",
  "decide",
  "directory",
  "download",
  "downloads",
  "encrypted",
  "first",
  "for",
  "form",
  "forms",
  "from",
  "hard",
  "help",
  "hush",
  "hushline",
  "if",
  "in",
  "includes",
  "into",
  "is",
  "it",
  "its",
  "law",
  "lawyer",
  "lawyers",
  "learn",
  "legal",
  "line",
  "listing",
  "listings",
  "lets",
  "location",
  "more",
  "message",
  "messages",
  "need",
  "not",
  "of",
  "on",
  "one",
  "or",
  "out",
  "people",
  "profile",
  "profiles",
  "public",
  "reach",
  "recipient",
  "recipients",
  "right",
  "s",
  "secure",
  "securely",
  "set",
  "sign",
  "so",
  "source",
  "sources",
  "start",
  "starts",
  "submission",
  "submissions",
  "team",
  "teams",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "tips",
  "up",
  "visitor",
  "visitors",
  "visit",
  "want",
  "way",
  "whether",
  "with",
  "you",
  "your",
]);
const HUSHLINE_APP_VOICE_GUIDANCE = [
  "Use practical language from hushline.app: Hush Line is for anonymous, end-to-end encrypted contact and secure first contact, not broad marketing claims.",
  "Keep the message grounded in the people Hush Line serves, such as sources, journalists, lawyers, educators, developers, organizers, and trusted recipients when the screenshot supports that audience.",
  "Prefer concrete platform framing from hushline.app like no app download or account required for sources, a public directory that helps people find the right recipient, and browser-based tools that support real review workflows.",
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

function inferAudienceScopeFromEntry(entry) {
  if (entry.audience_scope) {
    return entry.audience_scope;
  }

  const screenshotFile = String(entry.screenshot_file || entry.file || "");
  if (screenshotFile.startsWith("admin/")) {
    return "admin-only";
  }

  return null;
}

function inferThemeFromEntry(entry) {
  if (entry.theme === "light" || entry.theme === "dark") {
    return entry.theme;
  }

  const screenshotFile = String(entry.screenshot_file || entry.file || "");
  if (/-dark-fold\.png$/i.test(screenshotFile)) {
    return "dark";
  }

  if (/-light-fold\.png$/i.test(screenshotFile)) {
    return "light";
  }

  return null;
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
      "  - Builds an eligible screenshot pool from the local curated hushline-screenshots set when available",
      "  - Randomly preselects one screenshot after excluding recent repeats of the same screen",
      "  - Writes daily planning context and a Codex prompt to previous-posts/<archive-key>",
      "  - Expects one high-value post for the requested day",
      "",
    ].join("\n"),
  );
}

function withinArchiveWindow(archiveDate, currentDate) {
  const diffDays = Math.floor((currentDate.getTime() - archiveDate.getTime()) / 86400000);
  return diffDays > 0 && diffDays <= ARCHIVE_LOOKBACK_DAYS;
}

function buildMessageText(entry) {
  return [
    entry.headline,
    entry.subtext,
    entry.linkedin_copy,
    entry.mastodon_copy,
    entry.bluesky_copy,
  ]
    .filter(Boolean)
    .join(" ");
}

function messageTokens(value) {
  return uniqueTokens(value).filter((token) => !GENERIC_MESSAGE_TOKENS.has(token));
}

function sharedMessageTokenCount(left, right) {
  const leftSet = new Set(messageTokens(left));
  const rightSet = new Set(messageTokens(right));
  let count = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      count += 1;
    }
  }

  return count;
}

function normalizeMessageLine(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function lastTemplateUseOffset(archiveHistory, templateName) {
  for (let index = archiveHistory.length - 1; index >= 0; index -= 1) {
    if (archiveHistory[index].template_name === templateName) {
      return archiveHistory.length - index;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function averageTemplateUsageForType(archiveHistory, templateNames, templateType) {
  const matching = templateNames.filter((name) => templateTypeForName(name) === templateType);
  if (matching.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const total = matching.reduce((sum, templateName) => {
    return sum + archiveHistory.filter((entry) => entry.template_name === templateName).length;
  }, 0);

  return total / matching.length;
}

function summarizeCandidateHistory(candidate, archiveHistory) {
  const normalized = {
    ...candidate,
    screen_key: candidate.screen_key || inferScreenKey(candidate),
    topic_family: candidate.topic_family || inferTopicFamily(candidate),
  };
  const stats = {
    candidate: normalized,
    content_matches: 0,
    exact_screenshot_matches: 0,
    novelty_penalty: 0,
    screen_matches: 0,
    topic_matches: 0,
  };

  archiveHistory.forEach((entry, index) => {
    const recencyWeight = archiveHistory.length - index;

    if (entry.screenshot_file && entry.screenshot_file === normalized.file) {
      stats.exact_screenshot_matches += 1;
      stats.novelty_penalty += 12000 * recencyWeight;
    }

    if (entry.content_key && entry.content_key === normalized.content_key) {
      stats.content_matches += 1;
      stats.novelty_penalty += 6000 * recencyWeight;
    }

    if (entry.screen_key && entry.screen_key === normalized.screen_key) {
      stats.screen_matches += 1;
      stats.novelty_penalty += 4000 * recencyWeight;
    }

    if (entry.topic_family && entry.topic_family === normalized.topic_family) {
      stats.topic_matches += 1;
      stats.novelty_penalty += 1500 * recencyWeight;
    }
  });

  return stats;
}

function summarizeWeeklyUsage(archiveHistory, plannedDate) {
  const week = formatIsoWeek(parseLocalDate(plannedDate));

  return archiveHistory.reduce((summary, entry) => {
    if (!entry.date || formatIsoWeek(parseLocalDate(entry.date)) !== week) {
      return summary;
    }

    if (inferAudienceScopeFromEntry(entry) === "admin-only") {
      summary.admin_count += 1;
    }

    if (inferThemeFromEntry(entry) === "dark") {
      summary.dark_count += 1;
    }

    return summary;
  }, {
    admin_count: 0,
    dark_count: 0,
    week,
  });
}

function loadArchiveHistory(currentArchiveKey) {
  if (!fs.existsSync(DAILY_POSTS_ROOT)) {
    return [];
  }
  const currentDate = parseLocalDate(archiveKeyDate(currentArchiveKey));

  return fs
    .readdirSync(DAILY_POSTS_ROOT, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() &&
        isValidArchiveKey(entry.name) &&
        compareArchiveKeys(entry.name, currentArchiveKey) < 0 &&
        withinArchiveWindow(parseLocalDate(archiveKeyDate(entry.name)), currentDate),
    )
    .map((entry) => entry.name)
    .sort(compareArchiveKeys)
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
      const social = post && post.social && typeof post.social === "object"
        ? post.social
        : {};

      return {
        audience_scope: (post && post.audience_scope) || "",
        archive_key: archiveKey,
        bluesky_copy: social.bluesky || "",
        concept_key: (post && (post.concept_key || normalizeConceptKey(post.content_key))) || "",
        content_key: (post && post.content_key) || "",
        date: archiveKeyDate(archiveKey),
        headline: (post && post.headline) || "",
        linkedin_copy: social.linkedin || "",
        mastodon_copy: social.mastodon || "",
        screen_key: (post && (post.screen_key || inferScreenKey(post))) || "",
        screenshot_file: (post && post.screenshot_file) || "",
        subtext: (post && post.subtext) || "",
        template_name: (post && post.template_name) || (templateMatch ? templateMatch[1].trim() : ""),
        theme: (post && post.theme) || "",
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

function chooseTemplateName(archiveHistory, templateNames, options = {}) {
  let candidates = options.templateType
    ? templateNames.filter((name) => templateTypeForName(name) === options.templateType)
    : templateNames.slice();

  if (candidates.length === 0) {
    throw new Error(`No daily templates are available for type: ${options.templateType}`);
  }

  const mostRecentTemplate = archiveHistory[archiveHistory.length - 1]?.template_name;
  if (candidates.length > 1 && mostRecentTemplate && candidates.includes(mostRecentTemplate)) {
    candidates = candidates.filter((templateName) => templateName !== mostRecentTemplate);
  }

  const scoredTemplates = candidates.map((templateName) => {
    const usageCount = archiveHistory.filter((entry) => entry.template_name === templateName).length;

    return {
      last_used_offset: lastTemplateUseOffset(archiveHistory, templateName),
      template_name: templateName,
      usage_count: usageCount,
    };
  });

  scoredTemplates.sort((left, right) => {
    return (
      left.usage_count - right.usage_count ||
      right.last_used_offset - left.last_used_offset ||
      left.template_name.localeCompare(right.template_name, undefined, { numeric: true })
    );
  });

  return scoredTemplates[0].template_name;
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

function filterCandidatesForArchiveHistory(candidates, archiveHistory) {
  const normalizedCandidates = candidates.map((candidate) => {
    const historyStats = summarizeCandidateHistory(candidate, archiveHistory);

    return {
      ...historyStats.candidate,
      history_stats: historyStats,
    };
  });

  const sortByNovelty = (left, right) => {
    const leftStats = left.history_stats;
    const rightStats = right.history_stats;

    return (
      leftStats.exact_screenshot_matches - rightStats.exact_screenshot_matches ||
      leftStats.content_matches - rightStats.content_matches ||
      leftStats.screen_matches - rightStats.screen_matches ||
      leftStats.topic_matches - rightStats.topic_matches ||
      leftStats.novelty_penalty - rightStats.novelty_penalty ||
      (right.score || 0) - (left.score || 0) ||
      String(left.file || left.content_key || left.path || "")
        .localeCompare(String(right.file || right.content_key || right.path || ""))
    );
  };
  const minimumFreshPool = 3;

  const withoutExactOrContentRepeats = normalizedCandidates
    .filter((candidate) => {
      const stats = candidate.history_stats;
      return stats.exact_screenshot_matches === 0 && stats.content_matches === 0;
    })
    .sort(sortByNovelty);

  if (withoutExactOrContentRepeats.length >= minimumFreshPool) {
    return withoutExactOrContentRepeats;
  }

  const withoutExactRepeats = normalizedCandidates
    .filter((candidate) => candidate.history_stats.exact_screenshot_matches === 0)
    .sort(sortByNovelty);

  return (withoutExactRepeats.length > 0
    ? withoutExactRepeats
    : normalizedCandidates.slice().sort(sortByNovelty));
}

function filterCandidatesForWeeklyCaps(candidates, archiveHistory, plannedDate) {
  const weeklyUsage = summarizeWeeklyUsage(archiveHistory, plannedDate);
  let filtered = candidates.slice();

  if (weeklyUsage.admin_count >= 1) {
    filtered = filtered.filter((candidate) => candidate.audience_scope !== "admin-only");
    if (filtered.length === 0) {
      throw new Error(
        `No eligible non-admin screenshot candidates remain for ${plannedDate}; weekly admin-only cap for ${weeklyUsage.week} is already full.`,
      );
    }
  }

  if (weeklyUsage.dark_count >= 1) {
    filtered = filtered.filter((candidate) => candidate.theme !== "dark");
    if (filtered.length === 0) {
      throw new Error(
        `No eligible light-mode screenshot candidates remain for ${plannedDate}; weekly dark-mode cap for ${weeklyUsage.week} is already full.`,
      );
    }
  }

  return filtered;
}

function chooseBestCandidate(candidates, archiveHistory, templateNames) {
  const ranked = rankCandidates(candidates, archiveHistory, templateNames);

  return ranked[0] || null;
}

function rankCandidates(candidates, archiveHistory, templateNames) {
  return candidates
    .map((candidate) => {
      const candidateType = detectCandidateTemplateType(candidate);

      return {
        ...candidate,
        template_type: candidateType,
        template_type_average_usage: averageTemplateUsageForType(
          archiveHistory,
          templateNames,
          candidateType,
        ),
      };
    })
    .sort((left, right) => {
      return (
        Number(left.audience_scope === "admin-only") - Number(right.audience_scope === "admin-only") ||
        left.template_type_average_usage - right.template_type_average_usage ||
        left.history_stats.novelty_penalty - right.history_stats.novelty_penalty ||
        (right.score || 0) - (left.score || 0) ||
        left.file.localeCompare(right.file)
      );
    });
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

    return chooseTemplateName(context.recent_archive_history || [], fallbackTemplates, {
      templateType: fallbackType,
    });
  }

  const candidateType = detectCandidateTemplateType(candidate);
  const matchingTemplateNames = context.template_selection.available_templates.filter(
    (templateName) => templateTypeForName(templateName) === candidateType,
  );

  if (matchingTemplateNames.length > 0) {
    return chooseTemplateName(context.recent_archive_history || [], matchingTemplateNames, {
      templateType: candidateType,
    });
  }

  return chooseTemplateName(
    context.recent_archive_history || [],
    context.template_selection.available_templates,
  );
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
    candidateCount: Math.max(args.candidateCount * 10, 200),
    darkRatio: args.darkRatio,
    week,
  });
  const archiveHistory = loadArchiveHistory(args.archiveKey);
  const templateNames = listDailyTemplateNames();
  const variedCandidates = filterCandidatesForArchiveHistory(
    planningContext.candidate_screenshots,
    archiveHistory,
  );
  const weekEligibleCandidates = filterCandidatesForWeeklyCaps(
    variedCandidates,
    archiveHistory,
    args.date,
  );
  const rankedCandidates = rankCandidates(
    weekEligibleCandidates,
    archiveHistory,
    templateNames,
  );
  const selectedCandidate = rankedCandidates[0] || null;

  if (!selectedCandidate) {
    throw new Error(`No eligible screenshot candidates remain for ${args.date}.`);
  }
  const desiredTemplateName = chooseTemplateNameForCandidate(
    selectedCandidate,
    {
      recent_archive_history: archiveHistory,
      template_selection: {
        available_templates: templateNames,
      },
    },
  );
  const selectedCandidates = rankedCandidates.slice(0, 3);

  return {
    audience_docs: planningContext.audience_docs,
    candidate_screenshots: selectedCandidates,
    daily_posts_root: path.relative(REPO_ROOT, DAILY_POSTS_ROOT),
    date: args.date,
    dark_ratio: args.darkRatio,
    hushline_agent_context: readHushlineAgentExcerpt(),
    hushline_app_voice_guidance: HUSHLINE_APP_VOICE_GUIDANCE,
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
  const voiceGuidance = (context.hushline_app_voice_guidance || HUSHLINE_APP_VOICE_GUIDANCE)
    .map((line) => `- ${line}`)
    .join("\n");
  const archiveHistory = context.recent_archive_history.length === 0
    ? "No prior archived daily posts were found."
    : context.recent_archive_history
        .map((entry) => {
          return [
            `${entry.archive_key}: ${entry.content_key} [${entry.topic_family}] (${entry.screenshot_file})`,
            `  Template: ${entry.template_name || "unknown"}`,
            `  Headline: ${entry.headline || "n/a"}`,
            `  Subtext: ${entry.subtext || "n/a"}`,
          ].join("\n");
        })
        .join("\n");

  return {
    system: [
      "You are writing one daily social post for Hush Line around a small ranked screenshot shortlist.",
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
      "Current hushline.app voice guidance:",
      voiceGuidance,
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
      "- Choose exactly one screenshot from the provided candidates.",
      `- Check the prior ${ARCHIVE_LOOKBACK_DAYS} days of archived daily posts before you decide on the messaging angle.`,
      "- The candidates were preselected from a ranked pool after excluding recent repeats of the same screenshot, screen, feature family, and overused template types wherever possible.",
      "- Produce exactly one post for the requested date.",
      "- Do not talk about recent releases, recent merges, or product recency unless the prompt explicitly gives you that information.",
      "- Do not repeat a screenshot, feature, or messaging angle that already appeared in the prior month, even if you could retarget it to a different audience.",
      "- Treat screenshots in the same topic family as repeats even when the exact content_key differs. For example, directory-all, directory-verified, and onboarding-directory all count as directory posts for variation purposes.",
      "- Prefer the candidate that gives you the most distinct message from the recent archive, not just the highest-ranked familiar topic.",
      "- Match the copy to the candidate audience scope. Public screens should read public-facing. Recipient-shared screens should read like recipient workflows. Admin-only screens must clearly say admin or team context.",
      "- Tailor the message to real Hush Line users and use cases, not generic product copy.",
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
    "- Use exactly one of the provided screenshots.",
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

  const weeklyUsage = summarizeWeeklyUsage(context.recent_archive_history || [], context.date);
  if (candidate.audience_scope === "admin-only" && weeklyUsage.admin_count >= 1) {
    throw new Error(
      `Weekly admin-only cap already reached for ${weeklyUsage.week}; cannot select ${post.screenshot_file} on ${context.date}.`,
    );
  }

  if (candidate.theme === "dark" && weeklyUsage.dark_count >= 1) {
    throw new Error(
      `Weekly dark-mode cap already reached for ${weeklyUsage.week}; cannot select ${post.screenshot_file} on ${context.date}.`,
    );
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

  const currentMessageText = buildMessageText({
    bluesky_copy: post.social.bluesky,
    headline: post.headline,
    linkedin_copy: post.social.linkedin,
    mastodon_copy: post.social.mastodon,
    subtext: post.subtext,
  });

  for (const entry of context.recent_archive_history || []) {
    const archivedMessageText = buildMessageText(entry);
    const sameFeature = (
      (entry.screen_key && entry.screen_key === (candidate.screen_key || inferScreenKey(candidate))) ||
      (entry.topic_family && entry.topic_family === (candidate.topic_family || inferTopicFamily(candidate)))
    );
    const matchingHeadline = normalizeMessageLine(entry.headline) === normalizeMessageLine(post.headline);
    const headlineOverlap = sharedMessageTokenCount(
      `${post.headline} ${post.subtext}`,
      `${entry.headline} ${entry.subtext}`,
    );
    const bodyOverlap = sharedMessageTokenCount(currentMessageText, archivedMessageText);

    if (matchingHeadline) {
      throw new Error(
        `Post headline for ${context.date} duplicates recent archive headline from ${entry.archive_key}.`,
      );
    }

    if (sameFeature && (headlineOverlap >= 3 || bodyOverlap >= 6)) {
      throw new Error(
        `Post messaging for ${context.date} is too close to recent ${entry.topic_family} archive ${entry.archive_key}.`,
      );
    }

    if (headlineOverlap >= 6 && bodyOverlap >= 10) {
      throw new Error(
        `Post messaging for ${context.date} overlaps too heavily with recent archive ${entry.archive_key}.`,
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

function loadSavedDailyContext(archiveKey) {
  const contextPath = path.join(DAILY_POSTS_ROOT, archiveKey, "context.json");
  if (!fs.existsSync(contextPath)) {
    return null;
  }

  return readJson(contextPath);
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
  filterCandidatesForWeeklyCaps,
  filterCandidatesForTemplateName,
  inferTopicFamily,
  loadSavedDailyContext,
  parseArgs,
  planDay,
  renderDailyPlan,
  validatePlan,
};
