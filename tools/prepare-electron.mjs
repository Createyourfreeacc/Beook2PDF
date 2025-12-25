// tools/prepare-electron.mjs
// Builds a minimal folder (dist/desktop) that electron-builder can package as extraResources.
//
// What it does:
// - Copies Next.js standalone server output into dist/desktop/next
// - Copies .next/static and public into the correct places
// - Copies assets/fonts (used by PDF generation) into dist/desktop/assets
// - Copies Puppeteer browser cache into dist/desktop/puppeteer (so users don't need downloads)
// - IMPORTANT: moves dist/desktop/next/node_modules -> dist/desktop/next_node_modules
//   to avoid electron-builder "node_modules" ignore heuristics.
//
// Prereqs for release builds:
// - next.config.ts must set output: "standalone"
// - Run `electron-builder install-app-deps` BEFORE `next build` to rebuild native modules
//   (better-sqlite3 / sqlite3) against Electron's Node ABI.
// - Install dependencies with PUPPETEER_CACHE_DIR=.puppeteer so the Chromium download ends up
//   inside the project and can be packaged.

import { rm, mkdir, cp, access, rename, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const outDir = path.join(root, "dist", "desktop");
const nextOut = path.join(outDir, "next");
const nextNodeModulesOut = path.join(outDir, "next_node_modules");

function mustExist(p, hint) {
  return access(p).catch(() => {
    const msg = hint ? `\nHint: ${hint}` : "";
    throw new Error(`Missing required path: ${p}${msg}`);
  });
}

async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Copy helper: dereference to avoid Windows symlink privileges
async function safeCp(src, dst) {
  return cp(src, dst, { recursive: true, force: true, dereference: true });
}

async function main() {
  const standaloneDir = path.join(root, ".next", "standalone");
  const staticDir = path.join(root, ".next", "static");
  const publicDir = path.join(root, "public");
  const assetsDir = path.join(root, "assets");

  const puppeteerCache =
    process.env.PUPPETEER_CACHE_DIR
      ? path.resolve(process.env.PUPPETEER_CACHE_DIR)
      : path.join(root, ".puppeteer");

  await mustExist(standaloneDir, 'Run: "npm run build" (next build) first.');
  await mustExist(staticDir, 'Run: "npm run build" (next build) first.');
  await mustExist(publicDir, "Your repo should already contain /public.");
  await mustExist(assetsDir, "Your repo should already contain /assets.");

  // Puppeteer is required for PDF generation. We fail early if the browser cache isn't present.
  await mustExist(
    puppeteerCache,
    'Reinstall deps with: PUPPETEER_CACHE_DIR=.puppeteer npm ci (or npm install), then rebuild.'
  );

  // Ensure Next standalone includes runtime deps
  const standaloneNodeModules = path.join(standaloneDir, "node_modules");
  await mustExist(
    standaloneNodeModules,
    "Next standalone output is missing node_modules. Ensure next.config sets output:'standalone' and run `npm run build`."
  );

  // Clean output
  await rm(outDir, { recursive: true, force: true });
  await mkdir(nextOut, { recursive: true });

  // 1) Next standalone output (server.js + minimal node_modules)
  await safeCp(standaloneDir, nextOut);

  // 2) Next static assets must be placed at: next/.next/static
  await mkdir(path.join(nextOut, ".next"), { recursive: true });
  await safeCp(staticDir, path.join(nextOut, ".next", "static"));

  // 3) Public folder must be placed at: next/public
  await safeCp(publicDir, path.join(nextOut, "public"));

  // 4) Fonts/assets used by server-side PDF generation
  await safeCp(assetsDir, path.join(outDir, "assets"));

  // 5) Puppeteer browser cache (Chromium)
  await safeCp(puppeteerCache, path.join(outDir, "puppeteer"));

  // 6) IMPORTANT: move next/node_modules out to dist/desktop/next_node_modules
  //    This avoids electron-builder dropping node_modules during extraResources copy.
  const nmInNext = path.join(nextOut, "node_modules");
  if (await isDirectory(nmInNext)) {
    await rm(nextNodeModulesOut, { recursive: true, force: true });
    await mkdir(path.dirname(nextNodeModulesOut), { recursive: true });
    await rename(nmInNext, nextNodeModulesOut);
  } else {
    // Should never happen because we checked standalone node_modules exists
    throw new Error(`Expected node_modules at ${nmInNext} but it was not found.`);
  }

  console.log("Prepared Electron resources in:", outDir);
  console.log("Next runtime moved to:", nextNodeModulesOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
