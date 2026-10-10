import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(repoRoot, "data", "cases");

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
  plugins: [facadePhotos()],
  server: { port: 5173, open: true },
});
