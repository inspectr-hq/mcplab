import { mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcUrl = new URL("../packages/cli/dist/cli.js", import.meta.url);
const destUrl = new URL("../dist/cli.js", import.meta.url);
const src = fileURLToPath(srcUrl);
const dest = fileURLToPath(destUrl);

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
