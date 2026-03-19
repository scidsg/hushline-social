#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL =
  "https://raw.githubusercontent.com/scidsg/hushline-screenshots/main/releases/latest";

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.HUSHLINE_SCREENSHOTS_BASE_URL || DEFAULT_BASE_URL,
    dest: path.resolve(process.cwd(), "..", "hushline-screenshots", "releases", "latest"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--dest") {
      args.dest = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (value === "--base-url") {
      args.baseUrl = argv[index + 1];
      index += 1;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/sync-latest-screenshots.js",
      "  node scripts/sync-latest-screenshots.js --dest ../hushline-screenshots/releases/latest",
      "",
      "Behavior:",
      "  - Downloads the upstream latest manifest from hushline-screenshots",
      "  - Downloads all fold-mode PNGs referenced by that manifest",
      "  - Writes them into the local latest screenshots folder",
      "",
    ].join("\n"),
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "hushline-social-sync/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "hushline-social-sync/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function foldFilesFromManifest(manifest) {
  const files = new Set(["manifest.json"]);

  for (const scene of manifest.scenes || []) {
    for (const file of scene.files || []) {
      if (file.mode === "fold") {
        files.add(file.file);
      }
    }
  }

  return [...files].sort();
}

async function downloadWithConcurrency(files, worker) {
  const concurrency = 8;
  let cursor = 0;

  async function runWorker() {
    while (cursor < files.length) {
      const current = cursor;
      cursor += 1;
      await worker(files[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => runWorker()),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await fetchText(`${args.baseUrl}/manifest.json`));
  const files = foldFilesFromManifest(manifest);

  fs.mkdirSync(args.dest, { recursive: true });
  fs.writeFileSync(
    path.join(args.dest, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const imageFiles = files.filter((file) => file !== "manifest.json");
  await downloadWithConcurrency(imageFiles, async (file) => {
    const destination = path.join(args.dest, file);
    const buffer = await fetchBuffer(`${args.baseUrl}/${file}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
  });

  process.stdout.write(
    [
      `Synced latest screenshots into ${args.dest}`,
      `Release: ${manifest.release}`,
      `Captured at: ${manifest.capturedAt}`,
      `Fold screenshots: ${imageFiles.length}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
