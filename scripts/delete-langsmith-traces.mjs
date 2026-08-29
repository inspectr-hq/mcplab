#!/usr/bin/env node
import { readFileSync } from 'fs';
import { parseArgs } from 'util';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Delete LangSmith traces via the REST API.
 *
 * Docs: https://docs.langchain.com/langsmith/smith-api/run/delete-runs
 *
 * Notes:
 * - This is a SOFT delete. LangChain processes deletions during off-peak
 *   hours (they mention weekend batch jobs), so traces won't disappear
 *   instantly. There's no deletion confirmation - re-query later to verify.
 * - Deleting a trace also deletes its child runs, feedback, and stats.
 * - Max 1000 trace_ids per request (the script batches automatically).
 * - session-id = the *project ID* the traces belong to (find it on the
 *   tracing project page in the LangSmith UI, not the project name).
 *
 * Usage:
 *   export LANGSMITH_API_KEY="ls__..."
 *   node scripts/delete-langsmith-traces.mjs --session-id <project_id> --trace-ids <id1>,<id2>,...
 *   node scripts/delete-langsmith-traces.mjs --session-id <project_id> --file trace_ids.txt
 *
 *   # EU region:
 *   node scripts/delete-langsmith-traces.mjs --endpoint https://eu.api.smith.langchain.com --session-id <project_id> --file trace_ids.txt
 */

const BATCH_SIZE = 100; // API max per request
const DEFAULT_ENDPOINT = 'https://api.smith.langchain.com';

function loadTraceIdsFromFile(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteTraces({
  apiKey,
  sessionId,
  traceIds,
  endpoint = DEFAULT_ENDPOINT,
  dryRun = false,
  pauseSeconds = 1,
}) {
  const url = `${endpoint}/api/v1/runs/delete`;
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  const batches = chunk(traceIds, BATCH_SIZE);
  console.log(`Preparing to delete ${traceIds.length} trace(s) from session ${sessionId}`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;

    if (dryRun) {
      console.log(`[DRY RUN] Batch ${batchNum}: would delete ${batch.length} trace(s)`);
      continue;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ trace_ids: batch, session_id: sessionId }),
    });

    if (resp.status === 200 || resp.status === 202) {
      console.log(`Batch ${batchNum}: accepted for deletion (${batch.length} traces). Status ${resp.status}.`);
    } else {
      const text = await resp.text();
      console.error(`Batch ${batchNum}: FAILED. Status ${resp.status}. Response: ${text}`);
    }

    if (batchNum < batches.length) {
      await sleep(pauseSeconds * 1000);
    }
  }

  if (!dryRun) {
    console.log(
      '\nDone submitting delete requests. This is a soft delete — ' +
        'actual removal happens during off-peak processing, so traces ' +
        'may still appear in the UI for a while. Re-query later to confirm.'
    );
  }
}

function usage() {
  console.error(
    'Usage: node delete-langsmith-traces.mjs --session-id <project_id> (--trace-ids <id1>,<id2>,... | --file <path>) ' +
      '[--endpoint <url>] [--api-key <key>] [--dry-run]'
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      'session-id': { type: 'string' },
      // repeated flags and/or comma-separated values, e.g. --trace-ids a,b --trace-ids c
      'trace-ids': { type: 'string', multiple: true },
      file: { type: 'string' },
      endpoint: { type: 'string', default: process.env.LANGSMITH_ENDPOINT || DEFAULT_ENDPOINT },
      'api-key': { type: 'string', default: process.env.LANGSMITH_API_KEY },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  if (!values['session-id']) {
    usage();
    console.error('Error: --session-id is required.');
    process.exit(1);
  }

  if (!values['trace-ids'] && !values.file) {
    usage();
    console.error('Error: pass either --trace-ids or --file.');
    process.exit(1);
  }

  if (values['trace-ids'] && values.file) {
    usage();
    console.error('Error: --trace-ids and --file are mutually exclusive.');
    process.exit(1);
  }

  if (!values['api-key']) {
    console.error('No API key provided. Set LANGSMITH_API_KEY or pass --api-key.');
    process.exit(1);
  }

  const traceIds = values['trace-ids']
    ? values['trace-ids'].flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
    : loadTraceIdsFromFile(values.file);
  if (traceIds.length === 0) {
    console.error('No trace IDs found to delete.');
    process.exit(1);
  }

  await deleteTraces({
    apiKey: values['api-key'],
    sessionId: values['session-id'],
    traceIds,
    endpoint: values.endpoint,
    dryRun: values['dry-run'],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
