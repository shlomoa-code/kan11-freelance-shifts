// ============================================================
// הגדרות חיבור - יש להחליף בפרטי הפרויקט שלך ב-Supabase
// ============================================================
const SUPABASE_URL = 'https://qxqrqfwkvovlwyqnpjgr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pUoh7aPHbENXIoSP1uLnsQ_dVXizlCz';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const ROLE_LABELS = { photographer: 'צלם', recorder: 'מקליט', manager: 'מנהל', accountant: 'הנהלת חשבונות', producer: 'מפיק' };
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
  // בניית מחרוזת תאריך ידנית מרכיבי הזמן המקומי - לא toISOString(),
  // כדי למנוע "גלישה" יום אחורה עקב המרה ל-UTC (בעיה שקורית באזור זמן ישראל)
  const yyyy = sunday.getFullYear();
  const mm = String(sunday.getMonth() + 1).padStart(2, '0');
  const dd = String(sunday.getDate()).padStart(2, '0');
  const iso = `${yyyy}-${mm}-${dd}`;
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
// ---- רענון אוטומטי מדי כמה שבועות ----
// מונע מצב שבו טאב שנשאר פתוח זמן רב מדי ממשיך לרוץ על גרסת קוד ישנה
// (למשל אחרי שאנחנו מעדכנים תיקונים ב-GitHub), גם אם המשתמש לא סוגר/פותח מחדש בעצמו
const PAGE_LOAD_TIME = Date.now();
const AUTO_REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // שבועיים
setInterval(() => {
  if (Date.now() - PAGE_LOAD_TIME > AUTO_REFRESH_AFTER_MS) {
    location.reload();
  }
}, 60 * 60 * 1000); // בדיקה כל שעה

window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadProfileAndRoute();
  }
});

let isFullManager = false; // true רק עבור role==='manager' (הבדל בין מנהל מלא להנה"ח - צפייה בלבד)

async function loadProfileAndRoute() {
  const { data, error } = await sb.from('fl_profiles').select('*').eq('id', currentUser.id).single();
  if (error || !data) { showToast('שגיאה בטעינת פרופיל', true); return; }
  currentProfile = data;

  const { data: rates } = await sb.from('fl_rate_settings').select('*').eq('id', 1).single();
  rateSettings = rates;

  if (currentProfile.role === 'manager' || currentProfile.role === 'accountant') {
    isFullManager = currentProfile.role === 'manager';
    showScreen('screen-admin');
    document.getElementById('admin-role-label').textContent = isFullManager ? 'מנהל' : 'הנהלת חשבונות (צפייה בלבד)';
    ['tab-rates','tab-backup'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !isFullManager);
    });
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
  document.getElementById('mini-logo-bar').classList.toggle('hidden', id === 'screen-auth');
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
    .select('*, shifts:fl_shifts(amount_before_vat, is_deleted)')
    .eq('worker_id', currentUser.id)
    .eq('is_deleted', false)
    .order('year', { ascending: false }).order('month', { ascending: false });

  (reports || []).forEach(r => { r.shifts = (r.shifts || []).filter(s => !s.is_deleted); });

  const open = (reports || []).filter(r => r.status === 'open');
  const history = (reports || []).filter(r => r.status !== 'open');
  const approved = (reports || []).filter(r => r.status === 'approved');

  const banner = document.getElementById('approved-banner');
  banner.innerHTML = approved.map(r => {
    const total = (r.shifts || []).reduce((s,x) => s + Number(x.amount_before_vat || 0), 0);
    const vat = total * (rateSettings.vat_percent / 100);
    return `<div class="approved-card">
      <div class="title">✅ הדוח שלך לחודש ${MONTH_NAMES[r.month-1]} ${r.year} אושר!</div>
      <div class="amount">₪${(total+vat).toLocaleString(undefined,{maximumFractionDigits:2})}</div>
      ${r.approval_note ? `<div class="cta" style="font-weight:700;margin-bottom:4px;">הערה: ${r.approval_note}</div>` : ''}
      <div class="cta">ניתן להגיש חשבונית להנהלת חשבונות בהתאם לסכום זה.</div>
    </div>`;
  }).join('');

  const openBox = document.getElementById('open-reports');
  openBox.innerHTML = open.length ? '' : '<div class="empty-box">אין דוחות פתוחים. לחץ על "פתח דוח חודשי חדש" כדי להתחיל.</div>';
  open.forEach(r => {
    const count = (r.shifts || []).length;
    openBox.innerHTML += `<div class="report-item" onclick="openReport('${r.id}')">
      <span>${MONTH_NAMES[r.month-1]} ${r.year}</span>
      <span style="color:var(--muted);font-size:13px;">${count} משמרות ←</span>
    </div>`;
  });

  const histBox = document.getElementById('history-reports');
  histBox.innerHTML = history.length ? '' : '<div class="empty-box">עדיין לא הוגשו דוחות</div>';
  history.forEach(r => {
    const count = (r.shifts || []).length;
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
  const { data } = await sb.from('fl_shifts').select('*').eq('report_id', currentReport.id).eq('is_deleted', false).order('day_of_month');
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
  if (currentReport.status === 'approved' && currentReport.approval_note) {
    statusBox.innerHTML = `<div class="card" style="border-color:#bbf7d0;background:#f0fdf4;margin-top:14px;"><strong>הערה מהמנהל:</strong><br>${currentReport.approval_note}</div>`;
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

  document.getElementById('km-field').classList.toggle('hidden', currentProfile.role !== 'photographer' && currentProfile.role !== 'producer');
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
  } else {
    document.getElementById('shift-location').value = '';
    setTimeValue('shift-start', '09:00');
    setTimeValue('shift-end', '19:00');
    document.getElementById('shift-km').value = 0;
    document.getElementById('shift-camera').checked = false;
    document.getElementById('shift-wireless').value = 0;
    document.getElementById('shift-daytype').value = 'regular';
  }
  updateShiftPreview();
  openModalEl('modal-shift');
}

['shift-day','shift-start-h','shift-start-m','shift-end-h','shift-end-m','shift-km','shift-camera','shift-wireless','shift-daytype'].forEach(id => {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateShiftPreview);
    if (el) el.addEventListener('change', updateShiftPreview);
  });
});


function getExtraEquipmentValue() {
  if (currentProfile.role === 'photographer') return document.getElementById('shift-camera').checked ? 1 : 0;
  if (currentProfile.role === 'recorder') return parseInt(document.getElementById('shift-wireless').value) || 0;
  return 0; // מפיק - אין תוספת ציוד
}

function updateShiftPreview() {
  const day = parseInt(document.getElementById('shift-day').value);
  const start = getTimeValue('shift-start');
  const end = getTimeValue('shift-end');
  const preview = document.getElementById('shift-preview');
  if (!day || !start || !end || !currentReport) { preview.textContent = ''; return; }
  const extra = getExtraEquipmentValue();
  const r = calcShift({
    role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: day,
    dayType: document.getElementById('shift-daytype').value, startTime: start, endTime: end,
    km: parseFloat(document.getElementById('shift-km').value) || 0, extraEquipment: extra,
  }, rateSettings);
  preview.textContent = `סכום משוער (לפני מע"מ): ₪${r.beforeVat.toLocaleString()}`;
}

async function saveShift() {
  const day = parseInt(document.getElementById('shift-day').value);
  const start = getTimeValue('shift-start');
  const end = getTimeValue('shift-end');
  if (!day || !start || !end) { showToast('נא למלא יום ושעות', true); return; }

  const extra = getExtraEquipmentValue();

  const payload = {
    report_id: currentReport.id,
    day_of_month: day,
    location: document.getElementById('shift-location').value.trim(),
    start_time: start, end_time: end,
    km: parseFloat(document.getElementById('shift-km').value) || 0,
    extra_equipment: extra,
    day_type: document.getElementById('shift-daytype').value,
    season: getIsraeliSeason(currentReport.year, currentReport.month, day),
  };
  const r = calcShift({ role: currentProfile.role, year: currentReport.year, month: currentReport.month, dayOfMonth: day,
    dayType: payload.day_type, startTime: start, endTime: end, km: payload.km, extraEquipment: extra }, rateSettings);
  payload.amount_before_vat = r.beforeVat;

  let error, resultData;
  if (editingShiftId) {
    ({ data: resultData, error } = await sb.from('fl_shifts').update(payload).eq('id', editingShiftId).select());
  } else {
    ({ data: resultData, error } = await sb.from('fl_shifts').insert(payload).select());
  }
  if (error) { showToast('שגיאה בשמירה: ' + error.message, true); return; }
  if (!resultData || resultData.length === 0) {
    showToast('השמירה נחסמה (חסרה הרשאה)' + (adminEditMode ? ' - יש להריץ את add_manager_edit_permissions.sql ב-Supabase' : ''), true);
    return;
  }
  closeModal('modal-shift');
  if (adminEditMode) {
    showToast('המשמרת עודכנה ✓');
    await refreshAfterAdminEdit(adminEditReportId);
  } else {
    await loadShifts();
    renderReportScreen();
  }
}

async function deleteShift(id) {
  const { error } = await sb.from('fl_shifts').update({ is_deleted: true }).eq('id', id);
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
const EMAILJS_PUBLIC_KEY = 'AuQvlX9lCdOzqo1F4';
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
  const { error } = await sb.from('fl_reports').update({ is_deleted: true }).eq('id', currentReport.id);
  if (error) { showToast('שגיאה במחיקה', true); return; }
  goDashboard();
}

// ============================================================
// מסך ניהול (מנהל)
// ============================================================
function switchAdminTab(tab) {
  ['pending','all','rates','backup'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === tab);
    document.getElementById('admin-'+t).classList.toggle('hidden', t !== tab);
  });
  if (tab === 'pending') loadAdminPending();
  if (tab === 'all') loadAdminAll();
  if (tab === 'rates') loadAdminRates();
  if (tab === 'backup') loadAdminBackup();
}

// ============================================================
// גיבוי ושחזור
// ============================================================
async function loadAdminBackup() {
  const box = document.getElementById('admin-backup');
  const { data: last } = await sb.from('fl_backups').select('created_at').order('created_at', { ascending: false }).limit(1).single();
  box.innerHTML = `<div class="card">
    <p style="color:var(--muted);font-size:14px;">
      הגיבוי שומר עותק מלא של כל הפרופילים, הדוחות, המשמרות וההגדרות - הן לקובץ שיורד למחשב שלך, והן לשרת (כדי שאפשר יהיה לשחזר ישירות מכאן במידת הצורך).
      <br><br>שום נתון שנשלח על ידי פרילנס לא נמחק לעולם, גם לא בלחיצה על "מחק" - הוא רק מוסתר, ותמיד אפשר לשחזר.
    </p>
    <p style="font-size:13px;"><strong>גיבוי אחרון בשרת:</strong> ${last ? new Date(last.created_at).toLocaleString('he-IL') : 'אין עדיין גיבוי'}</p>
    <button class="btn btn-primary" onclick="createBackup()">📦 צור גיבוי עכשיו</button>
    <button class="btn btn-outline" style="margin-top:10px;" onclick="restoreLastBackup()">♻️ שחזר מהגיבוי האחרון</button>
  </div>`;
}

async function createBackup() {
  showToast('יוצר גיבוי...');
  const [profiles, reports, shifts, rates] = await Promise.all([
    sb.from('fl_profiles').select('*'),
    sb.from('fl_reports').select('*'),
    sb.from('fl_shifts').select('*'),
    sb.from('fl_rate_settings').select('*'),
  ]);
  const backupData = {
    created_at: new Date().toISOString(),
    profiles: profiles.data || [],
    reports: reports.data || [],
    shifts: shifts.data || [],
    rate_settings: rates.data || [],
  };
  const { error } = await sb.from('fl_backups').insert({ created_by: currentUser.id, data: backupData });
  if (error) { showToast('שגיאה בשמירת הגיבוי בשרת: ' + error.message, true); }

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kan11-freelance-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('הגיבוי נוצר ונשמר ✓');
  loadAdminBackup();
}

async function restoreLastBackup() {
  if (!confirm('לשחזר את כל הנתונים מהגיבוי האחרון? פעולה זו תחזיר כל רשומה שנמחקה/שונתה בטעות, ולא תמחק נתונים קיימים אחרים.')) return;
  const { data: last, error } = await sb.from('fl_backups').select('*').order('created_at', { ascending: false }).limit(1).single();
  if (error || !last) { showToast('לא נמצא גיבוי לשחזור', true); return; }
  const d = last.data;
  showToast('משחזר...');
  try {
    if (d.profiles?.length) await sb.from('fl_profiles').upsert(d.profiles);
    if (d.reports?.length) await sb.from('fl_reports').upsert(d.reports);
    if (d.shifts?.length) await sb.from('fl_shifts').upsert(d.shifts);
    if (d.rate_settings?.length) await sb.from('fl_rate_settings').upsert(d.rate_settings);
    showToast('השחזור הושלם ✓');
  } catch (e) {
    showToast('שגיאה בשחזור: ' + e.message, true);
  }
}

async function loadAdminPending() {
  const { data } = await sb.from('fl_reports')
    .select('*, profiles:fl_profiles!fl_reports_worker_id_fkey(full_name, role, email), shifts:fl_shifts(*)')
    .eq('status', 'submitted').eq('is_deleted', false).order('submitted_at');
  const filtered = (data || []).map(r => ({ ...r, shifts: (r.shifts || []).filter(s => !s.is_deleted) }));
  renderAdminReportList(filtered, 'admin-pending', true);
}

async function loadAdminAll() {
  const { data } = await sb.from('fl_reports')
    .select('*, profiles:fl_profiles!fl_reports_worker_id_fkey(full_name, role, email), shifts:fl_shifts(*)')
    .eq('is_deleted', false)
    .order('year', { ascending: false }).order('month', { ascending: false });
  const filtered = (data || []).map(r => ({ ...r, shifts: (r.shifts || []).filter(s => !s.is_deleted) }));
  renderAdminReportList(filtered, 'admin-all', false);
}

function renderAdminReportList(reports, containerId, showActions) {
  const box = document.getElementById(containerId);
  if (!reports.length) { box.innerHTML = '<div class="empty-box">אין דוחות להצגה</div>'; return; }
  box.innerHTML = reports.map(r => {
    const total = (r.shifts || []).reduce((s,x) => s + Number(x.amount_before_vat || 0), 0);
    const vat = total * (rateSettings.vat_percent/100);
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;">
        <div style="cursor:pointer;" onclick="toggleAdminDetails('${r.id}')">
          <strong>${r.profiles.full_name}</strong>
          ${isFullManager ? `<button class="icon-btn" style="font-size:13px;" onclick="event.stopPropagation();promptEditFreelancerName('${r.worker_id}','${r.profiles.full_name.replace(/'/g, "\\'")}')" title="ערוך שם">✏️</button>` : ''}
          <span class="badge" style="background:#eee;color:#555;">${ROLE_LABELS[r.profiles.role]}</span><br>
          <span style="color:var(--muted);font-size:13px;">${MONTH_NAMES[r.month-1]} ${r.year} · ${r.shifts.length} משמרות · <span class="link">פירוט חישוב ▾</span></span>
        </div>
        <div style="text-align:left;">
          <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span><br>
          <strong>₪${(total+vat).toLocaleString(undefined,{maximumFractionDigits:0})}</strong>
        </div>
      </div>
      ${r.approval_note ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;margin-top:10px;font-size:13px;color:#166534;"><strong>הערה:</strong> ${r.approval_note} ${isFullManager ? `<button class="icon-btn" style="font-size:12px;" onclick="promptEditApprovalNote('${r.id}','${(r.approval_note||'').replace(/'/g, "\\'")}')" title="ערוך הערה">✏️</button>` : ''}</div>` : (isFullManager ? `<button class="btn btn-sm btn-outline" style="margin-top:10px;width:100%;" onclick="promptEditApprovalNote('${r.id}','')">✏️ הוסף הערה</button>` : '')}
      <div id="admin-details-${r.id}" class="hidden" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;"></div>
      <div class="row" style="margin-top:10px;">
        <button class="btn btn-sm btn-outline" style="flex:1;" onclick="printReport('${r.id}')">🖨️ הדפס דוח לחתימה</button>
        ${isFullManager ? `<button class="btn btn-sm btn-outline" style="flex:1;color:var(--muted);" onclick="adminHideReport('${r.id}')">🗑️ הסתר דוח</button>` : ''}
      </div>
      ${showActions && isFullManager ? `<div class="row" style="margin-top:10px;">
        <button class="btn btn-sm btn-primary" style="flex:1;" onclick="approveReport('${r.id}')">✓ אישור</button>
        <button class="btn btn-sm btn-danger" style="flex:1;" onclick="rejectReportPrompt('${r.id}')">↩ בקשת תיקון</button>
      </div>` : ''}
    </div>`;
  }).join('');
  window._adminReportsCache = window._adminReportsCache || {};
  reports.forEach(r => window._adminReportsCache[r.id] = r);
}

async function printReport(reportId) {
  const report = window._adminReportsCache[reportId];
  if (!report) return;
  const shifts = (report.shifts || []).slice().sort((a,b)=>a.day_of_month-b.day_of_month);
  let totalHours = 0, totalBefore = 0;
  const rows = shifts.map(s => {
    const r = calcShift({
      role: report.profiles.role, year: report.year, month: report.month, dayOfMonth: s.day_of_month,
      dayType: s.day_type, startTime: s.start_time, endTime: s.end_time, km: s.km, extraEquipment: s.extra_equipment
    }, rateSettings);
    totalHours += r.totalHours; totalBefore += r.beforeVat;
    return `<tr>
      <td>${s.day_of_month}/${report.month}/${report.year}</td>
      <td>${s.start_time}-${s.end_time}</td>
      <td>${r.totalHours}</td>
      <td>${dayTypeLabel(s.day_type)}</td>
      <td>${s.location || ''}</td>
      <td>${s.km || 0}</td>
      <td>₪${r.beforeVat.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
    </tr>`;
  }).join('');
  const vat = totalBefore * (rateSettings.vat_percent / 100);
  const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
    <title>דוח שעות - ${report.profiles.full_name} - ${MONTH_NAMES[report.month-1]} ${report.year}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1a1a1a;}
      h1{font-size:20px;margin-bottom:4px;}
      .sub{color:#555;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;}
      th{background:#f2f2f2;}
      .totals{margin-top:20px;font-size:14px;}
      .totals div{margin-bottom:4px;}
      .grand{font-size:17px;font-weight:bold;color:#b5121f;margin-top:8px;}
      .sign{margin-top:60px;display:flex;justify-content:space-between;}
      .sign div{width:45%;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:13px;}
      @media print { .no-print{display:none;} }
    </style></head><body>
    <h1>דוח שעות חודשי - כאן 11 חדשות</h1>
    <div class="sub">
      <div><strong>שם:</strong> ${report.profiles.full_name} (${ROLE_LABELS[report.profiles.role]})</div>
      <div><strong>חודש:</strong> ${MONTH_NAMES[report.month-1]} ${report.year}</div>
      <div><strong>סטטוס:</strong> ${STATUS_LABELS[report.status]}</div>
      ${report.approval_note ? `<div><strong>הערה:</strong> ${report.approval_note}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>תאריך</th><th>שעות</th><th>סה"כ שעות</th><th>סוג יום</th><th>מיקום</th><th>ק"מ</th><th>סכום</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div>סה"כ משמרות: ${shifts.length}</div>
      <div>סה"כ שעות: ${totalHours.toFixed(1)}</div>
      <div>סה"כ לפני מע"מ: ₪${totalBefore.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
      <div class="grand">סה"כ כולל מע"מ: ₪${(totalBefore+vat).toLocaleString(undefined,{maximumFractionDigits:2})}</div>
    </div>
    <div class="sign">
      <div>חתימת הפרילנס</div>
      <div>חתימת מנהל מאשר</div>
    </div>
    <script>window.onload = () => window.print();<\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

async function promptEditApprovalNote(reportId, currentNote) {
  const note = prompt('הערה (לצלם/מקליט ולהנהלת חשבונות):', currentNote);
  if (note === null) return;
  const { data, error } = await sb.from('fl_reports').update({ approval_note: note.trim() || null }).eq('id', reportId).select();
  if (error) { showToast('שגיאה: ' + error.message, true); return; }
  if (!data || data.length === 0) { showToast('העדכון נחסם (חסרה הרשאה)', true); return; }
  showToast('ההערה נשמרה ✓');
  const activeTab = document.getElementById('tab-pending').classList.contains('active') ? 'pending' : 'all';
  activeTab === 'pending' ? loadAdminPending() : loadAdminAll();
}

async function promptEditFreelancerName(workerId, currentName) {
  const newName = prompt('שם מלא מתוקן (יש להקפיד על התאמה מדויקת לסידור העבודה):', currentName);
  if (newName === null || !newName.trim() || newName.trim() === currentName) return;
  const { data, error } = await sb.from('fl_profiles').update({ full_name: newName.trim() }).eq('id', workerId).select();
  if (error) { showToast('שגיאה בעדכון השם: ' + error.message, true); return; }
  if (!data || data.length === 0) {
    showToast('העדכון נחסם (חסרה הרשאה) - יש להריץ את add_manager_edit_permissions.sql ב-Supabase', true);
    return;
  }
  showToast('השם עודכן ✓');
  const activeTab = document.getElementById('tab-pending').classList.contains('active') ? 'pending' : 'all';
  activeTab === 'pending' ? loadAdminPending() : loadAdminAll();
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
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
      <div style="font-weight:700;">${dowLabel ? dowLabel + ' – ' : ''}${dateStr} · ${s.start_time}-${s.end_time} · ${dayTypeLabel(s.day_type)}${s.location ? ' · ' + s.location : ''}</div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        ${isFullManager ? `<button class="icon-btn" onclick="adminEditShift('${report.id}','${s.id}')" title="ערוך משמרת">✏️</button>
        <button class="icon-btn" onclick="adminDeleteShift('${report.id}','${s.id}')" title="מחק משמרת">🗑️</button>` : ''}
      </div>
    </div>
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

// ---- עריכה/מחיקה של משמרת על ידי המנהל (עובד גם על דוחות שכבר הוגשו/אושרו) ----
let adminEditMode = false;
let adminEditReportId = null;
let managerOwnProfile = null;

function adminEditShift(reportId, shiftId) {
  const report = window._adminReportsCache[reportId];
  if (!report) return;
  managerOwnProfile = managerOwnProfile || currentProfile;
  currentReport = report;
  currentProfile = { ...currentProfile, role: report.profiles.role };
  adminEditMode = true;
  adminEditReportId = reportId;
  currentShifts = report.shifts;
  openShiftModal(shiftId);
}

async function adminDeleteShift(reportId, shiftId) {
  if (!confirm('להסתיר את המשמרת הזו? (המידע לא נמחק לצמיתות, ניתן לשחזר מגיבוי במידת הצורך)')) return;
  const { error } = await sb.from('fl_shifts').update({ is_deleted: true }).eq('id', shiftId);
  if (error) { showToast('שגיאה: ' + error.message, true); return; }
  showToast('המשמרת הוסתרה ✓');
  await refreshAfterAdminEdit(reportId);
}

async function refreshAfterAdminEdit(reportId) {
  if (managerOwnProfile) { currentProfile = managerOwnProfile; }
  adminEditMode = false;
  adminEditReportId = null;
  const { data: shifts } = await sb.from('fl_shifts').select('*').eq('report_id', reportId).eq('is_deleted', false).order('day_of_month');
  const report = window._adminReportsCache[reportId];
  if (report) report.shifts = shifts || [];
  const box = document.getElementById('admin-details-' + reportId);
  if (box) {
    box.dataset.loaded = '';
    box.classList.remove('hidden');
    toggleAdminDetails(reportId); // יסגור כי כרגע פתוח
    toggleAdminDetails(reportId); // ויפתח מחדש עם הנתונים המעודכנים
  }
  const activeTab = document.getElementById('tab-pending').classList.contains('active') ? 'pending' : 'all';
  activeTab === 'pending' ? loadAdminPending() : loadAdminAll();
}

async function adminHideReport(id) {
  if (!confirm('להסתיר את הדוח הזה מהתצוגה? (לא נמחק לצמיתות - שימושי לניקוי דוחות בדיקה/ניסיון)')) return;
  const { error } = await sb.from('fl_reports').update({ is_deleted: true }).eq('id', id);
  if (error) { showToast('שגיאה: ' + error.message, true); return; }
  showToast('הדוח הוסתר ✓');
  const activeTab = document.getElementById('tab-pending').classList.contains('active') ? 'pending' : 'all';
  activeTab === 'pending' ? loadAdminPending() : loadAdminAll();
}

async function approveReport(id) {
  const note = prompt('הערה לצלם/מקליט ולהנהלת חשבונות (לדוגמה: "צילום לדיגיטל", "צילום לערבית") - אופציונלי:');
  if (note === null) return; // המשתמש ביטל
  const { error } = await sb.from('fl_reports').update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: currentUser.id, approval_note: note.trim() || null }).eq('id', id);
  if (error) { showToast('שגיאה', true); return; }
  showToast('הדוח אושר ✓');
  const activeTab = document.getElementById('tab-pending').classList.contains('active') ? 'pending' : 'all';
  activeTab === 'pending' ? loadAdminPending() : loadAdminAll();
}

// ---- התראת מייל לפרילנס כשהדוח שלו מאושר (EmailJS) ----
// משתמש בתבנית הקיימת template_gsj7m1c (משותפת עם tzalamim), עם שדות: worker_email, subject, message, name, email
const EMAILJS_APPROVAL_TEMPLATE_ID = 'template_gsj7m1c';

async function sendApprovalEmail(report) {
  if (typeof emailjs === 'undefined') return;
  if (!report.profiles?.email) return;
  const total = (report.shifts || []).reduce((s,x) => s + Number(x.amount_before_vat || 0), 0);
  const vat = total * (rateSettings.vat_percent / 100);
  const monthLabel = `${MONTH_NAMES[report.month-1]} ${report.year}`;
  const totalStr = (total+vat).toLocaleString(undefined, {maximumFractionDigits:2});
  const message = `שלום ${report.profiles.full_name},

הדוח שלך עבור ${monthLabel} אושר.
סכום כולל מע"מ: ₪${totalStr}

ניתן לשלוח חשבונית / דרישת תשלום בהתאם לסכום זה אל:
אפרת: efratn@kan.org.il
שלמה: shlomoa@kan.org.il

תודה,
כאן 11 - חדשות`;
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_APPROVAL_TEMPLATE_ID, {
      worker_email: report.profiles.email,
      subject: `הדוח שלך עבור ${monthLabel} אושר`,
      message: message,
      name: 'כאן 11 - חדשות',
      email: MANAGER_EMAIL,
    }, EMAILJS_PUBLIC_KEY);
  } catch (e) {
    console.error('שליחת מייל אישור נכשלה', e);
  }
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
    ${rateField('תעריף יומי מפיק (₪, 10 שעות)','producer_daily',r.producer_daily)}
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
  const keys = ['photographer_daily','recorder_daily','producer_daily','tier1_pct','tier2_pct','night_pct','chag_shabbat_pct','election_pct',
    'entry_hour_summer','exit_hour_summer','entry_hour_winter','exit_hour_winter','km_free','km_rate','camera_bonus','wireless_bonus','wireless_max','vat_percent'];
  const payload = {};
  keys.forEach(k => payload[k] = parseFloat(document.getElementById('rate-'+k).value));
  const { error } = await sb.from('fl_rate_settings').update(payload).eq('id', 1);
  if (error) { showToast('שגיאה בשמירה: ' + error.message, true); return; }
  rateSettings = { ...rateSettings, ...payload };
  showToast('התעריפים נשמרו ✓');
}
