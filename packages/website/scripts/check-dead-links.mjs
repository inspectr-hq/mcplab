#!/usr/bin/env node

/**
 * Dead Link Checker for Astro Sites
 *
 * Scans built HTML files and verifies that internal page links resolve.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '../dist');
const HREF_PATTERN = /href=["']([^"']+)["']/g;

const checkedLinks = new Set();
const existingPages = new Set();
const deadLinks = [];

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
  if (pathname.startsWith('/_astro/')) return false;
  if (pathname.startsWith('/assets/')) return false;

  // Skip static files.
  return !/\.[a-z0-9]+$/i.test(pathname);
}

function buildExistingPagesSet() {
  const htmlFiles = listHtmlFiles(DIST_DIR).map((fullPath) => path.relative(DIST_DIR, fullPath));

  existingPages.add('/');

  for (const file of htmlFiles) {
    let urlPath;
    if (file === 'index.html') {
      urlPath = '/';
    } else if (file.endsWith('/index.html')) {
      urlPath = `/${file.slice(0, -'/index.html'.length)}/`;
    } else if (file.endsWith('.html')) {
      urlPath = `/${file.slice(0, -'.html'.length)}/`;
    } else {
      continue;
    }

    existingPages.add(urlPath);
    if (urlPath !== '/' && urlPath.endsWith('/')) {
      existingPages.add(urlPath.slice(0, -1));
    }
  }
}

function doesLinkExist(pathname) {
  if (existingPages.has(pathname)) return true;

  const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const withoutSlash = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return existingPages.has(withSlash) || existingPages.has(withoutSlash);
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(DIST_DIR, filePath);
  const fileErrors = [];

  let match;
  while ((match = HREF_PATTERN.exec(content)) !== null) {
    const href = match[1];
    const pathname = normalizeHref(href);

    if (!isLikelyPagePath(pathname)) continue;
    if (checkedLinks.has(pathname)) continue;
    checkedLinks.add(pathname);

    if (!doesLinkExist(pathname)) {
      fileErrors.push({ file: relativePath, link: href });
    }
  }

  return fileErrors;
}

async function checkDeadLinks() {
  console.log('Checking for dead internal links...\n');

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Error: dist directory not found at ${DIST_DIR}`);
    console.error('Run "npm run build" first.\n');
    process.exit(1);
  }

  buildExistingPagesSet();
  console.log(`Indexed ${existingPages.size} internal page paths`);

  const htmlFiles = listHtmlFiles(DIST_DIR);
  console.log(`Scanning ${htmlFiles.length} HTML files\n`);

  for (const filePath of htmlFiles) {
    deadLinks.push(...scanFile(filePath));
  }

  if (deadLinks.length === 0) {
    console.log(`All ${checkedLinks.size} internal links are valid.\n`);
    process.exit(0);
  }

  console.error('Found dead links:\n');
  const byFile = {};
  for (const err of deadLinks) {
    if (!byFile[err.file]) byFile[err.file] = [];
    byFile[err.file].push(err);
  }

  for (const file of Object.keys(byFile).sort()) {
    console.error(`  ${file}:`);
    for (const err of byFile[file]) {
      console.error(`    ${err.link} -> page not found`);
    }
    console.error('');
  }

  console.error(`Total: ${deadLinks.length} dead link(s).\n`);
  process.exit(1);
}

checkDeadLinks().catch((error) => {
  console.error('Dead link checker failed:', error);
  process.exit(1);
});
