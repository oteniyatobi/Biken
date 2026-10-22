import bcrypt from 'bcryptjs';
import { createSession, getSupabase, readBody } from '../../lib/server.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { email, password } = readBody(req);
  if (typeof email !== 'string' || typeof password !== 'string' ||
      email.length > 254 || password.length > 200) {
    return res.status(400).json({ ok: false, error: 'invalid_credentials' });
  }

  try {
    const { data: user, error } = await getSupabase()
      .from('admin_users')
      .select('id, email, name, role, password_hash')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();
    if (error) throw error;
    if (!user || user.role !== 'admin' || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const { error: updateError } = await getSupabase().from('admin_users')
      .update({ last_login: new Date().toISOString() }).eq('id', user.id);
    if (updateError) throw updateError;
    await createSession(res, user.id);
    return res.status(200).json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('Admin login failed:', error);
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  }
}
