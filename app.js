// ============================================================
// הגדרות חיבור - יש להחליף בפרטי הפרויקט שלך ב-Supabase
// ============================================================
const SUPABASE_URL = 'https://qxqrqfwkvovlwyqnpjgr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pUoh7aPHbENXIoSP1uLnsQ_dVXizlCz';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const ROLE_LABELS = { photographer: 'צלם', recorder: 'מקליט', manager: 'מנהל' };
const STATUS_LABELS = { open: 'פתוח', submitted: 'ממתין לאישור', approved: 'מאושר', rejected: 'נדחה' };
const STATUS_BADGE = { open: 'badge-open', submitted: 'badge-submitted', approved: 'badge-approved', rejected: 'badge-rejected' };

// ============================================================
// חיבור נוסף (קריאה בלבד) לפרויקט tzalamim-schedule - לבדיקת התאמה לסידור העבודה
// ============================================================
const TZALAMIM_URL = 'https://zcklavyanuqjjvuzemvy.supabase.co';
const TZALAMIM_KEY = 'sb_publishable_NS10PJJwfAKNNezDXMLkVw_xOETnrA7';
const sbTz = supabase.createClient(TZALAMIM_URL, TZALAMIM_KEY);

function normalizeName(n) {
  return (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// יום ראשון (week_start) + אינדקס יום (0=ראשון...6=שבת) לתאריך נתון
function getWeekStartAndDayIndex(year, month, day) {
  const d = new Date(year, month - 1, day);
  const dayIndex = d.getDay(); // 0=Sunday
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - dayIndex);
  const iso = sunday.toISOString().slice(0, 10);
  return { weekStart: iso, dayIndex };
}

// בדיקה האם משמרת נתונה קיימת בסידור העבודה של tzalamim עבור אותו עובד/תאריך
async function checkShiftInRoster(fullName, year, month, day) {
  const { weekStart, dayIndex } = getWeekStartAndDayIndex(year, month, day);
  const { data, error } = await sbTz.from('shifts')
    .select('freelance_name, freelance_recorder_name, label, region, start_time, end_time')
    .eq('week_start', weekStart).eq('day_of_week', dayIndex);
  if (error || !data) return { found: null, reason: 'שגיאה בבדיקה' };
  const target = normalizeName(fullName);
  const match = data.find(s => normalizeName(s.freelance_name) === target || normalizeName(s.freelance_recorder_name) === target);
  return { found: !!match, match };
}

let currentUser = null;   // { id, email }

let currentProfile = null; // { full_name, role }
let rateSettings = null;
let currentReport = null;  // דוח פתוח שנצפה כרגע
let currentShifts = [];
let editingShiftId = null;

// ---- עזרי שעה (dropdown שעה:דקה, פורמט 24 שעות תמיד) ----
function populateTimeSelects() {
  const hourOptions = Array.from({length: 24}, (_,i) => String(i).padStart(2,'0'));
  const minOptions = ['00','15','30','45'];
  ['shift-start-h','shift-end-h'].forEach(id => {
    document.getElementById(id).innerHTML = hourOptions.map(h => `<option value="${h}">${h}</option>`).join('');
  });
  ['shift-start-m','shift-end-m'].forEach(id => {
    document.getElementById(id).innerHTML = minOptions.map(m => `<option value="${m}">${m}</option>`).join('');
  });
}
function setTimeValue(prefix, hhmm) {
  const [h, m] = (hhmm || '00:00').split(':');
  document.getElementById(prefix + '-h').value = h;
  const roundedMin = ['00','15','30','45'].includes(m) ? m : '00';
  document.getElementById(prefix + '-m').value = roundedMin;
}
function getTimeValue(prefix) {
  return document.getElementById(prefix + '-h').value + ':' + document.getElementById(prefix + '-m').value;
}


// ============================================================
// אתחול
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadProfileAndRoute();
  }
});

async function loadProfileAndRoute() {
  const { data, error } = await sb.from('fl_profiles').select('*').eq('id', currentUser.id).single();
  if (error || !data) { showToast('שגיאה בטעינת פרופיל', true); return; }
  currentProfile = data;

  const { data: rates } = await sb.from('fl_rate_settings').select('*').eq('id', 1).single();
  rateSettings = rates;

  if (currentProfile.role === 'manager') {
    showScreen('screen-admin');
    loadAdminPending();
  } else {
    showScreen('screen-dashboard');
    document.getElementById('db-name').textContent = currentProfile.full_name;
    document.getElementById('db-role').textContent = ROLE_LABELS[currentProfile.role];
    loadDashboard();
  }
}

function showScreen(id) {
  ['screen-auth','screen-dashboard','screen-report','screen-admin'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function showToast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openModalEl(id) { document.getElementById(id).classList.remove('hidden'); }

// ============================================================
// הרשמה / התחברות
// ============================================================
function showRegister() {
  document.getElementById('login-box').classList.add('hidden');
  document.getElementById('register-box').classList.remove('hidden');
}
function showLogin() {
  document.getElementById('register-box').classList.add('hidden');
  document.getElementById('login-box').classList.remove('hidden');
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  if (!name || !email || !password || !role) { showToast('נא למלא את כל השדות', true); return; }

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { showToast(error.message, true); return; }

  const uid = data.user.id;
  const { error: profileErr } = await sb.from('fl_profiles').insert({ id: uid, full_name: name, email, role });
  if (profileErr) { showToast('שגיאה ביצירת פרופיל: ' + profileErr.message, true); return; }

  showToast('החשבון נוצר בהצלחה!');
  currentUser = data.user;
  await loadProfileAndRoute();
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showToast('התחברות נכשלה: ' + error.message, true); return; }
  currentUser = data.user;
  await loadProfileAndRoute();
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null; currentProfile = null;
  showScreen('screen-auth'); showLogin();
}

// ============================================================
// דשבורד עובד
// ============================================================
async function loadDashboard() {
  const { data: reports } = await sb.from('fl_reports')
    .select('*, shifts:fl_shifts(count)')
    .eq('worker_id', currentUser.id)
    .order('year', { ascending: false }).order('month', { ascending: false });

  const open = (reports || []).filter(r => r.status === 'open');
  const history = (reports || []).filter(r => r.status !== 'open');

  const openBox = document.getElementById('open-reports');
  openBox.innerHTML = open.length ? '' : '<div class="empty-box">אין דוחות פתוחים. לחץ על "פתח דוח חודשי חדש" כדי להתחיל.</div>';
  open.forEach(r => {
    const count = r.shifts?.[0]?.count ?? 0;
    openBox.innerHTML += `<div class="report-item" onclick="openReport('${r.id}')">
      <span>${MONTH_NAMES[r.month-1]} ${r.year}</span>
      <span style="color:var(--muted);font-size:13px;">${count} משמרות ←</span>
    </div>`;
  });

  const histBox = document.getElementById('history-reports');
  histBox.innerHTML = history.length ? '' : '<div class="empty-box">עדיין לא הוגשו דוחות</div>';
  history.forEach(r => {
    const count = r.shifts?.[0]?.count ?? 0;
    histBox.innerHTML += `<div class="report-item" onclick="openReport('${r.id}')">
      <span>${MONTH_NAMES[r.month-1]} ${r.year} <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span></span>
      <span style="color:var(--muted);font-size:13px;">${count} משמרות</span>
    </div>`;
  });
}

function openNewReportModal() {
  const monthSel = document.getElementById('new-report-month');
  const yearSel = document.getElementById('new-report-year');
  monthSel.innerHTML = MONTH_NAMES.map((m,i) => `<option value="${i+1}">${m}</option>`).join('');
  const now = new Date();
  monthSel.value = now.getMonth() + 1;
  let yearsHtml = '';
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) yearsHtml += `<option value="${y}">${y}</option>`;
  yearSel.innerHTML = yearsHtml;
  yearSel.value = now.getFullYear();
  openModalEl('modal-newreport');
}

async function createReport() {
  const month = parseInt(document.getElementById('new-report-month').value);
  const year = parseInt(document.getElementById('new-report-year').value);
  const { data, error } = await sb.from('fl_reports').insert({ worker_id: currentUser.id, month, year, status: 'open' }).select().single();
  if (error) { showToast(error.code === '23505' ? 'כבר קיים דוח לחודש זה' : error.message, true); return; }
  closeModal('modal-newreport');
  openReport(data.id);
}

// ============================================================
// מסך דוח בודד
// ============================================================
async function openReport(reportId) {
  const { data: report } = await sb.from('fl_reports').select('*').eq('id', reportId).single();
  currentReport = report;
  await loadShifts();
  showScreen('screen-report');
  renderReportScreen();
}

function goDashboard() { currentReport = null; showScreen('screen-dashboard'); loadDashboard(); }

async function loadShifts() {
  const { data } = await sb.from('fl_shifts').select('*').eq('report_id', currentReport.id).order('day_of_month');
  currentShifts = data || [];
}

function monthHasEnded(year, month) {
  // מותר להגיש רק החל מהיום הראשון של החודש שאחרי החודש המדווח
  const now = new Date();
  const firstOfNextMonth = new Date(year, month, 1); // month כאן כבר 1-based, אז month=הבא ב-Date (0-based)
  return now >= firstOfNextMonth;
}

function renderReportScreen() {
  const isOpen = currentReport.status === 'open';
  const canSubmit = monthHasEnded(currentReport.year, currentReport.month);
  document.getElementById('report-title').textContent = `${MONTH_NAMES[currentReport.month-1]} ${currentReport.year}`;
  document.getElementById('report-count').textContent = `${currentShifts.length} משמרות`;
  document.getElementById('report-badge').innerHTML = `<span class="badge ${STATUS_BADGE[currentReport.status]}">${STATUS_LABELS[currentReport.status]}</span>`;

  document.getElementById('add-shift-btn').classList.toggle('hidden', !isOpen);
  const submitBtn = document.getElementById('submit-report-btn');
  submitBtn.classList.toggle('hidden', !isOpen || currentShifts.length === 0);
  if (isOpen && currentShifts.length > 0) {
    submitBtn.disabled = !canSubmit;
    submitBtn.style.opacity = canSubmit ? '1' : '0.5';
    submitBtn.style.cursor = canSubmit ? 'pointer' : 'not-allowed';
    submitBtn.textContent = canSubmit ? '🔒 נעל ושלח דוח' : `🔒 ניתן להגיש רק החל מ-1/${(currentReport.month % 12) + 1}/${currentReport.month === 12 ? currentReport.year + 1 : currentReport.year}`;
  }

  const list = document.getElementById('shifts-list');
  document.getElementById('no-shifts').classList.toggle('hidden', currentShifts.length > 0);
  list.innerHTML = '';
  let totalHours = 0, totalBefore = 0;

  currentShifts.forEach(s => {
    const r = calcShift({
      role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: s.day_of_month,
      dayType: s.day_type, startTime: s.start_time, endTime: s.end_time, km: s.km, extraEquipment: s.extra_equipment, season: s.season
    }, rateSettings);
    totalHours += r.totalHours; totalBefore += r.beforeVat;
    const dateStr = `${s.day_of_month}/${currentReport.month}/${currentReport.year}`;
    const dowLabel = r.isSaturday ? 'שבת' : r.isFriday ? 'שישי' : '';
    list.innerHTML += `<div class="shift-item">
      <div class="shift-actions">
        ${isOpen ? `<button class="icon-btn" onclick="deleteShift('${s.id}')">🗑️</button>
        <button class="icon-btn" onclick="openShiftModal('${s.id}')">✏️</button>` : ''}
      </div>
      <div style="text-align:left;">
        <div><span class="shift-amount">₪${r.beforeVat.toLocaleString()}</span> — ${s.location || ''}</div>
        <div class="shift-meta">${dowLabel ? dowLabel + ' – ' : ''}${dateStr} · ${s.start_time}-${s.end_time} · ${dayTypeLabel(s.day_type)}${s.km > 0 ? ' · ' + s.km + ' ק"מ' : ''}${s.extra_equipment ? ' · ' + equipmentLabel(s.extra_equipment) : ''}</div>
      </div>
    </div>`;
  });

  document.getElementById('sum-hours').textContent = totalHours.toFixed(1);
  document.getElementById('sum-count').textContent = currentShifts.length;
  document.getElementById('sum-before').textContent = '₪' + totalBefore.toLocaleString(undefined, {maximumFractionDigits:2});
  const vat = totalBefore * (rateSettings.vat_percent / 100);
  document.getElementById('sum-vat').textContent = '₪' + (totalBefore + vat).toLocaleString(undefined, {maximumFractionDigits:2});

  const statusBox = document.getElementById('report-status-box');
  statusBox.innerHTML = '';
  if (currentReport.status === 'rejected' && currentReport.manager_note) {
    statusBox.innerHTML = `<div class="card" style="border-color:#fecaca;background:#fef2f2;margin-top:14px;"><strong>הדוח הוחזר לתיקון:</strong><br>${currentReport.manager_note}</div>`;
  }
}

function dayTypeLabel(t) { return { regular:'יום רגיל', chag_eve:'ערב חג', chag:'חג', election:'יום בחירות' }[t] || t; }
function equipmentLabel(v) { return currentProfile.role === 'photographer' ? 'מצלמה שנייה' : `${v} אלחוטי נוסף`; }

// ---- מודל משמרת ----
function openShiftModal(shiftId) {
  editingShiftId = shiftId || null;
  populateTimeSelects();
  const daySel = document.getElementById('shift-day');
  const daysInMonth = new Date(currentReport.year, currentReport.month, 0).getDate();
  daySel.innerHTML = '<option value="">בחר יום</option>' + Array.from({length: daysInMonth}, (_,i)=>i+1).map(d => `<option value="${d}">${d}</option>`).join('');

  document.getElementById('shift-modal-title').textContent = shiftId ? 'עריכת משמרת' : 'משמרת חדשה';
  document.getElementById('shift-modal-sub').textContent = `${MONTH_NAMES[currentReport.month-1]} ${currentReport.year}`;

  document.getElementById('km-field').classList.toggle('hidden', currentProfile.role !== 'photographer');
  document.getElementById('camera-field').classList.toggle('hidden', currentProfile.role !== 'photographer');
  document.getElementById('wireless-field').classList.toggle('hidden', currentProfile.role !== 'recorder');

  if (shiftId) {
    const s = currentShifts.find(x => x.id === shiftId);
    daySel.value = s.day_of_month;
    document.getElementById('shift-location').value = s.location || '';
    setTimeValue('shift-start', s.start_time);
    setTimeValue('shift-end', s.end_time);
    document.getElementById('shift-km').value = s.km || 0;
    document.getElementById('shift-camera').checked = !!s.extra_equipment;
    document.getElementById('shift-wireless').value = s.extra_equipment || 0;
    document.getElementById('shift-daytype').value = s.day_type;
    document.getElementById('shift-season').value = s.season;
  } else {
    document.getElementById('shift-location').value = '';
    setTimeValue('shift-start', '09:00');
    setTimeValue('shift-end', '19:00');
    document.getElementById('shift-km').value = 0;
    document.getElementById('shift-camera').checked = false;
    document.getElementById('shift-wireless').value = 0;
    document.getElementById('shift-daytype').value = 'regular';
    document.getElementById('shift-season').value = defaultSeason();
  }
  updateShiftPreview();
  openModalEl('modal-shift');
}

function defaultSeason() {
  const m = currentReport.month;
  return (m >= 4 && m <= 9) ? 'summer' : 'winter'; // אפריל-ספטמבר קיץ (הערכה, ניתן לשנות ידנית)
}

['shift-day','shift-start-h','shift-start-m','shift-end-h','shift-end-m','shift-km','shift-camera','shift-wireless','shift-daytype','shift-season'].forEach(id => {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateShiftPreview);
    if (el) el.addEventListener('change', updateShiftPreview);
  });
});

function updateShiftPreview() {
  const day = parseInt(document.getElementById('shift-day').value);
  const start = getTimeValue('shift-start');
  const end = getTimeValue('shift-end');
  const preview = document.getElementById('shift-preview');
  if (!day || !start || !end || !currentReport) { preview.textContent = ''; return; }
  const extra = currentProfile.role === 'photographer'
    ? (document.getElementById('shift-camera').checked ? 1 : 0)
    : parseInt(document.getElementById('shift-wireless').value);
  const r = calcShift({
    role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: day,
    dayType: document.getElementById('shift-daytype').value, startTime: start, endTime: end,
    km: parseFloat(document.getElementById('shift-km').value) || 0, extraEquipment: extra,
    season: document.getElementById('shift-season').value
  }, rateSettings);
  preview.textContent = `סכום משוער (לפני מע"מ): ₪${r.beforeVat.toLocaleString()}`;
}

async function saveShift() {
  const day = parseInt(document.getElementById('shift-day').value);
  const start = getTimeValue('shift-start');
  const end = getTimeValue('shift-end');
  if (!day || !start || !end) { showToast('נא למלא יום ושעות', true); return; }

  const extra = currentProfile.role === 'photographer'
    ? (document.getElementById('shift-camera').checked ? 1 : 0)
    : parseInt(document.getElementById('shift-wireless').value);

  const payload = {
    report_id: currentReport.id,
    day_of_month: day,
    location: document.getElementById('shift-location').value.trim(),
    start_time: start, end_time: end,
    km: parseFloat(document.getElementById('shift-km').value) || 0,
    extra_equipment: extra,
    day_type: document.getElementById('shift-daytype').value,
    season: document.getElementById('shift-season').value,
  };
  const r = calcShift({ role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: day,
    dayType: payload.day_type, startTime: start, endTime: end, km: payload.km, extraEquipment: extra, season: payload.season }, rateSettings);
  payload.amount_before_vat = r.beforeVat;

  let error;
  if (editingShiftId) {
    ({ error } = await sb.from('fl_shifts').update(payload).eq('id', editingShiftId));
  } else {
    ({ error } = await sb.from('fl_shifts').insert(payload));
  }
  if (error) { showToast('שגיאה בשמירה: ' + error.message, true); return; }
  closeModal('modal-shift');
  await loadShifts();
  renderReportScreen();
}

async function deleteShift(id) {
  const { error } = await sb.from('fl_shifts').delete().eq('id', id);
  if (error) { showToast('שגיאה במחיקה', true); return; }
  await loadShifts();
  renderReportScreen();
}

function confirmSubmit() {
  if (!monthHasEnded(currentReport.year, currentReport.month)) {
    showToast('ניתן להגיש דוח רק לאחר שהחודש הסתיים', true);
    return;
  }
  document.getElementById('confirm-title').textContent = 'הגשת דוח חודשי';
  document.getElementById('confirm-sub').textContent = 'האם אתה בטוח שברצונך לנעול את החודש ולהגיש את הדוח?';
  document.getElementById('confirm-yes-btn').onclick = submitReport;
  openModalEl('modal-confirm');
}

async function submitReport() {
  closeModal('modal-confirm');
  const { error } = await sb.from('fl_reports').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', currentReport.id);
  if (error) { showToast('שגיאה בהגשה', true); return; }
  currentReport.status = 'submitted';
  renderReportScreen();
  showToast('הדוח ננעל ונשלח לאישור ✓');
  sendSubmissionEmail();
}

// ---- התראת מייל למנהל (EmailJS) ----
const EMAILJS_PUBLIC_KEY = 'YOUR_EMAILJS_PUBLIC_KEY';
const EMAILJS_SERVICE_ID = 'service_dnvy6p8'; // אותו שירות כמו ב-tzalamim
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID'; // template ייעודי לדוח פרילנס
const MANAGER_EMAIL = 'shlomoa@kan.org.il';
const CC_EMAIL = 'efratn@kan.org.il';

async function sendSubmissionEmail() {
  if (typeof emailjs === 'undefined') return; // ה-SDK לא נטען
  const totalBefore = currentShifts.reduce((sum, s) => {
    const r = calcShift({ role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: s.day_of_month,
      dayType: s.day_type, startTime: s.start_time, endTime: s.end_time, km: s.km, extraEquipment: s.extra_equipment, season: s.season }, rateSettings);
    return sum + r.beforeVat;
  }, 0);
  const vat = totalBefore * (rateSettings.vat_percent / 100);
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: MANAGER_EMAIL,
      cc_email: CC_EMAIL,
      freelancer_name: currentProfile.full_name,
      role_label: ROLE_LABELS[currentProfile.role],
      month_label: `${MONTH_NAMES[currentReport.month-1]} ${currentReport.year}`,
      shifts_count: currentShifts.length,
      total_before_vat: totalBefore.toLocaleString(undefined, {maximumFractionDigits:2}),
      total_with_vat: (totalBefore + vat).toLocaleString(undefined, {maximumFractionDigits:2}),
      report_link: window.location.href,
    }, EMAILJS_PUBLIC_KEY);
  } catch (e) {
    console.error('שליחת מייל נכשלה', e); // לא חוסם את המשתמש אם המייל נכשל
  }
}

function confirmDeleteReport() {
  document.getElementById('confirm-title').textContent = 'מחיקת חודש';
  document.getElementById('confirm-sub').textContent = 'פעולה זו תמחק את כל המשמרות בחודש זה לצמיתות. להמשיך?';
  document.getElementById('confirm-yes-btn').onclick = deleteReport;
  openModalEl('modal-confirm');
}

async function deleteReport() {
  closeModal('modal-confirm');
  const { error } = await sb.from('fl_reports').delete().eq('id', currentReport.id);
  if (error) { showToast('שגיאה במחיקה', true); return; }
  goDashboard();
}

// ============================================================
// מסך ניהול (מנהל)
// ============================================================
function switchAdminTab(tab) {
  ['pending','all','rates'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === tab);
    document.getElementById('admin-'+t).classList.toggle('hidden', t !== tab);
  });
  if (tab === 'pending') loadAdminPending();
  if (tab === 'all') loadAdminAll();
  if (tab === 'rates') loadAdminRates();
}

async function loadAdminPending() {
  const { data } = await sb.from('fl_reports')
    .select('*, profiles:fl_profiles(full_name, role), shifts:fl_shifts(*)')
    .eq('status', 'submitted').order('submitted_at');
  renderAdminReportList(data || [], 'admin-pending', true);
}

async function loadAdminAll() {
  const { data } = await sb.from('fl_reports')
    .select('*, profiles:fl_profiles(full_name, role), shifts:fl_shifts(*)')
    .order('year', { ascending: false }).order('month', { ascending: false });
  renderAdminReportList(data || [], 'admin-all', false);
}

function renderAdminReportList(reports, containerId, showActions) {
  const box = document.getElementById(containerId);
  if (!reports.length) { box.innerHTML = '<div class="empty-box">אין דוחות להצגה</div>'; return; }
  box.innerHTML = reports.map(r => {
    const total = (r.shifts || []).reduce((s,x) => s + Number(x.amount_before_vat || 0), 0);
    const vat = total * (rateSettings.vat_percent/100);
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;cursor:pointer;" onclick="toggleAdminDetails('${r.id}')">
        <div>
          <strong>${r.profiles.full_name}</strong> <span class="badge" style="background:#eee;color:#555;">${ROLE_LABELS[r.profiles.role]}</span><br>
          <span style="color:var(--muted);font-size:13px;">${MONTH_NAMES[r.month-1]} ${r.year} · ${r.shifts.length} משמרות · <span class="link">פירוט חישוב ▾</span></span>
        </div>
        <div style="text-align:left;">
          <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span><br>
          <strong>₪${(total+vat).toLocaleString(undefined,{maximumFractionDigits:0})}</strong>
        </div>
      </div>
      <div id="admin-details-${r.id}" class="hidden" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;"></div>
      ${showActions ? `<div class="row" style="margin-top:14px;">
        <button class="btn btn-sm btn-primary" style="flex:1;" onclick="approveReport('${r.id}')">✓ אישור</button>
        <button class="btn btn-sm btn-danger" style="flex:1;" onclick="rejectReportPrompt('${r.id}')">↩ בקשת תיקון</button>
      </div>` : ''}
    </div>`;
  }).join('');
  window._adminReportsCache = window._adminReportsCache || {};
  reports.forEach(r => window._adminReportsCache[r.id] = r);
}

function toggleAdminDetails(reportId) {
  const box = document.getElementById('admin-details-' + reportId);
  const isHidden = box.classList.contains('hidden');
  box.classList.toggle('hidden');
  if (isHidden && !box.dataset.loaded) {
    const report = window._adminReportsCache[reportId];
    box.innerHTML = report.shifts.sort((a,b)=>a.day_of_month-b.day_of_month).map(s => renderShiftBreakdown(report, s)).join('');
    box.dataset.loaded = '1';
    // בדיקת התאמה לסידור העבודה (tzalamim) - נטען ברקע ומתעדכן בדף
    report.shifts.forEach(s => {
      checkShiftInRoster(report.profiles.full_name, report.year, report.month, s.day_of_month).then(res => {
        const el = document.getElementById(`roster-check-${s.id}`);
        if (!el) return;
        if (res.found === null) { el.innerHTML = `<span style="color:var(--muted);">⚠️ לא ניתן לבדוק</span>`; return; }
        el.innerHTML = res.found
          ? `<span style="color:var(--green);">✓ נמצא בסידור העבודה</span>`
          : `<span style="color:var(--red);font-weight:700;">⚠️ לא נמצא בסידור העבודה לתאריך זה</span>`;
      });
    });
  }
}

function renderShiftBreakdown(report, s) {
  const r = calcShift({
    role: report.profiles.role, year: report.year, month: report.month, dayOfMonth: s.day_of_month,
    dayType: s.day_type, startTime: s.start_time, endTime: s.end_time, km: s.km, extraEquipment: s.extra_equipment, season: s.season
  }, rateSettings);
  const dateStr = `${s.day_of_month}/${report.month}/${report.year}`;
  const dowLabel = r.isSaturday ? 'שבת' : r.isFriday ? 'שישי' : '';
  const rows = r.breakdown.map(b => {
    const clockLabel = String(Math.floor(b.clockHour)).padStart(2,'0') + ':00';
    return `<tr>
      <td>שעה ${b.shiftHourIndex} (${clockLabel})</td>
      <td>${b.finalPct}%</td>
      <td>₪${b.hourPay.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
    </tr>`;
  }).join('');
  return `<div style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;">
    <div style="font-weight:700;margin-bottom:6px;">${dowLabel ? dowLabel + ' – ' : ''}${dateStr} · ${s.start_time}-${s.end_time} · ${dayTypeLabel(s.day_type)}${s.location ? ' · ' + s.location : ''}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead><tr style="color:var(--muted);text-align:right;"><th>שעה</th><th>אחוז</th><th>סכום</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:6px;display:flex;justify-content:space-between;color:var(--muted);">
      <span>שעות: ₪${r.hoursPay.toLocaleString()}</span>
      ${r.equipmentBonus ? `<span>ציוד: ₪${r.equipmentBonus}</span>` : ''}
      ${r.kmPay ? `<span>ק"מ: ₪${r.kmPay.toLocaleString()}</span>` : ''}
      <strong style="color:var(--red);">סה"כ: ₪${r.beforeVat.toLocaleString()}</strong>
    </div>
    <div id="roster-check-${s.id}" style="margin-top:6px;font-size:12.5px;color:var(--muted);">🔄 בודק התאמה לסידור עבודה...</div>
  </div>`;
}

async function approveReport(id) {
  const { error } = await sb.from('fl_reports').update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: currentUser.id }).eq('id', id);
  if (error) { showToast('שגיאה', true); return; }
  showToast('הדוח אושר ✓');
  loadAdminPending();
}

function rejectReportPrompt(id) {
  const note = prompt('הערה לצלם/מקליט (מה צריך לתקן):');
  if (note === null) return;
  rejectReport(id, note);
}

async function rejectReport(id, note) {
  const { error } = await sb.from('fl_reports').update({ status: 'rejected', manager_note: note, decided_at: new Date().toISOString(), decided_by: currentUser.id }).eq('id', id);
  if (error) { showToast('שגיאה', true); return; }
  showToast('הדוח הוחזר לתיקון');
  loadAdminPending();
}

async function loadAdminRates() {
  const box = document.getElementById('admin-rates');
  const r = rateSettings;
  box.innerHTML = `<div class="card">
    ${rateField('תעריף יומי צלם (₪, 10 שעות)','photographer_daily',r.photographer_daily)}
    ${rateField('תעריף יומי מקליט (₪, 10 שעות)','recorder_daily',r.recorder_daily)}
    ${rateField('שעות נוספות שלב 1 (%)','tier1_pct',r.tier1_pct)}
    ${rateField('שעות נוספות שלב 2 (%)','tier2_pct',r.tier2_pct)}
    ${rateField('תעריף לילה (%)','night_pct',r.night_pct)}
    ${rateField('תעריף שבת/חג (%)','chag_shabbat_pct',r.chag_shabbat_pct)}
    ${rateField('תעריף יום בחירות (%)','election_pct',r.election_pct)}
    ${rateField('כניסת שבת/חג - קיץ (שעה)','entry_hour_summer',r.entry_hour_summer)}
    ${rateField('יציאת שבת/חג - קיץ (שעה)','exit_hour_summer',r.exit_hour_summer)}
    ${rateField('כניסת שבת/חג - חורף (שעה)','entry_hour_winter',r.entry_hour_winter)}
    ${rateField('יציאת שבת/חג - חורף (שעה)','exit_hour_winter',r.exit_hour_winter)}
    ${rateField('ק"מ פטורים (ראשונים)','km_free',r.km_free)}
    ${rateField('תעריף לק"מ (₪)','km_rate',r.km_rate)}
    ${rateField('תוספת מצלמה שנייה (₪)','camera_bonus',r.camera_bonus)}
    ${rateField('תוספת אלחוטי (₪ ליחידה)','wireless_bonus',r.wireless_bonus)}
    ${rateField('מקסימום אלחוטי נוסף','wireless_max',r.wireless_max)}
    ${rateField('מע"מ (%)','vat_percent',r.vat_percent)}
    <button class="btn btn-primary" style="margin-top:18px;" onclick="saveRates()">שמור תעריפים</button>
  </div>`;
}

function rateField(label, key, value) {
  return `<div class="rate-field"><label>${label}</label><input type="number" step="0.1" id="rate-${key}" value="${value}"></div>`;
}

async function saveRates() {
  const keys = ['photographer_daily','recorder_daily','tier1_pct','tier2_pct','night_pct','chag_shabbat_pct','election_pct',
    'entry_hour_summer','exit_hour_summer','entry_hour_winter','exit_hour_winter','km_free','km_rate','camera_bonus','wireless_bonus','wireless_max','vat_percent'];
  const payload = {};
  keys.forEach(k => payload[k] = parseFloat(document.getElementById('rate-'+k).value));
  const { error } = await sb.from('fl_rate_settings').update(payload).eq('id', 1);
  if (error) { showToast('שגיאה בשמירה: ' + error.message, true); return; }
  rateSettings = { ...rateSettings, ...payload };
  showToast('התעריפים נשמרו ✓');
}
