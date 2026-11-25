# flag-debt

**Find the feature flags you forgot to clean up by comparing your code with Flagsmith, on every pull request.**

Feature flags are cheap to add and easy to forget. Months later nobody knows whether
`new_pricing_page` still does anything, a typo like `onboarding_tuor` quietly returns the
SDK default, and an archived flag is still read in production code. Flagsmith knows the
flag states. Your repo knows where the flags are used. flag-debt joins the two and tells
you what to delete, what is broken, and exactly which lines are involved.

Built for *Toggle Wars: The Flagsmith Experimentation Hackathon* (WeMakeDevs),
**Track 03: Build on Open Source Flagsmith**. Developed and tested against self-hosted
Flagsmith (Docker Compose in [`selfhost/`](selfhost/)); it works with Flagsmith Cloud too.

Real output against the self-hosted demo instance:

```
flag-debt · project "Tern" · 8 flags · 3 environments · 6 files scanned

ERROR Archived but still in code  (1)
      Remove the code path, or unarchive the flag.
      - old_checkout  web/src/checkout.js:5
ERROR Missing in Flagsmith  (2)
      Create the flag in Flagsmith, or fix the typo in code.
      - checkout_v3  web/src/checkout.js:4
      - onboarding_tuor  worker/jobs.py:8
WARN  On in production only  (1)
      Turn it on in staging/dev too, or check it was meant to be live.
      - beta_dashboard  web/src/checkout.js:10
WARN  Off everywhere  (1)
      Delete the guarded code, then delete the flag.
      - legacy_search  [unchanged for 60 days]  web/src/search.js:4, worker/jobs.py:16
WARN  Fully rolled out  (1)
      Hard-code the "on" path, delete the "off" path, then delete the flag.
      - new_pricing_page  [unchanged for 45 days]  web/src/flags.js:5
INFO  Not referenced in code  (2)
      Archive the flag in Flagsmith if no other service uses it.
      - holiday_banner  [created 3 days ago]
      - onboarding_tour  [created 20 days ago]

3 errors, 3 warnings. 3 code references can go once stale flags are cleaned up.
```

## What it finds

| Finding | Severity | Meaning |
|---|---|---|
| **Missing in Flagsmith** | error | Code calls an SDK with a key the project doesn't have (typo, or never created). The SDK silently returns the default. |
| **Archived but still in code** | error | The flag is archived in Flagsmith but code still reads it. |
| **Fully rolled out** | warn | On, with the same value in every environment and no segment or identity overrides, unchanged for N days. The flag no longer decides anything. |
| **Off everywhere** | warn | Off in every environment for N days. The guarded code is dead. |
| **On in production only** | warn | Enabled in production but off in every other environment, so it was never exercised before release. |
| **Not referenced in code** | info | No string in the scanned code matches the flag name. Archive it if no other service uses it. |

Each finding lists the `file:line` references. In a PR comment these link to the exact
lines. Multivariate flags (experiments) are never called "fully rolled out", and flags
tagged `permanent` (kill switches, ops toggles) are exempt from the staleness rules.

**How code is matched.** A flag counts as referenced when its name appears as a quoted
string anywhere in the scanned files, so `FLAGS = { pricing: 'new_pricing_page' }` counts.
Missing keys come from direct SDK calls (`hasFeature('x')`, `get_feature_value("x")`,
`getBooleanValue('x')` in OpenFeature, and others), across JS/TS, Python, Go, Java, Kotlin,
.NET, Ruby, PHP, Swift, Dart, Rust and Elixir.

**How Flagsmith is used.** flag-debt is read-only. It calls the Flagsmith Admin API with an
organisation API key: projects, features (type, tags, archived, created date), environments,
the environment-level feature states (enabled, value, last updated), and segment and
identity override counts. It never changes anything in Flagsmith.

**How this relates to Flagsmith's own features.** Flagsmith can tag flags as stale on time
alone, and it has a code-references feature that counts where flags appear. flag-debt is
complementary. It runs as a check on every pull request with no extra setup in Flagsmith,
it catches the reverse direction (keys in code that don't exist in Flagsmith), it combines
flag state with code (archived but still read; on everywhere with no overrides; on in prod
only), and it tells you what to do and which lines to change.

## Quick start: self-hosted demo (about 5 minutes)

Requires Docker and Node 20.6+.

```bash
npm run selfhost:up      # self-hosted Flagsmith on http://localhost:8000 (first boot runs migrations)
npm run seed             # creates the "Tern" demo project, a local admin and an API key → selfhost/.env.demo
npm run demo             # scans example/ against it
npm test                 # offline unit tests
```

[`example/`](example/) is a small web app plus a Python worker with flag debt planted on purpose.
[`example/README.md`](example/README.md) lists what should be found. The seed backdates flag
timestamps with SQL on the local Postgres, so staleness shows without waiting 30 days.

## Use it on your project

### CLI

```bash
export FLAGSMITH_API_URL=https://flagsmith.your-company.internal/api/v1/   # or https://api.flagsmith.com/api/v1/
export FLAGSMITH_ADMIN_API_KEY=...        # Organisation Settings → API Keys
npx github:Athiban-32/flag-debt --src . --project "My Project" --stale-days 30
```

Options: `--format text|markdown|json`, `--output report.md`, `--fail-on error|warn|none`,
`--production-pattern prod`, `--comment` (PR comment from Actions). Run `--help` for all of them.

### GitHub Action

```yaml
# .github/workflows/flag-debt.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  flag-debt:
    runs-on: ubuntu-latest   # use a self-hosted runner if Flagsmith is only on your network
    steps:
      - uses: actions/checkout@v4
      - uses: Athiban-32/flag-debt@main
        with:
          api-url: https://flagsmith.your-company.internal/api/v1/
          admin-api-key: ${{ secrets.FLAGSMITH_ADMIN_API_KEY }}
          project: My Project
          fail-on: error        # block PRs that read missing or archived flags
```

The report is posted as one PR comment that is updated on each push, and it is also
written to the job summary. This repo's [demo workflow](.github/workflows/demo.yml) runs the
whole thing in CI: it boots self-hosted Flagsmith in the runner, seeds it, and comments on the PR.

### Config file (optional)

`.flagdebt.json` in the scanned directory:

```json
{
  "staleDays": 45,
  "productionPattern": "^(prod|production|live)$",
  "permanentTags": ["permanent", "kill-switch"],
  "ignore": ["generated", "fixtures"],
  "ignoreFlags": ["used_by_mobile_app"],
  "sdkMethods": ["isOn"],
  "extraPatterns": ["featureEnabled\\(Flags\\.(?<key>\\w+)\\)"]
}
```

## Project layout

```
bin/flag-debt.mjs       CLI
src/scan-code.mjs       source walker: string literals + SDK-call keys
src/flagsmith.mjs       read-only Flagsmith Admin API client
src/analyse.mjs         the rules
src/report.mjs          text / Markdown / JSON output
src/github.mjs          sticky PR comment
action.yml              GitHub Action
selfhost/               Docker Compose for self-hosted Flagsmith + seed script
example/                demo codebase with planted flag debt
test/                   node:test unit tests (no network)
```

No runtime dependencies: Node's built-in `fetch`, `node:test` and `parseArgs` only.

## License

MIT
