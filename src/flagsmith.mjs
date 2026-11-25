// Minimal Flagsmith Admin API client. Works with self-hosted Flagsmith and Flagsmith Cloud.
// Auth: an Organisation API key ("Api-Key …", Organisation Settings → API Keys) or a user
// token ("Token …"). Read-only: this tool never changes anything in Flagsmith.

export class FlagsmithAdmin {
  constructor({ apiUrl, apiKey, token }) {
    this.base = (apiUrl || 'http://localhost:8000/api/v1/').replace(/\/?$/, '/');
    if (apiKey) this.auth = `Api-Key ${apiKey}`;
    else if (token) this.auth = `Token ${token}`;
    else throw new Error('Set FLAGSMITH_ADMIN_API_KEY (organisation API key) or FLAGSMITH_TOKEN');
  }

  // Retries network failures and 502/503/504 (self-hosted instances behind proxies blip).
  async get(path) {
    const url = path.startsWith('http') ? path : this.base + path.replace(/^\//, '');
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { headers: { Authorization: this.auth, Accept: 'application/json' } });
      } catch (err) {
        if (attempt >= 4) throw new Error(`Flagsmith GET ${url}: ${err.cause?.code ?? err.message}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      if (res.ok) return res.json();
      if ([502, 503, 504].includes(res.status) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Flagsmith GET ${url} → ${res.status} ${body}`);
    }
  }

  // Follows DRF pagination (`next`) and also accepts plain arrays.
  async list(path) {
    let page = await this.get(path);
    if (Array.isArray(page)) return page;
    const out = [...page.results];
    while (page.next) {
      page = await this.get(page.next);
      out.push(...page.results);
    }
    return out;
  }

  async projects() {
    return this.list('projects/');
  }

  async resolveProject(idOrName) {
    const projects = await this.projects();
    if (!projects.length) throw new Error('No projects visible with these credentials');
    if (idOrName == null || idOrName === '') {
      if (projects.length === 1) return projects[0];
      const names = projects.map((p) => `${p.id} (${p.name})`).join(', ');
      throw new Error(`Several projects found, pass --project: ${names}`);
    }
    const p = projects.find((x) => String(x.id) === String(idOrName) || x.name === idOrName);
    if (!p) throw new Error(`Project "${idOrName}" not found`);
    return p;
  }

  /** Snapshot of one project in the shape analyse() expects. */
  async snapshot(idOrName) {
    const project = await this.resolveProject(idOrName);
    const [features, environments, tags] = await Promise.all([
      this.list(`projects/${project.id}/features/?page_size=100`), // includes archived
      this.list(`environments/?project=${project.id}`),
      this.list(`projects/${project.id}/tags/`).catch(() => []),
    ]);
    const tagName = new Map(tags.map((t) => [t.id, t.label]));

    const flags = new Map(
      features.map((f) => [
        f.id,
        {
          id: f.id,
          name: f.name,
          type: f.type,
          createdAt: f.created_date,
          archived: Boolean(f.is_archived),
          tags: (f.tags ?? []).map((t) => tagName.get(t) ?? String(t)),
          states: {},
        },
      ]),
    );

    for (const env of environments) {
      const states = await this.list(`environments/${env.api_key}/featurestates/?page_size=100`);
      const counts = await this.overrideCounts(project.id, env.id);
      for (const s of states) {
        const flag = flags.get(s.feature);
        if (!flag || s.identity || s.feature_segment) continue; // environment default only
        flag.states[env.name] = {
          enabled: s.enabled,
          value: s.feature_state_value,
          updatedAt: s.updated_at,
          segmentOverrides: counts.get(s.feature)?.segments ?? 0,
          identityOverrides: counts.get(s.feature)?.identities ?? 0,
        };
      }
    }

    return {
      id: project.id,
      name: project.name,
      environments: environments.map((e) => ({ id: e.id, name: e.name })),
      flags: [...flags.values()],
    };
  }

  // Per-feature counts of segment and identity overrides in one environment.
  async overrideCounts(projectId, environmentId) {
    const features = await this.list(
      `projects/${projectId}/features/?environment=${environmentId}&page_size=100`,
    );
    return new Map(
      features.map((f) => [
        f.id,
        { segments: f.num_segment_overrides ?? 0, identities: f.num_identity_overrides ?? 0 },
      ]),
    );
  }
}
