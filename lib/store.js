// Enkel JSON-lagring i Vercel Blob (används för låsta prognoser).
// Utan BLOB_READ_WRITE_TOKEN (lokal utveckling) används minnet i stället.

const mem = new Map();
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export async function readJson(path) {
  if (!hasBlob()) return mem.get(path) ?? null;
  const { head } = await import('@vercel/blob');
  try {
    const meta = await head(path);
    const r = await fetch(`${meta.url}?v=${Date.parse(meta.uploadedAt) || Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch (err) {
    if (/not.?found/i.test(err?.name || '') || /not.?found|does not exist/i.test(err?.message || '')) return null;
    throw err;
  }
}

export async function writeJson(path, data) {
  if (!hasBlob()) { mem.set(path, data); return; }
  const { put } = await import('@vercel/blob');
  await put(path, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
}
