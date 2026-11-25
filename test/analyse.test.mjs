import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCode } from '../src/scan-code.mjs';
import { analyse } from '../src/analyse.mjs';
import { toMarkdown, toText, COMMENT_MARKER } from '../src/report.mjs';

const exampleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'example');
const NOW = Date.parse('2026-11-25T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const ENVS = ['Development', 'Staging', 'Production'];

// Mirrors selfhost/seed.mjs so the expected findings match example/README.md.
function flag(name, on, ageDays, extra = {}) {
  const states = Object.fromEntries(ENVS.map((e) => [e, {
    enabled: on.includes(e), value: extra.value ?? null, updatedAt: ago(ageDays),
    segmentOverrides: 0, identityOverrides: extra.identityEnv === e ? 1 : 0,
  }]));
  return { id: name, name, type: extra.type ?? 'STANDARD', createdAt: ago(ageDays),
    archived: Boolean(extra.archived), tags: extra.tags ?? [], states,
    options: extra.options ?? [], experiments: extra.experiments ?? [] };
}
const project = {
  name: 'Tern',
  environments: ENVS.map((name, id) => ({ id, name })),
  flags: [
    flag('install_section', ENVS, 40, {
      type: 'MULTIVARIATE', value: 'one_liner',
      options: [{ id: 1, value: 'steps' }, { id: 2, value: 'os_picker' }],
      experiments: [{ environment: 'Production', name: 'install', status: 'completed',
        decision: 'variant', winnerOptionId: 2, endedAt: ago(21) }],
    }),
    flag('signup_cta', ENVS, 4, {
      type: 'MULTIVARIATE', value: 'Start free',
      options: [{ id: 3, value: 'Try Tern free' }, { id: 4, value: 'Get started' }],
      experiments: [{ environment: 'Production', name: 'cta', status: 'running' }],
    }),
    flag('rate_limit_v2', ['Staging'], 40, { identityEnv: 'Production' }),
    flag('dark_mode', ENVS, 200, { tags: ['permanent'] }),
    flag('new_pricing_page', ENVS, 45),
    flag('legacy_search', [], 60),
    flag('beta_dashboard', ['Production'], 10),
    flag('old_checkout', [], 120, { archived: true }),
    flag('holiday_banner', ENVS, 3, { value: 'Happy holidays from Tern' }),
    flag('onboarding_tour', ['Development', 'Staging'], 20),
  ],
};

test('finds exactly the planted flag debt in example/', async () => {
  const code = await scanCode(exampleDir);
  const { findings, summary } = analyse(project, code, { now: NOW });
  const got = findings.map((f) => `${f.rule}:${f.flag}`).sort();
  assert.deepEqual(got, [
    'archived_in_use:old_checkout',
    'experiment_done:install_section',
    'experiment_unwired:signup_cta',
    'missing:checkout_v3',
    'missing:onboarding_tuor',
    'prod_only:beta_dashboard',
    'stale_off:legacy_search',
    'stale_on:new_pricing_page',
    'unused:holiday_banner',
    'unused:onboarding_tour',
  ]);
  assert.equal(summary.errors, 4);
  assert.equal(summary.warnings, 4);
  const done = findings.find((f) => f.rule === 'experiment_done');
  assert.equal(done.winner, 'os_picker');
  assert.deepEqual(done.losers.sort(), ['one_liner', 'steps']);
  assert.ok(done.refs.some((r) => r.file === 'web/src/install.js'));
});

test('a finished experiment inside the grace period is not reported yet', async () => {
  const code = await scanCode(exampleDir);
  const { findings } = analyse(project, code, { now: NOW, experimentGraceDays: 30 });
  assert.ok(!findings.some((f) => f.rule === 'experiment_done'));
});

test('losing variant values only count in files tied to the flag', async () => {
  const code = {
    files: 2,
    literals: new Map([
      ['steps', [{ file: 'docs/page.js', line: 3 }]],
      ['install_section', [{ file: 'flags.js', line: 1 }]],
    ]),
    sdkKeys: new Map(),
  };
  const { findings } = analyse(project, code, { now: NOW });
  assert.ok(!findings.some((f) => f.rule === 'experiment_done'));
});

test('constants count as references (FLAGS.pricing = "new_pricing_page")', async () => {
  const code = await scanCode(exampleDir);
  const refs = code.literals.get('new_pricing_page');
  assert.ok(refs.some((r) => r.file === 'web/src/flags.js'));
});

test('stale threshold is respected', async () => {
  const code = await scanCode(exampleDir);
  const { findings } = analyse(project, code, { now: NOW, staleDays: 90 });
  assert.ok(!findings.some((f) => f.rule.startsWith('stale')));
});

test('markdown report carries the sticky-comment marker and links', async () => {
  const code = await scanCode(exampleDir);
  const result = analyse(project, code, { now: NOW });
  const md = toMarkdown(result, { serverUrl: 'https://github.com', repo: 'o/r', sha: 'abc', prefix: 'example/' });
  assert.ok(md.startsWith(COMMENT_MARKER));
  assert.match(md, /https:\/\/github\.com\/o\/r\/blob\/abc\/example\/web\/src\/checkout\.js#L4/);
  assert.match(toText(result), /4 errors · 4 warnings · 2 info/);
  assert.match(md, /<details><summary><b>🟡 Fully rolled out<\/b> \(1\)<\/summary>/);
  assert.match(md, /### 🔴 Missing in Flagsmith/);
});

test('terminal colour is opt-in and plain output has no escape codes', async () => {
  const code = await scanCode(exampleDir);
  const result = analyse(project, code, { now: NOW });
  assert.ok(!toText(result).includes('\u001b['));
  assert.ok(toText(result, { color: true }).includes('\u001b[31m'));
});

test('dashboard links each flag to its page in Flagsmith', async () => {
  const { toHtml } = await import('../src/html.mjs');
  const code = await scanCode(exampleDir);
  const result = analyse(project, code, { now: NOW });
  const html = toHtml(result, {
    flagsmith: { base: 'http://localhost:8000', projectId: 3, environmentKey: 'ENVKEY', environmentName: 'Production' },
  });
  assert.match(html, /http:\/\/localhost:8000\/project\/3\/environment\/ENVKEY\/features\?feature=new_pricing_page/);
  assert.ok(!html.includes('feature=checkout_v3'), 'no link for flags missing from Flagsmith');
});
