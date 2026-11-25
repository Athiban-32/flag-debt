// Posts the report as a single "sticky" PR comment: updated in place on every run.
import { readFile } from 'node:fs/promises';
import { COMMENT_MARKER } from './report.mjs';

export async function prContext() {
  const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_EVENT_PATH || !GITHUB_REPOSITORY) return null;
  const event = JSON.parse(await readFile(GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) return null;
  return { repo: GITHUB_REPOSITORY, number: pr.number, sha: pr.head.sha };
}

export async function upsertComment({ token, repo, number, body }) {
  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'flag-debt',
  };
  const res = await fetch(`${api}/repos/${repo}/issues/${number}/comments?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub list comments: ${res.status} ${await res.text()}`);
  const existing = (await res.json()).find((c) => c.body?.includes(COMMENT_MARKER));
  const url = existing
    ? `${api}/repos/${repo}/issues/comments/${existing.id}`
    : `${api}/repos/${repo}/issues/${number}/comments`;
  const write = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
  if (!write.ok) throw new Error(`GitHub write comment: ${write.status} ${await write.text()}`);
  return { updated: Boolean(existing), url: (await write.json()).html_url };
}
