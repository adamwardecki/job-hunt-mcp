// Bind an approval to one browser page, while allowing the usual ATS `/apply` suffix.

const TRACKING_PARAM = /^(?:utm_.+|gclid|fbclid|ref|source)$/i;

function webUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

function hostKey(hostname: string): string {
  // Greenhouse moved public boards between these two hostnames without changing job paths.
  if (/^(?:boards|job-boards)\.greenhouse\.io$/.test(hostname)) return 'greenhouse.io';
  return hostname;
}

export function normalizeTarget(raw: string): string | null {
  return webUrl(raw)?.toString() || null;
}

export function sameTarget(a: string, b: string): boolean {
  const left = normalizeTarget(a);
  const right = normalizeTarget(b);
  return left !== null && left === right;
}

export function targetMatchesRole(roleUrl: string, targetUrl: string): boolean {
  const role = webUrl(roleUrl);
  const target = webUrl(targetUrl);
  if (!role || !target || role.protocol !== target.protocol || hostKey(role.hostname) !== hostKey(target.hostname) || role.port !== target.port) return false;
  if (target.pathname !== role.pathname && (role.pathname === '/' || !target.pathname.startsWith(`${role.pathname}/`))) return false;
  // A query parameter on the stored role URL may carry the only job identifier; it must survive.
  for (const [key, value] of role.searchParams) {
    if (target.searchParams.get(key) !== value) return false;
  }
  return true;
}
