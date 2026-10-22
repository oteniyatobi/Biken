/**
 * Biken email notifications
 *
 * Sends email notifications for ride requests stored in Supabase.
 *
 * Ride requests and status updates are managed in Supabase and the admin site.
 */

const TIMEZONE = 'Africa/Kigali';
const LANGUAGES = ['English', 'French', 'Kiswahili', 'Kinyarwanda'];

// The Biken team. New-request alerts go to these addresses, and when a
// customer replies to one of our emails, the reply goes here too.
const TEAM_EMAILS = ['h.bello@alustudent.com', 't.oteniya@alustudent.com'];

/* ---------- Notification requests ---------- */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    const r = clean_(body);
    const problems = validate_(r);
    if (problems.length) return json_({ ok: false, error: 'invalid', fields: problems });

    if (body.action === 'request_received') {
      if (!body.id) return json_({ ok: false, error: 'invalid', fields: ['id'] });
      let customerEmailSent = true;
      let teamEmailSent = true;
      try { sendReceived_(r, String(body.id).slice(0, 40)); }
      catch (err) { customerEmailSent = false; console.error('Customer email failed', err); }
      try { notifyTeam_(r, String(body.id).slice(0, 40)); }
      catch (err) { teamEmailSent = false; console.error('Team email failed', err); }
      return json_({ ok: true, customerEmailSent: customerEmailSent, teamEmailSent: teamEmailSent });
    }

    if (body.action === 'ride_confirmed') {
      const rider = String(body.rider || '').trim().slice(0, 200);
      const fare = Number(body.fare);
      if (!body.id || !rider || !Number.isFinite(fare) || fare < 0) {
        return json_({ ok: false, error: 'invalid', fields: ['id', 'rider', 'fare'] });
      }
      try {
        sendConfirmed_({
        id: String(body.id).slice(0, 40),
        name: r.name,
        email: r.email,
        pickup: r.pickup,
        destination: r.destination,
        when: whenLabel_(r.dateLabel, r.time),
        rider: rider,
        riderPhone: String(body.rider_phone || '').trim().slice(0, 40),
        fare: fare
        });
        return json_({ ok: true, emailSent: true });
      } catch (err) {
        console.error('Confirmation email failed', err);
        return json_({ ok: true, emailSent: false });
      }
    }

    return json_({ ok: false, error: 'invalid_action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json_({ ok: true, service: 'Biken email notifications' });
}

/* ---------- One-time setup and testing ---------- */

// Run once from the Apps Script editor and copy the secret into both Vercel projects.
function setup() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SHARED_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SHARED_SECRET', secret);
  }
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onRequestEdit'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Setup done. Copy this value into Vercel as SHARED_SECRET:\n' + secret);
}

// Sends a sample request to yourself, as if a customer filled in the form.
function testRequest() {
  const me = Session.getEffectiveUser().getEmail();
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const res = doPost({ postData: { contents: JSON.stringify({
    action: 'request_received',
    secret: PropertiesService.getScriptProperties().getProperty('SHARED_SECRET'),
    id: 'BK-TEST-000',
    name: 'Test', email: me, phone: '0788000000', pickup: 'Kimironko Market',
    destination: 'Kigali Convention Centre', date: today, time: '08:30', language: 'English'
  }) } });
  console.log(res.getContent());
}

/* ---------- Emails ---------- */

function sendReceived_(r, id) {
  const when = whenLabel_(r.dateLabel, r.time);
  const rows = [['Pickup', r.pickup], ['Destination', r.destination], ['When', when], ['Language', r.language], ['Request ID', id]];
  const intro = 'Thanks for booking with Biken. We\'ve received your ride request.';
  const next = 'What happens next: we find an available rider who speaks your language and agree the standard fare with them. ' +
    'Then we email you your ride details. You won\'t need to negotiate anything with the rider.';
  const outro = 'If any of these details are wrong, just reply to this email.';
  MailApp.sendEmail({
    to: r.email,
    subject: 'We\'ve received your Biken ride request (' + id + ')',
    name: 'Biken',
    replyTo: TEAM_EMAILS.join(','),
    body: textEmail_(r.name, [intro, '', textRows_(rows), '', next, '', outro]),
    htmlBody: htmlEmail_('Ride request received', r.name, intro, rows, next, outro)
  });
}

function sendConfirmed_(c) {
  const fare = formatFare_(c.fare);
  const rows = [['Pickup', c.pickup], ['Destination', c.destination], ['When', c.when], ['Rider', c.rider]];
  if (c.riderPhone) rows.push(['Rider\'s phone', c.riderPhone]);
  rows.push(['Fare', fare + ' (standard fare, already agreed with your rider)']);
  rows.push(['Request ID', c.id]);
  const intro = 'Your ride is confirmed.';
  const next = 'Your rider knows where you\'re going and the fare is already agreed, so there\'s nothing to negotiate. ' +
    'Please be ready at your pickup point a few minutes early.';
  const outro = 'Need to change something? Reply to this email.';
  MailApp.sendEmail({
    to: c.email,
    subject: 'Your Biken ride is confirmed: ' + c.when,
    name: 'Biken',
    replyTo: TEAM_EMAILS.join(','),
    body: textEmail_(c.name, [intro, '', textRows_(rows), '', next, '', outro]),
    htmlBody: htmlEmail_('Your ride is confirmed', c.name, intro, rows, next, outro)
  });
}

function notifyTeam_(r, id) {
  const to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || TEAM_EMAILS.join(',');
  if (!to) return;
  const when = whenLabel_(r.dateLabel, r.time);
  const adminUrl = PropertiesService.getScriptProperties().getProperty('ADMIN_URL');
  const lines = [
    'New ride request ' + id, '',
    'Name: ' + r.name, 'Email: ' + r.email, 'Phone: ' + r.phone,
    'Pickup: ' + r.pickup, 'Destination: ' + r.destination, 'When: ' + when, 'Language: ' + r.language
  ];
  if (adminUrl) lines.push('', 'Open Biken Admin: ' + adminUrl);
  MailApp.sendEmail({
    to: to,
    subject: 'New ride request: ' + r.name + ', ' + when,
    name: 'Biken website',
    replyTo: r.email,
    body: lines.join('\n')
  });
}

function textRows_(rows) {
  return rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
}

function textEmail_(name, lines) {
  return ['Hi ' + name + ','].concat([''], lines, ['', 'Biken', 'Move Kigali with confidence.']).join('\n');
}

function htmlEmail_(title, name, intro, rows, next, outro) {
  const tr = rows.map(function (x) {
    return '<tr><td style="padding:10px 0;color:#5D5866;font-size:14px;width:130px;vertical-align:top;border-bottom:1px solid #E7DEFA">' + esc_(x[0]) +
      '</td><td style="padding:10px 0;color:#25232B;font-size:15px;font-weight:600;border-bottom:1px solid #E7DEFA">' + esc_(x[1]) + '</td></tr>';
  }).join('');
  return '<div style="background:#F7F3FF;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #E7DEFA">' +
    '<div style="background:#4B238F;padding:22px 28px;color:#FFFFFF;font-size:22px;font-weight:bold">Biken</div>' +
    '<div style="padding:28px">' +
    '<h1 style="margin:0 0 12px;font-size:22px;color:#25232B">' + esc_(title) + '</h1>' +
    '<p style="margin:0 0 6px;font-size:15px;color:#25232B">Hi ' + esc_(name) + ',</p>' +
    '<p style="margin:0 0 18px;font-size:15px;color:#4F4A58;line-height:1.55">' + esc_(intro) + '</p>' +
    '<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px">' + tr + '</table>' +
    '<p style="margin:0 0 14px;font-size:15px;color:#4F4A58;line-height:1.55;background:#F1EBFF;padding:14px 16px;border-radius:12px">' + esc_(next) + '</p>' +
    '<p style="margin:0;font-size:14px;color:#5D5866;line-height:1.55">' + esc_(outro) + '</p>' +
    '</div>' +
    '<div style="padding:16px 28px;background:#25232B;color:#C6AEFF;font-size:13px">Biken · Move Kigali with confidence.</div>' +
    '</div></div>';
}

/* ---------- Helpers ---------- */

function clean_(b) {
  const s = function (v) { return String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 200); };
  const r = {
    name: s(b.name), email: s(b.email).toLowerCase(), phone: s(b.phone), pickup: s(b.pickup),
    destination: s(b.destination), date: s(b.date), time: s(b.time), language: s(b.language)
  };
  if (LANGUAGES.indexOf(r.language) < 0) r.language = 'English';
  r.dateLabel = r.date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    try {
      r.dateLabel = Utilities.formatDate(Utilities.parseDate(r.date, TIMEZONE, 'yyyy-MM-dd'), TIMEZONE, 'EEE d MMM yyyy');
    } catch (err) { r.dateLabel = r.date; }
  }
  return r;
}

function validate_(r) {
  const bad = [];
  ['name', 'email', 'phone', 'pickup', 'destination', 'date', 'time'].forEach(function (k) { if (!r[k]) bad.push(k); });
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) bad.push('email');
  if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) bad.push('date');
  if (r.time && !/^\d{2}:\d{2}$/.test(r.time)) bad.push('time');
  return bad;
}

function whenLabel_(dateLabel, time) {
  return dateLabel + (time ? ' at ' + time : '');
}

function formatFare_(fare) {
  const n = Number(String(fare).replace(/[^0-9.]/g, ''));
  return isNaN(n) || !String(fare).trim() ? String(fare) : n.toLocaleString('en-US') + ' RWF';
}

function esc_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
