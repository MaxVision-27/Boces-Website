// ============================================================
// SUPABASE SETUP
// ============================================================
const SUPABASE_URL = 'https://qfvzgmkfkxvvcmixcmzy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmdnpnbWtma3h2dmNtaXhjbXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMTQ3NjMsImV4cCI6MjA4OTc5MDc2M30.AKluwHFXo9mrWrhUuoxNquJvzQo_E6nHWH9Sfj_eEEo';

// db is initialized inside DOMContentLoaded so the CDN is guaranteed to be loaded first
let db;

// ============================================================
// STATE
// ============================================================
let currentRole = null;
let totalRepairs = 0;
let appointments = [];
let techs = [];
let currentTechId = null;
let currentTechName = null;
let currentSession = null; // 'AM' or 'PM' for a tech login (016_am_pm_and_help_desk.sql)
let myTimeLogs = [];
let deletedAppointments = [];
// Session token from staff_login(). Sent as x-staff-token on every
// request so the database's row-level security can tell staff apart
// from the public — tickets, students and hours are staff-only.
let staffToken = null;
// staff.html holds the tools; index.html is the public site.
const STAFF_PAGE = document.body.classList.contains('staff-page');

// ============================================================
// LOAD ALL DATA FROM SUPABASE ON PAGE START
// ============================================================
async function loadData() {
    await Promise.all(STAFF_PAGE ? [loadAppointments(), loadStats(), loadTechs()] : [loadStats()]);
    hydrateTechIdentity();
    updateRoleDisplay();
}

async function loadAppointments() {
    const { data, error } = await db.from('repair_requests').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (error) { console.error('Error loading appointments:', error); return; }
    appointments = data || [];
    calculateTotalRepairs();
    populateAppointmentsModal();
}

async function loadDeletedAppointments() {
    const { data, error } = await db.from('repair_requests').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    if (error) { console.error('Error loading deleted tickets:', error); return; }
    deletedAppointments = data || [];
}

async function loadStats() {
    const { data, error } = await db.from('stats').select('total_repairs').single();
    if (error) { console.error('Error loading stats:', error); return; }
    if (data) {
        totalRepairs = data.total_repairs;
        const el = document.getElementById('totalRepairs');
        if (el) el.textContent = totalRepairs;
    }
}

async function loadTechs() {
    const { data, error } = await db.from('techs').select('*').order('name', { ascending: true });
    if (error) { console.error('Error loading techs:', error); return; }
    techs = data || [];
}

// Reattach currentTechName from the roster after a saved session
// (sessionStorage only kept the id). If the roster no longer has that id
// (teacher removed them), clear the stale identity.
function hydrateTechIdentity() {
    if (!currentTechId || !STAFF_PAGE) return; // the public page doesn't load the roster
    const tech = classRoster().find(t => t.id === currentTechId);
    if (tech) {
        currentTechName = tech.name;
    } else {
        currentTechId = null;
        currentTechName = null;
        sessionStorage.removeItem('bocesTechId');
    }
}

// The students in the logged-in tech's class (students with no class set
// show in both, so nobody disappears before an admin sorts them).
function classRoster() {
    return techs.filter(t => !currentSession || !t.session || t.session === currentSession);
}

// ============================================================
// LOGIN — admin, or a tech from the AM or PM class. Each has its own
// password; the server remembers the class with the session.
// ============================================================
// Tech (Student) asks which class you're in; the picked one stays
// highlighted, and the password must be that class's own password.
function showLoginButtons() {
    const tech = document.getElementById('loginRole').value === 'tech';
    document.getElementById('loginClassPicker').style.display = tech ? '' : 'none';
    updateLoginPasswordLabel();
}

function pickLoginClass(btn) {
    document.querySelectorAll('.class-option').forEach(b => b.setAttribute('aria-pressed', b === btn));
    updateLoginPasswordLabel();
}

function loginClass() {
    return document.querySelector('.class-option[aria-pressed="true"]')?.dataset.class || null;
}

function updateLoginPasswordLabel() {
    const tech = document.getElementById('loginRole').value === 'tech';
    const cls = loginClass();
    document.getElementById('loginPasswordLabel').textContent = tech && cls ? `${cls.toUpperCase()} password` : 'Password';
}

async function login() {
    const role = document.getElementById('loginRole').value === 'tech' ? loginClass() : 'admin';
    if (!role) { alert('Pick your class: AM or PM.'); return; }
    const password = document.getElementById('loginPassword').value;

    if (!password) {
        alert('Please enter a password');
        return;
    }

    const { data: token, error } = await db.rpc('staff_login', { p_role: role, p_password: password });

    if (error) {
        console.error('Login error:', error);
        alert('Login failed. Check your internet connection and try again.');
        return;
    }
    if (!token) {
        alert('Incorrect password!');
        return;
    }

    staffToken = token;
    currentRole = role === 'admin' ? 'admin' : 'tech';
    currentSession = role === 'admin' ? null : role.toUpperCase();
    sessionStorage.setItem('bocesStaffToken', token);
    closeModal('loginModal');
    document.getElementById('loginPassword').value = '';

    // Tickets, students and hours only come back once the token is set.
    await loadData();

    if (currentRole === 'tech') {
        const savedTechId = sessionStorage.getItem('bocesTechId');
        if (savedTechId && classRoster().find(t => t.id === parseInt(savedTechId))) {
            selectTech(parseInt(savedTechId), false);
        } else {
            openTechPicker();
        }
    } else {
        alert('Login successful!');
    }
}

async function logout() {
    if (staffToken) await db.rpc('staff_logout');

    staffToken = null;
    currentSession = null;
    currentRole = null;
    currentTechId = null;
    currentTechName = null;
    appointments = [];
    deletedAppointments = [];
    techs = [];
    myTimeLogs = [];
    sessionStorage.removeItem('bocesStaffToken');
    sessionStorage.removeItem('bocesTechId');
    location.href = './';
}

// ============================================================
// TECH IDENTITY (picker shown after "Tech" login)
// ============================================================
function openTechPicker() {
    const container = document.getElementById('techPickerContainer');
    const roster = classRoster();

    if (roster.length === 0) {
        container.innerHTML = `<p style="text-align:center;color:#999;">No ${currentSession || ''} students have been added yet. Ask your teacher to add you in Manage Students.</p>`;
    } else {
        container.innerHTML = roster.map(t => `<button type="button" class="tech-pick-btn" onclick="selectTech(${t.id})">${escapeHtml(t.name)}</button>`).join('');
    }

    openModal('techPickerModal');
}

function selectTech(techId, showAlert = true) {
    const tech = classRoster().find(t => t.id === techId);
    if (!tech) return;

    currentTechId = tech.id;
    currentTechName = tech.name;
    sessionStorage.setItem('bocesTechId', tech.id);

    closeModal('techPickerModal');
    updateRoleDisplay();
    if (STAFF_PAGE) viewMyTickets();
    if (showAlert) alert(`Welcome, ${tech.name}!`);
}

// ============================================================
// STUDENTS (Admin) — just a name. No project/group of any kind;
// who's working what is decided per-ticket in the Ticket Pool.
// ============================================================
// Manage Students (Admin): every student with their workload, and a
// page per student with their tickets and logged sessions.
let allTimeLogs = [];
let openStudentId = null;

async function openManageStudents(fromTab = false) {
    if (fromTab) openStudentId = null;
    const { data, error } = await db.from('time_logs')
        .select('*')
        .order('work_date', { ascending: false })
        .order('start_time', { ascending: false });
    if (error) { console.error('Error loading time logs:', error); }
    allTimeLogs = data || [];
    populateManageStudentsModal();
    openModal('manageStudentsModal');
}

function showStudent(techId) {
    openStudentId = techId;
    populateManageStudentsModal();
}

// Tickets they're on now, plus any they logged time on before a handoff.
function studentTickets(techId) {
    const loggedOn = new Set(allTimeLogs.filter(l => l.tech_id === techId).map(l => l.ticket_id));
    return appointments.filter(a => (a.assigned_tech_ids || []).includes(techId) || loggedOn.has(a.id));
}

function studentHours(techId) {
    return allTimeLogs
        .filter(l => l.tech_id === techId)
        .reduce((sum, l) => sum + hoursBetween(l.start_time, l.end_time), 0);
}

function populateManageStudentsModal() {
    const container = document.getElementById('manageStudentsContainer');
    if (!container) return;

    const student = techs.find(t => t.id === openStudentId);
    if (student) {
        container.innerHTML = studentPageHtml(student);
        return;
    }
    openStudentId = null;

    const row = t => {
        const tickets = studentTickets(t.id).filter(a => (a.assigned_tech_ids || []).includes(t.id));
        const active = tickets.filter(a => a.status === 'assigned' || a.status === 'in_progress').length;
        const waiting = tickets.filter(a => a.status === 'review').length;
        return `
        <div class="folder-card" style="cursor:default;">
            <span class="folder-top"><strong>${escapeHtml(t.name)} <span class="forum-type">${t.session || 'No class'}</span></strong> <span class="folder-meta">${studentHours(t.id).toFixed(2)} hr logged</span></span>
            <span class="ws-hint" style="margin:0;">${active} active ticket${active === 1 ? '' : 's'}${waiting ? ` · <strong style="color:#6f42c1;">${waiting} waiting for your check-off</strong>` : ''}</span>
            <div class="ws-actions" style="margin-top:0.4rem;">
                <button class="btn btn-outline btn-sm" onclick="showStudent(${t.id})">Open</button>
                <button class="btn btn-outline btn-sm" onclick="renameStudent(${t.id})">Rename</button>
                <button class="btn btn-outline btn-sm" onclick="setStudentSession(${t.id}, '${t.session === 'AM' ? 'PM' : 'AM'}')">Move to ${t.session === 'AM' ? 'PM' : 'AM'}</button>
                <button class="btn btn-danger btn-sm" onclick="removeStudent(${t.id})">Remove</button>
            </div>
        </div>`;
    };

    container.innerHTML = `
        <div class="form-group" style="border-bottom: 1px solid var(--border); padding-bottom: 1.25rem; margin-bottom: 1.25rem;">
            <label for="newStudentName">Add Student</label>
            <div style="display:flex; gap:8px;">
                <input type="text" id="newStudentName" placeholder="Example: Alex Kim" style="flex:1;" onkeydown="if(event.key==='Enter'){addStudent();}">
                <select id="newStudentSession" aria-label="Class" style="width:auto;">
                    <option value="AM">AM class</option>
                    <option value="PM">PM class</option>
                </select>
                <button class="btn btn-primary" onclick="addStudent()">Add</button>
            </div>
        </div>
        ${techs.length === 0 ? '<p style="text-align:center; color:#999;">No students yet.</p>' : `<div class="folder-list">${techs.map(row).join('')}</div>`}`;
}

function studentPageHtml(student) {
    const tickets = studentTickets(student.id);
    const sessions = allTimeLogs.filter(l => l.tech_id === student.id);
    const ticketFolder = appt => `
        <button type="button" class="folder-card" onclick="openTicketWorkspace(${appt.id})">
            <span class="folder-top"><strong>Ticket #${appt.id} · ${escapeHtml(appt.name)}</strong> ${statusBadge(appt.status)}</span>
            <span class="folder-issue">${escapeHtml(appt.make_model || appt.device)}: ${escapeHtml(appt.issue)}</span>
            <span class="folder-meta">${(appt.assigned_tech_ids || []).includes(student.id) ? 'On this ticket now' : 'Handed off'} <strong>Open →</strong></span>
        </button>`;

    return `
        <button class="ws-back" onclick="showStudent(null)">← All students</button>
        <div class="ws-header">
            <h2>${escapeHtml(student.name)}</h2>
            <span class="folder-meta">${studentHours(student.id).toFixed(2)} hr logged</span>
        </div>

        <h3 class="list-heading">Tickets (${tickets.length})</h3>
        ${tickets.length ? `<div class="folder-list">${tickets.map(ticketFolder).join('')}</div>` : '<p class="ws-hint">No tickets yet.</p>'}

        <h3 class="list-heading">Work sessions (${sessions.length})</h3>
        ${sessions.length ? sessions.map(l => `
            <div class="session">
                <div class="session-top">
                    <strong>${new Date(l.work_date + 'T00:00:00').toLocaleDateString()} · ${formatTime12h(l.start_time)} to ${formatTime12h(l.end_time)} (${hoursBetween(l.start_time, l.end_time).toFixed(2)} hr)</strong>
                    <span class="folder-meta">Ticket #${l.ticket_id}</span>
                </div>
                <p>${l.note ? escapeHtml(l.note) : '<em>No note</em>'}</p>
            </div>`).join('') : '<p class="ws-hint">No sessions logged yet.</p>'}`;
}

async function setStudentSession(techId, session) {
    const { error } = await db.from('techs').update({ session }).eq('id', techId);
    if (error) { console.error('Error moving student:', error); alert('Failed to move student.'); return; }
    techs.find(t => t.id === techId).session = session;
    populateManageStudentsModal();
}

async function renameStudent(techId) {
    const tech = techs.find(t => t.id === techId);
    const name = prompt('New name for this student:', tech.name)?.trim();
    if (!name || name === tech.name) return;

    const { error } = await db.from('techs').update({ name }).eq('id', techId);
    if (error) { console.error('Error renaming student:', error); alert('Failed to rename student.'); return; }

    tech.name = name;
    techs.sort((a, b) => a.name.localeCompare(b.name));
    if (currentTechId === techId) { currentTechName = name; updateRoleDisplay(); }
    populateManageStudentsModal();
}

async function addStudent() {
    const input = document.getElementById('newStudentName');
    const name = input.value.trim();

    if (!name) { alert('Please enter a name'); return; }

    const session = document.getElementById('newStudentSession').value;
    const { data, error } = await db.from('techs').insert({ name, session }).select().single();
    if (error) { console.error('Error adding student:', error); alert('Failed to add student.'); return; }

    techs.push(data);
    techs.sort((a, b) => a.name.localeCompare(b.name));
    input.value = '';
    populateManageStudentsModal();
}

async function removeStudent(techId) {
    if (!confirm('Remove this student? They will be unassigned from any tickets.')) return;

    const { error } = await db.from('techs').delete().eq('id', techId);
    if (error) { console.error('Error removing student:', error); return; }

    techs = techs.filter(t => t.id !== techId);

    // Strip them out of any ticket they were assigned to — assigned_tech_ids
    // is a plain array column, not a foreign key, so this has to happen
    // from the app rather than a DB cascade.
    const affected = appointments.filter(a => (a.assigned_tech_ids || []).includes(techId));
    for (const appt of affected) {
        const newIds = appt.assigned_tech_ids.filter(id => id !== techId);
        const newStatus = newIds.length === 0 ? 'pending' : appt.status;
        await db.from('repair_requests').update({ assigned_tech_ids: newIds, status: newStatus }).eq('id', appt.id);
        appt.assigned_tech_ids = newIds;
        appt.status = newStatus;
    }

    if (currentTechId === techId) {
        currentTechId = null;
        currentTechName = null;
        sessionStorage.removeItem('bocesTechId');
        updateRoleDisplay();
    }
    populateManageStudentsModal();
    populateAppointmentsModal();
}

// ============================================================
// REPAIR REQUESTS — created directly by a logged-in Tech. No project
// is required; the creating student is assigned automatically and can
// pick up teammates (or be reassigned entirely) later from the pool.
// ============================================================
function openTechTicketModal() {
    if (!currentTechId) { openTechPicker(); return; }
    // The customer watches this screen: nothing else open behind the form.
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    const password = document.getElementById('techApptPassword');
    if (password.type !== 'password') togglePasswordShown(password.nextElementSibling);
    document.getElementById('techReceiving').textContent = currentTechName;
    document.getElementById('techTicketError').hidden = true;
    const others = classRoster().filter(t => t.id !== currentTechId);
    document.getElementById('techPartnerPicker').innerHTML = others.length ? others.map(t => `
        <label style="display:inline-flex; align-items:center; gap:4px; background:white; padding:3px 8px; border-radius:10px; border:1px solid #ccc; font-size:0.85rem; font-weight:normal; cursor:pointer;">
            <input type="checkbox" class="partner-pick" value="${t.id}" style="width:auto;">
            ${escapeHtml(t.name)}
        </label>`).join('') : '<span style="color:#999; font-size:0.85rem;">No other students added yet</span>';
    openModal('techTicketModal');
}

// Short, easy-to-write-down code (no 0/O/1/I to avoid mix-ups) so a
// customer can look their ticket up later without an account.
function generateTrackingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// The New Ticket form mirrors the school's Help Desk Ticket
// (forms/help-desk-template.docx), which prints from these fields.
const TICKET_FIELDS = {
    name: 'techApptName', contact_number: 'techApptContact', class_name: 'techApptClass', room_number: 'techApptRoom',
    device: 'techApptDevice', make_model: 'techApptModel', serial_tag: 'techApptSerial',
    computer_password: 'techApptPassword', issue: 'techApptIssue', email: 'techApptEmail'
};

async function submitTechTicket() {
    const ticket = Object.fromEntries(Object.entries(TICKET_FIELDS)
        .map(([col, id]) => [col, document.getElementById(id).value.trim()]));
    ticket.email = ticket.email.toLowerCase();

    const missing = [['name', 'the customer name'], ['contact_number', 'a contact number'], ['make_model', 'the computer make/model'], ['issue', 'the problem description']]
        .filter(([col]) => !ticket[col]).map(([, label]) => label);
    const errorBox = document.getElementById('techTicketError');
    errorBox.hidden = !missing.length;
    const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
    errorBox.textContent = missing.length ? `Please add ${list}.` : '';
    if (missing.length) { errorBox.scrollIntoView({ block: 'center' }); return; }

    let data, error;
    for (let attempt = 0; attempt < 5; attempt++) {
        const trackingCode = generateTrackingCode();
        ({ data, error } = await db.from('repair_requests').insert({
            ...ticket,
            computer_password: ticket.computer_password || null,
            status: 'assigned',
            flagged: false,
            flag_reason: null,
            assigned_tech_ids: [currentTechId, ...[...document.querySelectorAll('.partner-pick:checked')].map(cb => parseInt(cb.value))],
            created_by: currentTechName,
            tracking_code: trackingCode
        }).select().single());

        if (!error || error.code !== '23505') break; // 23505 = unique_violation, try a new code
    }

    if (error) { console.error('Error creating ticket:', error); alert('Failed to create ticket.'); return; }

    appointments.push(data);
    populateAppointmentsModal();
    if (currentRole === 'tech') viewMyTickets();
    closeModal('techTicketModal');

    Object.values(TICKET_FIELDS).forEach(id => { if (id !== 'techApptDevice') document.getElementById(id).value = ''; });

    document.getElementById('createdTrackingCode').textContent = data.tracking_code;
    document.getElementById('printHelpDeskBtn').dataset.ticket = data.id;
    openModal('ticketCreatedModal');
}

function togglePasswordShown(btn) {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-pressed', show);
}

async function copyText(text, btn) {
    btn.dataset.label ??= btn.textContent;
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
    } catch {
        btn.textContent = 'Select and copy it';
    }
    setTimeout(() => btn.textContent = btn.dataset.label, 1500);
}

// ============================================================
// PUBLIC TICKET TRACKING (lookup by code, no login needed)
// ============================================================
const trackStatusMeta = {
    pending: { label: 'In the Pool', color: '#ffc107', text: '#333' },
    assigned: { label: 'Assigned', color: '#17a2b8', text: 'white' },
    in_progress: { label: 'In Progress', color: '#0d6efd', text: 'white' },
    review: { label: 'Final Check', staffLabel: 'Needs Check-Off', color: '#6f42c1', text: 'white' },
    completed: { label: 'Completed', color: '#28a745', text: 'white' }
};

async function trackRepair() {
    const input = document.getElementById('trackCodeInput');
    const result = document.getElementById('trackResult');
    const code = input.value.trim().toUpperCase();

    if (!code) {
        result.innerHTML = '<p class="track-msg error">Please enter a tracking code.</p>';
        return;
    }

    result.innerHTML = '<p class="track-msg">Looking up your repair...</p>';

    const { data, error } = await db.rpc('track_repair', { p_code: code }).maybeSingle();

    if (error) {
        console.error('Error tracking repair:', error);
        result.innerHTML = '<p class="track-msg error">Something went wrong. Please try again.</p>';
        return;
    }

    if (!data) {
        result.innerHTML = '<p class="track-msg error">No repair found with that code. Double-check it and try again.</p>';
        return;
    }

    const meta = trackStatusMeta[data.status] || { label: data.status, color: '#999', text: 'white' };
    result.innerHTML = `
        <div class="info-card" style="text-align:left; margin-top:1rem;">
            <h3>${escapeHtml(data.device)}</h3>
            <p style="color:#555;"><em>${escapeHtml(data.issue)}</em></p>
            <span class="status-badge" style="background:${meta.color}; color:${meta.text}; margin-top:0.5rem;">${meta.label}</span>
            <p style="margin-top:0.8rem; font-size:0.85rem; color:#999;">Submitted ${new Date(data.created_at).toLocaleDateString()}</p>
            ${data.status === 'completed' ? `<p style="margin-top:0.8rem;">Your repair is done. How did we do?
                <button class="btn btn-approve btn-sm" onclick="openReview('${code.replace(/[^A-Z0-9]/g, '')}')">Leave a review</button></p>` : ''}
        </div>
    `;
}

// ============================================================
// TICKET ASSIGNMENT — one or more students per ticket
// ============================================================
async function updateTicketAssignment(apptId) {
    const checkboxes = document.querySelectorAll(`.assign-tech-${apptId}:checked`);
    const techIds = [...checkboxes].map(cb => parseInt(cb.value));
    const appt = appointments.find(a => a.id === apptId);

    let newStatus = appt.status;
    if (techIds.length === 0) {
        newStatus = 'pending';
    } else if (appt.status === 'pending') {
        newStatus = 'assigned';
    }

    const { error } = await db.from('repair_requests').update({
        assigned_tech_ids: techIds,
        status: newStatus
    }).eq('id', apptId);

    if (error) { console.error('Error updating assignment:', error); return; }

    appt.assigned_tech_ids = techIds;
    appt.status = newStatus;

    populateAppointmentsModal();
    renderTicketWorkspace();
    const saved = document.getElementById(`saveStudents-${apptId}`);
    if (saved) {
        saved.textContent = 'Saved';
        setTimeout(() => saved.textContent = 'Save Students', 1500);
    }
}

async function startProgress(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'in_progress' }).eq('id', apptId);
    if (error) { console.error('Error starting progress:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'in_progress';

    populateAppointmentsModal();
    renderTicketWorkspace();
}

async function saveTicketParts(apptId, btn) {
    const partsUsed = document.getElementById(`parts-${apptId}`).value.trim();

    const { error } = await db.from('repair_requests').update({ parts_used: partsUsed }).eq('id', apptId);
    if (error) { console.error('Error saving parts:', error); alert('Failed to save parts.'); return; }

    appointments.find(a => a.id === apptId).parts_used = partsUsed;
    btn.textContent = 'Saved';
    setTimeout(() => btn.textContent = 'Save Parts', 1500);
}

// Students send a finished repair to the admin; only the admin completes
// it (enforced in the database, 014_admin_checkoff.sql).
async function requestCheckoff(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'review', review_note: null }).eq('id', apptId);
    if (error) { console.error('Error requesting check-off:', error); alert('Could not send it for check-off.'); return; }

    Object.assign(appointments.find(a => a.id === apptId), { status: 'review', review_note: null });
    populateAppointmentsModal();
    renderTicketWorkspace();
}

async function sendBack(apptId) {
    const note = prompt('What still needs to be done? The students on this ticket will see this.\n\nExample: The screen still flickers when the lid is half open.');
    if (note === null) return;

    const update = { status: 'in_progress', review_note: note.trim() || null };
    const { error } = await db.from('repair_requests').update(update).eq('id', apptId);
    if (error) { console.error('Error sending back:', error); alert('Could not send it back.'); return; }

    Object.assign(appointments.find(a => a.id === apptId), update);
    populateAppointmentsModal();
    renderTicketWorkspace();
}

async function markCompleted(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'completed', review_note: null }).eq('id', apptId);
    if (error) { console.error('Error marking complete:', error); alert('Could not mark it completed. Only an admin can check off a repair.'); return; }

    const appt = appointments.find(a => a.id === apptId);
    Object.assign(appt, { status: 'completed', review_note: null });

    await syncStats();
    populateAppointmentsModal();
    renderTicketWorkspace();
    alert('Repair marked as completed!');
}

// Soft-delete: the row (and its tracking code) stays in the database
// with deleted_at set, just hidden from the active pool, so a mistaken
// click can be undone from the "Deleted" filter instead of losing the
// ticket for good.
async function deleteAppointment(apptId) {
    if (!confirm('Delete this ticket? It leaves the pool but can be restored from the "Deleted" filter.')) return;

    const { error } = await db.from('repair_requests').update({ deleted_at: new Date().toISOString() }).eq('id', apptId);
    if (error) { console.error('Error deleting:', error); return; }

    appointments = appointments.filter(a => a.id !== apptId);
    await syncStats();
    if (isWorkspaceOpen()) leaveWorkspace();
    else populateAppointmentsModal();
}

async function restoreAppointment(apptId) {
    const { data, error } = await db.from('repair_requests').update({ deleted_at: null }).eq('id', apptId).select().single();
    if (error) { console.error('Error restoring ticket:', error); return; }

    deletedAppointments = deletedAppointments.filter(a => a.id !== apptId);
    appointments.push(data);
    await syncStats();
    populateAppointmentsModal();
}

async function permanentlyDeleteAppointment(apptId) {
    if (!confirm('Permanently delete this ticket? This cannot be undone.')) return;

    const { error } = await db.from('repair_requests').delete().eq('id', apptId);
    if (error) { console.error('Error permanently deleting:', error); return; }

    deletedAppointments = deletedAppointments.filter(a => a.id !== apptId);
    populateAppointmentsModal();
}

// ============================================================
// STATS — total repairs is now just a count of completed tickets,
// with a manual override still available for edge cases.
// ============================================================
async function syncStats() {
    calculateTotalRepairs();
    await db.from('stats').update({ total_repairs: totalRepairs }).eq('id', 1);
}

function calculateTotalRepairs() {
    // The public can't read tickets, so for them the count on the page
    // comes from the stats row (loadStats) rather than being recounted.
    if (!currentRole || !STAFF_PAGE) return;
    totalRepairs = appointments.filter(a => a.status === 'completed').length;
    const el = document.getElementById('totalRepairs');
    if (el) el.textContent = totalRepairs;
}

function populateStatsModal() {
    const calculatedTotal = appointments.filter(a => a.status === 'completed').length;
    const input = document.getElementById('totalRepairsInput');
    input.value = totalRepairs;
    input.placeholder = `Auto-calculated: ${calculatedTotal}`;
}

async function updateStats() {
    const manualTotal = parseInt(document.getElementById('totalRepairsInput').value);
    const calculatedTotal = appointments.filter(a => a.status === 'completed').length;
    totalRepairs = (!isNaN(manualTotal) && manualTotal !== calculatedTotal) ? manualTotal : calculatedTotal;

    await db.from('stats').update({ total_repairs: totalRepairs }).eq('id', 1);

    closeModal('updateStatsModal');
    alert('Statistics updated!');
}

// ============================================================
// REVIEWS
// ============================================================
// Tags for each star level
const reviewTagsByRating = {
    5: [
        'Super fast repair',
        'Incredibly friendly',
        'Outstanding service',
        'Perfectly fixed',
        'Handled with great care',
        'Excellent communication',
        'Amazing value',
        'Very knowledgeable',
        'Finished ahead of time',
        'Highly recommend',
        'Exceeded expectations',
        'Best repair experience'
    ],
    4: [
        'Fast repair',
        'Friendly staff',
        'Great service',
        'Fixed my issue',
        'Handled my device carefully',
        'Good communication',
        'Good value',
        'Knowledgeable team',
        'Completed on time',
        'Would recommend',
        'Minor issue but resolved'
    ],
    3: [
        'Took a bit longer than expected',
        'Communication could improve',
        'Issue was mostly fixed',
        'Experience was okay',
        'Fair value',
        'Could be more organized',
        'Needed a follow-up visit',
        'Decent service overall'
    ],
    2: [
        'Took too long',
        'Poor communication',
        'Issue not fully resolved',
        'Disappointing experience',
        'Not worth the wait',
        'Disorganized process',
        'Unclear about repair status',
        'Had to come back multiple times'
    ],
    1: [
        'Issue not fixed at all',
        'Very poor experience',
        'Extremely long wait',
        'No communication',
        'Device not handled carefully',
        'Waste of time',
        'Would not recommend',
        'Very disappointed'
    ]
};

// From the review buttons; a finished repair's tracking result fills in its code.
function openReview(code = '') {
    document.getElementById('reviewCode').value = code;
    openModal('reviewModal');
}

function updateReviewTags() {
    const rating = parseInt(document.getElementById('reviewRating').value);
    const tags = reviewTagsByRating[rating] || [];
    const container = document.getElementById('reviewTags');

    container.innerHTML = tags.map(tag => `
        <button type="button" class="review-tag" onclick="toggleTag(this)">${tag}</button>
    `).join('');
}

function toggleTag(btn) {
    btn.classList.toggle('selected');
}

async function submitReview() {
    const rating = parseInt(document.getElementById('reviewRating').value);
    const selectedTags = [...document.querySelectorAll('.review-tag.selected')]
        .map(btn => btn.textContent.trim());

    if (selectedTags.length === 0) {
        alert('Please select at least one option.');
        return;
    }

    const code = document.getElementById('reviewCode').value.trim().toUpperCase();
    if (!code) { alert('Please enter the tracking code from your repair.'); return; }

    const comment = selectedTags.join(' · ');

    // One review per repair: the database checks the code and that it hasn't been used.
    const { data: result, error } = await db.rpc('submit_review', { p_code: code, p_rating: rating, p_comment: comment });
    if (error) { console.error('Error submitting review:', error); alert('Failed to submit review.'); return; }
    if (result === 'bad_code') { alert("We couldn't find a repair with that tracking code. Check the code and try again."); return; }
    if (result === 'used') { alert('This repair already has a review. Thank you!'); return; }
    if (result !== 'ok') { alert('Failed to submit review.'); return; }

    document.getElementById('reviewCode').value = '';
    document.querySelectorAll('.review-tag.selected').forEach(btn => btn.classList.remove('selected'));

    closeModal('reviewModal');
    renderReviews();
    alert('Thank you for your feedback!');
}

async function renderReviews() {
    const container = document.getElementById('reviewsContainer');
    if (!container) return;

    const { data, error } = await db.from('reviews').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error loading reviews:', error); return; }

    if (!data || data.length === 0) {
        container.innerHTML = "<p style='text-align:center;color:#777;'>No reviews yet.</p>";
        return;
    }

    container.innerHTML = data.map(r => `
        <div class="info-card">
            <h3>${'⭐'.repeat(r.rating)}</h3>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin:0.5rem 0;">
                ${r.comment.split(' · ').map(tag => `
                    <span style="background:#001f3f; color:white; padding:4px 10px; border-radius:15px; font-size:0.85rem;">
                        ${tag}
                    </span>
                `).join('')}
            </div>
            ${currentRole === 'admin' ? `
            <button class="btn btn-secondary"
                style="margin-top:0.5rem; background:#dc3545; padding:0.3rem 1rem;"
                onclick="deleteReview(${r.id})">Delete</button>
            ` : ''}
        </div>
    `).join('');

    if (window.refreshCardTilt) window.refreshCardTilt();
}

async function deleteReview(reviewId) {
    if (!confirm('Delete this review?')) return;
    const { error } = await db.from('reviews').delete().eq('id', reviewId);
    if (error) { console.error('Error deleting review:', error); return; }
    renderReviews();
}

// ============================================================
// PRICING & PARTS DICTIONARY — public, static content. Every price
// is for the part only (labor is always free). Each device listing
// links to its dictionary entry with a plain #part-<id> anchor.
// ============================================================
const partsDictionary = {
    screen: {
        name: 'Screen (display)',
        does: 'Shows the picture and, on phones and tablets, senses your touch.',
        signs: [
            'Cracked or shattered glass',
            'Black, flickering, or striped display',
            'Touch doesn’t respond in some spots',
            'Dark blotches, lines, or dead pixels'
        ],
        search: 'Search "[your exact model] screen replacement". For phones and tablets, get the full display assembly (screen and touch layer together) unless we tell you only the glass is broken. For laptops, search "[your exact model] LCD panel", or the panel part number we give you.'
    },
    battery: {
        name: 'Battery',
        does: 'Stores power so the device runs when it’s unplugged.',
        signs: [
            'Dies quickly or shuts off with charge left',
            'Won’t charge past a certain percent',
            'Only works while plugged in',
            'Swollen: the screen or case is lifting or the back bulges. Stop using it and bring it in.'
        ],
        search: 'Search "[your exact model] replacement battery". Match the voltage and capacity (mAh or Wh) printed on the old battery, and buy from a seller with good reviews rather than the cheapest no-name listing.'
    },
    'charging-port': {
        name: 'Charging port',
        does: 'Where the charging cable plugs in. It carries power, and on phones and tablets, data too.',
        signs: [
            'Won’t charge, or charges only when the cable is held at an angle',
            'The cable feels loose or falls out',
            'Not recognized when plugged into a computer',
            'Lint in the port causes the same symptoms, so we’ll check and clean it before you buy anything'
        ],
        search: 'Phones and tablets: search "[your exact model] charging port flex cable". Laptops with a round charger plug: search "[your exact model] DC jack".'
    },
    'back-glass': {
        name: 'Back glass',
        does: 'The glass panel on the back of many phones. It protects the inside and lets wireless charging through.',
        signs: [
            'Cracked or shattered back',
            'Sharp edges or glass flaking off'
        ],
        search: 'Search "[your exact model] back glass replacement". Check whether it includes the camera lens cover and adhesive.'
    },
    camera: {
        name: 'Camera',
        does: 'Takes photos and video. Phones have separate front and rear cameras.',
        signs: [
            'Photos stay blurry and won’t focus',
            'Black screen in the camera app',
            'The lens shakes or clicks',
            'Cracked lens cover (sometimes only the cover needs replacing)'
        ],
        search: 'Search "[your exact model] rear camera" or "[your exact model] front camera". If only the lens cover is cracked, search "[your exact model] camera lens glass" instead. It costs much less.'
    },
    keyboard: {
        name: 'Laptop keyboard',
        does: 'The laptop’s built-in keys.',
        signs: [
            'Keys don’t work, stick, or type the wrong letter',
            'Keys are missing or broken off',
            'Damage after a spill'
        ],
        search: 'Search "[your exact model] replacement keyboard" and match the layout (US English) and whether it’s backlit. On some laptops the keyboard is built into the top case, so we’ll give you the exact part number.'
    },
    ram: {
        name: 'RAM (memory)',
        does: 'Short-term working memory. More RAM lets you run more apps and browser tabs at once.',
        signs: [
            'Very slow with several apps or tabs open',
            'Random freezes or blue screens',
            'Beeps or a blank screen when starting up',
            'Shows less memory than it should'
        ],
        search: 'Match what we tell you: type (DDR4 or DDR5), size, speed, and shape ("SO-DIMM" for laptops, "DIMM" for desktops). Example: "16GB DDR4 3200 SO-DIMM".'
    },
    ssd: {
        name: 'Storage (SSD)',
        does: 'Keeps your files, apps, and operating system, even with the power off.',
        signs: [
            'Takes minutes to start up, or is slow at everything',
            '"No boot device" or "operating system not found" message',
            'Files disappear or won’t open',
            'Clicking noises (older hard drives)'
        ],
        search: 'Match the connection we tell you: "M.2 NVMe", "M.2 SATA", or "2.5-inch SATA". Example: "1TB M.2 NVMe SSD". Stick to well-known brands, and ask us about moving your files over.'
    },
    charger: {
        name: 'Laptop charger',
        does: 'The power adapter that charges a laptop.',
        signs: [
            'The laptop won’t charge but the battery is fine',
            'Frayed or bent cable, or a loose tip',
            'The charger’s light doesn’t turn on',
            'Gets very hot'
        ],
        search: 'Match the wattage (W) and plug on your old charger or the bottom of the laptop. For USB-C laptops, get a USB-C PD charger with the same or higher wattage. Example: "65W USB-C laptop charger".'
    },
    'cooling-fan': {
        name: 'Cooling fan',
        does: 'Moves air through the computer so the processor doesn’t overheat.',
        signs: [
            'Loud grinding or rattling',
            'Gets very hot, then slows down or shuts off',
            'The fan never spins'
        ],
        search: 'Laptops: search "[your exact model] CPU cooling fan". Desktops: we’ll tell you the size (for example "120mm case fan") or which processor cooler fits.'
    },
    'power-supply': {
        name: 'Power supply (PSU)',
        does: 'Turns wall power into the power a desktop computer’s parts use.',
        signs: [
            'The computer won’t turn on at all',
            'Shuts off or restarts by itself under load',
            'Burning smell or buzzing. Unplug it and bring it in.'
        ],
        search: 'Match the wattage we recommend and the size (usually ATX), from a well-known brand with an 80 Plus rating. Example: "650W 80 Plus Bronze ATX power supply".'
    },
    'cmos-battery': {
        name: 'CMOS battery',
        does: 'A coin-sized battery that keeps a desktop’s clock and startup settings while it’s unplugged.',
        signs: [
            'The date and time reset whenever it’s unplugged',
            'Startup settings reset, or a "CMOS checksum" error'
        ],
        search: 'Almost always a "CR2032" coin battery, sold wherever batteries are.'
    }
};

const devicePriceList = [
    { device: 'Phone', repairs: [
        { part: 'screen', label: 'Screen', price: '$40–$150' },
        { part: 'battery', label: 'Battery', price: '$20–$50' },
        { part: 'charging-port', label: 'Charging port', price: '$10–$30' },
        { part: 'back-glass', label: 'Back glass', price: '$10–$40' },
        { part: 'camera', label: 'Camera', price: '$15–$60' }
    ] },
    { device: 'Tablet', repairs: [
        { part: 'screen', label: 'Screen', price: '$50–$200' },
        { part: 'battery', label: 'Battery', price: '$25–$60' },
        { part: 'charging-port', label: 'Charging port', price: '$10–$30' }
    ] },
    { device: 'Laptop', repairs: [
        { part: 'screen', label: 'Screen', price: '$60–$200' },
        { part: 'battery', label: 'Battery', price: '$30–$60' },
        { part: 'keyboard', label: 'Keyboard', price: '$20–$60' },
        { part: 'ram', label: 'RAM upgrade', price: '$20–$80' },
        { part: 'ssd', label: 'Storage (SSD)', price: '$30–$100' },
        { part: 'charger', label: 'Charger', price: '$20–$60' },
        { part: 'cooling-fan', label: 'Cooling fan', price: '$10–$30' }
    ] },
    { device: 'Computer (desktop)', repairs: [
        { part: 'ram', label: 'RAM upgrade', price: '$20–$80' },
        { part: 'ssd', label: 'Storage (SSD)', price: '$30–$100' },
        { part: 'power-supply', label: 'Power supply', price: '$40–$100' },
        { part: 'cooling-fan', label: 'Cooling fan', price: '$10–$30' },
        { part: 'cmos-battery', label: 'CMOS battery', price: '$3–$10' }
    ] }
];

// iPhones type curly apostrophes; the content uses them too.
function normalizeSearch(text) {
    return text.toLowerCase().replace(/[‘’]/g, "'");
}

function renderPricing() {
    document.getElementById('deviceGrid').innerHTML = devicePriceList.map(({ device, repairs }) => `
        <article class="device-card">
            <h4>${device}</h4>
            <ul class="price-list">
                ${repairs.map(r => `
                    <li>
                        <a class="part-link" href="#part-${r.part}" onclick="showPart('${r.part}')">${r.label}</a>
                        <span class="price">${r.price}</span>
                    </li>`).join('')}
            </ul>
        </article>`).join('');

    document.getElementById('partsList').innerHTML = Object.entries(partsDictionary).map(([id, p]) => `
        <article class="part-entry" id="part-${id}">
            <h4>${p.name}</h4>
            <dl>
                <dt>What it does</dt>
                <dd>${p.does}</dd>
                <dt>Signs it has failed</dt>
                <dd><ul>${p.signs.map(s => `<li>${s}</li>`).join('')}</ul></dd>
                <dt>What to search for</dt>
                <dd>${p.search.replace(/"([^"]+)"/g, '<span class="search-term">$1</span>')}</dd>
            </dl>
        </article>`).join('');
}

// Price links open the closed dictionary, then scroll themselves: the
// browser's own #hash jump runs before the dropdown has laid out.
function showPart(id) {
    document.getElementById('partsDetails').open = true;
    document.getElementById('partsSearch').value = '';
    filterParts('');
    document.getElementById('part-' + id).scrollIntoView();
}

function filterParts(query) {
    const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
    const entries = [...document.querySelectorAll('.part-entry')];
    entries.forEach(el => {
        const text = normalizeSearch(el.textContent);
        el.classList.toggle('hidden', !words.every(w => text.includes(w)));
    });
    document.getElementById('partsEmpty').classList.toggle('hidden', entries.some(el => !el.classList.contains('hidden')));
}

// ============================================================
// DISPLAY / UI
// ============================================================
function updateRoleDisplay() {
    const indicator = document.getElementById('roleIndicator');
    // The public page has no panels; dummies keep the code below simple.
    const adminPanel = document.getElementById('adminPanel') || document.createElement('div');
    const techToolbar = document.getElementById('techToolbar') || document.createElement('div');
    if (STAFF_PAGE) populateAppointmentsModal();

    if (currentRole === 'admin') {
        indicator.textContent = 'Admin';
        indicator.style.background = '#ffd700';
        indicator.style.color = '#333';
        indicator.classList.remove('hidden');
        adminPanel.style.display = 'block';
        techToolbar.style.display = 'none';
    } else if (currentRole === 'tech') {
        indicator.textContent = `${currentSession ? currentSession + ' ' : ''}Tech${currentTechName ? `: ${currentTechName}` : ''}`;
        indicator.style.background = '#4169e1';
        indicator.style.color = 'white';
        indicator.classList.remove('hidden');
        adminPanel.style.display = 'none';
        techToolbar.style.display = 'block';
    } else {
        indicator.classList.add('hidden');
        adminPanel.style.display = 'none';
        techToolbar.style.display = 'none';
    }

    document.querySelectorAll('[data-signed-out]').forEach(el => el.hidden = !!currentRole);
    document.querySelectorAll('[data-signed-in]').forEach(el => el.hidden = !currentRole);
    if (STAFF_PAGE && currentRole && !document.querySelector('.staff-view[style*="flex"]')) showHomeView();

    calculateTotalRepairs();
    renderReviews();
}

// ============================================================
// TICKET POOL (Admin) — every ticket as a folder, grouped by status.
// Opening one shows the same Ticket Workspace techs use, plus the
// admin's controls (assign students, delete). The search and filter
// controls live in index.html so typing doesn't rebuild them.
// ============================================================
async function onStatusFilterChange() {
    if (document.getElementById('statusFilter').value === 'deleted') await loadDeletedAppointments();
    populateAppointmentsModal();
}

function filterByEmail(email) {
    document.getElementById('nameSearch').value = email;
    document.getElementById('statusFilter').value = 'all';
    populateAppointmentsModal();
}

function emailCounts() {
    const counts = {};
    appointments.forEach(a => {
        if (a.email) counts[a.email.toLowerCase()] = (counts[a.email.toLowerCase()] || 0) + 1;
    });
    return counts;
}

function populateAppointmentsModal() {
    const container = document.getElementById('appointmentsContainer');
    if (!container) return;

    const query = document.getElementById('nameSearch').value.trim().toLowerCase();
    const filterStatus = document.getElementById('statusFilter').value;
    const sortOrder = document.getElementById('sortFilter').value;
    const matches = a => !query || a.name.toLowerCase().includes(query) || (a.email || '').toLowerCase().includes(query);
    const byDate = field => (a, b) => (sortOrder === 'newest' ? -1 : 1) * (new Date(a[field]) - new Date(b[field]));

    if (filterStatus === 'deleted') {
        const deleted = deletedAppointments.filter(matches).sort(byDate('deleted_at'));
        container.innerHTML = deleted.length === 0
            ? '<p style="text-align:center; color:#999;">No deleted tickets.</p>'
            : `<div class="folder-list">${deleted.map(appt => `
                <div class="folder-card" style="cursor:default;">
                    <span class="folder-top"><strong>Ticket #${appt.id} · ${escapeHtml(appt.name)}</strong> <span class="status-badge" style="background:#dc3545; color:white;">Deleted</span></span>
                    <span class="folder-issue">${escapeHtml(appt.make_model || appt.device)}: ${escapeHtml(appt.issue)}</span>
                    <span class="folder-meta">Deleted ${new Date(appt.deleted_at).toLocaleDateString()}</span>
                    <div class="ws-actions" style="margin-top:0.4rem;">
                        <button class="btn btn-approve btn-sm" onclick="restoreAppointment(${appt.id})">Restore</button>
                        <button class="btn btn-danger btn-sm" onclick="permanentlyDeleteAppointment(${appt.id})">Delete Forever</button>
                    </div>
                </div>`).join('')}</div>`;
        return;
    }

    const waiting = appointments.filter(a => a.status === 'review').length;
    document.getElementById('checkoffCount').textContent = waiting ? ` (${waiting} to check)` : '';

    const counts = emailCounts();
    const duplicateEmails = Object.keys(counts).filter(email => counts[email] > 1);
    const filtered = appointments
        .filter(matches)
        .filter(a => filterStatus === 'all' || a.status === filterStatus)
        .sort(byDate('created_at'));

    let html = '';
    if (duplicateEmails.length > 0) {
        html += `
        <div style="background:#fff3cd; border:1px solid #ffc107; border-radius:8px; padding:0.8rem; margin-bottom:1rem; font-size:0.9rem;">
            <strong>Possible duplicate tickets.</strong> Select an email to see its tickets:<br>
            ${duplicateEmails.map(email => `
                <button type="button" data-email="${escapeHtml(email)}" onclick="filterByEmail(this.dataset.email)"
                    style="background:#ffc107; color:#333; border:none; padding:2px 10px; border-radius:10px; margin:4px 4px 0 0; font-size:0.85rem; cursor:pointer;">
                    ${escapeHtml(email)} (${counts[email]})
                </button>`).join('')}
        </div>`;
    }

    if (filtered.length === 0) {
        container.innerHTML = html + '<p style="text-align:center; color:#999;">No tickets match your search.</p>';
        return;
    }

    const folder = appt => {
        const names = (appt.assigned_tech_ids || []).map(id => techs.find(t => t.id === id)?.name).filter(Boolean);
        const duplicate = appt.email && counts[appt.email.toLowerCase()] > 1;
        return `
        <button type="button" class="folder-card" onclick="openTicketWorkspace(${appt.id})">
            <span class="folder-top"><strong>Ticket #${appt.id} · ${escapeHtml(appt.name)}${duplicate ? ' <span class="dup-badge">duplicate</span>' : ''}</strong> ${statusBadge(appt.status)}</span>
            <span class="folder-issue">${escapeHtml(appt.make_model || appt.device)}: ${escapeHtml(appt.issue)}</span>
            <span class="folder-meta">${names.length ? escapeHtml(names.join(', ')) : 'No students yet'} <strong>Open →</strong></span>
        </button>`;
    };

    const groups = [['review', 'Needs your check-off'], ['pending', 'In the Pool: needs students'], ['assigned', 'Assigned'], ['in_progress', 'In Progress'], ['completed', 'Completed']];
    for (const [status, label] of groups) {
        const tickets = filtered.filter(a => a.status === status);
        if (tickets.length) html += `<h3 class="list-heading">${label} (${tickets.length})</h3><div class="folder-list">${tickets.map(folder).join('')}</div>`;
    }
    container.innerHTML = html;
}

// ============================================================
// MY TICKETS (Tech) — the student's tickets as folders. Opening one
// shows the Ticket Workspace, with room to log work, add parts, and
// preview the paperwork.
// ============================================================
function statusBadge(status) {
    const meta = trackStatusMeta[status];
    return `<span class="status-badge" style="background:${meta.color}; color:${meta.text};">${meta.staffLabel || meta.label}</span>`;
}

async function viewMyTickets() {
    await loadMyTimeLogs();

    const mine = appointments.filter(a => (a.assigned_tech_ids || []).includes(currentTechId));
    const active = mine.filter(a => a.status !== 'completed');
    const completed = mine.filter(a => a.status === 'completed');

    const folder = appt => {
        const hours = myTimeLogs
            .filter(l => l.ticket_id === appt.id)
            .reduce((sum, l) => sum + hoursBetween(l.start_time, l.end_time), 0);
        return `
        <button type="button" class="folder-card" onclick="openTicketWorkspace(${appt.id})">
            <span class="folder-top"><strong>Ticket #${appt.id} · ${escapeHtml(appt.name)}</strong> ${statusBadge(appt.status)}</span>
            <span class="folder-issue">${escapeHtml(appt.make_model || appt.device)}: ${escapeHtml(appt.issue)}</span>
            <span class="folder-meta">Your time: ${hours.toFixed(2)} hr <strong>Open →</strong></span>
        </button>`;
    };

    const container = document.getElementById('myTicketsContainer');
    if (mine.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; padding:2rem;">No tickets assigned to you yet.</p>';
    } else {
        container.innerHTML = `
            <div class="folder-list">${active.length ? active.map(folder).join('') : '<p style="text-align:center; color:#999;">No active tickets right now.</p>'}</div>
            ${completed.length ? `<h3 class="list-heading">Completed</h3><div class="folder-list">${completed.map(folder).join('')}</div>` : ''}`;
    }

    closeModal('ticketWorkspaceModal');
    openModal('myTicketsModal');
    renderTechGreeting();
}

// The hello at the top of Tech Tools: the time of day, the student's name,
// one friendly line (picked once per visit), and where their tickets stand.
const GREETING_LINES = [
    'Ready to fix something?',
    'What are we repairing today?',
    'Pick up where you left off.',
    'Stuck on a repair? Someone may have posted the fix in the Forum.',
    'Log your sessions as you go and your Hours sheet fills itself in.',
    ...({ 1: ['New week, new repairs.'], 5: ['Last push before the weekend.'] }[new Date().getDay()] || [])
];
const greetingLine = GREETING_LINES[Math.floor(Math.random() * GREETING_LINES.length)];

function renderTechGreeting() {
    const hour = new Date().getHours();
    const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    document.getElementById('techGreeting').textContent = `Good ${partOfDay}${currentTechName ? `, ${currentTechName}` : ''}`;

    const open = appointments.filter(a => a.status !== 'completed' && (a.assigned_tech_ids || []).includes(currentTechId));
    const sentBack = open.filter(a => a.status === 'in_progress' && a.review_note).length;
    const status = !open.length ? 'No open tickets right now.'
        : `You have ${open.length} open ticket${open.length === 1 ? '' : 's'}.` +
          (sentBack ? ` ${sentBack} came back from the admin with a note.` : '');
    document.getElementById('techGreetingLine').textContent = `${greetingLine} ${status}`;
}

let workspaceTicketId = null;
let workspaceLogs = [];

// The lists a ticket can be opened from; "←" goes back to the one used.
const WORKSPACE_LISTS = [
    { modal: 'myTicketsModal', label: 'My Tickets', back: () => viewMyTickets() },
    { modal: 'ticketPoolModal', label: 'Ticket Pool', back: () => { populateAppointmentsModal(); openModal('ticketPoolModal'); } },
    { modal: 'manageStudentsModal', label: 'Students', back: () => openManageStudents() }
];
let workspaceFrom = WORKSPACE_LISTS[0];

function leaveWorkspace() {
    closeModal('ticketWorkspaceModal');
    workspaceFrom.back();
}

// Every session on the ticket, from everyone on it, so the team sees
// what the others did (the same entries the Service Log prints).
async function openTicketWorkspace(apptId) {
    const { data, error } = await db.from('time_logs')
        .select('*')
        .eq('ticket_id', apptId)
        .order('work_date')
        .order('start_time');
    if (error) { console.error('Error loading time logs:', error); alert('Could not load this ticket.'); return; }

    workspaceTicketId = apptId;
    workspaceLogs = data;
    workspaceFrom = WORKSPACE_LISTS.find(l => document.getElementById(l.modal).style.display === 'flex') || workspaceFrom;
    WORKSPACE_LISTS.forEach(l => closeModal(l.modal));
    openModal('ticketWorkspaceModal');
    renderTicketWorkspace();
}

function isWorkspaceOpen() {
    return document.getElementById('ticketWorkspaceModal').style.display === 'flex';
}

// Admins get the same workspace with their controls added: customer
// details, choosing the students, and deleting. They log no sessions.
function renderTicketWorkspace() {
    const appt = appointments.find(a => a.id === workspaceTicketId);
    if (!appt || !isWorkspaceOpen()) return;
    const isAdmin = currentRole === 'admin';
    const techName = id => techs.find(t => t.id === id)?.name || 'Unknown';
    const team = (appt.assigned_tech_ids || []).map(techName);
    const duplicate = appt.email && emailCounts()[appt.email.toLowerCase()] > 1;

    const complete = `<button class="btn btn-approve" onclick="markCompleted(${appt.id})">Approve &amp; Complete</button>`;
    const sentBack = appt.review_note ? `<span style="flex-basis:100%;"><strong>↩ Sent back by the admin:</strong> ${escapeHtml(appt.review_note)}</span>` : '';
    const nextStep = {
        pending: '<span>Nobody is on this ticket yet. Pick students below to get it started.</span>',
        assigned: `<span>Ready to begin? Press Start Repair when you start working on it.</span>
                   <button class="btn btn-start" onclick="startProgress(${appt.id})">▶ Start Repair</button>`,
        in_progress: sentBack + (isAdmin
            ? `<span>The students are still working on it. You can check it off yourself once it's done.</span>${complete}`
            : `<span>Finished and tested? Send it to the admin to check off.</span>
               <button class="btn btn-review" onclick="requestCheckoff(${appt.id})">Ready for Check-Off</button>`),
        review: isAdmin
            ? `<span>The students say this repair is done. Check the device, then approve it or send it back with what's left to do.</span>
               <span class="ws-actions">${complete}<button class="btn btn-warn" onclick="sendBack(${appt.id})">↩ Send Back</button></span>`
            : '<span>Waiting for the admin to check it off. If they send it back, their note will show here.</span>',
        completed: '<span>This repair is complete. You can still print its paperwork below.</span>'
    }[appt.status] || '';

    const sessions = workspaceLogs.length ? workspaceLogs.map(l => `
        <div class="session">
            <div class="session-top">
                <strong>${new Date(l.work_date + 'T00:00:00').toLocaleDateString()} · ${formatTime12h(l.start_time)} to ${formatTime12h(l.end_time)} (${hoursBetween(l.start_time, l.end_time).toFixed(2)} hr)</strong>
                ${isAdmin || l.tech_id === currentTechId ? `<button class="link-danger" onclick="deleteTimeLog(${l.id})">Delete</button>` : ''}
            </div>
            <p><strong>${escapeHtml(techName(l.tech_id))}:</strong> ${l.note ? escapeHtml(l.note) : '<em>No note</em>'}</p>
        </div>`).join('')
        : '<p class="ws-hint" style="margin:0;">No sessions yet. Your first one will show up here.</p>';

    // Re-rendering after a save keeps the same sections open.
    const container = document.getElementById('ticketWorkspaceContainer');
    const wasOpen = container.dataset.ticket === String(appt.id)
        ? new Set([...container.querySelectorAll('details[open] h3')].map(h => h.textContent)) : new Set();
    container.dataset.ticket = appt.id;
    // Everything past the next step folds away; open shows a section from the start.
    const section = (title, body, { count = '', open = false } = {}) => `
        <details class="ws-card"${open || wasOpen.has(title) ? ' open' : ''}>
            <summary><h3>${title}</h3>${count ? `<span class="ws-count">${count}</span>` : ''}</summary>
            <div class="ws-body">${body}</div>
        </details>`;

    container.innerHTML = `
        <button class="ws-back" onclick="leaveWorkspace()">← ${workspaceFrom.label}</button>
        <div class="ws-header">
            <div>
                <p class="ws-eyebrow">Ticket #${appt.id} · ${escapeHtml([appt.make_model, appt.device].filter(Boolean).join(' · '))}</p>
                <h2>${escapeHtml(appt.name)}</h2>
            </div>
            ${statusBadge(appt.status)}
        </div>
        <dl class="ws-facts">
            <div><dt>Problem</dt><dd>${escapeHtml(appt.issue)}</dd></div>
            <div><dt>Team</dt><dd>${escapeHtml(team.join(', ') || 'Nobody yet')}</dd></div>
        </dl>
        ${nextStep ? `<div class="ws-next">${nextStep}</div>` : ''}

        ${isAdmin && appt.status !== 'completed' ? section('Students on this ticket', `
            <p class="ws-hint">Tick everyone working on it. If you hand it to new students, change it here. Their time starts a new Hours sheet.</p>
            <div class="ws-actions" style="margin-bottom:1rem;">
                ${techs.length ? techs.map(t => `
                    <label class="pick-chip"><input type="checkbox" class="assign-tech-${appt.id}" value="${t.id}" ${(appt.assigned_tech_ids || []).includes(t.id) ? 'checked' : ''}> ${escapeHtml(t.name)}</label>`).join('')
                    : '<span class="ws-hint">No students added yet. Add them under Manage Students.</span>'}
            </div>
            <button class="btn btn-primary" id="saveStudents-${appt.id}" onclick="updateTicketAssignment(${appt.id})">Save Students</button>`,
            { count: team.length ? `${team.length} on it` : 'Nobody yet', open: appt.status === 'pending' }) : ''}

        ${!isAdmin && appt.status !== 'completed' ? `
        <section class="ws-card">
            <h3>Log a work session</h3>
            <p class="ws-hint">Fill this in every time you work on the device. It goes on the Service Log and the Hours sheet.</p>
            <div class="ws-fields">
                <label>Date <input type="date" id="logDate-${appt.id}" value="${todayDateStr()}"></label>
                <label>Start time <select id="logStart-${appt.id}">${QUARTER_HOUR_OPTIONS}</select></label>
                <label>End time <select id="logEnd-${appt.id}">${QUARTER_HOUR_OPTIONS}</select></label>
            </div>
            <p class="ws-hint">Example: you worked from 1:15 to 2:00 in the afternoon, so pick 1:15 PM and 2:00 PM.</p>
            <label>What did you do?
                <textarea id="logNote-${appt.id}" rows="3" placeholder="Example: Took off the back panel and tested the battery. It only holds 40% charge. Next: the customer orders a new battery."></textarea>
            </label>
            <button class="btn btn-primary" onclick="logTime(${appt.id})">Save Session</button>
        </section>` : ''}

        ${section('Work so far', `
            <p class="ws-hint">Everyone's sessions on this ticket, oldest first.</p>
            ${sessions}`, { count: `${workspaceLogs.length} session${workspaceLogs.length === 1 ? '' : 's'}` })}

        ${section('Parts', `
            <p class="ws-hint">List any part the customer bought for this repair. Leave it blank if the repair didn't need one.</p>
            <label>Parts used <input type="text" id="parts-${appt.id}" value="${escapeHtml(appt.parts_used || '')}" placeholder="Example: Battery for Dell Latitude 5420"></label>
            <button class="btn btn-outline" onclick="saveTicketParts(${appt.id}, this)">Save Parts</button>`,
            { count: appt.parts_used ? escapeHtml(appt.parts_used) : 'None yet' })}

        ${section('Paperwork', `
            <p class="ws-hint">Open a form to check what's on it, then print it.</p>
            ${paperworkButtons(appt.id)}`)}

        ${section('Ticket details', `
            <dl class="ws-facts">
                ${appt.tracking_code ? `<div><dt>Tracking code</dt><dd><strong>${appt.tracking_code}</strong>
                    <button class="btn btn-outline btn-chip" onclick="copyText('${appt.tracking_code}', this)">Copy</button></dd></div>` : ''}
                ${appt.serial_tag ? `<div><dt>Serial tag</dt><dd>${escapeHtml(appt.serial_tag)}</dd></div>` : ''}
                ${appt.computer_password ? `<div><dt>Computer password</dt><dd>${escapeHtml(appt.computer_password)}</dd></div>` : ''}
                ${appt.class_name || appt.room_number ? `<div><dt>Class and room</dt><dd>${escapeHtml([appt.class_name, appt.room_number && `Room ${appt.room_number}`].filter(Boolean).join(' · '))}</dd></div>` : ''}
                ${isAdmin ? `
                <div><dt>Contact number</dt><dd>${escapeHtml(appt.contact_number || 'None given')}</dd></div>
                <div><dt>Customer email</dt><dd>${escapeHtml(appt.email || 'None given')}${duplicate ? ' <span class="dup-badge">has other tickets</span>' : ''}</dd></div>
                <div><dt>Created</dt><dd>${new Date(appt.created_at).toLocaleDateString()}${appt.created_by ? ` by ${escapeHtml(appt.created_by)}` : ''}</dd></div>` : ''}
            </dl>`, { count: appt.tracking_code || '' })}

        ${isAdmin ? section('Delete ticket', `
            <p class="ws-hint">Takes it out of the pool. You can bring it back from the Deleted filter.</p>
            <button class="btn btn-danger" onclick="deleteAppointment(${appt.id})">Delete Ticket</button>`) : ''}`;
}

// ============================================================
// TIME TRACKING — hours a tech logs per ticket, per day. Feeds both
// the "Log time worked" control on each ticket and the "My Hours" tab
// they use to transfer entries onto the school's paper time sheet.
// ============================================================
async function loadMyTimeLogs() {
    if (!currentTechId) { myTimeLogs = []; return; }

    const { data, error } = await db.from('time_logs')
        .select('*')
        .eq('tech_id', currentTechId)
        .order('work_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) { console.error('Error loading time logs:', error); return; }
    myTimeLogs = data || [];
}

function todayDateStr() {
    return new Date().toISOString().slice(0, 10);
}

// start/end come from <input type="time"> as "HH:MM" (24h) — the same
// format Postgres' `time` column round-trips, so no conversion on the way in.
function hoursBetween(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

// Sessions are logged in quarter hours (017 enforces it): 6:00 AM to 6:00 PM.
const QUARTER_HOUR_OPTIONS = '<option value="">Choose a time</option>' +
    Array.from({ length: 49 }, (_, i) => {
        const minutes = 6 * 60 + i * 15;
        const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        return `<option value="${value}">${formatTime12h(value)}</option>`;
    }).join('');

function formatTime12h(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

async function logTime(ticketId) {
    const dateField = document.getElementById(`logDate-${ticketId}`);
    const startField = document.getElementById(`logStart-${ticketId}`);
    const endField = document.getElementById(`logEnd-${ticketId}`);
    const workDate = dateField.value;
    const startTime = startField.value;
    const endTime = endField.value;

    if (!workDate) { alert('Please pick the date you worked on this.'); return; }
    if (!startTime || !endTime) { alert('Please enter the time you started and finished.'); return; }
    if (hoursBetween(startTime, endTime) <= 0) { alert('End time must be after start time.'); return; }

    const { error } = await db.from('time_logs').insert({
        ticket_id: ticketId,
        tech_id: currentTechId,
        work_date: workDate,
        start_time: startTime,
        end_time: endTime,
        note: document.getElementById(`logNote-${ticketId}`).value.trim() || null
    });

    if (error) { console.error('Error logging time:', error); alert('Failed to log time.'); return; }

    await openTicketWorkspace(ticketId);
}

async function deleteTimeLog(logId) {
    if (!confirm('Delete this time entry?')) return;

    const { error } = await db.from('time_logs').delete().eq('id', logId);
    if (error) { console.error('Error deleting time log:', error); return; }

    myTimeLogs = myTimeLogs.filter(l => l.id !== logId);
    workspaceLogs = workspaceLogs.filter(l => l.id !== logId);

    renderTicketWorkspace();
    if (document.getElementById('myHoursModal').style.display === 'flex') renderMyHours();
}

async function openMyHours() {
    await loadMyTimeLogs();
    renderMyHours();
    openModal('myHoursModal');
}

function renderMyHours() {
    const container = document.getElementById('myHoursContainer');
    if (!container) return;

    if (myTimeLogs.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; padding:2rem;">No hours logged yet.</p>';
        return;
    }

    const total = myTimeLogs.reduce((sum, l) => sum + hoursBetween(l.start_time, l.end_time), 0);

    const rows = myTimeLogs.map(l => {
        const ticket = appointments.find(a => a.id === l.ticket_id);
        const label = ticket ? `${ticket.name} - ${ticket.device}` : 'Deleted ticket';
        return `
            <tr>
                <td style="padding:0.4rem; border-bottom:1px solid #eee;">${new Date(l.work_date + 'T00:00:00').toLocaleDateString()}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #eee;">${label}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #eee; white-space:nowrap;">${formatTime12h(l.start_time)} – ${formatTime12h(l.end_time)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #eee; text-align:right;">${hoursBetween(l.start_time, l.end_time).toFixed(2)}</td>
                <td style="padding:0.4rem; border-bottom:1px solid #eee; text-align:right;"><span style="cursor:pointer; color:#dc3545;" onclick="deleteTimeLog(${l.id})" title="Delete entry">✕</span></td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <p style="font-size:0.9rem; color:#555; margin-bottom:1rem;">Use this to fill in your paper time sheet.</p>
        <table style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="text-align:left; border-bottom:2px solid #001f3f;">
                    <th style="padding:0.4rem;">Date</th>
                    <th style="padding:0.4rem;">Ticket</th>
                    <th style="padding:0.4rem;">Time</th>
                    <th style="padding:0.4rem; text-align:right;">Hours</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr style="font-weight:bold; border-top:2px solid #001f3f;">
                    <td style="padding:0.4rem;" colspan="3">Total</td>
                    <td style="padding:0.4rem; text-align:right;">${total.toFixed(2)}</td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    `;
}

// ============================================================
// PRINTABLE FORMS — the paper Service Log (printed from the page) and
// the WBL Hours sheet and Help Desk Ticket (the school's own .docx files,
// filled in the browser).
// Tickets and time logs are staff-only in the database (008), so these
// only fill in for a logged-in admin or tech. Each form opens in the
// Paper Preview first: the Service Log as HTML (printed by copying it
// into #printArea, the only thing shown when printing) and the Hours
// sheets as the real .docx, drawn by docx-preview.
// ============================================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function paperworkButtons(apptId) {
    return `
        <div class="ws-actions" style="margin:0.4rem 0;">
            <button class="btn btn-outline btn-sm" onclick="previewHelpDesk(${apptId})">Help Desk Ticket</button>
            <button class="btn btn-outline btn-sm" onclick="previewServiceLog(${apptId})">Service Log</button>
            <button class="btn btn-outline btn-sm" onclick="previewHoursSheets(${apptId}, 'creation')">Hours: Ticket Creation</button>
            <button class="btn btn-outline btn-sm" onclick="previewHoursSheets(${apptId}, 'repair')">Hours: Repair Work</button>
        </div>`;
}

function openPaperPreview(title, note, actionsHtml) {
    document.getElementById('paperPreviewTitle').textContent = title;
    document.getElementById('paperPreviewNote').textContent = note;
    document.getElementById('paperPreviewActions').innerHTML = actionsHtml;
    openModal('paperPreviewModal');
    return document.getElementById('paperPreviewSheets');
}

// The sheets are letter width; shrink them to fit the preview.
function fitPaperPreview() {
    const box = document.getElementById('paperPreviewSheets');
    const room = box.clientWidth - 32;
    box.querySelectorAll('.print-sheet, section.docx').forEach(page => {
        page.style.zoom = '';
        page.style.zoom = Math.min(1, room / page.offsetWidth);
    });
}

async function previewServiceLog(apptId) {
    const appt = appointments.find(a => a.id === apptId);
    const { data: logs, error } = await db.from('time_logs')
        .select('*')
        .eq('ticket_id', apptId)
        .order('work_date')
        .order('start_time');
    if (error) { console.error('Error loading time logs:', error); alert('Could not load the time logged on this ticket.'); return; }

    const techName = id => techs.find(t => t.id === id)?.name || '';
    const studentNames = (appt.assigned_tech_ids || []).map(techName).filter(Boolean);
    const sheets = openPaperPreview(`Service Log · Ticket #${appt.id}`,
        'Each work session with a note fills a dated row. Write the date completed and accessories by hand.',
        PRINT_BUTTON);
    sheets.innerHTML = serviceLogHtml(appt, logs, studentNames, techName);
    fitPaperPreview();
}

// The school's Word forms render as HTML with docx-preview, one section
// per page, so they preview and print like the Service Log.
async function renderDocxPages(blobs, container) {
    container.innerHTML = '';
    for (const blob of blobs) {
        const page = document.createElement('div');
        container.append(page);
        await docx.renderAsync(blob, page, null, { inWrapper: false, ignoreLastRenderedPageBreak: true });
    }
    fitPaperPreview();
}

const PRINT_BUTTON = '<button class="btn btn-primary" onclick="printPaperPreview()">Print</button>';

function printPaperPreview() {
    const area = document.getElementById('printArea');
    area.innerHTML = document.getElementById('paperPreviewSheets').innerHTML;
    area.querySelectorAll('.print-sheet, section.docx').forEach(page => page.style.zoom = '');
    window.addEventListener('afterprint', () => { area.innerHTML = ''; }, { once: true });
    window.print();
}

async function previewHoursSheets(apptId, kind) {
    const blobs = await buildHoursSheets(apptId, kind);
    if (!blobs) return;

    const label = kind === 'creation' ? 'Ticket Creation' : 'Repair Work';
    const note = kind === 'creation'
        ? 'Credits 30 minutes to the students on the ticket when it was created.'
        : 'Each logged session fills a date line. A new team or a sixth session starts another sheet.';
    const sheets = openPaperPreview(`Hours: ${label} · Ticket #${apptId}`, note, PRINT_BUTTON);
    await renderDocxPages(blobs, sheets);
}

// The school's Help Desk Ticket with {{KEY}} after each label (see
// scripts/make-help-desk-template.py). Signatures stay blank for the customer.
const HELP_DESK_TEMPLATE = 'forms/help-desk-template.docx';

async function previewHelpDesk(apptId) {
    const appt = appointments.find(a => a.id === apptId);
    const response = await fetch(HELP_DESK_TEMPLATE);
    if (!response.ok) { alert('Could not load the Help Desk Ticket.'); return; }
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const values = {
        INTAKE: `#${appt.id}`,
        CUSTOMER: appt.name,
        CONTACT: appt.contact_number,
        CLASS: appt.class_name,
        ROOM: appt.room_number,
        MODEL: [appt.make_model, appt.device && `(${appt.device})`].filter(Boolean).join(' '),
        SERIAL: appt.serial_tag,
        PASSWORD: appt.computer_password,
        PROBLEM: (appt.issue || '').replace(/\s+/g, ' '),
        TECH: appt.created_by,
        DATE: new Date(appt.created_at).toLocaleDateString()
    };
    const xml = (await zip.file('word/document.xml').async('string'))
        .replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(values[key] || ''));
    zip.file('word/document.xml', xml);

    const sheets = openPaperPreview(`Help Desk Ticket · Ticket #${appt.id}`,
        'Print this when the device comes in and have the customer sign both pages.', PRINT_BUTTON);
    await renderDocxPages([await zip.generateAsync({ type: 'blob' })], sheets);
}

function serviceLogHtml(appt, logs, studentNames, techName) {
    const session = id => techs.find(t => t.id === id)?.session || 'PM';
    const amPm = id => session(id) === 'AM' ? '<span class="circled">AM</span> or PM' : 'AM or <span class="circled">PM</span>';
    const rows = logs.filter(l => l.note).map(l => `
        <tr>
            <th>${new Date(l.work_date + 'T00:00:00').toLocaleDateString()}<br>${amPm(l.tech_id)}</th>
            <td><strong>${escapeHtml(techName(l.tech_id))}:</strong> ${escapeHtml(l.note)}</td>
        </tr>`);
    while (rows.length < 7) rows.push('<tr class="blank-row"><th>Date<br>AM or PM</th><td></td></tr>');

    return `
    <div class="print-sheet service-log">
        <h1>SERVICE-LOG</h1>
        <table>
            <tr><th>Start date</th><td>${new Date(appt.created_at).toLocaleDateString()}</td></tr>
            <tr><th>Intake #</th><td>Ticket #${appt.id}${appt.tracking_code ? ` &nbsp;·&nbsp; Tracking code: ${escapeHtml(appt.tracking_code)}` : ''}</td></tr>
            <tr><th>Model of computer</th><td>${escapeHtml(appt.make_model || appt.device)}</td></tr>
            <tr><th>Serial Number</th><td>${escapeHtml(appt.serial_tag || '')}</td></tr>
            <tr><th>Description of problem</th><td>${escapeHtml(appt.issue)}</td></tr>
            <tr><th>Date completed</th><td></td></tr>
            <tr><th>Tech Names</th><td>${escapeHtml(studentNames.join(', '))}</td></tr>
            <tr><th>Customer accessories</th><td></td></tr>
            <tr>
                <th>NOTES</th>
                <td class="instructions">To receive additional credit:<br>Please circle whether the notes are coming from AM or PM.<br>Enter Date of note.<br>Enter your name of who worked on device<br>Your notes should include work done and what needs to be done.</td>
            </tr>
            ${rows.join('')}
        </table>
    </div>`;
}

// The school's own WBL Hours .docx with each blank's underscores swapped
// for {{KEY.i:n}} (see scripts/make-hours-template.py). Filling puts the
// value where the underscores were and pads with non-breaking spaces so the
// rest of the line stays put; an unfilled blank gets its underscores back.
const HOURS_TEMPLATE = 'forms/wbl-hours-template.docx';

function fillHoursTemplate(xml, values) {
    const used = {};
    return xml.replace(/\{\{(\w+)\.(\d+):(\d+)\}\}/g, (_, key, i, n) => {
        const value = values[key];
        if (!value) return '_'.repeat(n);
        const room = Math.min(n, Math.max(0, value.length - (used[key] || 0)));
        used[key] = (used[key] || 0) + room;
        return (i === '0' ? escapeHtml(value) : '') + ' '.repeat((n - room) * 2);
    });
}

// 'creation': one 30-minute session starting when the ticket was created,
// credited to everyone on the ticket at creation. 'repair': every logged
// session, grouped by who was on the ticket when it was logged, so a
// handoff to other students starts new sheets (see 013_hours_teams.sql).
async function buildHoursSheets(apptId, kind) {
    const appt = appointments.find(a => a.id === apptId);
    const teamNames = ids => (ids || []).map(id => techs.find(t => t.id === id)?.name).filter(Boolean);
    const teamSessions = ids => new Set((ids || []).map(id => techs.find(t => t.id === id)?.session || 'PM'));
    let teams;

    if (kind === 'creation') {
        const start = new Date(appt.created_at);
        start.setMinutes(start.getMinutes() - start.getMinutes() % 15, 0, 0); // 1:19 counts as 1:15
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const hhmm = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        teams = [{
            names: teamNames(appt.creation_tech_ids),
            classes: teamSessions(appt.creation_tech_ids),
            sessions: [{ date: start.toLocaleDateString(), start: formatTime12h(hhmm(start)), end: formatTime12h(hhmm(end)) }]
        }];
    } else {
        const { data: logs, error } = await db.from('time_logs')
            .select('work_date, start_time, end_time, team_tech_ids')
            .eq('ticket_id', apptId)
            .order('work_date')
            .order('start_time');
        if (error) { console.error('Error loading time logs:', error); alert('Could not load the time logged on this ticket.'); return; }
        if (!logs.length) { alert('No time has been logged on this ticket yet.'); return; }

        const byTeam = new Map();
        for (const l of logs) {
            const key = [...(l.team_tech_ids || [])].sort((a, b) => a - b).join(',');
            if (!byTeam.has(key)) byTeam.set(key, { names: teamNames(l.team_tech_ids), classes: teamSessions(l.team_tech_ids), sessions: new Map() });
            // Students who worked a session together each log it; list it once.
            byTeam.get(key).sessions.set(`${l.work_date} ${l.start_time} ${l.end_time}`, {
                date: new Date(l.work_date + 'T00:00:00').toLocaleDateString(),
                start: formatTime12h(l.start_time),
                end: formatTime12h(l.end_time)
            });
        }
        teams = [...byTeam.values()].map(t => ({ ...t, sessions: [...t.sessions.values()] }));
    }

    // The form has five date lines, so more sessions go on another sheet.
    const sheets = teams.flatMap(t => Array.from({ length: Math.ceil(t.sessions.length / 5) },
        (_, i) => ({ ...t, sessions: t.sessions.slice(i * 5, i * 5 + 5) })));

    const response = await fetch(HOURS_TEMPLATE);
    if (!response.ok) { alert('Could not load the Hours sheet template.'); return; }
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const blobs = [];

    for (const sheet of sheets) {
        const values = { DEVICE: `Ticket #${appt.id}`, AM: sheet.classes.has('AM') ? '✔' : '', PM: sheet.classes.has('PM') ? '✔' : '' };
        // ponytail: the form has 6 name lines; a 7th student on one team is left off
        sheet.names.slice(0, 6).forEach((name, j) => { values[`NAME${j + 1}`] = name; });
        sheet.sessions.forEach((s, j) => {
            values[`DATE${j + 1}`] = s.date;
            values[`START${j + 1}`] = s.start;
            values[`END${j + 1}`] = s.end;
        });

        zip.file('word/document.xml', fillHoursTemplate(xml, values));
        blobs.push(await zip.generateAsync({ type: 'blob' }));
    }
    return blobs;
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) {
    if (document.getElementById(id).classList.contains('staff-view')) { showView(id); return; }
    document.getElementById(id).style.display = 'flex';
    if (id === 'updateStatsModal') populateStatsModal();
    if (id === 'reviewModal') updateReviewTags();
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Staff page sections (staff.html): one shows at a time under the tabs,
// and an open ticket takes the tabs' place.
function showView(id) {
    document.querySelectorAll('.staff-view').forEach(v => v.style.display = v.id === id ? 'flex' : 'none');
    document.querySelectorAll('.staff-tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === id));
    document.querySelectorAll('.staff-tabs').forEach(t => t.hidden = id === 'ticketWorkspaceModal');
}

// Where each role lands: a tech's tickets, or the admin's Ticket Pool.
function showHomeView() {
    if (currentRole === 'tech') viewMyTickets();
    else if (currentRole === 'admin') { populateAppointmentsModal(); showView('ticketPoolModal'); }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

// The role badge leads back to the staff tools from the public page;
// on the staff page a tech uses it to switch students.
function onRoleIndicatorClick() {
    if (!STAFF_PAGE) location.href = 'staff.html';
    else if (currentRole === 'tech') openTechPicker();
}

// ============================================================
// START — waits for DOM so window.supabase is guaranteed loaded
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!STAFF_PAGE) renderPricing();

    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            fetch: (url, options = {}) => {
                const headers = new Headers(options.headers);
                if (staffToken) headers.set('x-staff-token', staffToken);
                return fetch(url, { ...options, headers });
            }
        }
    });

    // The role comes from the server, not sessionStorage, so an expired
    // or forged session just lands on the public view.
    staffToken = sessionStorage.getItem('bocesStaffToken');
    if (staffToken) {
        const { data: role } = await db.rpc('current_staff_role');
        if (role) {
            currentRole = role;
            if (role === 'tech') currentSession = (await db.rpc('current_staff_group')).data;
            const savedTechId = sessionStorage.getItem('bocesTechId');
            if (savedTechId) currentTechId = parseInt(savedTechId);
        } else {
            staffToken = null;
            sessionStorage.removeItem('bocesStaffToken');
            sessionStorage.removeItem('bocesTechId');
        }
    }

    if (STAFF_PAGE && !currentRole) openModal('loginModal');
    await loadData();
    if (STAFF_PAGE && currentRole === 'tech' && !currentTechId) openTechPicker();
});
