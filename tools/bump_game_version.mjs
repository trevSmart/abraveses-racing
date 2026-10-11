// Puja l'enter de VERSION després d'un merge a main.
//
//   node tools/bump_game_version.mjs
//
// El workflow de GitHub el crida quan es fusiona una pull request. Si el merge
// ja deixa un número més alt (el fitxer és nou, o algú l'ha pujat a mà), el
// respecta. Si el número no canvia —o baixa, com quan un squash arrossega la
// versió vella de la branca—, l'incrementa des de la que hi havia a main.

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

function asInt(value) {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

const current = fs.readFileSync(versionPath, "utf8").trim();
const currentN = asInt(current);
if (currentN === null) {
  console.error(`VERSION ha de ser un enter, i és «${current}»`);
  process.exit(1);
}
const previous = versionAt("HEAD~1");
const previousN = previous === null ? null : asInt(previous);
if (previous !== null && previousN === null) {
  console.error(`La versió anterior no és un enter: «${previous}»`);
  process.exit(1);
}
// El merge ja deixa una versió nova (l'acabem de crear, o el canvi la puja a mà).
if (previousN === null || currentN > previousN) {
  console.log(`La versió ja queda fixada en aquest merge (${previous ?? "cap"} → ${current}).`);
  process.exit(0);
}
const next = String(previousN + 1);
fs.writeFileSync(versionPath, `${next}\n`);
console.log(`Versió ${current} → ${next}`);
