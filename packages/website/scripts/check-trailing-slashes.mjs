#!/usr/bin/env node

/**
 * Trailing Slash Validator for Astro Sites
 *
 * Scans built HTML files to ensure internal page links use trailing slashes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '../dist');
const HREF_PATTERN = /href=["']([^"']+)["']/g;

const errors = [];

function listHtmlFiles(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'pagefind') continue;
      out.push(...listHtmlFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith('.html')) out.push(full);
  }
  return out;
}

function normalizeHref(href) {
  return href.split(/[?#]/)[0];
}

function isLikelyPagePath(pathname) {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  if (pathname === '/') return false;
  if (pathname.startsWith('/_astro/')) return false;
  if (pathname.startsWith('/assets/')) return false;

  // Skip known static files.
  return !/\.[a-z0-9]+$/i.test(pathname);
}

function shouldHaveTrailingSlash(pathname) {
  return isLikelyPagePath(pathname) && !pathname.endsWith('/');
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(DIST_DIR, filePath);
  const fileErrors = [];

  let match;
  while ((match = HREF_PATTERN.exec(content)) !== null) {
    const href = match[1];
    const pathname = normalizeHref(href);

    if (shouldHaveTrailingSlash(pathname)) {
      fileErrors.push({
        file: relativePath,
        link: href,
        suggestion: `${pathname}/${href.slice(pathname.length)}`
      });
    }
  }

  return fileErrors;
}

async function validateTrailingSlashes() {
  console.log('Checking internal links for trailing slashes...\n');

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Error: dist directory not found at ${DIST_DIR}`);
    console.error('Run "npm run build" first.\n');
    process.exit(1);
  }

  const htmlFiles = listHtmlFiles(DIST_DIR);

  console.log(`Found ${htmlFiles.length} HTML files\n`);

  for (const filePath of htmlFiles) {
    const fileErrors = scanFile(filePath);
    if (fileErrors.length > 0) {
      errors.push(...fileErrors);
    }
  }

  if (errors.length === 0) {
    console.log('All internal page links have trailing slashes.\n');
    process.exit(0);
  }

  console.error('Found links without trailing slashes:\n');
  const byFile = {};
  for (const err of errors) {
    if (!byFile[err.file]) byFile[err.file] = [];
    byFile[err.file].push(err);
  }

  for (const file of Object.keys(byFile).sort()) {
    console.error(`  ${file}:`);
    for (const err of byFile[file]) {
      console.error(`    ${err.link} -> ${err.suggestion}`);
    }
    console.error('');
  }

  console.error(`Total: ${errors.length} link(s) need trailing slashes.\n`);
  process.exit(1);
}

validateTrailingSlashes().catch((error) => {
  console.error('Trailing slash validation failed:', error);
  process.exit(1);
});
