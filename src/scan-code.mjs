// Walks a source tree and records:
//   - every quoted string literal (so we can tell whether a Flagsmith flag name appears in code)
//   - every flag key passed directly to a Flagsmith / OpenFeature SDK call (so we can spot
//     keys the code asks for that do not exist in Flagsmith)
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_EXTENSIONS = [
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.go', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.dart', '.rs', '.ex', '.exs',
];
export const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'target', '.turbo', '.cache',
];

// SDK methods across Flagsmith's SDKs (JS, React, Node, Python, Go, Java, .NET, Ruby, PHP,
// Flutter) and the OpenFeature client API. The first argument is the flag key.
export const DEFAULT_SDK_METHODS = [
  'hasFeature', 'getValue', 'getFlag', 'getExperimentFlag', 'trackExposureEvent',
  'isFeatureEnabled', 'getFeatureValue', 'getTrait',
  'is_feature_enabled', 'get_feature_value', 'get_flag', 'get_experiment_flag',
  'IsFeatureEnabled', 'GetFeatureValue', 'GetFlag',
  'getBooleanValue', 'getStringValue', 'getNumberValue', 'getObjectValue',
  'getBooleanDetails', 'getStringDetails', 'getNumberDetails', 'getObjectDetails',
  'useFlag', 'useExperiment',
];

const LITERAL = /(['"`])((?:\\.|(?!\1).){1,200}?)\1/g;
const MAX_FILE_BYTES = 1_000_000;

function sdkCallRegex(methods) {
  const names = methods.map((m) => m.replace(/[$]/g, '\\$')).join('|');
  // e.g. flagsmith.hasFeature('new_checkout') / client.get_feature_value("banner")
  return new RegExp(`\\b(?:${names})\\s*(?:<[^>]*>)?\\(\\s*(['"\`])([\\w.:-]+)\\1`, 'g');
}

async function* walk(dir, root, ignore, extensions) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (ignore.includes(e.name)) continue;
      yield* walk(full, root, ignore, extensions);
    } else if (e.isFile() && extensions.includes(path.extname(e.name).toLowerCase())) {
      yield full;
    }
  }
}

/**
 * @returns {{ files: number, literals: Map<string, {file:string,line:number}[]>,
 *             sdkKeys: Map<string, {file:string,line:number,method:string}[]> }}
 */
export async function scanCode(root, opts = {}) {
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const callRe = sdkCallRegex(opts.sdkMethods ?? DEFAULT_SDK_METHODS);
  const extraRes = (opts.extraPatterns ?? []).map((p) => new RegExp(p, 'g'));
  const literals = new Map();
  const sdkKeys = new Map();
  const push = (map, key, val) => (map.get(key) ?? map.set(key, []).get(key)).push(val);
  let files = 0;

  for await (const full of walk(root, root, ignore, extensions)) {
    const info = await stat(full);
    if (info.size > MAX_FILE_BYTES) continue;
    const text = await readFile(full, 'utf8');
    const file = path.relative(root, full).split(path.sep).join('/');
    files++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/['"`]/.test(line)) continue;
      const loc = { file, line: i + 1 };
      for (const m of line.matchAll(LITERAL)) push(literals, m[2], loc);
      for (const m of line.matchAll(callRe)) {
        const method = m[0].slice(0, m[0].indexOf('(')).replace(/<.*$/, '').trim();
        push(sdkKeys, m[2], { ...loc, method });
      }
      for (const re of extraRes) {
        for (const m of line.matchAll(re)) {
          const key = m.groups?.key ?? m[1];
          if (key) push(sdkKeys, key, { ...loc, method: 'pattern' });
        }
      }
    }
  }
  return { files, literals, sdkKeys };
}
