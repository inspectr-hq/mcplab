#!/usr/bin/env node

/**
 * Sitemap Comparison Script
 *
 * Compares the current built sitemap to a cached version.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.SITE_URL || 'https://mcplab.inspectr.dev';
const DIST_DIR = path.join(__dirname, '../dist');
const SITEMAP_CANDIDATES = ['sitemap-index.xml', 'sitemap.xml', 'sitemap-0.xml'];
const CACHE_DIR = path.join(__dirname, '../.sitemap-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'previous-sitemap.json');

function findSitemapPath() {
  for (const file of SITEMAP_CANDIDATES) {
    const fullPath = path.join(DIST_DIR, file);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return null;
}

function extractUrls(xmlContent) {
  const urls = new Set();
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xmlContent)) !== null) {
    urls.add(match[1]);
  }
  return urls;
}

async function compareSitemaps() {
  console.log('Comparing sitemaps...\n');

  const sitemapPath = findSitemapPath();
  if (!sitemapPath) {
    console.error(`Error: no sitemap found in ${DIST_DIR}`);
    console.error(`Expected one of: ${SITEMAP_CANDIDATES.join(', ')}`);
    console.error('Run "npm run build" first.\n');
    process.exit(1);
  }

  const currentXml = fs.readFileSync(sitemapPath, 'utf-8');
  const currentUrls = Array.from(extractUrls(currentXml)).sort();

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  if (!fs.existsSync(CACHE_FILE)) {
    console.log('No previous sitemap cache found. Saving current URLs as baseline.');
    fs.writeFileSync(CACHE_FILE, JSON.stringify(currentUrls, null, 2));
    console.log(`Cached ${currentUrls.length} URLs.`);
    return;
  }

  const previousUrls = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  const previousSet = new Set(previousUrls);
  const currentSet = new Set(currentUrls);

  const added = currentUrls.filter((url) => !previousSet.has(url));
  const removed = previousUrls.filter((url) => !currentSet.has(url));

  console.log(`Sitemap report:`);
  console.log(`  File: ${path.basename(sitemapPath)}`);
  console.log(`  Total URLs: ${currentUrls.length} (previous: ${previousUrls.length})`);
  console.log(`  Added: ${added.length}`);
  console.log(`  Removed: ${removed.length}\n`);

  if (added.length > 0) {
    console.log('New pages:');
    for (const url of added) {
      const localPath = url.replace(BASE_URL, '');
      console.log(`  + ${localPath || '/'}`);
    }
    console.log('');
  }

  if (removed.length > 0) {
    console.log('Removed pages:');
    for (const url of removed) {
      const localPath = url.replace(BASE_URL, '');
      console.log(`  - ${localPath || '/'}`);
    }
    console.log('');
  }

  if (added.length === 0 && removed.length === 0) {
    console.log('No sitemap URL changes detected.\n');
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(currentUrls, null, 2));
  console.log('Sitemap cache updated.');
}

compareSitemaps().catch((error) => {
  console.error('Sitemap comparison failed:', error);
  process.exit(1);
});
