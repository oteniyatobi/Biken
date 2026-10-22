import {
  getSupabase, isStatus, readBody, requireAdmin, sendAppsScriptEvent
} from '../lib/server.js';

function positiveInteger(value, fallback, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, max) : fallback;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await requireAdmin(req, res))) return;
    const client = getSupabase();

    if (req.method === 'GET') {
      const limit = positiveInteger(req.query.limit, 20, 100) || 20;
      const offset = positiveInteger(req.query.offset, 0, 100000);
      let query = client.from('ride_requests').select('*', { count: 'exact' })
        .order('submitted_at', { ascending: false });
      if (req.query.status && isStatus(req.query.status)) query = query.eq('status', req.query.status);
      if (req.query.dateFrom) query = query.gte('date', req.query.dateFrom);
      if (req.query.dateTo) query = query.lte('date', req.query.dateTo);
      if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const term = req.query.search.trim().slice(0, 100).replace(/[,%()\\]/g, ' ');
        query = query.or(['name', 'email', 'pickup', 'destination']
          .map((field) => `${field}.ilike.%${term}%`).join(','));
      }
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({ ok: true, requests: data, count: count || 0 });
    }

    if (req.method === 'PATCH') {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id || id.length > 40) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const body = readBody(req);
      const updates = {};
      for (const key of ['status', 'rider', 'rider_phone', 'fare', 'notes']) {
        if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
      }
      if (!Object.keys(updates).length && body.send_confirmation !== true) {
        return res.status(400).json({ ok: false, error: 'no_updates' });
      }
      if (updates.status !== undefined && !isStatus(updates.status)) {
        return res.status(400).json({ ok: false, error: 'invalid_status' });
      }
      for (const key of ['rider', 'rider_phone', 'notes']) {
        if (updates[key] !== undefined && updates[key] !== null &&
            (typeof updates[key] !== 'string' || updates[key].length > 500)) {
          return res.status(400).json({ ok: false, error: `invalid_${key}` });
        }
        if (typeof updates[key] === 'string') updates[key] = updates[key].trim();
      }
      if (updates.fare !== undefined && updates.fare !== null &&
          (!Number.isInteger(Number(updates.fare)) || Number(updates.fare) < 0)) {
        return res.status(400).json({ ok: false, error: 'invalid_fare' });
      }
      if (updates.fare !== undefined && updates.fare !== null) updates.fare = Number(updates.fare);
      if (updates.status === 'Confirmed') {
        const { data: existing, error: readError } = await client.from('ride_requests')
          .select('rider, fare').eq('id', id).maybeSingle();
        if (readError) throw readError;
        if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });
        const rider = updates.rider === undefined ? existing.rider : updates.rider;
        const fare = updates.fare === undefined ? existing.fare : updates.fare;
        if (!rider || fare === null || fare === undefined) {
          return res.status(400).json({ ok: false, error: 'confirmation_requires_rider_and_fare' });
        }
      }
      updates.updated_at = new Date().toISOString();
      if (updates.status === 'Confirmed') updates.confirmed_at = new Date().toISOString();
      if (updates.status === 'Completed') updates.completed_at = new Date().toISOString();
      if (updates.status === 'Cancelled') updates.cancelled_at = new Date().toISOString();

      if (body.send_confirmation === true) {
        const { data: request, error } = await client.from('ride_requests')
          .select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!request) return res.status(404).json({ ok: false, error: 'not_found' });
        const rider = updates.rider === undefined ? request.rider : updates.rider;
        const fare = updates.fare === undefined ? request.fare : updates.fare;
        if ((updates.status || request.status) !== 'Confirmed' || !rider ||
            fare === null || fare === undefined) {
          return res.status(400).json({ ok: false, error: 'confirmation_requires_rider_and_fare' });
        }
        if (Object.keys(updates).length > 1) {
          const { error: updateError } = await client.from('ride_requests').update(updates).eq('id', id);
          if (updateError) throw updateError;
        }
        try {
          const notification = await sendAppsScriptEvent('ride_confirmed', {
            ...request,
            ...updates,
            date: String(request.date).slice(0, 10),
            time: String(request.time).slice(0, 5),
            rider,
            fare,
            rider_phone: updates.rider_phone === undefined ? request.rider_phone : updates.rider_phone
          });
          return res.status(200).json({ ok: true, emailSent: notification.emailSent !== false });
        } catch (error) {
          console.error('Ride details saved, but confirmation email failed:', error);
          return res.status(200).json({ ok: true, emailSent: false });
        }
      }

      const { data, error } = await client.from('ride_requests')
        .update(updates).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.status(200).json({ ok: true, request: data });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (error) {
    if (!res.headersSent) {
      console.error('Could not process ride requests:', error);
      return res.status(503).json({ ok: false, error: 'service_unavailable' });
    }
  }
}
