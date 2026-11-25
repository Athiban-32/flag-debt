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
    archived: Boolean(extra.archived), tags: extra.tags ?? [], states };
}
const project = {
  name: 'Tern',
  environments: ENVS.map((name, id) => ({ id, name })),
  flags: [
    flag('install_section', ENVS, 5, { type: 'MULTIVARIATE', value: 'one_liner' }),
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
    'missing:checkout_v3',
    'missing:onboarding_tuor',
    'prod_only:beta_dashboard',
    'stale_off:legacy_search',
    'stale_on:new_pricing_page',
    'unused:holiday_banner',
    'unused:onboarding_tour',
  ]);
  assert.equal(summary.errors, 3);
  assert.equal(summary.warnings, 3);
  assert.ok(summary.removableRefs >= 3);
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
  assert.match(toText(result), /3 errors, 3 warnings/);
});
