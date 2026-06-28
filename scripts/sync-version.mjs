#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ROOT = resolve(new URL("..", import.meta.url).pathname);

function replaceOrThrow(content, pattern, replacer, filePath) {
  if (!pattern.test(content)) {
    throw new Error(`Could not update ${filePath}`);
  }
  return content.replace(pattern, replacer);
}

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function write(path, content) {
  writeFileSync(resolve(ROOT, path), content);
}

function readCargoVersion() {
  const cargo = read("tauri/Cargo.toml");
  const match = cargo.match(/^version = "([^"]+)"$/m);
  if (!match) throw new Error("Could not read version from tauri/Cargo.toml");
  return match[1];
}

function setCargoVersion(version) {
  const cargoPath = "tauri/Cargo.toml";
  const cargo = read(cargoPath);
  const updated = replaceOrThrow(
    cargo,
    /^version = "[^"]+"$/m,
    `version = "${version}"`,
    cargoPath,
  );
  write(cargoPath, updated);
}

function syncFrontendPackage(version) {
  const packagePath = "frontend/package.json";
  const packageJson = JSON.parse(read(packagePath));
  packageJson.version = version;
  write(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function syncFrontendLock(version) {
  const lockPath = "frontend/package-lock.json";
  const lock = JSON.parse(read(lockPath));
  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }
  write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function syncEnginePyproject(version) {
  const pyprojectPath = "engine/pyproject.toml";
  const pyproject = read(pyprojectPath);
  const updated = replaceOrThrow(
    pyproject,
    /^version = "[^"]+"$/m,
    `version = "${version}"`,
    pyprojectPath,
  );
  write(pyprojectPath, updated);
}

function syncEngineUvLock(version) {
  const lockPath = "engine/uv.lock";
  const lock = read(lockPath);
  const updated = replaceOrThrow(
    lock,
    /(\[\[package\]\]\nname = "probe-engine"\nversion = ")[^"]+(")/m,
    `$1${version}$2`,
    lockPath,
  );
  write(lockPath, updated);
}

function syncDevMock(version) {
  const mockPath = "frontend/src/dev-mock.ts";
  const mock = read(mockPath);
  const updated = replaceOrThrow(
    mock,
    /version: "[^"]+",\n(\s+)name: "probe",/m,
    `version: "${version}",\n$1name: "probe",`,
    mockPath,
  );
  write(mockPath, updated);
}

function main() {
  // Release prep: pass the tag version without "v" to update Cargo first,
  // then sync the package/dev mirrors from that source of truth.
  const requestedVersion = process.argv[2];
  if (requestedVersion && !VERSION_PATTERN.test(requestedVersion)) {
    throw new Error(`Invalid version: ${requestedVersion}`);
  }

  if (requestedVersion) {
    setCargoVersion(requestedVersion);
  }

  const version = readCargoVersion();
  syncFrontendPackage(version);
  syncFrontendLock(version);
  syncEnginePyproject(version);
  syncEngineUvLock(version);
  syncDevMock(version);

  process.stdout.write(`${version}\n`);
}

main();
