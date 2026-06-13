# Hush Line Social Archive

This repository is the runtime archive/env checkout for Hush Line social automation.

Agent code, tests, templates, assets, launchd templates, package files, and operating
docs live in [`scidsg/hushline-agents`](https://github.com/scidsg/hushline-agents)
under `agents/social/`.

This repository may contain generated social output such as:

- `previous-posts/`
- `previous-article-posts/`
- `previous-verified-user-posts/`
- local runtime logs
- local `.env.launchd`

Do not add agent implementation files here. Move them to `hushline-agents/agents/social/`.
