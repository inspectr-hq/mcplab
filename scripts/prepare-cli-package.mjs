import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const appDist = join(repoRoot, "packages", "app", "dist");
const cliDist = join(repoRoot, "packages", "cli", "dist");
const cliBundledAppDist = join(cliDist, "app");

function run(cmd) {
  execSync(cmd, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

// Ensure the published CLI can serve the web app outside the monorepo by bundling app assets into CLI dist/app.
run("npm run build -w @inspectr/mcplab-app");
run("npm run build -w @inspectr/mcplab");

if (!existsSync(appDist)) {
  throw new Error(`App build output not found at ${appDist}`);
}
if (!existsSync(cliDist)) {
  throw new Error(`CLI build output not found at ${cliDist}`);
}

rmSync(cliBundledAppDist, { recursive: true, force: true });
mkdirSync(cliBundledAppDist, { recursive: true });
cpSync(appDist, cliBundledAppDist, { recursive: true });

console.log(`Bundled app assets into CLI package: ${cliBundledAppDist}`);
