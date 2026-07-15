// ============================================================
//  מרכז הרכב של מור — פיד יומן לאייפון (מינוי לוח שנה)
//  קובץ זה יושב ב: api/calendar.js בפרויקט ה-Vercel
//  האייפון "נרשם" לכתובת הזו ומקבל את כל אירועי היומן
//  (טיפולים, טסטים, התקנות, תזכורות אישיות) — מתעדכן אוטומטית.
//  כתובת: /api/calendar?key=SECRET
// ============================================================

// ------------------ הגדרות ------------------
const SECRET       = 'd755906eaa2f316bedcdbb2593955a85'; // הקוד הסודי של הלינק
const ROBOT_EMAIL    = 'robot@mor-fleet.co.il';
const ROBOT_PASSWORD = 'sd250987';
const PROJECT_ID   = 'crmsystem-3dfd8';
const API_KEY      = 'AIzaSyC3VMcLRen5FxO8iphsgzeov1NFQQsSuo8';
const PAST_DAYS    = 90;  // כמה ימים אחורה לכלול אירועים
// ---------------------------------------------

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getIdToken() {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ROBOT_EMAIL, password: ROBOT_PASSWORD, returnSecureToken: true })
    }
  );
  const data = await r.json();
  if (!data.idToken) throw new Error('התחברות הרובוט נכשלה: ' + JSON.stringify(data.error || data));
  return data.idToken;
}

function fsVal(v) {
  if (v == null) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue'   in v) return fsObj(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
}
function fsObj(fields) {
  const o = {};
  for (const k in fields) o[k] = fsVal(fields[k]);
  return o;
}

// --- קורא אוסף שלם מ-Firestore ---
async function getCollection(idToken, name) {
  const out = [];
  let pageToken = '';
  do {
    const r = await fetch(`${FS_BASE}/${name}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}&key=${API_KEY}`, {
      headers: { Authorization: 'Bearer ' + idToken }
    });
    const data = await r.json();
    if (data.error) throw new Error('קריאת ' + name + ' נכשלה: ' + JSON.stringify(data.error));
    (data.documents || []).forEach(doc => out.push(fsObj(doc.fields || {})));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

// --- בריחת תווים מיוחדים לפורמט ICS ---
function icsEsc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// --- ממיר אירוע אחד לבלוק VEVENT ---
function toVevent(ev, dtstamp) {
  const lines = ['BEGIN:VEVENT'];
  lines.push('UID:' + icsEsc(ev.uid) + '@mor-fleet');
  lines.push('DTSTAMP:' + dtstamp);
  const d = String(ev.date).replace(/-/g, ''); // YYYYMMDD
  if (ev.time && /^\d{2}:\d{2}$/.test(ev.time)) {
    const t = ev.time.replace(':', '');
    // שעה מקומית "צפה" — האייפון מציג לפי השעון המקומי (ישראל)
    lines.push('DTSTART:' + d + 'T' + t + '00');
    // משך שעה
    let hh = parseInt(ev.time.slice(0, 2), 10) + 1;
    let dEnd = d;
    if (hh >= 24) { hh = 23; } // לא גולשים ליום הבא — מסתפקים בסוף היום
    lines.push('DTEND:' + dEnd + 'T' + String(hh).padStart(2, '0') + ev.time.slice(3, 5) + '00');
  } else {
    // אירוע של יום שלם
    lines.push('DTSTART;VALUE=DATE:' + d);
    const nd = new Date(ev.date + 'T12:00:00Z');
    nd.setUTCDate(nd.getUTCDate() + 1);
    lines.push('DTEND;VALUE=DATE:' + nd.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  lines.push('SUMMARY:' + icsEsc(ev.title));
  if (ev.desc) lines.push('DESCRIPTION:' + icsEsc(ev.desc));
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export default async function handler(req, res) {
  try {
    const { key } = req.query;
    if (key !== SECRET) {
      return res.status(401).send('קוד שגוי');
    }

    const idToken = await getIdToken();
    const [fleetEvents, selfReminders] = await Promise.all([
      getCollection(idToken, 'fleetEvents'),
      getCollection(idToken, 'selfReminders')
    ]);

    // סף תאריך: לא מציגים אירועים ישנים מדי
    const minDate = new Date(Date.now() - PAST_DAYS * 86400000).toISOString().slice(0, 10);
    const events = [];

    fleetEvents.forEach(fe => {
      if (!fe.date || fe.date < minDate) return;
      const typeLabel = fe.type === 'service' ? '🔧' : fe.type === 'test' ? '📋' : '📅';
      events.push({
        uid: 'fe-' + fe.id,
        date: fe.date,
        time: fe.time || '',
        title: typeLabel + ' ' + (fe.title || 'אירוע צי רכב'),
        desc: fe.desc || ''
      });
    });

    selfReminders.forEach(r => {
      if (!r.date || r.date < minDate) return;
      events.push({
        uid: 'sr-' + r.id,
        date: r.date,
        time: r.time || '',
        title: '🔔 ' + (r.title || 'תזכורת אישית'),
        desc: r.note || ''
      });
    });

    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MorFleet//Calendar//HE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:מרכז הרכב של מור',
      'X-WR-TIMEZONE:Asia/Jerusalem',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
      events.map(ev => toVevent(ev, dtstamp)).join('\r\n'),
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(ics);
  } catch (e) {
    return res.status(500).send('שגיאה: ' + String(e));
  }
}
