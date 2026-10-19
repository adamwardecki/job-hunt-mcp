// Company-name matching for dedupe. Exact alias/domain hits are certain; token containment and
// edit distance produce "possible" matches the model has to confirm.

const SUFFIXES = new Set([
  'inc', 'llc', 'ltd', 'limited', 'gmbh', 'ag', 'bv', 'sa', 'sas', 'sarl', 'oy', 'ab', 'as', 'aps',
  'plc', 'corp', 'corporation', 'co', 'company', 'sp', 'z', 'o', 'oo', 'spzoo', 'srl', 'spa',
  'labs', 'lab', 'hq', 'technologies', 'technology', 'tech', 'software', 'io', 'ai', 'app', 'group',
]);

export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  const s = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\.(com|io|ai|co|dev|app|so|net|org)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let tokens = s.split(' ').filter(Boolean);
  if (tokens[0] === 'the' && tokens.length > 1) tokens = tokens.slice(1);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  try {
    if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
    s = new URL(s).hostname;
  } catch {
    return '';
  }
  return s.replace(/^www\./, '').replace(/^(careers|jobs|apply)\./, '');
}

export interface AtsMatch {
  ats: string | null;
  slug: string | null;
}

// Slug of the employer on a hosted ATS, e.g. jobs.ashbyhq.com/<slug>/...
export function atsFromUrl(url: string | null | undefined): AtsMatch {
  if (!url) return { ats: null, slug: null };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ats: null, slug: null };
  }
  const host = u.hostname.replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const pick = (ats: string, slug: string | null | undefined): AtsMatch => ({ ats, slug: slug ? slug.toLowerCase() : null });
  if (host === 'jobs.ashbyhq.com') return pick('ashby', seg[0]);
  if (/(^|\.)greenhouse\.io$/.test(host)) return pick('greenhouse', seg[0] === 'embed' ? u.searchParams.get('for') : seg[0]);
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return pick('lever', seg[0]);
  if (host === 'apply.workable.com') return pick('workable', seg[0]);
  if (/\.teamtailor\.com$/.test(host)) return pick('teamtailor', host.split('.')[0]);
  if (/\.jobs\.personio\.(de|com)$/.test(host)) return pick('personio', host.split('.')[0]);
  if (host === 'join.com') return pick('join', seg[0] === 'companies' ? seg[1] : null);
  if (/myworkdayjobs\.com$/.test(host)) return pick('workday', host.split('.')[0]);
  if (/\.recruitee\.com$/.test(host)) return pick('other', host.split('.')[0]);
  if (host === 'jobs.smartrecruiters.com') return pick('other', seg[0]);
  return { ats: null, slug: null };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      // j - 1 and j are within prev (length n + 1) and cur (filled up to j - 1) by the loop bounds.
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Score how likely `query` names the same company as one of `candidates` (name + aliases).
// 1 = certain (normalized equality), 0.8-0.95 = possible, 0 = no.
export function nameScore(query: string, candidates: readonly string[]): number {
  const q = normalizeName(query);
  if (!q) return 0;
  let best = 0;
  for (const c of candidates) {
    const n = normalizeName(c);
    if (!n) continue;
    if (n === q || n.replace(/ /g, '') === q.replace(/ /g, '')) return 1;
    const qt = q.split(' '), nt = n.split(' ');
    const [short, long] = qt.length <= nt.length ? [qt, nt] : [nt, qt];
    const shortJoined = short.join(' ');
    if (shortJoined.length >= 4 && short.every((t) => long.includes(t))) best = Math.max(best, 0.85);
    const sim = similarity(q, n);
    if (sim >= 0.85 && Math.min(q.length, n.length) >= 5) best = Math.max(best, sim * 0.95);
  }
  return best;
}
