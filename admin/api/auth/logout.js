import { clearSessionCookie, deleteSession } from '../../lib/server.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    await deleteSession(req);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Could not end admin session:', error);
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  } finally {
    clearSessionCookie(res);
  }
}
