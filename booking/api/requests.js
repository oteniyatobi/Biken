import { createRequest } from './db.js';

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

// POST /api/requests - Create a new ride request
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

    // Honeypot field
    if (body.website) {
      return res.status(200).json({ ok: true });
    }

    const FIELDS = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time', 'language'];
    const REQUIRED = ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time'];
    const LANGUAGES = ['English', 'French', 'Kiswahili', 'Kinyarwanda'];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const data = {};
    for (const k of FIELDS) {
      data[k] = String(body[k] == null ? '' : body[k]).trim().slice(0, 200);
    }
    data.email = data.email.toLowerCase();
    if (!LANGUAGES.includes(data.language)) data.language = 'English';

    const bad = REQUIRED.filter((k) => !data[k]);
    if (data.email && !EMAIL_RE.test(data.email)) bad.push('email');
    const parsedDate = new Date(`${data.date}T00:00:00Z`);
    if (data.date && (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== data.date)) bad.push('date');
    if (data.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.time)) bad.push('time');
    if (bad.length) {
      return res.status(400).json({ ok: false, error: 'invalid', fields: bad });
    }

    // Create request
    const request = await createRequest(data);
    let emailWarning = false;
    try {
      const emailResult = await sendEmailEvent('request_received', { ...data, id: request.id });
      emailWarning = emailResult.customerEmailSent === false || emailResult.teamEmailSent === false;
    } catch (err) {
      emailWarning = true;
      console.error('Ride request saved, but email notifications failed:', err);
    }

    return res.status(200).json({ ok: true, id: request.id, emailWarning });
  } catch (err) {
    console.error('Error creating request:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}