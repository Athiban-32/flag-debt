# Example codebase

A tiny "Tern" product (web app + Python worker) with flag debt planted on purpose, used by
`npm run demo`. `selfhost/seed.mjs` creates the matching Flagsmith project. What the scanner
should find:

| Flag | In Flagsmith | In code | Expected finding |
|---|---|---|---|
| `install_section` | experiment completed 21 days ago, `os_picker` won | yes, still branches on `one_liner` / `steps` | Experiment finished, losing variants still in code |
| `signup_cta` | experiment **running** in Production | no | Experiment running, flag not in code |
| `rate_limit_v2` | on in Staging, identity override | yes | none (still rolling out) |
| `dark_mode` | on everywhere for months, tagged `permanent` | yes | none (exempt) |
| `new_pricing_page` | on everywhere, same value, 45 days | yes | Fully rolled out |
| `legacy_search` | off everywhere, 60 days | yes | Off everywhere |
| `beta_dashboard` | on in Production only | yes | On in production only |
| `old_checkout` | archived | yes | Archived but still in code |
| `holiday_banner` | on in all envs | no | Not referenced in code |
| `checkout_v3` | does not exist | yes | Missing in Flagsmith |
| `onboarding_tuor` | does not exist (typo of `onboarding_tour`) | yes | Missing in Flagsmith |
| `onboarding_tour` | on in Dev + Staging | no (typo above) | Not referenced in code |
