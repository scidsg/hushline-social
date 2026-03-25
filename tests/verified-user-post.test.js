const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildPost,
  normalizeVerifiedUsers,
  parseArgs,
  prepareVerifiedUserRun,
  renderHtml,
  selectVerifiedUser,
} = require("../scripts/lib/verified-user-post");

const SAMPLE_USERS = [
  {
    bio: "Public-interest reporter covering procurement and labor issues.",
    display_name: "Alex Rowan",
    entry_type: "user",
    is_verified: true,
    primary_username: "alex-rowan",
    profile_url: "/to/alex-rowan",
  },
  {
    bio: "Investigative editor focused on energy and utilities.",
    display_name: "Bri Stone",
    entry_type: "user",
    is_verified: true,
    primary_username: "bri-stone",
    profile_url: "/to/bri-stone",
  },
  {
    bio: "Ignored because not verified.",
    display_name: "Casey Draft",
    entry_type: "user",
    is_verified: false,
    primary_username: "casey-draft",
    profile_url: "/to/casey-draft",
  },
];

test("parseArgs rejects malformed dates", () => {
  assert.throws(
    () => parseArgs(["--date", "2026/03/30"]),
    /`--date` must use YYYY-MM-DD format/,
  );
});

test("normalizeVerifiedUsers keeps verified user rows and resolves /to URLs", () => {
  const users = normalizeVerifiedUsers(SAMPLE_USERS, "https://tips.hushline.app");

  assert.equal(users.length, 2);
  assert.equal(users[0].display_name, "Alex Rowan");
  assert.equal(users[0].user_url, "https://tips.hushline.app/to/alex-rowan");
  assert.equal(users[1].user_url, "https://tips.hushline.app/to/bri-stone");
});

test("selectVerifiedUser rotates away from recent archive entries", () => {
  const users = normalizeVerifiedUsers(SAMPLE_USERS, "https://tips.hushline.app");
  const selected = selectVerifiedUser(users, [
    {
      date: "2026-03-23",
      primary_username: "alex-rowan",
    },
  ]);

  assert.equal(selected.primary_username, "bri-stone");
});

test("prepareVerifiedUserRun rejects non-Monday dates", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verified-user-post-"));
  const sourcePath = path.join(tempRoot, "users.json");
  fs.writeFileSync(sourcePath, `${JSON.stringify(SAMPLE_USERS, null, 2)}\n`);

  await assert.rejects(
    () => prepareVerifiedUserRun({
      baseUrl: "https://tips.hushline.app",
      date: "2026-03-31",
      noRender: true,
      source: sourcePath,
    }),
    /run only on Mondays/,
  );
});

test("prepareVerifiedUserRun selects the next user after archive history", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "verified-user-post-"));
  const sourcePath = path.join(tempRoot, "users.json");
  const archiveRoot = path.join(tempRoot, "archive");
  fs.mkdirSync(path.join(archiveRoot, "2026-03-23"), { recursive: true });
  fs.writeFileSync(sourcePath, `${JSON.stringify(SAMPLE_USERS, null, 2)}\n`);
  fs.writeFileSync(
    path.join(archiveRoot, "2026-03-23", "post.json"),
    `${JSON.stringify({
      date: "2026-03-23",
      display_name: "Alex Rowan",
      primary_username: "alex-rowan",
      user_url: "https://tips.hushline.app/to/alex-rowan",
    }, null, 2)}\n`,
  );

  const run = await prepareVerifiedUserRun(
    {
      baseUrl: "https://tips.hushline.app",
      date: "2026-03-30",
      noRender: true,
      source: sourcePath,
    },
    { archiveRoot },
  );

  assert.equal(run.selectedUser.primary_username, "bri-stone");
  assert.equal(run.post.user_link, "https://tips.hushline.app/to/bri-stone");
});

test("renderHtml injects the selected user text and QR filename", () => {
  const post = buildPost({
    date: "2026-03-30",
    selectedUser: {
      bio: "Investigative editor focused on energy and utilities.",
      display_name: "Bri Stone",
      primary_username: "bri-stone",
      user_url: "https://tips.hushline.app/to/bri-stone",
    },
    source: "fixture",
  });
  const html = renderHtml(post, "verified-user-qr.png", "logo-tips.png");

  assert.match(html, /Bri Stone/);
  assert.match(html, /Investigative editor focused on energy and utilities\./);
  assert.match(html, /https:\/\/tips\.hushline\.app\/to\/bri-stone/);
  assert.match(html, /\.\/verified-user-qr\.png/);
});
