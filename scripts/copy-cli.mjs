import { mkdirSync, cpSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcUrl = new URL("../packages/cli/dist", import.meta.url);
const destUrl = new URL("../dist", import.meta.url);
const src = fileURLToPath(srcUrl);
const dest = fileURLToPath(destUrl);

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
