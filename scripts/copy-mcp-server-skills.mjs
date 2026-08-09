import { mkdirSync, cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcUrl = new URL("../skills", import.meta.url);
const destUrl = new URL("../packages/mcp-server/dist/skills", import.meta.url);
const src = fileURLToPath(srcUrl);
const dest = fileURLToPath(destUrl);

if (!existsSync(src)) {
  throw new Error(`Skills source directory not found: ${src}`);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
