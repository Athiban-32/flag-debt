# flag-debt on real codebases

flag-debt was run on two public, actively maintained projects that use Flagsmith. Their
Flagsmith projects are private, so these runs use `--code-only`. That mode needs no Flagsmith
access: it maps every flag key the code reads, resolves flag-name constants and enums, and
reports keys that look like typos and flag constants nothing reads. With an organisation API key,
the same scan also produces the Flagsmith-side findings (stale, archived, missing, experiments).

Both runs below were made on 2026-11-26 and can be reproduced from the commits given.

## Flagsmith's own dashboard: `Flagsmith/flagsmith` @ `029b425`

Flagsmith uses Flagsmith in its own dashboard ("Flagsmith on Flagsmith").

```bash
# frontend/ of github.com/Flagsmith/flagsmith at 029b425
echo '{ "sdkMethods": ["getFlagsmithHasFeature", "getFlagsmithValue", "getFlagsmithJSONValue"] }' > fs.json
npx github:Athiban-32/flag-debt --src frontend --code-only --config fs.json
```

| | |
|---|---|
| Files scanned | 1,292 (JS/TS) |
| Flag keys found | **49**, read 90 times |
| Time | about 5 s |
| Look-alike keys | none |
| Unread flag constants | none |

What it showed:
- **Wrapper functions matter.** The dashboard reads flags through its own helpers
  (`Utils.getFlagsmithHasFeature` and friends). With only the built-in SDK method names, flag-debt
  sees 10 keys. Adding the three helper names in `.flagdebt.json` brings that to all 49. This is
  why `sdkMethods` exists.
- **A clean bill of health is a valid result.** There were no typos and no dead flag constants in
  the code. The code-only mode can't judge staleness; Flagsmith's team would run the full mode
  with their API key for that.

## BC Government Mines Digital Services: `bcgov/mds` @ `13700c9`

A production system of the Province of British Columbia. It uses Flagsmith from React/TypeScript
web apps and a Python (Flask) API.

```bash
# services/ of github.com/bcgov/mds at 13700c9. No config needed.
npx github:Athiban-32/flag-debt --src services --code-only
```

| | |
|---|---|
| Files scanned | 3,127 (TS/JS/Python) |
| Flag keys found | **42**, read 142 times |
| Reads through constants | **142 of 142** (`isFeatureEnabled(Feature.X)`, `is_feature_enabled(Feature.X)`) |
| Time | about 6 s |
| Look-alike keys | none |
| **Unread flag constants** | **4** |

MDS never passes a flag name directly. Every read goes through a `Feature` enum: a TypeScript
`enum Feature` in `services/common/src/utils/featureFlag.ts` and a Python `class Feature(Enum)` in
`services/core-api/app/api/utils/feature_flag.py`. flag-debt resolves `Feature.X` to the string
the enum assigns, so all 142 reads were mapped to real flag keys with no configuration.

The four constants that no code reads:

| Constant | Flag key | Defined in | Notes from checking the whole repository |
|---|---|---|---|
| `Feature.FLAGSMITH` | `flagsmith` | `common/src/utils/featureFlag.ts:11` | Not read anywhere in the TS/JS code |
| `Feature.VC_W3C` | `vc_w3c` | `common/src/utils/featureFlag.ts:16` | Read only by the Python API (3 times), never by the web apps |
| `Feature.TRACTION_VERIFIABLE_CREDENTIALS` | `verifiable_credentials` | `core-api/app/api/utils/feature_flag.py:15` | Only the definition exists |
| `Feature.MINESPACE_SIGNUP` | `minespace_signup` | `core-api/app/api/utils/feature_flag.py:24` | Read only by the web apps (6 times), never by the Python API |

Each was checked by searching every `.ts/.tsx/.js/.jsx/.py` file in the repository. The only
dynamic lookup (`Feature[featureFlag]` in `NOWSideMenu.tsx`) only ever receives
`NOW_FILE_MANAGEMENT` and `NOTICE_OF_WORK_TIER`, so it doesn't change the result.

These are small cleanup items, not bugs: an unread constant is a flag the code no longer (or never)
uses on that side of the stack. With Flagsmith access, the next question flag-debt answers is
whether `flagsmith` and `verifiable_credentials` still exist in Flagsmith and can be archived.

## Limits seen on real code

- **Dynamic keys:** keys built at runtime (`Feature[name]`) are not resolved. They were rare
  here, one call site in 3,127 files.
- **Wrapper names:** custom helpers need one line in `.flagdebt.json` (`sdkMethods`), unless they
  use common names. MDS's `isFeatureEnabled` / `is_feature_enabled` were already covered.
- **One repo at a time:** constants read only by another repository look unread. This is why the
  results are reported per language and per file.
