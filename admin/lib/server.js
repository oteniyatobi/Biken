import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const COOKIE_NAME = 'biken_admin';
const SESSION_DAYS = 7;
const STATUSES = ['New', 'Finding rider', 'Confirmed', 'Completed', 'Cancelled'];
let supabase;

export function getSupabase() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
  }
  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return supabase;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function cookieValue(req) {
  const header = req.headers.cookie || '';
  const cookie = header.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : '';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function setCookie(res, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
  res.setHeader('Cache-Control', 'no-store');
}

export function clearSessionCookie(res) {
  setCookie(res, '', 0);
}

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error: cleanupError } = await getSupabase().from('admin_sessions')
    .delete().lt('expires_at', new Date().toISOString());
  if (cleanupError) throw cleanupError;
  const { error } = await getSupabase().from('admin_sessions').insert({
    user_id: userId,
    token_hash: tokenHash(token),
    expires_at: expiresAt
  });
  if (error) throw error;
  setCookie(res, token, SESSION_DAYS * 86400);
}

export async function getAdminSession(req) {
  const token = cookieValue(req);
  if (!token) return null;

  const { data, error } = await getSupabase()
    .from('admin_sessions')
    .select('id, user_id, expires_at, admin_users!inner(id, email, name, role)')
    .eq('token_hash', tokenHash(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || data.admin_users.role !== 'admin') return null;
  return { sessionId: data.id, user: data.admin_users };
}

export async function requireAdmin(req, res) {
  const session = await getAdminSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
}

export async function deleteSession(req) {
  const token = cookieValue(req);
  if (!token) return;
  const { error } = await getSupabase().from('admin_sessions')
    .delete().eq('token_hash', tokenHash(token));
  if (error) throw error;
}

export async function sendAppsScriptEvent(action, data) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.SHARED_SECRET;
  if (!url || !secret) throw new Error('Apps Script email settings are not configured.');

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

export function isStatus(value) {
  return STATUSES.includes(value);
}
