import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';

let client;

function getClient() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
  }

  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return client;
}

function makeRequestId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 3; i++) suffix += chars[randomInt(chars.length)];
  return `BK-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${suffix}`;
}

export async function createRequest(data) {
  const { data: request, error } = await getClient()
    .from('ride_requests')
    .insert({
      id: makeRequestId(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      pickup: data.pickup,
      destination: data.destination,
      date: data.date,
      time: data.time,
      language: data.language || 'English',
      status: 'New'
    })
    .select()
    .single();

  if (error) throw error;
  return request;
}
