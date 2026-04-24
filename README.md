# Hush Line Social

Dynamic social-post automation for Hush Line.

This repo plans one post per publish date from current local Hush Line context, renders the social asset from the approved template set, archives the result in-repo, and publishes LinkedIn first for the daily flow.

## What It Does

- builds one fresh post per run from current docs and the latest screenshot set
- randomly picks one eligible screenshot per run after excluding recent repeats of the same screen
- selects screenshots only from `../hushline-screenshots/releases/latest`
- writes network-specific copy plus separate image alt text
- renders the final `@2x` PNG asset into `previous-posts/YYYY-MM-DD`
- uses the pushed dated archive folder as the LinkedIn publication-state record across machines
- discovers regular daily templates from any `templates/hushline-daily-*.html` file
- picks one matching daily template at random for each run, then constrains the screenshot choice to that template type
- enforces weekly daily-post caps of at most one admin-targeted screenshot and at most one dark-mode screenshot per Monday-through-Friday week
- renders one weekly verified-user post archive from directory JSON into `previous-verified-user-posts/YYYY-MM-DD`
- writes network-specific copy, alt text, and a `post-copy.txt` alongside the verified-user card assets
- fills the verified-user template with display name, bio, direct `/to/...` URL, and a matching QR code
- publishes the weekly verified-user archive to LinkedIn after rendering
- pushes the weekly verified-user archive to git after successful LinkedIn publication so the pushed dated folder itself is the published-state record

## Schedule

Default launchd schedules are weekday-only:

- planner: `06:00` local time, Monday through Friday
- LinkedIn publisher: `06:10` local time, Monday through Friday
- verified-user weekly runner: `12:00` local time every Monday
- verified-user LinkedIn publisher: `12:10` local time every Monday

Weekend dates are intentionally skipped by both the launchd wrappers and the direct daily planner/publisher entrypoints.

## Key Paths

- social repo: `/Users/scidsg/hushline-social`
- upstream app repo: `../hushline`
- screenshot source: `../hushline-screenshots/releases/latest`
- daily archive root: `previous-posts`
- verified-user archive root: `previous-verified-user-posts`
- launchd env file: `.env.launchd`
- combined live log: `logs/social-daily.log`

## Manual Runs

Use the launchd wrappers so env loading and lock handling match production:

```sh
cd /Users/scidsg/hushline-social
./scripts/run_daily_planner_launchd.sh
./scripts/run_daily_linkedin_launchd.sh
./scripts/run_verified_user_weekly_launchd.sh
./scripts/run_verified_user_weekly_linkedin_launchd.sh
```

For a specific weekday or Monday:

```sh
cd /Users/scidsg/hushline-social
./scripts/run_daily_planner_launchd.sh --date YYYY-MM-DD
./scripts/run_daily_linkedin_launchd.sh --date YYYY-MM-DD
./scripts/run_verified_user_weekly_launchd.sh --date YYYY-MM-DD
./scripts/run_verified_user_weekly_linkedin_launchd.sh --date YYYY-MM-DD
```

To monitor both launchd jobs from one terminal:

```sh
cd /Users/scidsg/hushline-social
tail -n 50 -f logs/social-daily.log
```

## Launchd Install

GUI scope is acceptable for local testing but can miss scheduled runs when the user is logged out:

```sh
cd /Users/scidsg/hushline-social
./scripts/install_launch_agent.sh --scope gui
```

For an always-on server, use daemon scope instead:

```sh
cd /Users/scidsg/hushline-social
sudo ./scripts/install_launch_agent.sh --scope daemon
```

## Daemon Requirements

Daemon mode needs a fully non-interactive `.env.launchd` setup:

- `OPENAI_API_KEY`
- `HUSHLINE_SOCIAL_GITHUB_TOKEN`
- `HUSHLINE_SOCIAL_GIT_SIGNING_KEY_PUB`
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_AUTHOR_URN`

Optional Codex overrides:

- `CODEX_MODEL` defaults to `gpt-5.5`
- `CODEX_REASONING_EFFORT` defaults to `high`

Optional verified-user source overrides:

- `HUSHLINE_VERIFIED_USERS_SOURCE` for a local JSON file or remote `users.json` URL
- `HUSHLINE_VERIFIED_USERS_BASE_URL` to change the base origin used for relative `/to/...` links

The repo includes a preflight check for this:

```sh
cd /Users/scidsg/hushline-social
./scripts/check_launchd_prereqs.sh --scope gui
./scripts/check_launchd_prereqs.sh --scope daemon
```

## Notes

- Regular daily templates are discovered dynamically from `templates/hushline-daily-*.html`. Adding a new file with that prefix makes it eligible for future daily runs without further code changes.
- The verified-user template is separate and does not participate in daily template selection.
- The planner fails on stale screenshot data unless explicitly overridden.
- The daily planner enforces hard weekly caps for the weekday run set: no more than one admin-targeted post and no more than one dark-mode screenshot in the same Monday-through-Friday week.
- The daily planner and manual daily post wrappers can reset tracked changes, remove untracked files, and run `git pull --ff-only` in both `hushline-social` and `../hushline-screenshots` before planning.
- The daily planner keeps its archive local by default; the daily LinkedIn publisher pushes `previous-posts/YYYY-MM-DD` after successful publication, and the pushed dated folder is the publication-state signal across machines.
- The verified-user weekly LaunchAgents are scheduled for Mondays, but the manual wrappers can be run for any date override.
- The verified-user LinkedIn publisher posts from `previous-verified-user-posts/YYYY-MM-DD`.
- The weekly verified-user render step keeps its archive local by default; the LinkedIn publish step pushes that dated folder after successful publication, and the pushed dated folder is the publication-state signal across machines.
- Do not use this repo to permanently patch upstream screenshot ownership issues; fix those in `../hushline`.
