import { db } from '../shared/db-client.js';

const FIELDS = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time', 'language'];
const REQUIRED = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time'];
const LANGUAGES = ['English', 'French', 'Kiswahili', 'Kinyarwanda'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

async function sendEmailEvent(action, data) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.SHARED_SECRET;
  if (!url || !secret) {
    throw new Error('APPS_SCRIPT_URL and SHARED_SECRET are required for email notifications.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, action, secret }),
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || !result.ok) {
    throw new Error(`Apps Script email request failed (${response.status}).`);
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = readBody(req);

  // Hidden "website" field: people never fill it in, spam bots usually do.
  if (body.website) return res.status(200).json({ ok: true });

  const data = {};
  for (const k of FIELDS) data[k] = String(body[k] == null ? '' : body[k]).trim().slice(0, 200);
  data.email = data.email.toLowerCase();
  if (!LANGUAGES.includes(data.language)) data.language = 'English';

  const bad = REQUIRED.filter((k) => !data[k]);
  if (data.email && !EMAIL_RE.test(data.email)) bad.push('email');
  const parsedDate = new Date(`${data.date}T00:00:00Z`);
  if (data.date && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== data.date)) bad.push('date');
  if (data.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.time)) bad.push('time');
  if (bad.length) return res.status(400).json({ ok: false, error: 'invalid', fields: bad });

  try {
    const request = await db.createRequest(data);
    let emailWarning = false;
    try {
      const emailResult = await sendEmailEvent('request_received', { ...data, id: request.id });
      emailWarning = emailResult.customerEmailSent === false || emailResult.teamEmailSent === false;
    } catch (error) {
      emailWarning = true;
      console.error('Ride request saved, but email notifications failed:', error);
    }
    return res.status(200).json({ ok: true, id: request.id, emailWarning });
  } catch (err) {
    console.error('Could not save ride request:', err);
    return res.status(503).json({ ok: false, error: 'not_configured_or_unavailable' });
  }
}
