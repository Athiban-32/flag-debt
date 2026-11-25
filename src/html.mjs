// Self-contained HTML "flag health" dashboard (no external assets), e.g. for a CI artifact
// or GitHub Pages: flag-debt --format html --output flag-health.html
import { RULES } from './analyse.mjs';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function locHtml(r, link) {
  const text = esc(`${r.file}:${r.line}`);
  if (!link) return `<code>${text}</code>`;
  const href = `${link.serverUrl}/${link.repo}/blob/${link.sha}/${link.prefix}${r.file}#L${r.line}`;
  return `<a href="${esc(href)}"><code>${text}</code></a>`;
}

// Deep link to the flag in the Flagsmith dashboard (production environment by default).
function flagsmithHref(flag, fs) {
  if (!fs?.base || !fs.environmentKey || flag.type === null || flag.id == null) return null;
  return `${fs.base}/project/${fs.projectId}/environment/${fs.environmentKey}/features?feature=${flag.id}`;
}

export function toHtml({ findings, flags, summary }, { link, describe, flagsmith, generatedAt = new Date() } = {}) {
  const sevCount = (s) => findings.filter((f) => f.severity === s).length;
  const envs = summary.environments;
  const healthy = flags.filter((f) => !f.rules.length).length;

  const cards = [
    ['Errors', sevCount('error'), 'error'],
    ['Warnings', sevCount('warn'), 'warn'],
    ['Info', sevCount('info'), 'info'],
    ['Healthy flags', healthy, 'ok'],
    ['Removable code refs', summary.removableRefs, 'neutral'],
  ].map(([label, n, cls]) => `<div class="card ${cls}"><b>${n}</b><span>${label}</span></div>`).join('');

  const worst = (rules) => {
    const sev = rules.map((r) => RULES[r].severity);
    return sev.includes('error') ? 'error' : sev.includes('warn') ? 'warn' : sev.includes('info') ? 'info' : 'ok';
  };
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  const rows = [...flags]
    .sort((a, b) => order[worst(a.rules)] - order[worst(b.rules)] || a.name.localeCompare(b.name))
    .map((f) => {
      const cells = envs.map((e) => {
        const s = f.states[e];
        const label = s === true ? 'on' : s === false ? 'off' : '—';
        return `<td class="state ${label === 'on' ? 'on' : label === 'off' ? 'off' : 'none'}">${label}</td>`;
      }).join('');
      const badges = [
        f.type === 'MULTIVARIATE' ? '<span class="tag">multivariate</span>' : '',
        f.experiment ? `<span class="tag exp">experiment ${esc(f.experiment)}</span>` : '',
        f.archived ? '<span class="tag">archived</span>' : '',
        f.type === null ? '<span class="tag">not in Flagsmith</span>' : '',
        ...f.tags.map((t) => `<span class="tag">${esc(t)}</span>`),
      ].join('');
      const status = f.rules.length
        ? f.rules.map((r) => `<span class="pill ${RULES[r].severity}">${esc(RULES[r].title)}</span>`).join(' ')
        : '<span class="pill ok">Healthy</span>';
      const href = flagsmithHref(f, flagsmith);
      const open = href
        ? `<a class="open" href="${esc(href)}" target="_blank" rel="noopener" title="Open in Flagsmith (${esc(flagsmith.environmentName)})">Open in Flagsmith ↗</a>`
        : '';
      return `<tr><td><code>${esc(f.name)}</code> ${badges}</td>${cells}<td class="num">${f.refs}</td><td>${status}</td><td>${open}</td></tr>`;
    }).join('\n');

  let section = null;
  const details = [];
  for (const f of findings) {
    if (f.rule !== section) {
      if (section) details.push('</ul></section>');
      section = f.rule;
      const r = RULES[f.rule];
      details.push(`<section><h3><span class="pill ${r.severity}">${r.severity}</span> ${esc(r.title)}</h3>`,
        `<p>${esc(r.why)} <b>Fix:</b> ${esc(r.fix)}</p><ul>`);
    }
    const extra = describe?.(f);
    details.push(`<li><code>${esc(f.flag)}</code>${extra ? ` <span class="muted">(${esc(extra)})</span>` : ''}` +
      `${f.refs.length ? ' · ' + f.refs.map((r) => locHtml(r, link)).join(' ') : ''}</li>`);
  }
  if (section) details.push('</ul></section>');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flag health · ${esc(summary.project)}</title>
<style>
:root{--bg:#f7f7f5;--fg:#1c1c1a;--muted:#6b6a64;--line:#e2e0d9;--card:#fff;--err:#c4382c;--warn:#b7791f;--info:#6b6a64;--ok:#2f7d5b;--on:#2f7d5b;--off:#9c9a93}
@media (prefers-color-scheme:dark){:root{--bg:#141513;--fg:#ecebe6;--muted:#a19f98;--line:#2d2f2c;--card:#1c1d1b;--err:#ef6b5e;--warn:#e0a643;--info:#a19f98;--ok:#5fc093;--on:#5fc093;--off:#77756f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 60px}h1{margin:0 0 4px;font-size:1.6rem}h2{margin:36px 0 12px;font-size:1.15rem}h3{font-size:1rem;margin:22px 0 6px}
.muted,.sub{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}.card b{display:block;font-size:1.8rem;line-height:1.1}.card span{color:var(--muted);font-size:.85rem}
.card.error b{color:var(--err)}.card.warn b{color:var(--warn)}.card.ok b{color:var(--ok)}
.tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:640px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:.8rem;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}td.state{font-weight:600;font-size:.85rem}td.on{color:var(--on)}td.off{color:var(--off)}td.none{color:var(--muted)}td.num{text-align:right}
code{font:.88em ui-monospace,"Cascadia Code",Consolas,monospace}a{color:inherit}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.78rem;font-weight:600;border:1px solid currentColor;margin:1px 0}
.pill.error{color:var(--err)}.pill.warn{color:var(--warn)}.pill.info{color:var(--info)}.pill.ok{color:var(--ok)}
.tag{display:inline-block;font-size:.72rem;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-left:4px}.tag.exp{color:var(--ok)}
a.open{font-size:.8rem;white-space:nowrap;color:var(--ok);text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:2px 8px}a.open:hover{border-color:var(--ok)}
ul{padding-left:1.1rem}li{margin:4px 0}footer{margin-top:40px;color:var(--muted);font-size:.8rem}
</style></head><body><main>
<h1>Flag health: ${esc(summary.project)}</h1>
<div class="sub">${summary.flags} flags · ${envs.map(esc).join(', ')} · ${summary.filesScanned} files scanned · stale after ${summary.staleDays} days · generated ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC</div>
<div class="cards">${cards}</div>
<h2>Flags by environment</h2>
<div class="tablewrap"><table><thead><tr><th>Flag</th>${envs.map((e) => `<th>${esc(e)}</th>`).join('')}<th>Code refs</th><th>Status</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>
<h2>What to do</h2>
${details.join('\n') || '<p>No flag debt found.</p>'}
<footer>Generated by flag-debt from Flagsmith (read-only Admin API) and a scan of the code.</footer>
</main></body></html>`;
}
