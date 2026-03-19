# AGENTS.md

## Purpose

This repo is a dynamic social post agent for Hush Line.

The job is not to produce a static yearly batch with hard-coded copy. The job is to:

- build a fresh weekly social plan
- create 5 posts per week
- map those posts to Monday through Friday
- choose screenshots from the latest available capture set
- generate end-user-facing social copy
- generate one separate alt text block per image
- render final social assets from approved templates
- support daily automatic publishing, with LinkedIn as the first target platform

## Core Planning Rules

- The planner must be dynamic.
- Do not hard-code feature themes, post copy, or a fixed yearly manifest.
- Use current local Hush Line context to decide what to feature.
- Prioritize recently shipped work based on local PR history and current docs.
- Favor features that align with Hush Line’s documented user base.
- Keep content fresh week to week. Avoid repeating the same concept across adjacent plans.

## Source Inputs

Use these sources when planning:

- `../hushline`
  - recent PR history
  - docs describing users and use cases
- `../hushline-screenshots/releases/latest`
  - latest published screenshot set

Do not treat old archived screenshot releases as the primary source when planning new content.

## Screenshot Selection Rules

- Use screenshots from the `latest` folder only.
- Use above-the-fold screenshots for social asset composition.
- Avoid empty-state UIs.
- Avoid screenshots that do not clearly showcase Hush Line.
- Avoid duplicate concepts, even if one version is mobile and another is desktop.
- Balance mobile and desktop usage across a weekly plan.
- Include some dark mode, but keep it a minority share. Target about 20%.
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
- no marketing-speak
- no filler
- no duplicate copy pasted across all three networks
- same core message, adapted natively per network

## Character Limits

Respect current per-network limits:

- LinkedIn: `3000`
- Mastodon: `500`
- Bluesky: `300`

## Asset Rules

- Use the existing mobile or desktop template
- do not change footer, color system, background graphics, or layout unless explicitly requested
- render PNG output at `@2x`

## Planning Model

This is a weekly planner, not a static annual planner.

Expected behavior:

- prepare weekly context
- call Codex through the shell runner pattern
- have Codex choose 5 posts for the requested week from current context
- validate the plan
- render from the validated plan

Weekly plan shape:

- one plan per ISO week
- five posts per plan
- one post each for Monday, Tuesday, Wednesday, Thursday, and Friday

## Operational Rule

The planner should fail rather than silently proceed on stale screenshot data.

Before planning:

- confirm screenshots are sourced from `../hushline-screenshots/releases/latest`
- confirm the local screenshot set is fresh enough for production use

## Publishing Model

Publishing is daily, planning is weekly.

- the weekly planner creates the full Monday through Friday set
- the daily publisher selects the post whose `planned_date` is today
- LinkedIn is the first production publishing target
- do not double-post; persist local publication state
- launchd is the intended scheduler on the server
- launchd should call the wrapper script, not a raw `node` command
- secrets should come from `.env.launchd` or an explicitly configured env file on the server

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
- mobile/desktop balance is reasonable
- dark mode stays near the target share
- alt text is separate from social copy
- 5 posts exist for the week
- planned dates cover Monday through Friday
- no repeated concept appears in the same week
- the daily publisher can identify today’s LinkedIn post cleanly
