#!/usr/bin/env node

/**
 * Sitemap Status Checker
 *
 * Verifies robots.txt and sitemap endpoints for the deployed site.
 */

import { execSync } from 'child_process';

const BASE_URL = process.env.SITE_URL || 'https://mcplab.inspectr.dev';
const ROBOTS_URL = `${BASE_URL}/robots.txt`;
const SITEMAP_CANDIDATES = [
  `${BASE_URL}/sitemap-index.xml`,
  `${BASE_URL}/sitemap.xml`,
  `${BASE_URL}/sitemap-0.xml`
];

const userAgents = [
  { name: 'Default (curl)', agent: null },
  { name: 'Googlebot', agent: 'Googlebot' },
  { name: 'Mozilla/5.0', agent: 'Mozilla/5.0' }
];

let hasErrors = false;

function fetchUrl(url, agent = null) {
  const args = ['-i', '-sS', '-L', url];
  if (agent) args.unshift('-A', agent);
  const output = execSync(`curl ${args.map((arg) => `"${arg}"`).join(' ')}`, {
    encoding: 'utf8'
  });

  const sections = output.split(/\r?\n\r?\n/);
  const headerSection = sections[0] ?? '';
  const body = sections.slice(1).join('\n\n');
  const headers = headerSection.split(/\r?\n/).filter(Boolean);
  return { headers, body };
}

function statusCode(headers) {
  const line = headers[0] ?? '';
  const match = line.match(/\s(\d{3})\s/);
  return match ? Number(match[1]) : null;
}

function isXmlContent(headers) {
  const contentType = headers.find((h) => h.toLowerCase().startsWith('content-type:'));
  return Boolean(contentType && contentType.toLowerCase().includes('xml'));
}

function looksLikeXml(body) {
  const trimmed = body.trim();
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<urlset') || trimmed.startsWith('<sitemapindex');
}

function checkRobots(sitemapUrl) {
  console.log('Checking robots.txt...');
  try {
    const { headers, body } = fetchUrl(ROBOTS_URL);
    const code = statusCode(headers);

    if (code !== 200) {
      console.error(`  Error: robots.txt returned HTTP ${code ?? 'unknown'}`);
      hasErrors = true;
      return;
    }

    const sitemapLine = body
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().startsWith('sitemap:'));

    if (!sitemapLine) {
      console.error("  Error: robots.txt is missing a 'Sitemap:' entry");
      hasErrors = true;
      return;
    }

    console.log(`  robots.txt sitemap entry: ${sitemapLine.trim()}`);
    if (!sitemapLine.includes(sitemapUrl)) {
      console.warn(`  Warning: robots.txt sitemap entry does not exactly match ${sitemapUrl}`);
    }
  } catch (error) {
    console.error(`  Error checking robots.txt: ${error.message}`);
    hasErrors = true;
  }
  console.log('');
}

function findWorkingSitemap() {
  for (const candidate of SITEMAP_CANDIDATES) {
    try {
      const response = fetchUrl(candidate);
      const code = statusCode(response.headers);
      if (code === 200 && isXmlContent(response.headers) && looksLikeXml(response.body)) {
        return { url: candidate, ...response };
      }
    } catch {
      // continue
    }
  }
  return null;
}

console.log(`Checking SEO and sitemap health for ${BASE_URL}\n`);

const sitemap = findWorkingSitemap();
if (!sitemap) {
  console.error('Error: no working sitemap endpoint found.');
  console.error(`Checked: ${SITEMAP_CANDIDATES.join(', ')}`);
  process.exit(1);
}

console.log(`Using sitemap endpoint: ${sitemap.url}\n`);
checkRobots(sitemap.url);

for (const { name, agent } of userAgents) {
  console.log(`Testing sitemap with User-Agent: ${name}`);
  try {
    const { headers, body } = fetchUrl(sitemap.url, agent);
    const code = statusCode(headers);

    if (code !== 200) {
      console.error(`  Error: expected HTTP 200, got ${code ?? 'unknown'}`);
      hasErrors = true;
    } else {
      console.log('  Status: 200 OK');
    }

    if (!isXmlContent(headers)) {
      console.error("  Error: expected an XML content-type");
      hasErrors = true;
    } else {
      const contentType = headers.find((h) => h.toLowerCase().startsWith('content-type:'));
      console.log(`  ${contentType}`);
    }

    if (!looksLikeXml(body)) {
      console.error('  Error: response body does not look like XML');
      hasErrors = true;
    } else {
      console.log('  XML structure detected');
    }
  } catch (error) {
    console.error(`  Error executing curl: ${error.message}`);
    hasErrors = true;
  }
  console.log('');
}

if (hasErrors) {
  console.error('Sitemap status check failed.');
  process.exit(1);
}

console.log('All sitemap checks passed.');
