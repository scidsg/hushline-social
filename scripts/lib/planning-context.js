"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  HUSHLINE_DOCS_ROOT,
  HUSHLINE_ROOT,
  LIMITS,
  REPO_ROOT,
  SCREENSHOT_MANIFEST,
  excerptText,
  listFilesRecursive,
  readJson,
  resolveScreenshotPath,
  sharedTokenCount,
  writeJson,
} = require("./social-common");

const DOC_DISCOVERY_TERMS = [
  "journalist",
  "journalists",
  "lawyer",
  "lawyers",
  "attorney",
  "attorneys",
  "whistleblower",
  "whistleblowers",
  "source",
  "sources",
  "newsroom",
  "newsrooms",
  "recipient",
  "recipients",
  "tip line",
  "anonymous",
];

const EXCLUDED_SCREEN_PATTERNS = [
  /\blogin\b/i,
  /\bregister\b/i,
  /\b2fa\b/i,
  /\binbox\b/i,
  /\bmessage submitted\b/i,
  /\bmessage status\b/i,
  /\bjs disabled\b/i,
  /\bdefault state\b/i,
  /\breset\b/i,
  /\bsearch '.*'\b/i,
  /\bsearch\b/i,
];

const PREFERRED_SCREEN_PATTERNS = [
  { pattern: /\bdirectory - verified\b/i, weight: 14 },
  { pattern: /\bencryption\b/i, weight: 12 },
  { pattern: /\bnotifications\b/i, weight: 8 },
  { pattern: /\bmessage statuses\b/i, weight: 8 },
  { pattern: /\bvision assistant\b/i, weight: 10 },
  { pattern: /\buser guidance\b/i, weight: 6 },
  { pattern: /\bauthentication\b/i, weight: 6 },
  { pattern: /\bdirectory\b/i, weight: 4 },
  { pattern: /\bonboarding\b/i, weight: 5 },
];

const ADMIN_ONLY_ROUTE_PATTERNS = [
  /^\/settings\/admin\b/i,
  /^\/settings\/registration\b/i,
];

const ADMIN_ONLY_TEXT_PATTERNS = [
  /\badmin search buster\b/i,
  /\bbranding\b/i,
];

const PUBLIC_ROUTE_PATTERNS = [
  /^\/directory\b/i,
];

const RECIPIENT_SHARED_ROUTE_PATTERNS = [
  /^\/email-headers\b/i,
  /^\/vision\b/i,
  /^\/settings\/aliases\b/i,
  /^\/settings\/auth\b/i,
  /^\/settings\/encryption\b/i,
  /^\/settings\/notifications\b/i,
  /^\/settings\/profile\b/i,
  /^\/settings\/replies\b/i,
  /^\/settings\/advanced\b/i,
];

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

const WEEKDAY_SLOT_ORDER = new Map([
  ["monday", 0],
  ["tuesday", 1],
  ["wednesday", 2],
  ["thursday", 3],
  ["friday", 4],
]);

function parseArgs(argv) {
  const args = {
    candidateCount: 12,
    darkRatio: 0.2,
    dryRun: false,
    week: defaultWeek(),
    noRender: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--week") {
      args.week = argv[index + 1];
      index += 1;
    } else if (value === "--candidate-count") {
      args.candidateCount = Number(argv[index + 1]);
      index += 1;
    } else if (value === "--dark-ratio") {
      args.darkRatio = Number(argv[index + 1]);
      index += 1;
    } else if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--no-render") {
      args.noRender = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!/^\d{4}-W\d{2}$/.test(args.week)) {
    throw new Error("`--week` must use YYYY-Www format.");
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
      "Internal shared planning context module.",
      "Use the day or month planning entrypoints instead of calling this file directly.",
      "",
      "Behavior:",
      "  - Reads recent merged PRs from the local Hush Line repo and GitHub CLI",
      "  - Reads current audience context from Hush Line docs",
      "  - Builds a candidate screenshot inventory from hushline-screenshots/releases/latest",
      "  - Builds a reusable planning context for downstream daily or monthly planners",
      "",
    ].join("\n"),
  );
}

function defaultWeek() {
  return formatIsoWeek(new Date());
}

function formatIsoWeek(date) {
  const cursor = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((cursor - yearStart) / 86400000) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function parseIsoWeek(week) {
  const match = String(week).match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO week: ${week}`);
  }

  return {
    weekNumber: Number(match[2]),
    year: Number(match[1]),
  };
}

function getIsoWeekStart(week) {
  const { year, weekNumber } = parseIsoWeek(week);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + ((weekNumber - 1) * 7));
  return monday;
}

function buildWeekSlots(week) {
  const monday = getIsoWeekStart(week);
  const labels = ["monday", "tuesday", "wednesday", "thursday", "friday"];

  return labels.map((label, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return {
      planned_date: date.toISOString().slice(0, 10),
      slot: label,
    };
  });
}

function loadScreenshotInventory() {
  const manifest = readJson(SCREENSHOT_MANIFEST);

  return {
    captured_at: manifest.capturedAt,
    inventory: manifest.scenes
      .map((scene) => {
        const fold = scene.files.find((file) => file.mode === "fold");
        if (!fold) {
          return null;
        }

        const absolutePath = resolveScreenshotPath(fold.file);
        return {
          absolute_path: absolutePath,
          ...inferCandidateContext({
            content_key: scene.slug,
            path: scene.path,
            session: scene.session,
            title: scene.title,
          }),
          content_key: scene.slug,
          file: fold.file,
          path: scene.path,
          session: scene.session,
          theme: scene.theme,
          title: scene.title,
          viewport: scene.viewport,
        };
      })
      .filter(Boolean),
    release: manifest.release,
  };
}

function normalizeConceptKey(contentKey) {
  return String(contentKey || "")
    .replace(/^(auth-(admin|artvandelay|newman)|guest)-/, "")
    .replace(/^-+/, "");
}

function inferCandidateContext(item) {
  const pathValue = String(item.path || "");
  const text = `${item.title} ${item.content_key} ${item.path} ${item.session}`.toLowerCase();

  if (PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathValue)) || item.session === "guest") {
    return {
      audience_scope: "public",
      concept_key: normalizeConceptKey(item.content_key),
      copy_brief: "Write for sources and public users evaluating or using Hush Line.",
    };
  }

  if (
    ADMIN_ONLY_ROUTE_PATTERNS.some((pattern) => pattern.test(pathValue)) ||
    ADMIN_ONLY_TEXT_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return {
      audience_scope: "admin-only",
      concept_key: normalizeConceptKey(item.content_key),
      copy_brief: "Write for admins or teams running a Hush Line deployment. Make the admin audience explicit.",
    };
  }

  if (
    RECIPIENT_SHARED_ROUTE_PATTERNS.some((pattern) => pattern.test(pathValue)) ||
    item.session === "newman" ||
    item.session === "artvandelay"
  ) {
    return {
      audience_scope: "recipient-shared",
      concept_key: normalizeConceptKey(item.content_key),
      copy_brief: "Write for recipients and staff using Hush Line day to day, not for platform admins.",
    };
  }

  if (item.session === "admin") {
    return {
      audience_scope: "admin-only",
      concept_key: normalizeConceptKey(item.content_key),
      copy_brief: "Write for admins or teams running a Hush Line deployment. Make the admin audience explicit.",
    };
  }

  return {
    audience_scope: "recipient-shared",
    concept_key: normalizeConceptKey(item.content_key),
    copy_brief: "Write for recipients and staff using Hush Line day to day, not for platform admins.",
  };
}

function discoverAudienceDocs() {
  const readmePath = path.join(HUSHLINE_ROOT, "README.md");
  const candidateFiles = [readmePath];

  try {
    const rgPattern = DOC_DISCOVERY_TERMS
      .map((term) => term.replaceAll(" ", "\\s+"))
      .join("|");
    const discovered = execFileSync(
      "rg",
      [
        "-l",
        "--glob",
        "*.md",
        rgPattern,
        path.join(HUSHLINE_ROOT, "docs"),
        path.join(HUSHLINE_DOCS_ROOT, "docs"),
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 4,
      },
    )
      .split("\n")
      .filter(Boolean)
      .slice(0, 60);

    candidateFiles.push(...discovered);
  } catch (error) {
    candidateFiles.push(
      ...listFilesRecursive(
        path.join(HUSHLINE_ROOT, "docs"),
        (filePath) => filePath.endsWith(".md"),
      ).slice(0, 40),
      ...listFilesRecursive(
        path.join(HUSHLINE_DOCS_ROOT, "docs"),
        (filePath) => filePath.endsWith(".md"),
      ).slice(0, 40),
    );
  }

  const scored = candidateFiles
    .map((filePath) => {
      const content = fs.readFileSync(filePath, "utf8");
      const lower = content.toLowerCase();
      const score = DOC_DISCOVERY_TERMS.reduce((total, term) => {
        return total + (lower.includes(term) ? 1 : 0);
      }, 0);

      return {
        excerpt: excerptText(content),
        file: filePath,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  const selected = [];
  const seen = new Set();
  for (const entry of scored) {
    if (seen.has(entry.file)) {
      continue;
    }

    selected.push({
      excerpt: entry.excerpt,
      file: path.relative(REPO_ROOT, entry.file),
    });
    seen.add(entry.file);

    if (selected.length === 6) {
      break;
    }
  }

  return selected;
}

function fetchRecentPullRequests(limit = 20) {
  try {
    return JSON.parse(
      execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "merged",
          "--limit",
          String(limit),
          "--json",
          "number,title,mergedAt,url",
          "--repo",
          "scidsg/hushline",
        ],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 4,
          timeout: 5000,
        },
      ),
    );
  } catch (error) {
    const raw = execFileSync(
      "git",
      [
        "-C",
        HUSHLINE_ROOT,
        "log",
        "--pretty=format:%cI|%s",
        `-n${limit}`,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const [mergedAt, title] = line.split("|");
        return {
          mergedAt,
          number: null,
          title,
          url: null,
          fallback_index: index,
        };
      })
      .filter((entry) => !/^merge\s+(pull request|branch)\b/i.test(entry.title));
  }
}

function scoreCandidates(inventory, recentPullRequests, audienceDocs) {
  const audienceText = audienceDocs.map((doc) => doc.excerpt).join(" ");

  return inventory
    .map((item) => {
      const candidateText = [item.title, item.content_key, item.path, item.session].join(" ");
      let score = sharedTokenCount(candidateText, audienceText) * 2.5;
      const matchedPullRequests = [];
      const quality = evaluateScreenshotQuality(item);

      recentPullRequests.forEach((pr, index) => {
        const overlap = sharedTokenCount(candidateText, pr.title);
        if (overlap > 0) {
          const recencyWeight = recentPullRequests.length - index;
          score += overlap * recencyWeight;
          matchedPullRequests.push({
            merged_at: pr.mergedAt,
            number: pr.number,
            title: pr.title,
          });
        }
      });

      score += quality.weight;

      return {
        ...item,
        exclusion_reason: quality.exclusionReason,
        matched_pull_requests: matchedPullRequests.slice(0, 4),
        score,
      };
    })
    .sort((left, right) => {
      return right.score - left.score || left.file.localeCompare(right.file);
    });
}

function evaluateScreenshotQuality(item) {
  const text = `${item.title} ${item.content_key} ${item.path}`.toLowerCase();

  for (const pattern of EXCLUDED_SCREEN_PATTERNS) {
    if (pattern.test(text)) {
      return {
        exclusionReason: `filtered by quality rule: ${pattern}`,
        weight: -1000,
      };
    }
  }

  if (item.path.startsWith("/to/") || /\bprofile\b/i.test(item.title)) {
    return {
      exclusionReason: "profile-based screenshots are excluded unless we can positively verify trust signals like a visible PGP key",
      weight: -1000,
    };
  }

  if (item.session !== "guest" && PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(item.path))) {
    return {
      exclusionReason: "public-facing routes should use guest captures, not authenticated sessions",
      weight: -1000,
    };
  }

  if (item.session === "admin" && RECIPIENT_SHARED_ROUTE_PATTERNS.some((pattern) => pattern.test(item.path))) {
    return {
      exclusionReason: "shared recipient routes should not use admin-session captures",
      weight: -1000,
    };
  }

  let weight = 0;
  for (const rule of PREFERRED_SCREEN_PATTERNS) {
    if (rule.pattern.test(text)) {
      weight += rule.weight;
    }
  }

  if (item.theme === "light") {
    weight += 0.5;
  }

  return {
    exclusionReason: null,
    weight,
  };
}

function loadRecentHistory(currentWeek) {
  const plansRoot = path.join(REPO_ROOT, "plans");
  if (!fs.existsSync(plansRoot)) {
    return [];
  }

  return fs
    .readdirSync(plansRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-W\d{2}$/.test(entry.name) && entry.name < currentWeek)
    .map((entry) => path.join(plansRoot, entry.name, "plan.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort()
    .slice(-6)
    .map((filePath) => readJson(filePath))
    .map((plan) => ({
      week: plan.week || plan.month,
      posts: plan.posts.map((post) => ({
        concept_key: normalizeConceptKey(post.content_key),
        content_key: post.content_key,
        screenshot_file: post.screenshot_file,
        slot: post.slot,
      })),
    }));
}

function chooseSessionScopedCandidates(scored) {
  const grouped = new Map();

  for (const item of scored) {
    if (!grouped.has(item.concept_key)) {
      grouped.set(item.concept_key, []);
    }
    grouped.get(item.concept_key).push(item);
  }

  return [...grouped.values()].flatMap((variants) => {
    const sessions = new Set(variants.map((variant) => variant.session));
    const publicVariants = variants.filter((variant) => variant.audience_scope === "public");
    const recipientVariants = variants.filter((variant) => variant.audience_scope === "recipient-shared");
    const adminVariants = variants.filter((variant) => variant.audience_scope === "admin-only");

    if (publicVariants.length > 0 && sessions.has("guest")) {
      return publicVariants.filter((variant) => variant.session === "guest");
    }

    if (recipientVariants.length > 0) {
      const nonAdmin = recipientVariants.filter((variant) => variant.session !== "admin");
      if (nonAdmin.length > 0) {
        return nonAdmin;
      }
      return recipientVariants;
    }

    if (adminVariants.length > 0) {
      return adminVariants.filter((variant) => variant.session === "admin");
    }

    return variants;
  });
}

function buildCandidateShortlist(options) {
  const {
    candidateCount,
    darkRatio,
    week,
    requestedPosts,
  } = options;
  const recentPullRequests = fetchRecentPullRequests(20);
  const audienceDocs = discoverAudienceDocs();
  const screenshots = loadScreenshotInventory();
  const recentHistory = loadRecentHistory(week);
  const usedContentKeys = new Set(
    recentHistory.flatMap((plan) => plan.posts.map((post) => post.content_key)),
  );
  const usedConceptKeys = new Set(
    recentHistory.flatMap((plan) => plan.posts.map((post) => post.concept_key)),
  );
  const scored = scoreCandidates(screenshots.inventory, recentPullRequests, audienceDocs)
    .filter((item) => !item.exclusion_reason)
    .filter((item) => !usedContentKeys.has(item.content_key))
    .filter((item) => !usedConceptKeys.has(item.concept_key));
  const sessionScoped = chooseSessionScopedCandidates(scored);

  const targetCount = Math.max(candidateCount, Math.max(8, requestedPosts * 2));
  const grouped = new Map();

  for (const item of sessionScoped) {
    if (!grouped.has(item.concept_key)) {
      grouped.set(item.concept_key, []);
    }
    grouped.get(item.concept_key).push(item);
  }

  const concepts = [...grouped.values()]
    .map((variants) => {
      const ordered = variants
        .slice()
        .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
      return {
        audience_scope: ordered[0].audience_scope,
        base_score: ordered[0].score,
        concept_key: ordered[0].concept_key,
        copy_brief: ordered[0].copy_brief,
        path: ordered[0].path,
        variants: ordered,
      };
    })
    .sort((left, right) => right.base_score - left.base_score || left.concept_key.localeCompare(right.concept_key));

  const selectedConcepts = [];
  const pathCounts = new Map();
  const maxPerPath = 1;

  function canSelectConcept(concept) {
    return (pathCounts.get(concept.path) || 0) < maxPerPath;
  }

  function rememberConcept(concept) {
    selectedConcepts.push(concept);
    pathCounts.set(concept.path, (pathCounts.get(concept.path) || 0) + 1);
  }

  for (const concept of concepts) {
    if (selectedConcepts.length >= targetCount) {
      break;
    }

    if (canSelectConcept(concept)) {
      rememberConcept(concept);
    }
  }

  const shortlist = assignVariantsToConcepts(selectedConcepts, targetCount, darkRatio);

  return {
    audienceDocs,
    recentHistory,
    recentPullRequests,
    screenshotCapturedAt: screenshots.captured_at,
    screenshotRelease: screenshots.release,
    shortlist: shortlist.slice(0, targetCount),
  };
}

function assignVariantsToConcepts(selectedConcepts, targetCount, darkRatio) {
  const targetMobile = Math.floor(targetCount / 2);
  const targetDesktop = targetCount - targetMobile;
  const targetDark = darkRatio <= 0 ? 0 : Math.max(1, Math.round(targetCount * darkRatio));
  let mobileCount = 0;
  let desktopCount = 0;
  let darkCount = 0;

  return selectedConcepts.map((concept, index) => {
    const remaining = selectedConcepts.length - index;
    const needMobile = targetMobile - mobileCount;
    const needDesktop = targetDesktop - desktopCount;
    const needDark = targetDark - darkCount;

    const preferredViewport = needMobile > needDesktop ? "mobile" : "desktop";
    const preferredTheme = needDark > 0 && needDark >= remaining ? "dark" : "light";

    const chosen = concept.variants
      .slice()
      .sort((left, right) => {
        return (
          variantPriority(right, preferredViewport, preferredTheme, needDark) -
            variantPriority(left, preferredViewport, preferredTheme, needDark) ||
          right.score - left.score ||
          left.file.localeCompare(right.file)
        );
      })[0];

    if (chosen.viewport === "mobile") {
      mobileCount += 1;
    } else {
      desktopCount += 1;
    }

    if (chosen.theme === "dark") {
      darkCount += 1;
    }

    return chosen;
  });
}

function variantPriority(variant, preferredViewport, preferredTheme, needDark) {
  let priority = 0;

  if (variant.viewport === preferredViewport) {
    priority += 6;
  }

  if (variant.theme === preferredTheme) {
    priority += 4;
  }

  if (variant.theme === "light" && needDark <= 0) {
    priority += 2;
  }

  if (variant.theme === "dark" && needDark > 0) {
    priority += 1;
  }

  return priority;
}

function buildPromptPayload(context) {
  const slots = context.slots
    .map((slot) => `${slot.slot}: ${slot.planned_date}`)
    .join("\n");
  const pullRequests = context.recent_pull_requests
    .map((pr) => {
      const number = pr.number ? `#${pr.number}` : "local";
      return `${number} | ${pr.mergedAt} | ${pr.title}`;
    })
    .join("\n");
  const docs = context.audience_docs
    .map((doc) => `${doc.file}\n${doc.excerpt}`)
    .join("\n\n");
  const history = context.recent_history.length === 0
    ? "No prior plan history was found."
    : context.recent_history
        .map((plan) => {
          const posts = plan.posts
            .map((post) => `${post.slot}: ${post.content_key} (${post.screenshot_file})`)
            .join("; ");
          return `${plan.week}: ${posts}`;
        })
        .join("\n");

  return {
    system: [
      "You are planning a set of weekday social posts for Hush Line.",
      "Choose screenshots that reflect recent product work and documented user needs.",
      "Write in plain language. No marketing-speak, no hype, no filler.",
      "Social copy must be end-user-facing. Do not confuse post copy with alt text.",
      "Avoid empty-state screens, duplicate content themes, and repeated scenes across mobile/desktop variants.",
      "Avoid profile screenshots unless the image visibly shows strong trust/authenticity signals such as a visible PGP key or clear verification cues.",
      "If a screenshot is admin-only, the copy must explicitly say that it is for admins or teams running Hush Line.",
      "LinkedIn is the first automated publishing target, so LinkedIn copy should be especially ready for production use.",
    ].join(" "),
    user: [
      `Plan week: ${context.week}`,
      "",
      "Weekday slots:",
      slots,
      "",
      "Character limits:",
      `LinkedIn ${LIMITS.linkedin}`,
      `Mastodon ${LIMITS.mastodon}`,
      `Bluesky ${LIMITS.bluesky}`,
      "",
      `Target dark-mode share for this week: ${context.dark_ratio}`,
      `Screenshot release from local latest folder: ${context.screenshot_release}`,
      `Screenshots captured at: ${context.screenshot_captured_at}`,
      "",
      "Recently merged Hush Line PRs:",
      pullRequests,
      "",
      "Audience and user-base context from docs:",
      docs,
      "",
      "Recent plan history to avoid repeating:",
      history,
      "",
      "Instructions:",
      "- Pick exactly one screenshot per slot from the provided candidates only.",
      "- Prioritize recent shipped work that appears clearly in the screenshot.",
      "- Favor screenshots that matter to journalists, lawyers, whistleblowers, sources, and other trusted recipients.",
      "- Produce exactly five posts, one for each weekday Monday through Friday.",
      "- Avoid repeating the same content theme or route within the week.",
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
    type: "object",
    additionalProperties: false,
    required: ["week", "summary", "posts"],
    properties: {
      week: {
        type: "string",
        pattern: "^\\d{4}-W\\d{2}$",
      },
      summary: {
        type: "string",
      },
      posts: {
        type: "array",
        minItems: context.slots.length,
        maxItems: context.slots.length,
        items: {
          type: "object",
          additionalProperties: false,
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
          properties: {
            slot: {
              type: "string",
            },
            planned_date: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            },
            screenshot_file: {
              type: "string",
            },
            content_key: {
              type: "string",
            },
            headline: {
              type: "string",
            },
            subtext: {
              type: "string",
            },
            image_alt_text: {
              type: "string",
            },
            social: {
              type: "object",
              additionalProperties: false,
              required: ["linkedin", "mastodon", "bluesky"],
              properties: {
                linkedin: { type: "string" },
                mastodon: { type: "string" },
                bluesky: { type: "string" },
              },
            },
            rationale: {
              type: "string",
            },
            source_pr_numbers: {
              type: "array",
              items: {
                type: "integer",
              },
            },
          },
        },
      },
    },
  };
}

function buildCodexPrompt(context, planPath) {
  const prompt = buildPromptPayload(context);
  const candidates = context.candidate_screenshots
    .map((candidate, index) => {
      return [
        `Candidate ${index + 1}`,
        `file: ${candidate.file}`,
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
    `Read planning context from: ${path.join("plans", context.week, "context.json")}`,
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
    "- Do not render images yourself.",
    "- Do not duplicate content_key values within the week.",
    "- Do not duplicate concept_key values within the week.",
    "- Avoid screenshots that look like empty states.",
    "- Avoid profile screenshots unless the trust/authenticity signals are visibly strong in the screenshot.",
    "- If a chosen candidate has audience_scope `admin-only`, make that admin audience explicit in the copy.",
    "- If multiple candidates represent the same route or concept, pick the clearest one and leave the others unused.",
  ].join("\n");
}

function validatePlan(modelPlan, context) {
  const slotMap = new Map(context.slots.map((slot) => [slot.slot, slot.planned_date]));
  const candidateMap = new Map(
    context.candidate_screenshots.map((candidate) => [candidate.file, candidate]),
  );

  if (modelPlan.week !== context.week) {
    throw new Error(`Model returned week ${modelPlan.week}, expected ${context.week}.`);
  }

  if (!Array.isArray(modelPlan.posts) || modelPlan.posts.length !== context.slots.length) {
    throw new Error("Model returned the wrong number of posts for the week.");
  }

  const usedContentKeys = new Set();
  const usedConceptKeys = new Set();
  const usedSlots = new Set();

  const posts = modelPlan.posts.map((post) => {
    if (!slotMap.has(post.slot)) {
      throw new Error(`Model returned unknown slot: ${post.slot}`);
    }

    if (usedSlots.has(post.slot)) {
      throw new Error(`Model repeated slot: ${post.slot}`);
    }
    usedSlots.add(post.slot);

    const expectedDate = slotMap.get(post.slot);
    if (post.planned_date !== expectedDate) {
      throw new Error(`Slot ${post.slot} expected planned date ${expectedDate}, received ${post.planned_date}.`);
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

    if (usedContentKeys.has(post.content_key)) {
      throw new Error(`Model repeated content key ${post.content_key} within the week.`);
    }
    usedContentKeys.add(post.content_key);

    if (usedConceptKeys.has(candidate.concept_key)) {
      throw new Error(`Model repeated concept key ${candidate.concept_key} within the week.`);
    }
    usedConceptKeys.add(candidate.concept_key);

    if (!post.social || typeof post.social !== "object") {
      throw new Error(`Post ${post.slot} is missing a social copy object.`);
    }

    for (const network of Object.keys(LIMITS)) {
      if (String(post.social[network] || "").length > LIMITS[network]) {
        throw new Error(`${network} copy exceeds limit for ${post.slot}.`);
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
        throw new Error(`Admin-only screenshot ${post.screenshot_file} needs copy that explicitly signals admin/team context.`);
      }
    }

    return {
      ...post,
      audience_scope: candidate.audience_scope,
      concept_key: candidate.concept_key,
      copy_brief: candidate.copy_brief,
      matched_pull_requests: candidate.matched_pull_requests,
      screenshot_file: candidate.file,
      social: {
        linkedin: post.social.linkedin.trim(),
        mastodon: post.social.mastodon.trim(),
        bluesky: post.social.bluesky.trim(),
      },
      theme: candidate.theme,
      title: candidate.title,
      viewport: candidate.viewport,
    };
  });

  return {
    week: modelPlan.week,
    posts: posts.sort((left, right) => {
      return (
        (WEEKDAY_SLOT_ORDER.get(left.slot) ?? 999) - (WEEKDAY_SLOT_ORDER.get(right.slot) ?? 999) ||
        left.slot.localeCompare(right.slot)
      );
    }),
    summary: modelPlan.summary,
  };
}

function buildPlanningContext(args) {
  const slots = buildWeekSlots(args.week);
  const shortlistData = buildCandidateShortlist({
    candidateCount: args.candidateCount,
    darkRatio: args.darkRatio,
    week: args.week,
    requestedPosts: slots.length,
  });

  return {
    audience_docs: shortlistData.audienceDocs,
    candidate_screenshots: shortlistData.shortlist,
    dark_ratio: args.darkRatio,
    week: args.week,
    recent_history: shortlistData.recentHistory,
    recent_pull_requests: shortlistData.recentPullRequests,
    screenshot_captured_at: shortlistData.screenshotCapturedAt,
    screenshot_release: shortlistData.screenshotRelease,
    slots,
  };
}

function writeContextArtifacts(week, context) {
  const planRoot = path.join(REPO_ROOT, "plans", week);
  fs.mkdirSync(planRoot, { recursive: true });
  const contextPath = path.join(planRoot, "context.json");
  const promptPath = path.join(planRoot, "prompt.txt");
  const planPath = path.join(planRoot, "plan.json");
  writeJson(contextPath, context);
  fs.writeFileSync(promptPath, `${buildCodexPrompt(context, path.join("plans", week, "plan.json"))}\n`);
  return {
    contextPath,
    planPath,
    planRoot,
    promptPath,
  };
}

async function planWeek(args) {
  const context = buildPlanningContext(args);
  const artifacts = writeContextArtifacts(args.week, context);

  return {
    context,
    contextPath: artifacts.contextPath,
    dryRun: args.dryRun,
    plan: null,
    planPath: artifacts.planPath,
    promptPath: artifacts.promptPath,
  };
}

module.exports = {
  buildPlanningContext,
};
