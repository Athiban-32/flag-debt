import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCode } from '../src/scan-code.mjs';
import { inventory } from '../src/inventory.mjs';
import { looksLikeTypo, closest } from '../src/similar.mjs';
import { analyse } from '../src/analyse.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'enums');

test('resolves Feature.X arguments to flag keys in TypeScript and Python', async () => {
  const code = await scanCode(dir);
  assert.equal(code.sdkKeys.get('new_search').length, 2);
  assert.deepEqual(code.sdkKeys.get('new_search').map((r) => r.via), ['Feature.NEW_SEARCH', 'Feature.NEW_SEARCH']);
  assert.equal(code.sdkKeys.get('billing_v2').length, 1);
  assert.equal(code.resolvedCalls, 3);
});

test('reports flag constants that nothing reads, per language', async () => {
  const code = await scanCode(dir);
  assert.deepEqual(code.unreadConstants.map((u) => u.constant).sort(), ['Feature.EXPORT_CSV', 'Feature.OLD_REPORTS']);
});

test('code-only inventory flags the typo next to the real key', async () => {
  const inv = inventory(await scanCode(dir));
  assert.deepEqual(inv.typos.map((t) => [t.suspect, t.likely]), [['billing_vv2', 'billing_v2']]);
});

test('typo heuristic ignores deliberate versions and short keys', () => {
  assert.ok(looksLikeTypo('onboarding_tuor', 'onboarding_tour'));
  assert.ok(looksLikeTypo('newPricingPage', 'new_pricing_page'));
  assert.ok(!looksLikeTypo('checkout_v2', 'checkout_v3'));
  assert.ok(!looksLikeTypo('beta', 'meta'));
  assert.equal(closest('onboarding_tuor', ['onboarding_tour', 'dark_mode']), 'onboarding_tour');
});

test('missing keys suggest the closest real flag', async () => {
  const code = await scanCode(dir);
  const project = {
    name: 'p', environments: [{ id: 1, name: 'Production' }],
    flags: ['new_search', 'billing_v2'].map((name) => ({
      id: name, name, type: 'STANDARD', createdAt: new Date().toISOString(), archived: false, tags: [],
      states: { Production: { enabled: true, value: null, updatedAt: new Date().toISOString(), segmentOverrides: 1, identityOverrides: 0 } },
    })),
  };
  const missing = analyse(project, code).findings.find((f) => f.rule === 'missing');
  assert.equal(missing.flag, 'billing_vv2');
  assert.equal(missing.didYouMean, 'billing_v2');
});
