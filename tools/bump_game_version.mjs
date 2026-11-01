// Puja el patch de VERSION (major.minor.patch) després d'un merge a main.
//
//   node tools/bump_game_version.mjs
//
// El workflow de GitHub el crida quan es fusiona una pull request. Si el merge
// ja deixa una versió més alta (el fitxer és nou, o algú l'ha pujada a mà), la
// respecta. Si el número no canvia —o baixa, com quan un squash arrossega la
// versió vella de la branca—, puja el patch de la que hi havia a main.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// GAME_VERSION_ROOT només serveix per provar el script en un repo temporal.
const root = process.env.GAME_VERSION_ROOT
  ? path.resolve(process.env.GAME_VERSION_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionPath = path.join(root, "VERSION");

function versionAt(rev) {
  try {
    return execSync(`git show ${rev}:VERSION`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** @returns {[number, number, number] | null} */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negatiu si a < b, zero si són iguals, positiu si a > b. */
function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

function bumpPatch(version) {
  return `${version[0]}.${version[1]}.${version[2] + 1}`;
}

const current = fs.readFileSync(versionPath, "utf8").trim();
const currentV = parseVersion(current);
if (currentV === null) {
  console.error(`VERSION ha de ser major.minor.patch, i és «${current}»`);
  process.exit(1);
}
const previous = versionAt("HEAD~1");
const previousV = previous === null ? null : parseVersion(previous);
if (previous !== null && previousV === null && previous !== current) {
  console.log(`La versió ja queda fixada en aquest merge (${previous} → ${current}).`);
  process.exit(0);
}
if (previous !== null && previousV === null) {
  console.error(`La versió anterior no és major.minor.patch: «${previous}»`);
  process.exit(1);
}
// El merge ja deixa una versió nova (l'acabem de crear, o el canvi la puja a mà).
if (previousV === null || compareVersion(currentV, previousV) > 0) {
  console.log(`La versió ja queda fixada en aquest merge (${previous ?? "cap"} → ${current}).`);
  process.exit(0);
}
const next = bumpPatch(previousV);
fs.writeFileSync(versionPath, `${next}\n`);
console.log(`Versió ${current} → ${next}`);
