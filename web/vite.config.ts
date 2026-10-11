import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(repoRoot, "data", "cases");

/** A Vercel el clone no baixa Git LFS, així que `world.glb` queda com a punter.
 *  El model es llegeix de GitHub amb el SHA d'aquest commit. */
function remoteWorldGlbUrl(): string {
  if (!process.env.VERCEL) {
    return "";
  }
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!owner || !repo || !sha) {
    return "";
  }
  return `https://media.githubusercontent.com/media/${owner}/${repo}/${sha}/web/public/world.glb`;
}

/** Treu el punter de Git LFS de la sortida: si es servís, el joc el prendria per un GLB. */
function dropLfsWorldPointer(): Plugin {
  let outFile = "";
  return {
    name: "drop-lfs-world-pointer",
    apply: "build",
    configResolved(config) {
      outFile = path.resolve(config.root, config.build.outDir, "world.glb");
    },
    closeBundle() {
      if (!outFile || !fs.existsSync(outFile)) {
        return;
      }
      const buf = Buffer.alloc(64);
      const fd = fs.openSync(outFile, "r");
      const n = fs.readSync(fd, buf, 0, 64, 0);
      fs.closeSync(fd);
      const head = buf.subarray(0, n).toString("utf8");
      if (head.startsWith("version https://git-lfs.github.com/spec/v1")) {
        fs.unlinkSync(outFile);
      }
    },
  };
}

/** Enter de `VERSION`, a l'arrel del repo. El puja el workflow en fer merge a main. */
function readGameVersion(): string {
  const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
  if (!/^\d+$/.test(version)) {
    throw new Error(`VERSION ha de ser un enter, i és «${version}»`);
  }
  return version;
}

/** Escriu la versió a la pantalla de càrrega (`%%GAME_VERSION%%` a `index.html`). */
function injectGameVersion(): Plugin {
  return {
    name: "game-version",
    transformIndexHtml(html) {
      return html.replaceAll("%%GAME_VERSION%%", readGameVersion());
    },
  };
}

/** Serveix `data/cases/<ref>/cadastre_facana.jpg` a `/facades/<ref>.jpg` (el tooltip del mode dev). */
function facadePhotos(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    const match = /^\/facades\/([A-Za-z0-9]+)\.jpg$/.exec(url);
    if (!match) {
      next();
      return;
    }
    const file = path.join(casesDir, match[1], "cadastre_facana.jpg");
    if (!fs.existsSync(file)) {
      next();
      return;
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(file).pipe(res);
  };
  return {
    name: "facades-cadastre",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    writeBundle(options) {
      if (!fs.existsSync(casesDir)) {
        return;
      }
      const outDir = path.resolve(options.dir ?? "dist", "facades");
      fs.mkdirSync(outDir, { recursive: true });
      for (const ref of fs.readdirSync(casesDir)) {
        const src = path.join(casesDir, ref, "cadastre_facana.jpg");
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(outDir, `${ref}.jpg`));
        }
      }
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  define: {
    __WORLD_GLB_URL__: JSON.stringify(remoteWorldGlbUrl()),
  },
  plugins: [injectGameVersion(), facadePhotos(), dropLfsWorldPointer()],
  server: { port: 5173, open: true },
});
