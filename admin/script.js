const $ = (selector) => document.querySelector(selector);
const loginScreen = $('#login-screen');
const dashboard = $('#dashboard');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const loginErrorText = $('#login-error-text');
const modal = $('#request-modal');
const modalBody = $('#modal-body');
const modalSave = $('#modal-save');
const modalConfirm = $('#modal-confirm');
const PAGE_SIZE = 20;
let currentPage = 0;
let currentRequest = null;
let searchTimer = null;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.ok !== true) {
    const error = new Error(result && result.error === 'unauthorized'
      ? 'Your session has ended. Please sign in again.'
      : 'The request could not be completed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function showLogin(message = '') {
  dashboard.hidden = true;
  loginScreen.hidden = false;
  loginErrorText.textContent = message;
  loginError.hidden = !message;
}

function showDashboard(user) {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  const name = user.name || user.email;
  $('#user-name').textContent = name;
  $('#user-avatar').textContent = name.trim().charAt(0).toUpperCase();
  $('#dropdown-name').textContent = name;
  $('#dropdown-email').textContent = user.email;
  setTab(location.hash === '#requests' ? 'requests' : 'dashboard');
}

function setTab(tab) {
  const selected = tab === 'requests' ? 'requests' : 'dashboard';
  document.querySelectorAll('[data-tab]').forEach((link) => {
    const active = link.dataset.tab === selected;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${selected}`);
  });
  if (selected === 'dashboard') loadDashboard();
  else {
    currentPage = 0;
    loadRequests();
  }
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  $('#toast-container').append(element);
  window.setTimeout(() => element.remove(), 4500);
}

function dateLabel(date) {
  if (!date) return '—';
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return escapeHtml(date);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function dateTimeLabel(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

function statusBadge(status) {
  const key = String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  return `<span class="status status-${key}">${escapeHtml(status)}</span>`;
}

async function loadDashboard() {
  try {
    const { stats } = await api('/api/dashboard');
    ['total', 'new', 'confirmed', 'completed', 'today', 'thisWeek'].forEach((key) => {
      const id = key === 'thisWeek' ? 'stat-week' : `stat-${key}`;
      $(`#${id}`).textContent = stats[key];
    });
    $('#recent-tbody').innerHTML = stats.recentRequests.length
      ? stats.recentRequests.map((request) => `<tr>
          <td class="cell-main">${escapeHtml(request.id)}</td>
          <td>${escapeHtml(request.name)}</td>
          <td class="route-cell"><span>${escapeHtml(request.pickup)}</span><span class="cell-sub">to ${escapeHtml(request.destination)}</span></td>
          <td>${dateLabel(request.date)}<div class="cell-sub">${escapeHtml(request.time)}</div></td>
          <td>${statusBadge(request.status)}</td>
          <td>${dateTimeLabel(request.submitted_at)}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty-cell">No ride requests yet.</td></tr>';
  } catch (error) {
    if (error.status === 401) return showLogin(error.message);
    toast(error.message, 'error');
  }
}

function dateRange() {
  const range = $('#date-filter').value;
  if (!range) return {};
  const today = new Date();
  const toIso = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (range === 'week') from.setDate(from.getDate() - 6);
  if (range === 'month') from.setDate(1);
  return { dateFrom: toIso(from), dateTo: toIso(today) };
}

function renderRequests(requests) {
  $('#requests-tbody').innerHTML = requests.length
    ? requests.map((request) => `<tr>
        <td class="cell-main">${escapeHtml(request.id)}</td>
        <td><span class="cell-main">${escapeHtml(request.name)}</span><div class="cell-sub">${escapeHtml(request.email)}</div></td>
        <td><span>${escapeHtml(request.phone)}</span></td>
        <td class="route-cell"><span>${escapeHtml(request.pickup)}</span><span class="cell-sub">to ${escapeHtml(request.destination)}</span></td>
        <td>${dateLabel(request.date)}<div class="cell-sub">${escapeHtml(request.time)}</div></td>
        <td>${escapeHtml(request.language)}</td>
        <td>${statusBadge(request.status)}</td>
        <td>${escapeHtml(request.rider || '—')}<div class="cell-sub">${request.fare == null ? 'Fare not set' : `${Number(request.fare).toLocaleString()} RWF`}</div></td>
        <td><button class="btn btn-ghost btn-sm" type="button" data-open-request="${escapeHtml(request.id)}">Manage</button></td>
      </tr>`).join('')
    : '<tr><td colspan="9" class="empty-cell">No requests match these filters.</td></tr>';
}

async function loadRequests() {
  $('#requests-tbody').innerHTML = '<tr><td colspan="9"><div class="table-loading">Loading requests…</div></td></tr>';
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(currentPage * PAGE_SIZE)
  });
  const status = $('#status-filter').value;
  const search = $('#request-search').value.trim();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const dates = dateRange();
  if (dates.dateFrom) params.set('dateFrom', dates.dateFrom);
  if (dates.dateTo) params.set('dateTo', dates.dateTo);

  try {
    const { requests, count } = await api(`/api/requests?${params.toString()}`);
    renderRequests(requests);
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    $('#pagination').hidden = count <= PAGE_SIZE;
    $('#page-info').textContent = `Page ${currentPage + 1} of ${pageCount}`;
    $('#prev-page').disabled = currentPage === 0;
    $('#next-page').disabled = currentPage + 1 >= pageCount;
  } catch (error) {
    if (error.status === 401) return showLogin(error.message);
    $('#requests-tbody').innerHTML = '<tr><td colspan="9" class="empty-cell">Could not load requests.</td></tr>';
    toast(error.message, 'error');
  }
}

function openRequest(request) {
  currentRequest = request;
  $('#modal-title').textContent = `Request ${request.id}`;
  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><span>Customer</span><strong>${escapeHtml(request.name)}</strong></div>
      <div class="detail-item"><span>Contact</span><strong>${escapeHtml(request.email)}<br>${escapeHtml(request.phone)}</strong></div>
      <div class="detail-item"><span>Pickup</span><strong>${escapeHtml(request.pickup)}</strong></div>
      <div class="detail-item"><span>Destination</span><strong>${escapeHtml(request.destination)}</strong></div>
      <div class="detail-item"><span>Pickup time</span><strong>${dateLabel(request.date)} · ${escapeHtml(request.time)}</strong></div>
      <div class="detail-item"><span>Language</span><strong>${escapeHtml(request.language)}</strong></div>
      <div class="detail-item"><span>Submitted</span><strong>${dateTimeLabel(request.submitted_at)}</strong></div>
    </div>
    <form id="request-edit-form" class="edit-grid">
      <div class="field"><label for="edit-status">Status</label><select class="input" id="edit-status" name="status">
        ${['New', 'Finding rider', 'Confirmed', 'Completed', 'Cancelled'].map((status) =>
          `<option value="${status}" ${request.status === status ? 'selected' : ''}>${status}</option>`).join('')}
      </select></div>
      <div class="field"><label for="edit-rider">Rider name</label><input class="input" id="edit-rider" name="rider" maxlength="200" value="${escapeHtml(request.rider || '')}"></div>
      <div class="field"><label for="edit-rider-phone">Rider phone</label><input class="input" id="edit-rider-phone" name="rider_phone" maxlength="40" value="${escapeHtml(request.rider_phone || '')}"></div>
      <div class="field"><label for="edit-fare">Fare (RWF)</label><input class="input" id="edit-fare" name="fare" type="number" min="0" step="1" value="${request.fare == null ? '' : Number(request.fare)}"></div>
      <div class="field full-width"><label for="edit-notes">Coordinator notes</label><textarea class="input" id="edit-notes" name="notes" rows="3" maxlength="500">${escapeHtml(request.notes || '')}</textarea></div>
    </form>`;
  modal.hidden = false;
  modalSave.hidden = false;
  modalConfirm.hidden = request.status !== 'Confirmed' || !request.rider || request.fare == null;
  modal.querySelector('.modal-close').focus();
}

function closeModal() {
  modal.hidden = true;
  currentRequest = null;
}

async function updateRequest(sendConfirmation = false) {
  if (!currentRequest) return;
  const form = $('#request-edit-form');
  const data = Object.fromEntries(new FormData(form).entries());
  const fareValue = data.fare.trim();
  const payload = {
    status: data.status,
    rider: data.rider.trim(),
    rider_phone: data.rider_phone.trim(),
    fare: fareValue === '' ? null : Number(fareValue),
    notes: data.notes.trim(),
    ...(sendConfirmation ? { send_confirmation: true } : {})
  };
  modalSave.disabled = true;
  modalConfirm.disabled = true;
  try {
    const result = await api(`/api/requests?id=${encodeURIComponent(currentRequest.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    if (sendConfirmation) {
      toast(result.emailSent ? 'Confirmation email sent.' : 'Ride was saved, but the confirmation email failed.', result.emailSent ? 'success' : 'error');
    } else {
      toast('Ride request updated.', 'success');
    }
    closeModal();
    loadRequests();
    loadDashboard();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    modalSave.disabled = false;
    modalConfirm.disabled = false;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-btn');
  button.disabled = true;
  loginError.hidden = true;
  const fields = new FormData(loginForm);
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') })
    });
    loginForm.reset();
    showDashboard(user);
  } catch (error) {
    loginErrorText.textContent = error.status === 401
      ? 'That email and password do not match an admin account.'
      : 'Could not sign in right now. Please try again.';
    loginError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('[data-tab]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const tab = link.dataset.tab;
    history.replaceState(null, '', `#${tab}`);
    setTab(tab);
  });
});
$('#user-btn').addEventListener('click', () => {
  const dropdown = $('#user-dropdown');
  dropdown.hidden = !dropdown.hidden;
  $('#user-btn').setAttribute('aria-expanded', String(!dropdown.hidden));
});
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (error) { toast(error.message, 'error'); }
  showLogin();
});
$('#request-search').addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  currentPage = 0;
  searchTimer = window.setTimeout(loadRequests, 250);
});
$('#status-filter').addEventListener('change', () => { currentPage = 0; loadRequests(); });
$('#date-filter').addEventListener('change', () => { currentPage = 0; loadRequests(); });
$('#prev-page').addEventListener('click', () => { currentPage = Math.max(0, currentPage - 1); loadRequests(); });
$('#next-page').addEventListener('click', () => { currentPage += 1; loadRequests(); });
$('#requests-tbody').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-open-request]');
  if (!button) return;
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(currentPage * PAGE_SIZE) });
  const search = $('#request-search').value.trim();
  if (search) params.set('search', search);
  const status = $('#status-filter').value;
  if (status) params.set('status', status);
  const dates = dateRange();
  if (dates.dateFrom) params.set('dateFrom', dates.dateFrom);
  if (dates.dateTo) params.set('dateTo', dates.dateTo);
  try {
    const { requests } = await api(`/api/requests?${params.toString()}`);
    const request = requests.find((item) => item.id === button.dataset.openRequest);
    if (request) openRequest(request);
  } catch (error) {
    if (error.status === 401) return showLogin(error.message);
    toast(error.message, 'error');
  }
});
$('#modal-save').addEventListener('click', () => updateRequest(false));
$('#modal-confirm').addEventListener('click', () => updateRequest(true));
$('#modal-close').addEventListener('click', closeModal);
$('#modal-cancel').addEventListener('click', closeModal);
$('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
  if (event.key === 'Escape') $('#user-dropdown').hidden = true;
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.user-menu')) $('#user-dropdown').hidden = true;
});

api('/api/auth/me')
  .then(({ user }) => showDashboard(user))
  .catch((error) => showLogin(error.status === 401 ? '' : 'Could not connect to the admin service.'));
