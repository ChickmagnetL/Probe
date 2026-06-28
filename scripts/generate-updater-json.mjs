#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function parseArgs(argv) {
  const options = {
    requirePlatforms: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact-dir") options.artifactDir = argv[++i];
    else if (arg === "--output") options.output = argv[++i];
    else if (arg === "--version") options.version = argv[++i];
    else if (arg === "--url-prefix") options.urlPrefix = argv[++i];
    else if (arg === "--notes") options.notes = argv[++i];
    else if (arg === "--notes-file") options.notesFile = argv[++i];
    else if (arg === "--pub-date") options.pubDate = argv[++i];
    else if (arg === "--require-platform") options.requirePlatforms.push(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.artifactDir) throw new Error("--artifact-dir is required");
  if (!options.version) throw new Error("--version is required");
  if (!options.urlPrefix) throw new Error("--url-prefix is required");
  return options;
}

function listArtifactFiles(rootDir) {
  return readdirSync(rootDir)
    .map((entry) => {
      const fullPath = join(rootDir, entry);
      return {
        fileName: basename(fullPath),
        fullPath,
        isFile: statSync(fullPath).isFile(),
      };
    })
    .filter((entry) => entry.isFile)
    .map(({ fileName, fullPath }) => ({ fileName, fullPath }))
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function findAsset(files, matcher) {
  return files.find(({ fileName }) => matcher(fileName)) ?? null;
}

function readSignature(filePath) {
  return readFileSync(filePath, "utf8").trim();
}

function buildPlatforms(artifactDir) {
  const files = listArtifactFiles(artifactDir.path);
  const platforms = {};

  const macArchive = findAsset(files, (file) => file.endsWith(".app.tar.gz"));
  const macSignature = macArchive
    ? findAsset(files, (file) => file === `${macArchive.fileName}.sig`)
    : null;
  if (macArchive && macSignature) {
    platforms["darwin-aarch64"] = {
      url: `${artifactDir.urlPrefix}/${macArchive.fileName}`,
      signature: readSignature(macSignature.fullPath),
    };
  }

  const windowsExe = findAsset(files, (file) => file.endsWith(".exe") && !file.endsWith(".exe.sig"));
  const windowsSignature = windowsExe
    ? findAsset(files, (file) => file === `${windowsExe.fileName}.sig`)
    : null;
  if (windowsExe && windowsSignature) {
    platforms["windows-x86_64"] = {
      url: `${artifactDir.urlPrefix}/${windowsExe.fileName}`,
      signature: readSignature(windowsSignature.fullPath),
    };
  }

  return platforms;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactDir = {
    path: args.artifactDir,
    urlPrefix: args.urlPrefix.replace(/\/$/, ""),
  };

  const notes = args.notesFile
    ? readFileSync(args.notesFile, "utf8").trim()
    : (args.notes ?? "");

  const platforms = buildPlatforms(artifactDir);
  if (Object.keys(platforms).length === 0) {
    throw new Error("No updater artifacts were found in the artifact directory.");
  }

  for (const requiredPlatform of args.requirePlatforms) {
    if (!(requiredPlatform in platforms)) {
      throw new Error(`Missing required updater platform artifact: ${requiredPlatform}`);
    }
  }

  const latest = {
    version: args.version,
    notes,
    pub_date: args.pubDate ?? new Date().toISOString(),
    platforms,
  };

  const outputPath = args.output ?? join(args.artifactDir, "latest.json");
  writeFileSync(outputPath, `${JSON.stringify(latest, null, 2)}\n`);
}

main();
