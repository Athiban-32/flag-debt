// Turns a Flagsmith project snapshot + a code scan into flag-debt findings.
//
// project = { name, environments: [{ id, name }], flags: [{
//   id, name, type, createdAt, archived, tags: string[],
//   states: { [envName]: { enabled, value, updatedAt, segmentOverrides, identityOverrides } }
// }] }

export const RULES = {
  missing: {
    severity: 'error',
    title: 'Missing in Flagsmith',
    why: 'Code asks for a flag that does not exist in this project, so it silently gets the SDK default.',
    fix: 'Create the flag in Flagsmith, or fix the typo in code.',
  },
  archived_in_use: {
    severity: 'error',
    title: 'Archived but still in code',
    why: 'The flag is archived in Flagsmith but code still reads it.',
    fix: 'Remove the code path, or unarchive the flag.',
  },
  stale_on: {
    severity: 'warn',
    title: 'Fully rolled out',
    why: 'On with the same value in every environment, with no overrides, for a long time. The flag no longer decides anything.',
    fix: 'Hard-code the "on" path, delete the "off" path, then delete the flag.',
  },
  stale_off: {
    severity: 'warn',
    title: 'Off everywhere',
    why: 'Off in every environment for a long time. The guarded code is dead.',
    fix: 'Delete the guarded code, then delete the flag.',
  },
  prod_only: {
    severity: 'warn',
    title: 'On in production only',
    why: 'Enabled in production but off in every other environment, so it was never exercised before release.',
    fix: 'Turn it on in staging/dev too, or check it was meant to be live.',
  },
  unused: {
    severity: 'info',
    title: 'Not referenced in code',
    why: 'No string in the scanned code matches this flag name.',
    fix: 'Archive the flag in Flagsmith if no other service uses it.',
  },
};

const DAY = 86_400_000;
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

function daysSince(iso, now) {
  if (!iso) return null;
  return Math.floor((now - Date.parse(iso)) / DAY);
}

export function analyse(project, code, options = {}) {
  const now = options.now ?? Date.now();
  const staleDays = options.staleDays ?? 30;
  const prodPattern = new RegExp(options.productionPattern ?? 'prod', 'i');
  const exemptTags = new Set((options.permanentTags ?? ['permanent']).map((t) => t.toLowerCase()));
  const envNames = project.environments.map((e) => e.name);
  const prodEnvs = envNames.filter((n) => prodPattern.test(n));
  const findings = [];
  const add = (rule, flag, extra = {}) =>
    findings.push({ rule, ...RULES[rule], flag: flag.name ?? flag, ...extra });

  const byName = new Map(project.flags.map((f) => [f.name, f]));

  for (const flag of project.flags) {
    const refs = code.literals.get(flag.name) ?? [];
    const permanent = flag.tags.some((t) => exemptTags.has(t.toLowerCase()));
    const states = envNames.map((n) => flag.states[n]).filter(Boolean);

    if (flag.archived) {
      if (refs.length) add('archived_in_use', flag, { refs });
      continue;
    }
    if (!refs.length) add('unused', flag, { refs, ageDays: daysSince(flag.createdAt, now) });
    if (permanent || !states.length) continue;

    const lastChange = states.map((s) => s.updatedAt).filter(Boolean).sort().at(-1) ?? flag.createdAt;
    const age = daysSince(lastChange, now);
    const hasOverrides = states.some((s) => s.segmentOverrides > 0 || s.identityOverrides > 0);
    const allOn = states.every((s) => s.enabled);
    const allOff = states.every((s) => !s.enabled);
    const sameValue = new Set(states.map((s) => JSON.stringify(s.value ?? null))).size === 1;
    const isExperimentish = flag.type === 'MULTIVARIATE';

    if (age !== null && age >= staleDays && !hasOverrides) {
      if (allOn && sameValue && !isExperimentish) add('stale_on', flag, { refs, ageDays: age });
      else if (allOff) add('stale_off', flag, { refs, ageDays: age });
    }
    if (prodEnvs.length && prodEnvs.length < states.length) {
      const prodOn = prodEnvs.every((n) => flag.states[n]?.enabled);
      const othersOff = envNames
        .filter((n) => !prodEnvs.includes(n) && flag.states[n])
        .every((n) => !flag.states[n].enabled);
      if (prodOn && othersOff) add('prod_only', flag, { refs });
    }
  }

  for (const [key, refs] of code.sdkKeys) {
    if (!byName.has(key)) add('missing', key, { refs });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      a.flag.localeCompare(b.flag),
  );

  const removableRefs = findings
    .filter((f) => f.rule === 'stale_on' || f.rule === 'stale_off')
    .reduce((n, f) => n + f.refs.length, 0);

  return {
    findings,
    summary: {
      project: project.name,
      environments: envNames,
      flags: project.flags.filter((f) => !f.archived).length,
      filesScanned: code.files,
      staleDays,
      counts: Object.fromEntries(
        Object.keys(RULES).map((r) => [r, findings.filter((f) => f.rule === r).length]),
      ),
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warn').length,
      removableRefs,
    },
  };
}
