import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../skills', import.meta.url));
const dest = fileURLToPath(new URL('../packages/mcp-server/dist/skills', import.meta.url));
if (!existsSync(src)) throw new Error(`Skills source directory not found: ${src}`);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
