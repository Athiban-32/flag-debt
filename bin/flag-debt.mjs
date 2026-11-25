#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { scanCode, DEFAULT_SDK_METHODS, DEFAULT_IGNORE } from '../src/scan-code.mjs';
import { FlagsmithAdmin } from '../src/flagsmith.mjs';
import { analyse } from '../src/analyse.mjs';
import { toText, toMarkdown, toJson, describe } from '../src/report.mjs';
import { toHtml } from '../src/html.mjs';
import { prContext, upsertComment } from '../src/github.mjs';
import { inventory, inventoryText, inventoryMarkdown } from '../src/inventory.mjs';

const HELP = `flag-debt: find stale, unused and missing feature flags by comparing your code with Flagsmith

Usage: flag-debt [options]

  --src <dir>                 code to scan (default: .)
  --api-url <url>             Flagsmith API (default: $FLAGSMITH_API_URL or http://localhost:8000/api/v1/)
  --project <id|name>         Flagsmith project (default: $FLAGSMITH_PROJECT, or the only project)
  --stale-days <n>            days unchanged before a flag counts as stale (default: 30)
  --production-pattern <re>   regex for production environment names (default: prod)
  --format <text|markdown|json|html>  output format (default: text; html = flag health dashboard)
  --output <file>             also write the report to a file
  --fail-on <error|warn|none> exit 1 if findings at this level exist (default: none)
  --comment                   post/update a sticky PR comment (needs GITHUB_TOKEN, runs in Actions)
  --config <file>             config file (default: <src>/.flagdebt.json if present)
  --ui-url <url>              Flagsmith dashboard URL for "Open in Flagsmith" links
                              (default: derived from the API URL)
  --no-color                  plain terminal output (also: NO_COLOR=1; FORCE_COLOR=1 forces colour)
  --code-only                 no Flagsmith needed: list flag keys in the code and likely typos

Auth (read-only): FLAGSMITH_ADMIN_API_KEY (organisation API key) or FLAGSMITH_TOKEN.`;

const { values: args } = parseArgs({
  options: {
    src: { type: 'string', default: '.' },
    'api-url': { type: 'string' },
    project: { type: 'string' },
    'stale-days': { type: 'string' },
    'production-pattern': { type: 'string' },
    format: { type: 'string', default: 'text' },
    output: { type: 'string' },
    'fail-on': { type: 'string', default: 'none' },
    comment: { type: 'boolean', default: false },
    config: { type: 'string' },
    'ui-url': { type: 'string' },
    'no-color': { type: 'boolean', default: false },
    'code-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (!['text', 'markdown', 'json', 'html'].includes(args.format)) {
  console.error(`flag-debt: unknown --format "${args.format}" (text, markdown, json or html)`);
  process.exit(2);
}

// Colour only for a real terminal, unless the user forces it either way.
function useColor() {
  const env = process.env;
  if (args['no-color'] || 'NO_COLOR' in env) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY) && env.TERM !== 'dumb';
}

// The dashboard UI that matches an API URL: Flagsmith Cloud's API and app are on different
// hosts; a self-hosted instance serves both from one origin.
function uiBaseFor(apiUrl) {
  const u = new URL(apiUrl);
  if (u.hostname === 'api.flagsmith.com' || u.hostname === 'edge.api.flagsmith.com') {
    return 'https://app.flagsmith.com';
  }
  return `${u.origin}${u.pathname.replace(/\/api\/v1\/?$/, '')}`.replace(/\/$/, '');
}

async function loadConfig(src) {
  const file = args.config ?? path.join(src, '.flagdebt.json');
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (args.config || err.code !== 'ENOENT') throw new Error(`Bad config ${file}: ${err.message}`);
    return {};
  }
}

async function main() {
  const src = path.resolve(args.src);
  const config = await loadConfig(src);
  const env = process.env;

  const scanOptions = {
    ignore: [...DEFAULT_IGNORE, ...(config.ignore ?? [])],
    extensions: config.extensions,
    sdkMethods: [...DEFAULT_SDK_METHODS, ...(config.sdkMethods ?? [])],
    extraPatterns: config.extraPatterns,
  };

  // No Flagsmith access: inventory the flag keys in code and look for typo look-alikes.
  if (args['code-only']) {
    const started = Date.now();
    const inv = inventory(await scanCode(src, scanOptions));
    inv.seconds = +((Date.now() - started) / 1000).toFixed(2);
    const rendered =
      args.format === 'json' ? JSON.stringify(inv, null, 2)
        : args.format === 'markdown' ? inventoryMarkdown(inv)
          : inventoryText(inv);
    console.log(rendered);
    if (args.output) await writeFile(args.output, rendered + '\n');
    if (args['fail-on'] !== 'none' && inv.typos.length) process.exitCode = 1;
    return;
  }

  const apiUrl = args['api-url'] ?? env.FLAGSMITH_API_URL ?? config.apiUrl ?? 'http://localhost:8000/api/v1/';
  const admin = new FlagsmithAdmin({
    apiUrl,
    apiKey: env.FLAGSMITH_ADMIN_API_KEY,
    token: env.FLAGSMITH_TOKEN,
  });

  const [project, code] = await Promise.all([
    admin.snapshot(args.project ?? env.FLAGSMITH_PROJECT ?? config.project),
    scanCode(src, scanOptions),
  ]);

  const result = analyse(project, code, {
    staleDays: Number(args['stale-days'] ?? config.staleDays ?? 30),
    productionPattern: args['production-pattern'] ?? config.productionPattern,
    permanentTags: config.permanentTags,
  });
  const ignored = new Set(config.ignoreFlags ?? []);
  if (ignored.size) result.findings = result.findings.filter((f) => !ignored.has(f.flag));

  const pr = await prContext();
  const link = pr && {
    serverUrl: env.GITHUB_SERVER_URL || 'https://github.com',
    repo: pr.repo,
    sha: pr.sha,
    prefix: path.relative(env.GITHUB_WORKSPACE || src, src).split(path.sep).join('/').replace(/(.)$/, '$1/'),
  };
  const markdown = toMarkdown(result, link);
  const prodEnv =
    project.environments.find((e) => new RegExp(args['production-pattern'] ?? config.productionPattern ?? 'prod', 'i').test(e.name)) ??
    project.environments[0];
  const flagsmithLinks = prodEnv && {
    base: (args['ui-url'] ?? env.FLAGSMITH_UI_URL ?? config.uiUrl ?? uiBaseFor(apiUrl)).replace(/\/$/, ''),
    projectId: project.id,
    environmentKey: prodEnv.apiKey,
    environmentName: prodEnv.name,
  };
  const formats = {
    json: () => toJson(result),
    markdown: () => markdown,
    html: () => toHtml(result, { link, describe, flagsmith: flagsmithLinks }),
    text: () => toText(result, { color: useColor() }),
  };
  if (!formats[args.format]) throw new Error(`Unknown --format ${args.format}`);
  const rendered = formats[args.format]();

  // An HTML page is meant for a file; print the readable text report to the terminal instead.
  console.log(args.format === 'html' && args.output ? toText(result, { color: useColor() }) : rendered);
  if (args.output) await writeFile(args.output, rendered + '\n');
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown + '\n');

  if (args.comment) {
    if (!pr) console.warn('--comment: not a pull_request event, skipping the PR comment');
    else if (!env.GITHUB_TOKEN) console.warn('--comment: GITHUB_TOKEN not set, skipping');
    else {
      const res = await upsertComment({ token: env.GITHUB_TOKEN, repo: pr.repo, number: pr.number, body: markdown });
      console.log(`${res.updated ? 'Updated' : 'Posted'} PR comment: ${res.url}`);
    }
  }

  const { errors, warnings } = result.summary;
  if ((args['fail-on'] === 'error' && errors) || (args['fail-on'] === 'warn' && errors + warnings)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`flag-debt: ${err.message}`);
  process.exitCode = 2;
});
