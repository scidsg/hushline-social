# AGENTS.md

## Purpose

This repo is a dynamic social post agent for Hush Line.

The job is not to produce a static yearly batch with hard-coded copy. The job is to:

- build a fresh daily social post
- create one post per day
- choose screenshots from the latest available capture set
- generate end-user-facing social copy
- generate one separate alt text block per image
- render final social assets from approved templates
- archive rendered daily assets under `previous-posts/YYYY-MM-DD`
- support daily automatic publishing, with LinkedIn as the first target platform

## Core Planning Rules

- The planner must be dynamic.
- Do not hard-code feature themes, post copy, or a fixed yearly manifest.
- Use current local Hush Line context to decide what to feature.
- Prioritize recently shipped work based on closed-completed local PR history and current docs.
- Favor features that align with Hush Line’s documented user base.
- Keep content fresh day to day. Avoid repeating the same concept across adjacent archived posts.

## Source Inputs

Use these sources when planning:

- `../hushline`
  - recent PR history
  - docs describing users and use cases
- `../hushline-screenshots/releases/latest`
  - latest published screenshot set

Do not treat old archived screenshot releases as the primary source when planning new content.

For verified-user weekly posts:

- poll the live verified-user directory source on each production run
- assume verified users can be added, removed, or updated at any time
- do not rely on a stale local snapshot for production selection
- use a local JSON file only for explicit tests, debugging, or fixture-based verification

## Screenshot Selection Rules

- Use screenshots from the `latest` folder only.
- Use above-the-fold screenshots for social asset composition.
- Avoid empty-state UIs.
- Avoid screenshots that do not clearly showcase Hush Line.
- Avoid duplicate concepts, even if one version is mobile and another is desktop.
- Balance mobile and desktop usage across recent archived posts.
- Include some dark mode, but keep it a minority share across recent archived posts.
- If a screenshot is admin-specific, the copy must clearly say that it is for admins or teams running Hush Line.

## Audience Context Rules

Match copy to the screenshot context.

- `guest` or public-facing screens:
  - write for sources, visitors, and public users evaluating or using Hush Line
- authenticated end-user screens:
  - write for recipients and staff using Hush Line day to day
- admin-only screens:
  - explicitly signal admin, team, or deployment context

Do not write generic copy that ignores the screenshot’s audience.

## Screenshot Ownership Rules

The screenshot logic lives upstream in `../hushline`.

Current ownership model:

- `admin`
  - admin-only features
- `artvandelay`
  - full end-user feature set
- `newman`
  - onboarding and incomplete-account states
- `guest`
  - public and unauthenticated flows

Do not patch around bad screenshot ownership in this repo if the root fix belongs in `../hushline`.

## Copy Rules

Each planned post must include:

- headline
- subtext
- image alt text
- LinkedIn copy
- Mastodon copy
- Bluesky copy

Rules:

- social copy must be end-user-facing
- alt text must be separate from social copy
- do not include alt text inside post copy
- no marketing-speak
- no filler
- avoid hype, superlatives, and vague claims
- do not paste the exact same copy across all three networks
- keep the same core message across platforms, but adapt phrasing natively for each network
- match the copy to the screenshot and its audience context
- if the screenshot is admin-only, explicitly say so in the copy
- every post must end with a relevant CTA for that specific post, such as:
  - `Sign up at https://hushline.app.`
  - `Learn more at https://hushline.app.`

Verified-user weekly copy style:

- write the opening sentence around the selected person, not around Hush Line
- every verified-user post should begin with exactly `🤩 Verified Member Highlight!`
- that opening line must be followed by a blank line before the person-specific copy starts
- start with the person's name and role or beat, for example `James is an investigative journalist covering national security and politics.`
- keep the copy plain and direct
- do not frame the post as a generic "verified profile" announcement
- do not lead with trust-language, platform-language, or marketing-language
- the CTA should directly tell people how to send that person a tip
- prefer CTA lines in this form:
  - `To send James a tip, go to https://tips.hushline.app/to/james.`
  - `To send James a tip, visit https://tips.hushline.app/to/james.`
- when the source bio is written in first person, rewrite it into third person before using it in social copy
- keep the same core sentence structure across networks, with minor native phrasing changes only
- alt text still stays separate from the social copy

Structure:

- posts should be written in `2–3 short paragraphs`
- separate paragraphs with a blank line
- each paragraph should express one clear idea
- paragraph 1 should open with a concrete, human, user-relevant point
- paragraph 2 should explain the feature, workflow, or value shown in the screenshot
- paragraph 3, if used, should be a short CTA or closing line
- do not write wall-of-text captions
- do not write in bullets, threads, or slogan fragments unless explicitly requested

Example:

```text
Whistleblowers often face the hardest moment at the very beginning: where to go and who to trust.

Hush Line now includes a directory of public-record law firms that support whistleblowers across jurisdictions. It helps people identify legitimate organizations before they disclose sensitive information.

Learn more at https://hushline.app.
```

## Character Limits

Respect current per-network limits:

- LinkedIn: `3000`
- Mastodon: `500`
- Bluesky: `300`

## Asset Rules

- For regular daily posts, use templates discovered from `templates/hushline-daily-*.html`
- The planner should choose one eligible daily template at random, then select a post that fits that template
- The verified-user template is separate and not part of daily template selection
- do not change footer, color system, background graphics, or layout unless explicitly requested
- render PNG output at `@2x`

## Planning Model

This is a daily planner, not a static annual planner.

Expected behavior:

- prepare daily context
  - check the `previous-posts` folder to avoid duplicate post content 
- call Codex through the shell runner pattern
- have Codex choose one post for the requested date from current context
- validate the plan
- render from the validated plan into `previous-posts/YYYY-MM-DD`
- archive that day's folder back to this repository for audit access

Daily plan shape:

- one plan per calendar date
- one post per plan
- one folder per date under `previous-posts/YYYY-MM-DD`

## Operational Rule

The planner should fail rather than silently proceed on stale screenshot data.

Before planning:

- confirm screenshots are sourced from `../hushline-screenshots/releases/latest`
- confirm the local screenshot set is fresh enough for production use

## Publishing Model

Publishing is daily, planning is daily.

- the daily planner creates that day's single post folder under `previous-posts/YYYY-MM-DD`
- the daily publisher selects the archived post whose date is today
- LinkedIn is the first production publishing target
- do not double-post; use the pushed dated archive folder as the cross-machine publication-state record
- launchd is the intended scheduler on the server
- launchd should call the wrapper script, not a raw `node` command
- secrets should come from `.env.launchd` or an explicitly configured env file on the server
- archive pushes should use signed commits and push only the daily folder contents needed for audit
- for daily posts, do not push the archive folder before LinkedIn publication succeeds; push the dated folder after publication so the repo reflects posted state
- for verified-user weekly posts, do not push the archive folder before LinkedIn publication succeeds; push the dated folder after publication so the repo reflects posted state

Current default launchd schedule in this repo:

- `com.hushline.social.daily-planner`
  - `06:00` local time, Monday through Friday
- `com.hushline.social.linkedin.daily`
  - `06:10` local time, Monday through Friday
- `com.hushline.social.verified-user.weekly`
  - `12:00` local time every Monday
- `com.hushline.social.linkedin.verified-user.weekly`
  - `12:10` local time every Monday

Keep the publisher scheduled after the planner with enough buffer for rendering, archive writes, and local state updates.

Weekend dates are excluded from the daily planner and daily LinkedIn publisher. Verified-user LaunchAgents are scheduled for Mondays, but manual verified-user creation and publishing may be run for any explicit date override.

For always-on servers, do not rely on GUI-only LaunchAgents. Install the background jobs with:

```sh
cd /Users/scidsg/hushline-social
sudo ./scripts/install_launch_agent.sh --scope daemon
```

GUI scope is still acceptable for local desktop testing, but it can miss scheduled runs when the user is logged out.

By default, the daily planner wrapper performs `git pull --ff-only` before planning. By default it also discards dirty tracked changes with `git reset --hard HEAD` and removes untracked non-ignored files with `git clean -fd` before that pull. Set `HUSHLINE_SOCIAL_GIT_PULL=0` only when intentionally skipping the update step. Set `HUSHLINE_SOCIAL_GIT_CLEAN=0` if you want the planner to fail on a dirty checkout instead of resetting it.

## Publication State Rules

- for daily posts, treat the pushed `previous-posts/YYYY-MM-DD` folder itself as the publication-state record across machines
- for weekly verified-user posts, treat the pushed `previous-verified-user-posts/YYYY-MM-DD` folder itself as the publication-state record across machines
- do not push a dated archive folder before its LinkedIn publication succeeds unless you explicitly intend to mark that date as already posted
- if a published dated archive folder is missing from the repo, another machine may treat that date as unpublished and create a duplicate LinkedIn post

## Manual Runbook

Use the launchd wrappers for manual runs so env loading and lock handling match production:

```sh
cd /Users/scidsg/hushline-social
./scripts/run_daily_planner_launchd.sh
./scripts/run_daily_linkedin_launchd.sh
./scripts/run_verified_user_weekly_launchd.sh
./scripts/run_verified_user_weekly_linkedin_launchd.sh
```

For a specific date:

```sh
cd /Users/scidsg/hushline-social
./scripts/run_daily_planner_launchd.sh --date YYYY-MM-DD
./scripts/run_daily_linkedin_launchd.sh --date YYYY-MM-DD
./scripts/run_verified_user_weekly_launchd.sh --date YYYY-MM-DD
./scripts/run_verified_user_weekly_linkedin_launchd.sh --date YYYY-MM-DD
```

Do not use the bare publisher script for routine live runs when `.env.launchd` or launchd-style locking matters.

Daemon-mode `.env.launchd` files should include:

- `OPENAI_API_KEY`
- `HUSHLINE_SOCIAL_GITHUB_TOKEN`
- `HUSHLINE_SOCIAL_GIT_SIGNING_KEY_PUB`
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_AUTHOR_URN`

## Launchd Troubleshooting

- if a scheduled time changes, reinstall the agents with `./scripts/install_launch_agent.sh`
- if the host may be logged out at run time, reinstall with `sudo ./scripts/install_launch_agent.sh --scope daemon`
- if you need to stop scheduled runs temporarily, disable and boot out both launch agents rather than editing code paths
- if a wrapper exits with an "already running" message, check for a stale lock directory under `.tmp/`
- if the daily archive folder is missing, the publisher should not post until the planner recreates that date's archive
- if the weekly verified-user archive folder is missing, the verified-user LinkedIn publisher should not post until the runner recreates that date's archive
- if the planner archive was deleted after a live post, restore `linkedin-publication.json` before allowing the publisher to run again

## Upstream Screenshot Workflow Notes

If screenshot capture behavior itself is wrong, fix it in:

- `../hushline/docs/screenshots/scenes.json`
- `../hushline/docs/screenshots/scenes.first-user.json`
- `../hushline/scripts/capture-doc-screenshots.mjs`

Do not try to permanently solve capture-policy problems only inside the planner.

## Verification

When screenshot scene ownership changes upstream, verify in `../hushline` with:

```sh
make test TESTS=tests/test_docs_screenshots_manifest.py
```

When planning in this repo, verify that:

- selected screenshots come from `latest`
- admin-only screenshots are rare and clearly labeled in copy
- mobile/desktop balance is reasonable across recent archived posts
- dark mode stays a minority share across recent archived posts
- alt text is separate from social copy
- one post exists for the date being generated
- the planned date matches the archive folder date
- no repeated concept appears across adjacent archived posts
- the daily publisher can identify today’s LinkedIn post cleanly from `previous-posts/YYYY-MM-DD`
