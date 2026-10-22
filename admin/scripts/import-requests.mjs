import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const file = process.argv[2];
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !file) {
  throw new Error('Set Supabase environment variables and pass the exported CSV file path.');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted cell.');
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const aliases = {
  submitted_at: ['submitted', 'submittedat', 'timestamp', 'createdat'],
  id: ['id', 'requestid', 'bookingid'],
  name: ['name', 'customer', 'customername'],
  email: ['email', 'customeremail'],
  phone: ['phone', 'customerphone'],
  pickup: ['pickup', 'pickuplocation'],
  destination: ['destination', 'dropoff', 'dropofflocation'],
  date: ['date', 'pickupdate'],
  time: ['time', 'pickuptime'],
  language: ['language', 'preferredlanguage'],
  status: ['status'],
  rider: ['rider', 'ridername'],
  rider_phone: ['riderphone', 'ridertelephone'],
  fare: ['fare', 'farerwf'],
  notes: ['notes', 'coordinatornotes']
};

const legacyOrder = [
  'submitted_at', 'id', 'name', 'email', 'phone', 'pickup', 'destination',
  'date', 'time', 'language', 'status', 'rider', 'rider_phone', 'fare', 'notes'
];

function parseDate(value) {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsedIso = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsedIso.getTime()) || parsedIso.toISOString().slice(0, 10) !== text) {
      throw new Error(`Unrecognized pickup date: ${text}`);
    }
    return text;
  }
  const label = text.match(/^(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (label) {
    const parsed = new Date(`${label[2]} ${label[1]}, ${label[3]} UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unrecognized pickup date: ${text}`);
  return parsed.toISOString().slice(0, 10);
}

function parseTimestamp(value) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const rows = parseCsv(await readFile(file, 'utf8'));
if (rows.length < 2) throw new Error('The CSV must include a header and at least one request row.');

const headers = rows[0].map(normalizeHeader);
const fieldIndexes = {};
for (const [field, names] of Object.entries(aliases)) {
  fieldIndexes[field] = headers.findIndex((header) => names.includes(header));
}
const hasKnownHeaders = fieldIndexes.id >= 0 && fieldIndexes.name >= 0;
if (!hasKnownHeaders) {
  for (let i = 0; i < legacyOrder.length; i++) fieldIndexes[legacyOrder[i]] = i;
}

const statuses = new Set(['New', 'Finding rider', 'Confirmed', 'Completed', 'Cancelled']);
const languages = new Set(['English', 'French', 'Kiswahili', 'Kinyarwanda']);
const importRows = [];
const errors = [];
for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
  const cells = rows[rowIndex];
  const value = (field) => {
    const index = fieldIndexes[field];
    return index >= 0 ? String(cells[index] || '').trim() : '';
  };
  const line = rowIndex + 1;
  try {
    const id = value('id');
    const status = value('status') || 'New';
    const fareText = value('fare').replace(/[,\sA-Za-z]/g, '');
    if (!id || !value('name') || !value('email') || !value('phone') ||
        !value('pickup') || !value('destination')) {
      throw new Error('missing request ID or required customer/route fields');
    }
    if (!statuses.has(status)) throw new Error(`unknown status "${status}"`);
    if (fareText && (!/^\d+$/.test(fareText) || Number(fareText) < 0)) {
      throw new Error(`invalid fare "${value('fare')}"`);
    }
    const time = value('time').match(/^(\d{1,2}):(\d{2})/);
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) {
      throw new Error(`invalid pickup time "${value('time')}"`);
    }
    const date = parseDate(value('date'));
    const language = value('language');
    importRows.push({
      id,
      name: value('name'),
      email: value('email').toLowerCase(),
      phone: value('phone'),
      pickup: value('pickup'),
      destination: value('destination'),
      date,
      time: `${time[1].padStart(2, '0')}:${time[2]}`,
      language: languages.has(language) ? language : 'English',
      status,
      rider: value('rider') || null,
      rider_phone: value('rider_phone') || null,
      fare: fareText ? Number(fareText) : null,
      notes: value('notes') || null,
      submitted_at: parseTimestamp(value('submitted_at')) || new Date().toISOString()
    });
  } catch (error) {
    errors.push(`CSV row ${line}: ${error.message}`);
  }
}
if (errors.length) throw new Error(`Import stopped; no rows were written.\n${errors.join('\n')}`);

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const batchSize = 100;
for (let i = 0; i < importRows.length; i += batchSize) {
  const { error } = await client.from('ride_requests')
    .upsert(importRows.slice(i, i + batchSize), { onConflict: 'id' });
  if (error) throw error;
}
console.log(`Imported ${importRows.length} requests into Supabase. Existing IDs were updated, not duplicated.`);
