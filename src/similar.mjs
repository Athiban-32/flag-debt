// Edit distance and "did you mean" helpers for flag keys.

export function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const norm = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Two keys look like the same flag spelled differently: identical once case and separators are
 * ignored (newPricing vs new_pricing), or a small edit apart (onboarding_tuor vs onboarding_tour).
 * Short keys need an exact normalised match, so v1/v2 or beta/meta are not reported.
 */
export function looksLikeTypo(a, b) {
  if (a === b) return false;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const shortest = Math.min(na.length, nb.length);
  if (shortest < 8) return false;
  // Keys that differ only in a trailing version/number are deliberate (checkout_v2 / checkout_v3).
  if (na.replace(/\d+$/, '') === nb.replace(/\d+$/, '')) return false;
  return levenshtein(na, nb) <= (shortest >= 14 ? 2 : 1);
}

export function closest(key, candidates) {
  let best = null;
  for (const c of candidates) {
    if (!looksLikeTypo(key, c)) continue;
    const d = levenshtein(norm(key), norm(c));
    if (!best || d < best.d) best = { key: c, d };
  }
  return best?.key ?? null;
}
