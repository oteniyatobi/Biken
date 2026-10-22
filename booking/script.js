(function () {
  'use strict';

  var form = document.getElementById('request-form');
  var confirmBox = document.getElementById('confirm');
  var card = document.getElementById('request-card');
  var errorBox = document.getElementById('form-error');
  var errorText = document.getElementById('form-error-text');
  var submitBtn = document.getElementById('submit-btn');
  var submitLabel = document.getElementById('submit-label');
  var submitArrow = document.getElementById('submit-arrow');
  var submitSpinner = document.getElementById('submit-spinner');
  var againBtn = document.getElementById('again-btn');
  var dateInput = document.getElementById('f-date');
  var yearEl = document.getElementById('year');

  var REQUIRED = ['name', 'phone', 'email', 'pickup', 'destination', 'date', 'time'];
  var LABELS = {
    name: 'your first name',
    phone: 'your phone number',
    email: 'your email address',
    pickup: 'a pickup location',
    destination: 'a destination',
    date: 'a pickup date',
    time: 'a pickup time'
  };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var sending = false;

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function joinList(xs) {
    return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }
  function whenLabel(date, time) {
    var p = String(date).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var day = isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return day + (time ? ' · ' + time : '');
  }

  if (dateInput) dateInput.min = todayISO();
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  function field(name) { return form.elements[name]; }

  function setInvalid(name, bad) {
    var el = field(name);
    if (!el) return;
    el.classList.toggle('is-invalid', bad);
    el.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.hidden = !msg;
  }

  function setSending(on) {
    sending = on;
    submitBtn.disabled = on;
    submitLabel.textContent = on ? 'Sending your request…' : 'Send ride request';
    submitArrow.style.display = on ? 'none' : '';
    submitSpinner.hidden = !on;
  }

  function readForm() {
    var fd = new FormData(form);
    var data = {};
    ['name', 'phone', 'email', 'pickup', 'destination', 'date', 'time', 'language', 'website'].forEach(function (k) {
      data[k] = String(fd.get(k) || '').trim();
    });
    return data;
  }

  function validate(data) {
    var missing = [];
    var bad = {};
    REQUIRED.forEach(function (k) {
      if (!data[k]) { missing.push(LABELS[k]); bad[k] = true; }
    });
    var emailBad = !!data.email && !EMAIL_RE.test(data.email);
    if (emailBad) bad.email = true;
    var dateBad = !!data.date && data.date < todayISO();
    if (dateBad) bad.date = true;

    REQUIRED.forEach(function (k) { setInvalid(k, !!bad[k]); });

    var parts = [];
    if (missing.length) parts.push('Please add ' + joinList(missing) + '.');
    if (emailBad) parts.push('Your email address should look like name@example.com.');
    if (dateBad) parts.push('Pick a pickup date from today onwards.');
    return { ok: parts.length === 0, message: parts.join(' '), bad: bad };
  }

  function focusFirstInvalid(bad) {
    for (var i = 0; i < REQUIRED.length; i++) {
      if (bad[REQUIRED[i]]) { field(REQUIRED[i]).focus(); return; }
    }
  }

  function showConfirmation(data, id, emailWarning) {
    var values = {
      name: data.name,
      email: data.email,
      pickup: data.pickup,
      destination: data.destination,
      when: whenLabel(data.date, data.time),
      language: data.language || 'English',
      id: id || '—'
    };
    confirmBox.querySelectorAll('[data-c]').forEach(function (el) {
      el.textContent = values[el.getAttribute('data-c')] || '';
    });
    var emailStatus = document.getElementById('confirm-email-status');
    emailStatus.textContent = emailWarning
      ? 'Your request is saved, but we could not confirm the email was delivered. Our team will follow up with your ride details.'
      : "We've sent a confirmation to " + data.email + ". You'll receive another email with your ride details once we've confirmed your rider and fare.";
    form.hidden = true;
    confirmBox.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    confirmBox.focus({ preventScroll: true });
  }

  form.addEventListener('input', function (e) {
    var el = e.target;
    if (el.classList && el.classList.contains('is-invalid') && String(el.value).trim()) {
      setInvalid(el.name, false);
      if (!form.querySelector('.is-invalid')) showError('');
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;

    var data = readForm();
    var check = validate(data);
    if (!check.ok) {
      showError(check.message);
      focusFirstInvalid(check.bad);
      return;
    }
    showError('');
    setSending(true);

    fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (out) { return { res: res, out: out }; });
      })
      .then(function (r) {
        if (r.res.ok && r.out && r.out.ok) {
          showConfirmation(data, r.out.id, r.out.emailWarning);
          return;
        }
        if (r.out && r.out.error === 'invalid' && Array.isArray(r.out.fields) && r.out.fields.length) {
          r.out.fields.forEach(function (k) { setInvalid(k, true); });
          showError('Please check the highlighted details and try again.');
          return;
        }
        showError("We couldn't send your request just now. Please try again in a minute.");
      })
      .catch(function () {
        showError("We couldn't reach Biken. Check your internet connection and try again.");
      })
      .then(function () { setSending(false); });
  });

  againBtn.addEventListener('click', function () {
    form.reset();
    REQUIRED.forEach(function (k) { setInvalid(k, false); });
    showError('');
    confirmBox.hidden = true;
    form.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    field('name').focus({ preventScroll: true });
  });
})();
