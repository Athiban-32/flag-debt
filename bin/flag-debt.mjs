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

  const admin = new FlagsmithAdmin({
    apiUrl: args['api-url'] ?? env.FLAGSMITH_API_URL ?? config.apiUrl,
    apiKey: env.FLAGSMITH_ADMIN_API_KEY,
    token: env.FLAGSMITH_TOKEN,
  });

  const [project, code] = await Promise.all([
    admin.snapshot(args.project ?? env.FLAGSMITH_PROJECT ?? config.project),
    scanCode(src, {
      ignore: [...DEFAULT_IGNORE, ...(config.ignore ?? [])],
      extensions: config.extensions,
      sdkMethods: [...DEFAULT_SDK_METHODS, ...(config.sdkMethods ?? [])],
      extraPatterns: config.extraPatterns,
    }),
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
  const formats = {
    json: () => toJson(result),
    markdown: () => markdown,
    html: () => toHtml(result, { link, describe }),
    text: () => toText(result),
  };
  if (!formats[args.format]) throw new Error(`Unknown --format ${args.format}`);
  const rendered = formats[args.format]();

  // An HTML page is meant for a file; print the readable text report to the terminal instead.
  console.log(args.format === 'html' && args.output ? toText(result) : rendered);
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
