import { RULES } from './analyse.mjs';

export const COMMENT_MARKER = '<!-- flag-debt-report -->';
const ICON = { error: '🔴', warn: '🟡', info: '⚪' };
const RANK = { error: 0, warn: 1, info: 2 };

function locText(r) {
  return `${r.file}:${r.line}`;
}

function locLink(r, link) {
  if (!link) return `\`${locText(r)}\``;
  return `[\`${locText(r)}\`](${link.serverUrl}/${link.repo}/blob/${link.sha}/${link.prefix}${r.file}#L${r.line})`;
}

export function describe(f) {
  if (f.rule === 'experiment_done') {
    const won = f.decision === 'disable' ? 'decision: turn it off' : `"${f.winner}" won`;
    const when = f.ageDays != null ? ` ${f.ageDays} days ago` : '';
    return `${won} in ${f.environment}${when}; losing still in code: ${f.losers.join(', ')}`;
  }
  if (f.rule === 'experiment_unwired') return `running in ${f.environments.join(', ')}`;
  if (f.ageDays != null && (f.rule === 'stale_on' || f.rule === 'stale_off')) {
    return `unchanged for ${f.ageDays} days`;
  }
  if (f.rule === 'unused' && f.ageDays != null) return `created ${f.ageDays} days ago`;
  return '';
}

// ANSI styling for the terminal report. Plain text unless the caller asks for colour.
const ESC = '\u001b[';
function palette(color) {
  const wrap = (open, close) => (t) => (color ? `${ESC}${open}m${t}${ESC}${close}m` : String(t));
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    gray: wrap(90, 39),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
  };
}

const MAX_TEXT_REFS = 4;

export function toText({ findings, summary }, { color = false } = {}) {
  const c = palette(color);
  const sev = {
    error: (t) => c.bold(c.red(t)),
    warn: (t) => c.bold(c.yellow(t)),
    info: (t) => c.bold(c.gray(t)),
  };
  const label = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };
  const out = [];
  out.push(
    `${c.bold('flag-debt')}  ${summary.project} · ${summary.flags} flags · ` +
      `${summary.environments.length} environments · ${summary.filesScanned} files scanned`,
  );
  out.push('');
  if (!findings.length) {
    out.push(c.green('✔ No flag debt found.'));
    return out.join('\n');
  }
  let rule = null;
  for (const f of findings) {
    if (f.rule !== rule) {
      if (rule) out.push('');
      rule = f.rule;
      const r = RULES[rule];
      out.push(
        `${sev[r.severity]('● ' + label[r.severity])} ${c.bold(r.title)} ${c.dim(`(${summary.counts[rule]})`)}`,
      );
      out.push(`  ${c.dim('Fix: ' + r.fix)}`);
    }
    out.push(`  ${c.bold(f.flag)}`);
    const extra = describe(f);
    if (extra) out.push(`    ${extra}`);
    for (const r of f.refs.slice(0, MAX_TEXT_REFS)) out.push(`    ${c.dim('→')} ${c.cyan(locText(r))}`);
    if (f.refs.length > MAX_TEXT_REFS) out.push(`    ${c.dim(`+${f.refs.length - MAX_TEXT_REFS} more`)}`);
  }
  const info = findings.filter((f) => f.severity === 'info').length;
  out.push('');
  out.push(
    `${c.bold('Summary')}  ${sev.error(`${summary.errors} errors`)} · ${sev.warn(`${summary.warnings} warnings`)} · ` +
      `${c.gray(`${info} info`)} · ${summary.removableRefs} code references can go once stale flags are cleaned up`,
  );
  return out.join('\n');
}

export function toMarkdown({ findings, summary }, link) {
  const out = [COMMENT_MARKER, '## 🚩 Flag debt report', ''];
  out.push(
    `Flagsmith project **${summary.project}** · ${summary.flags} flags · ` +
      `environments: ${summary.environments.join(', ')} · ${summary.filesScanned} files scanned · ` +
      `stale after ${summary.staleDays} days`,
  );
  out.push('');
  if (!findings.length) {
    out.push('✅ No flag debt found.');
    return out.join('\n');
  }
  out.push('| | Finding | Count |', '|---|---|---|');
  const rows = Object.entries(summary.counts)
    .filter(([, n]) => n)
    .sort(([a], [b]) => RANK[RULES[a].severity] - RANK[RULES[b].severity]);
  for (const [rule, n] of rows) out.push(`| ${ICON[RULES[rule].severity]} | ${RULES[rule].title} | ${n} |`);
  out.push('');
  if (summary.removableRefs) {
    out.push(
      `**${summary.removableRefs} code references** can be removed once the stale flags are cleaned up.`,
      '',
    );
  }

  // Errors stay open; warnings and info are folded so the first screen shows what blocks.
  const groups = new Map();
  for (const f of findings) (groups.get(f.rule) ?? groups.set(f.rule, []).get(f.rule)).push(f);
  for (const [rule, items] of groups) {
    const r = RULES[rule];
    const lines = [`${r.why} **Fix:** ${r.fix}`, ''];
    for (const f of items) {
      const extra = describe(f);
      const where = f.refs.slice(0, 5).map((x) => locLink(x, link)).join(' ');
      const more = f.refs.length > 5 ? ` +${f.refs.length - 5} more` : '';
      lines.push(`- \`${f.flag}\`${extra ? ` (${extra})` : ''}${where ? ` · ${where}${more}` : ''}`);
    }
    if (r.severity === 'error') {
      out.push(`### ${ICON[r.severity]} ${r.title}`, '', ...lines, '');
    } else {
      out.push(
        `<details><summary><b>${ICON[r.severity]} ${r.title}</b> (${items.length})</summary>`,
        '',
        ...lines,
        '',
        '</details>',
        '',
      );
    }
  }
  out.push('<sub>Generated by flag-debt against a self-hosted Flagsmith instance.</sub>');
  return out.join('\n');
}

export function toJson(result) {
  return JSON.stringify(result, null, 2);
}
