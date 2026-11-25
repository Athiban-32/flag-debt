// --code-only: what flag-debt can say from the code alone, without Flagsmith credentials.
// Lists every flag key read through an SDK call and reports keys that look like typos of
// each other (the rarer spelling is the suspect).
import { looksLikeTypo } from './similar.mjs';

export function inventory(code) {
  const keys = [...code.sdkKeys.entries()]
    .map(([key, refs]) => ({
      key,
      refs: refs.length,
      files: new Set(refs.map((r) => r.file)).size,
      methods: [...new Set(refs.map((r) => r.method))].sort(),
      locations: refs,
    }))
    .sort((a, b) => b.refs - a.refs || a.key.localeCompare(b.key));

  const typos = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]];
      if (!looksLikeTypo(a.key, b.key)) continue;
      const [likely, suspect] = a.refs >= b.refs ? [a, b] : [b, a];
      typos.push({ suspect: suspect.key, likely: likely.key, refs: suspect.locations });
    }
  }
  return {
    filesScanned: code.files,
    totalRefs: keys.reduce((n, k) => n + k.refs, 0),
    resolvedCalls: code.resolvedCalls ?? 0,
    keys,
    typos,
    unreadConstants: (code.unreadConstants ?? []).sort((a, b) => a.constant.localeCompare(b.constant)),
  };
}

export function inventoryText(inv) {
  const out = [];
  out.push(`flag-debt --code-only · ${inv.filesScanned} files scanned · ${inv.keys.length} flag keys · ${inv.totalRefs} reads`);
  if (inv.resolvedCalls) out.push(`(${inv.resolvedCalls} reads go through flag-name constants such as Feature.X)`);
  out.push('');
  if (inv.unreadConstants.length) {
    out.push(`Flag constants defined but never read (${inv.unreadConstants.length}): dead flags in code`);
    for (const u of inv.unreadConstants) out.push(`  ${u.constant} = "${u.key}"  ${u.file}:${u.line}`);
    out.push('');
  }
  if (inv.typos.length) {
    out.push('Possible typos (keys that look like the same flag spelled differently):');
    for (const t of inv.typos) {
      out.push(`  ${t.suspect}  → did you mean ${t.likely}?  ${t.refs.slice(0, 3).map((r) => `${r.file}:${r.line}`).join(', ')}`);
    }
    out.push('');
  } else {
    out.push('No look-alike flag keys found.');
    out.push('');
  }
  out.push('Flag keys by number of reads:');
  for (const k of inv.keys) {
    out.push(`  ${String(k.refs).padStart(4)}  ${k.key}  (${k.files} file${k.files === 1 ? '' : 's'})`);
  }
  out.push('');
  out.push('Connect Flagsmith (FLAGSMITH_ADMIN_API_KEY) to also find stale, archived, missing and experiment debt.');
  return out.join('\n');
}

export function inventoryMarkdown(inv) {
  const out = ['## 🚩 Flag inventory (code only)', ''];
  out.push(`${inv.filesScanned} files scanned · **${inv.keys.length} flag keys** · ${inv.totalRefs} reads`, '');
  if (inv.typos.length) {
    out.push('**Possible typos**', '');
    for (const t of inv.typos) out.push(`- \`${t.suspect}\` → did you mean \`${t.likely}\`?`);
    out.push('');
  }
  if (inv.unreadConstants.length) {
    out.push(`**Flag constants defined but never read** (${inv.unreadConstants.length})`, '');
    for (const u of inv.unreadConstants) out.push(`- \`${u.constant}\` = \`${u.key}\` · \`${u.file}:${u.line}\``);
    out.push('');
  }
  out.push('| Reads | Flag key | Files |', '|---:|---|---:|');
  for (const k of inv.keys) out.push(`| ${k.refs} | \`${k.key}\` | ${k.files} |`);
  return out.join('\n');
}
