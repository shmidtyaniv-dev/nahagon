// ============================================================
//  מרכז הרכב של מור — ימים תפוסים מיומן האייפון של יניב
//  קורא את היומן הציבורי "תפוס- מרכז הרכב של מור" מ-iCloud,
//  ומחזיר רשימת תאריכים (ISO) שבהם יש אירוע — כל תאריך כזה
//  נחסם לקביעת טיפולים (גם בדף הנהגים וגם ביומן המערכת).
//  כתובת: /api/busy-days  →  { dates: ["2026-07-20", ...] }
// ============================================================

const ICLOUD_URL = 'https://p158-caldav.icloud.com/published/2/MTM1NzQyOTIxNjEzNTc0Mjqu0cvm14n64dRVqpC75_REd6zje8e9aJFQVbZudUIsOtDQFIAl_i7H2NXD477ERGMZFDsrJnq7Jf2q22Flt_4';
const PAST_DAYS   = 7;    // כמה ימים אחורה עוד רלוונטיים
const FUTURE_DAYS = 400;  // עד כמה קדימה

// --- מחלץ תאריך ISO מערך DTSTART/DTEND של ICS ---
// תומך ב: 20260720 (יום שלם) וגם 20260720T090000 (עם שעה)
function icsDate(val) {
  const m = String(val || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  try {
    const r = await fetch(ICLOUD_URL);
    if (!r.ok) throw new Error('iCloud החזיר ' + r.status);
    const raw = await r.text();

    // "פרישת" שורות מקופלות (שורה שמתחילה ברווח היא המשך של הקודמת)
    const text = raw.replace(/\r?\n[ \t]/g, '');
    const lines = text.split(/\r?\n/);

    const minDate = addDays(new Date().toISOString().slice(0, 10), -PAST_DAYS);
    const maxDate = addDays(new Date().toISOString().slice(0, 10), FUTURE_DAYS);

    const dates = new Set();
    let inEvent = false, dtstart = null, dtend = null, allDay = false;

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { inEvent = true; dtstart = null; dtend = null; allDay = false; continue; }
      if (line === 'END:VEVENT') {
        if (dtstart) {
          let end = dtend || dtstart;
          // באירוע יום-שלם DTEND הוא "לא כולל" — מורידים יום
          if (allDay && dtend && dtend > dtstart) end = addDays(dtend, -1);
          if (end < dtstart) end = dtstart;
          // בטיחות: לא מרחיבים טווח מעל שנה
          let d = dtstart, guard = 0;
          while (d <= end && guard < 370) {
            if (d >= minDate && d <= maxDate) dates.add(d);
            d = addDays(d, 1); guard++;
          }
        }
        inEvent = false; continue;
      }
      if (!inEvent) continue;
      if (line.startsWith('DTSTART')) {
        dtstart = icsDate(line.split(':').pop());
        if (line.includes('VALUE=DATE')) allDay = true;
      } else if (line.startsWith('DTEND')) {
        dtend = icsDate(line.split(':').pop());
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // מטמון קצר בצד Vercel — לא מפציצים את iCloud בכל טעינה
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ dates: Array.from(dates).sort() });
  } catch (e) {
    return res.status(500).json({ error: String(e), dates: [] });
  }
}
