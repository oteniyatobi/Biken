import { getAdminSession } from '../../lib/server.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const session = await getAdminSession(req);
    if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });
    return res.status(200).json({ ok: true, user: session.user });
  } catch (error) {
    console.error('Could not verify admin session:', error);
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  }
}
