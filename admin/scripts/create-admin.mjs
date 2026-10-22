import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD.');
}
if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL.trim()) || !ADMIN_NAME.trim()) {
  throw new Error('ADMIN_EMAIL must be valid and ADMIN_NAME must not be empty.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
const { error } = await supabase.from('admin_users').insert({
  email: ADMIN_EMAIL.trim().toLowerCase(),
  name: ADMIN_NAME.trim(),
  password_hash: passwordHash,
  role: 'admin'
});
if (error) throw error;
console.log(`Created admin account for ${ADMIN_EMAIL.trim().toLowerCase()}.`);
