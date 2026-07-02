// ============================================================
//  מרכז הרכב של מור — אוטומציית עדכון ק"מ חודשית
//  קובץ זה יושב ב: api/monthly-km.js בפרויקט ה-Vercel
//  הוא "הדלת האחורית" שהרובוט (Make) דופק בה פעם ביום.
// ============================================================

// ------------------ הגדרות (מותר לשנות) ------------------
const SECRET       = 'CHANGE-ME-to-a-long-random-string-12345'; // סיסמה שרק Make ידע. חובה לשנות!
const SEND_DAY     = 1;   // באיזה יום בחודש לשלוח את הבקשות
const REMIND_DAY   = 6;   // באיזה יום בחודש לשלוח תזכורת למי שלא עדכן
const PROJECT_ID   = 'crmsystem-3dfd8';                 // מזהה ה-Firebase שלך (מהקובץ)
const API_KEY      = 'AIzaSyC3VMcLRen5FxO8iphsgzeov1NFQQsSuo8'; // מפתח ה-web של Firebase (מהקובץ)
const APP_ORIGIN   = 'https://nahagon.vercel.app';      // כתובת האפליקציה
// -----------------------------------------------------------

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// --- ממיר ערכים מפורמט Firestore REST לג'אווהסקריפט רגיל ---
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
// --- ממיר ערך ג'אווהסקריפט לפורמט Firestore REST ---
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

// --- תאריך של "היום" לפי שעון ישראל, בפורמט YYYY-MM-DD ---
function todayIL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

// --- מביא מ-Hebcal את כל תאריכי החגים (ימי שבתון) של השנה ---
async function getHolidays(year) {
  const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&i=on&year=${year}`;
  const r = await fetch(url);
  const data = await r.json();
  const set = new Set();
  for (const item of (data.items || [])) {
    if (item.yomtov) set.add(item.date.slice(0, 10)); // רק ימי חג שבתון
  }
  return set;
}

// --- האם התאריך הוא יום עבודה? (לא שישי, לא שבת, לא חג) ---
function isWorkday(dateStr, holidays) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getUTCDay(); // 5 = שישי, 6 = שבת
  if (dow === 5 || dow === 6) return false;
  if (holidays.has(dateStr)) return false;
  return true;
}

// --- מוצא את יום העבודה הראשון החל מיום נתון בחודש הנוכחי ---
function firstWorkdayFrom(dayOfMonth, holidays) {
  const today = todayIL();                    // "2026-07-02"
  const ym = today.slice(0, 7);               // "2026-07"
  for (let d = dayOfMonth; d <= dayOfMonth + 14; d++) {
    const candidate = `${ym}-${String(d).padStart(2, '0')}`;
    if (isWorkday(candidate, holidays)) return candidate;
  }
  return null;
}

// --- מנרמל טלפון ישראלי לפורמט וואטסאפ: 0501234567 -> 972501234567 ---
function normPhone(p) {
  return String(p || '').replace(/[^0-9]/g, '').replace(/^0/, '972');
}

// --- קורא את כל הרכבים מ-Firestore ---
async function getVehicles() {
  const r = await fetch(`${FS_BASE}/vehicles?pageSize=300&key=${API_KEY}`);
  const data = await r.json();
  return (data.documents || []).map(doc => fsObj(doc.fields || {}));
}

// --- יוצר מסמך kmRequest — בדיוק כמו שהאפליקציה יוצרת ---
async function createKmRequest(token, vid, plate, driverName) {
  const body = {
    fields: {
      vid:        toFs(vid),
      plate:      toFs(plate),
      driverName: toFs(driverName),
      createdAt:  toFs(new Date().toISOString()),
      status:     toFs('pending'),
      source:     toFs('auto') // סימון שזה נוצר על ידי האוטומציה
    }
  };
  await fetch(`${FS_BASE}/kmRequests?documentId=${encodeURIComponent(token)}&key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// --- קורא את כל בקשות הק"מ של החודש הנוכחי ---
async function getMonthRequests() {
  const monthStart = todayIL().slice(0, 7) + '-01';
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'kmRequests' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'createdAt' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { stringValue: monthStart }
        }
      },
      limit: 500
    }
  };
  const r = await fetch(`${FS_BASE.replace('/documents', '')}/documents:runQuery?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  const rows = await r.json();
  const out = [];
  for (const row of rows) {
    if (row.document) {
      const data = fsObj(row.document.fields || {});
      data._token = row.document.name.split('/').pop();
      out.push(data);
    }
  }
  return out;
}

// ============================================================
//  הפונקציה הראשית — Make קורא לכתובת:
//  /api/monthly-km?secret=XXX&mode=send    (שליחה חודשית)
//  /api/monthly-km?secret=XXX&mode=remind  (תזכורת + סיכום)
//  תוספות לבדיקה: &force=1 (התעלם מהתאריך) &dry=1 (אל תכתוב כלום)
// ============================================================
export default async function handler(req, res) {
  try {
    const { secret, mode = 'send', force, dry } = req.query;

    if (secret !== SECRET) {
      return res.status(401).json({ error: 'סיסמה שגויה' });
    }

    const today = todayIL();
    const holidays = await getHolidays(Number(today.slice(0, 4)));

    // ---------- מצב 1: שליחה חודשית ----------
    if (mode === 'send') {
      const targetDate = firstWorkdayFrom(SEND_DAY, holidays);
      if (today !== targetDate && !force) {
        return res.json({ send: false, today, targetDate,
          note: 'עוד לא הגיע יום השליחה החודשי (או שהוא נדחה בגלל חג/סופ"ש)' });
      }

      const vehicles = await getVehicles();
      const drivers = [];
      for (const v of vehicles) {
        const name  = v.driver?.name  || '';
        const phone = normPhone(v.driver?.phone);
        const plate = v.plate || '';
        if (!phone || !v.id) continue; // מדלגים על רכב בלי נהג/טלפון

        // טוקן — בדיוק באותו פורמט של האפליקציה שלך
        const token = 'KM-' + v.id + '-' + Date.now().toString(36).slice(-5);
        if (!dry) await createKmRequest(token, v.id, plate, name);

        drivers.push({ name, plate, phone, link: APP_ORIGIN + '/?km=' + token });
      }
      return res.json({ send: true, mode: 'send', date: today, count: drivers.length, drivers });
    }

    // ---------- מצב 2: תזכורת למי שלא עדכן + סיכום ----------
    if (mode === 'remind') {
      const targetDate = firstWorkdayFrom(REMIND_DAY, holidays);
      if (today !== targetDate && !force) {
        return res.json({ send: false, today, targetDate,
          note: 'עוד לא הגיע יום התזכורת החודשי' });
      }

      const requests = await getMonthRequests();
      const auto = requests.filter(r => r.source === 'auto');
      const done    = auto.filter(r => r.status === 'done');
      const pending = auto.filter(r => r.status === 'pending');

      // משלימים טלפון מכרטיס הרכב (הבקשה לא שומרת טלפון)
      const vehicles = await getVehicles();
      const phoneByVid = {};
      for (const v of vehicles) phoneByVid[v.id] = normPhone(v.driver?.phone);

      const drivers = pending.map(r => ({
        name:  r.driverName || '',
        plate: r.plate || '',
        phone: phoneByVid[r.vid] || '',
        link:  APP_ORIGIN + '/?km=' + r._token   // אותו קישור מקורי — עדיין תקף
      })).filter(d => d.phone);

      return res.json({
        send: true, mode: 'remind', date: today,
        summary: {
          total: auto.length,
          done: done.length,
          pending: pending.length,
          doneNames:    done.map(r => r.driverName + ' (' + r.plate + ')'),
          pendingNames: pending.map(r => r.driverName + ' (' + r.plate + ')')
        },
        count: drivers.length,
        drivers
      });
    }

    return res.status(400).json({ error: 'mode לא מוכר. השתמש ב-send או remind' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
