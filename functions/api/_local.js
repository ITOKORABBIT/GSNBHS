export function json(data, status = 200, ttl = 120) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${ttl}`,
  }});
}

export async function get(url, ttl = 120) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response;
}

export function taiwanTime(value) {
  const date = new Date(String(value).replace(/\//g, '-').replace(' ', 'T') + '+08:00');
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
