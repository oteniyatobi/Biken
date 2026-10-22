import { getSupabase, requireAdmin } from '../lib/server.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    if (!(await requireAdmin(req, res))) return;
    const client = getSupabase();
    const dateParts = new Intl.DateTimeFormat('en', {
      timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const today = `${dateParts.find((part) => part.type === 'year').value}-${dateParts.find((part) => part.type === 'month').value}-${dateParts.find((part) => part.type === 'day').value}`;
    const weekStart = new Date(`${today}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const counts = await Promise.all([
      client.from('ride_requests').select('*', { count: 'exact', head: true }),
      ...['New', 'Confirmed', 'Completed', 'Cancelled'].map((status) =>
        client.from('ride_requests').select('*', { count: 'exact', head: true }).eq('status', status)),
      client.from('ride_requests').select('*', { count: 'exact', head: true })
        .eq('date', today),
      client.from('ride_requests').select('*', { count: 'exact', head: true })
        .gte('date', weekStart.toISOString().slice(0, 10)).lte('date', today),
      client.from('ride_requests').select('id, name, pickup, destination, date, time, status, submitted_at')
        .order('submitted_at', { ascending: false }).limit(5)
    ]);
    const failed = counts.find((result) => result.error);
    if (failed) throw failed.error;

    return res.status(200).json({
      ok: true,
      stats: {
        total: counts[0].count || 0,
        new: counts[1].count || 0,
        confirmed: counts[2].count || 0,
        completed: counts[3].count || 0,
        cancelled: counts[4].count || 0,
        today: counts[5].count || 0,
        thisWeek: counts[6].count || 0,
        recentRequests: counts[7].data || []
      }
    });
  } catch (error) {
    if (!res.headersSent) {
      console.error('Could not load dashboard:', error);
      return res.status(503).json({ ok: false, error: 'service_unavailable' });
    }
  }
}
