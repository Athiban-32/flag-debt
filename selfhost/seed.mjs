// Seeds a LOCAL self-hosted Flagsmith (docker compose in this folder) with the demo project
// that matches ../example. Creates a throwaway admin user and an organisation API key, and
// writes them to selfhost/.env.demo (gitignored). Safe to re-run: it recreates the project.
//
// Usage: node selfhost/seed.mjs [--api http://localhost:8000/api/v1/] [--no-backdate]
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(here, '.env.demo');
const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:8000/api/v1/' },
    'no-backdate': { type: 'boolean', default: false },
  },
});
const API = args.api.replace(/\/?$/, '/');
const PROJECT = 'Tern';
const ENVS = ['Development', 'Staging', 'Production'];

// The demo project. `on` lists environments where the flag is enabled; `ageDays` backdates
// the flag and its environment states so staleness can be shown without waiting weeks.
const FLAGS = [
  { name: 'install_section', on: ENVS, value: 'one_liner', ageDays: 5,
    variants: ['steps', 'os_picker'], description: 'A/B/C test of the install section' },
  { name: 'rate_limit_v2', on: ['Staging'], ageDays: 40,
    identityOverride: { env: 'Production', identifier: 'acme-corp' },
    description: 'New rate limiter, rolling out to one customer in prod' },
  { name: 'dark_mode', on: ENVS, ageDays: 200, tags: ['permanent'],
    description: 'User-facing theme toggle (kill switch, meant to stay)' },
  { name: 'new_pricing_page', on: ENVS, ageDays: 45, description: 'Pricing page redesign' },
  { name: 'legacy_search', on: [], ageDays: 60, description: 'Old search backend' },
  { name: 'beta_dashboard', on: ['Production'], ageDays: 10, description: 'Beta dashboard link' },
  { name: 'old_checkout', on: [], ageDays: 120, archived: true, description: 'Checkout v1' },
  { name: 'holiday_banner', on: ENVS, value: 'Happy holidays from Tern', ageDays: 3,
    description: 'Seasonal banner text' },
  { name: 'onboarding_tour', on: ['Development', 'Staging'], ageDays: 20,
    description: 'Guided tour for new users' },
];

let auth = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries network-level failures (Docker's port proxy occasionally resets a connection).
async function call(method, p, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce(method, p, body);
    } catch (err) {
      if (err.httpStatus || attempt >= 4) throw err;
      await sleep(1500 * attempt);
    }
  }
}

async function callOnce(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(auth && { Authorization: auth }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw Object.assign(new Error(`${method} ${p} → ${res.status} ${text.slice(0, 400)}`), {
      httpStatus: res.status,
    });
  }
  return text ? JSON.parse(text) : null;
}
const results = (r) => (Array.isArray(r) ? r : r.results);

async function readEnvFile() {
  try {
    const lines = (await readFile(ENV_FILE, 'utf8')).split(/\r?\n/);
    return Object.fromEntries(lines.filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }));
  } catch {
    return {};
  }
}

async function login(saved) {
  const email = saved.DEMO_ADMIN_EMAIL || `admin-${randomBytes(3).toString('hex')}@flagdebt.test`;
  const password = saved.DEMO_ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  if (!saved.DEMO_ADMIN_EMAIL) {
    await call('POST', 'auth/users/', {
      email, password, re_password: password, first_name: 'Demo', last_name: 'Admin',
    });
  }
  const { key } = await call('POST', 'auth/login/', { email, password });
  auth = `Token ${key}`;
  await writeEnvFile({ ...saved, DEMO_ADMIN_EMAIL: email, DEMO_ADMIN_PASSWORD: password });
  return { email, password };
}

async function writeEnvFile(values) {
  const order = ['FLAGSMITH_API_URL', 'FLAGSMITH_ADMIN_API_KEY', 'FLAGSMITH_PROJECT',
    'DEMO_ADMIN_EMAIL', 'DEMO_ADMIN_PASSWORD'];
  await writeFile(ENV_FILE, [
    '# Written by selfhost/seed.mjs for the LOCAL demo instance only. Do not commit.',
    ...order.filter((k) => values[k]).map((k) => `${k}=${values[k]}`),
    '',
  ].join('\n'));
}

function psql(sql) {
  execFileSync(
    'docker',
    ['compose', '-f', path.join(here, 'docker-compose.yml'), 'exec', '-T', 'postgres',
      'psql', '-U', 'postgres', '-d', 'flagsmith', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

async function main() {
  const saved = await readEnvFile();
  const creds = await login(saved);

  let org = results(await call('GET', 'organisations/'))[0];
  if (!org) org = await call('POST', 'organisations/', { name: 'Tern Labs' });

  for (const p of results(await call('GET', 'projects/'))) {
    if (p.name === PROJECT) await call('DELETE', `projects/${p.id}/`);
  }
  const project = await call('POST', 'projects/', { name: PROJECT, organisation: org.id });

  // Flagsmith creates default environments for a new project on some versions; reuse or create.
  const existing = results(await call('GET', `environments/?project=${project.id}`));
  const envs = {};
  for (const name of ENVS) {
    envs[name] = existing.find((e) => e.name === name)
      ?? (await call('POST', 'environments/', { name, project: project.id }));
  }
  for (const e of existing) if (!ENVS.includes(e.name)) await call('DELETE', `environments/${e.api_key}/`);

  const tag = await call('POST', `projects/${project.id}/tags/`, {
    label: 'permanent', color: '#2f6f5e', project: project.id,
  });

  for (const f of FLAGS) {
    const body = {
      name: f.name,
      description: f.description,
      default_enabled: false,
      initial_value: f.value ?? null,
      tags: f.tags ? [tag.id] : [],
      project: project.id,
    };
    if (f.variants) {
      const pct = Math.floor(100 / (f.variants.length + 1));
      body.multivariate_options = f.variants.map((v) => ({
        type: 'unicode', string_value: v, default_percentage_allocation: pct,
      }));
    }
    const feature = await call('POST', `projects/${project.id}/features/`, body);
    f.id = feature.id;

    for (const name of ENVS) {
      const env = envs[name];
      const fs = results(await call('GET', `environments/${env.api_key}/featurestates/?feature=${feature.id}`))
        .find((s) => !s.identity && !s.feature_segment);
      await call('PATCH', `environments/${env.api_key}/featurestates/${fs.id}/`, {
        enabled: f.on.includes(name),
      });
    }
    if (f.identityOverride) {
      const env = envs[f.identityOverride.env];
      const identity = await call('POST', `environments/${env.api_key}/identities/`, {
        identifier: f.identityOverride.identifier, environment: env.id,
      });
      await call('POST', `environments/${env.api_key}/identities/${identity.id}/featurestates/`, {
        feature: feature.id, enabled: true,
      });
    }
    if (f.archived) {
      await call('PATCH', `projects/${project.id}/features/${feature.id}/`, { is_archived: true });
    }
    console.log(`  ${f.name.padEnd(18)} on: ${f.on.join(', ') || '(nowhere)'}${f.archived ? ' · archived' : ''}`);
  }

  if (!args['no-backdate']) {
    for (const f of FLAGS) {
      const ago = `now() - interval '${f.ageDays} days'`;
      psql(`UPDATE features_feature SET created_date = ${ago} WHERE id = ${f.id};`);
      psql(`UPDATE features_featurestate SET created_at = ${ago}, updated_at = ${ago}
            WHERE feature_id = ${f.id} AND identity_id IS NULL AND feature_segment_id IS NULL;`);
    }
    console.log('  backdated flags to their demo ages (direct SQL on the local Postgres)');
  }

  const key = await call('POST', `organisations/${org.id}/master-api-keys/`, {
    name: `flag-debt-demo-${Date.now()}`, is_admin: true,
  });

  await writeEnvFile({
    FLAGSMITH_API_URL: API,
    FLAGSMITH_ADMIN_API_KEY: key.key,
    FLAGSMITH_PROJECT: project.id,
    DEMO_ADMIN_EMAIL: creds.email,
    DEMO_ADMIN_PASSWORD: creds.password,
  });
  console.log(`\nSeeded project "${PROJECT}" (id ${project.id}) with ${FLAGS.length} flags in ${ENVS.join(', ')}.`);
  console.log(`Dashboard: ${API.replace(/api\/v1\/$/, '')} (login details in selfhost/.env.demo)`);
  console.log('Next: npm run demo');
}

main().catch((err) => {
  console.error(`seed failed: ${err.message}`);
  process.exitCode = 1;
});
