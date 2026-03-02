import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

function collectYamlFiles(rootDir) {
  const files = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectYamlFiles(abs));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(abs);
    }
  }
  return files;
}

function formatPath(instancePath) {
  if (!instancePath) return '(root)';
  return instancePath;
}

const args = process.argv.slice(2);
const evalsDirArg = args.find((arg) => !arg.startsWith('--'));
const evalsDir = resolve(evalsDirArg || 'mcplab/evals');

if (!statSync(evalsDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`[schema] Evals directory not found: ${evalsDir}`);
  process.exit(1);
}

const schemaPath = resolve('config-schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = collectYamlFiles(evalsDir);
if (files.length === 0) {
  console.log(`[schema] No YAML files found in ${evalsDir}`);
  process.exit(0);
}

let failed = 0;
for (const filePath of files) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parseYaml(raw);
    const ok = validate(parsed);
    if (ok) continue;
    failed += 1;
    console.error(`\n[schema] Invalid: ${filePath}`);
    for (const error of validate.errors ?? []) {
      console.error(`  - ${formatPath(error.instancePath)}: ${error.message}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`\n[schema] Failed to parse: ${filePath}`);
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.error(`\n[schema] Validation failed (${failed}/${files.length} files invalid)`);
  process.exit(1);
}

console.log(`[schema] Validation passed (${files.length} files)`);
