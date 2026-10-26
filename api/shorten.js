// ============================================================
//  מרכז הרכב של מור — קיצור URL לשליחת קישורים לנהגים
//  משמש כ-proxy ל-TinyURL כדי לעקוף הגבלות CORS בדפדפן.
//  קריאה: GET /api/shorten?url=<long_url>
//  תגובה: { short: "https://tinyurl.com/xxxxx" }
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const longUrl = req.query.url;
  if (!longUrl) {
    return res.status(400).json({ error: 'missing url parameter' });
  }

  try {
    const r = await fetch(
      'https://tinyurl.com/api-create.php?url=' + encodeURIComponent(longUrl),
      { headers: { 'User-Agent': 'nahagon-fleet/1.0' } }
    );
    if (!r.ok) throw new Error('TinyURL returned ' + r.status);
    const short = (await r.text()).trim();
    if (!short.startsWith('http')) throw new Error('invalid response: ' + short);
    return res.json({ short });
  } catch (e) {
    // fallback — החזר את ה-URL המקורי
    return res.json({ short: longUrl, fallback: true, error: e.message });
  }
}
