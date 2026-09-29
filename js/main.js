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
let myTimeLogs = [];
let deletedAppointments = [];
// Session token from staff_login(). Sent as x-staff-token on every
// request so the database's row-level security can tell staff apart
// from the public — tickets, students and hours are staff-only.
let staffToken = null;

// ============================================================
// LOAD ALL DATA FROM SUPABASE ON PAGE START
// ============================================================
async function loadData() {
    await Promise.all([
        loadAppointments(),
        loadStats(),
        loadTechs(),
        renderReviews()
    ]);
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
        document.getElementById('totalRepairs').textContent = totalRepairs;
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
    if (!currentTechId) return;
    const tech = techs.find(t => t.id === currentTechId);
    if (tech) {
        currentTechName = tech.name;
    } else {
        currentTechId = null;
        currentTechName = null;
        sessionStorage.removeItem('bocesTechId');
    }
}

// ============================================================
// LOGIN
// ============================================================
async function login() {
    const role = document.getElementById('loginRole').value;
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
    currentRole = role;
    sessionStorage.setItem('bocesStaffToken', token);
    closeModal('loginModal');
    document.getElementById('loginPassword').value = '';

    // Tickets, students and hours only come back once the token is set.
    await loadData();

    if (role === 'tech') {
        const savedTechId = sessionStorage.getItem('bocesTechId');
        if (savedTechId && techs.find(t => t.id === parseInt(savedTechId))) {
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
    currentRole = null;
    currentTechId = null;
    currentTechName = null;
    appointments = [];
    deletedAppointments = [];
    techs = [];
    myTimeLogs = [];
    sessionStorage.removeItem('bocesStaffToken');
    sessionStorage.removeItem('bocesTechId');
    updateRoleDisplay();
}

// ============================================================
// TECH IDENTITY (picker shown after "Tech" login)
// ============================================================
function openTechPicker() {
    const container = document.getElementById('techPickerContainer');

    if (techs.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#999;">No students have been added yet. Ask your teacher to add you in Manage Students.</p>';
    } else {
        container.innerHTML = techs.map(t => `<button type="button" class="tech-pick-btn" onclick="selectTech(${t.id})">${t.name}</button>`).join('');
    }

    openModal('techPickerModal');
}

function selectTech(techId, showAlert = true) {
    const tech = techs.find(t => t.id === techId);
    if (!tech) return;

    currentTechId = tech.id;
    currentTechName = tech.name;
    sessionStorage.setItem('bocesTechId', tech.id);

    closeModal('techPickerModal');
    updateRoleDisplay();
    if (showAlert) alert(`Welcome, ${tech.name}!`);
}

// ============================================================
// STUDENTS (Admin) — just a name. No project/group of any kind;
// who's working what is decided per-ticket in the Ticket Pool.
// ============================================================
function openManageStudents() {
    populateManageStudentsModal();
    openModal('manageStudentsModal');
}

function populateManageStudentsModal() {
    const container = document.getElementById('manageStudentsContainer');
    if (!container) return;

    let html = `
        <div class="form-group" style="border-bottom: 1px solid var(--border); padding-bottom: 1.25rem; margin-bottom: 1.25rem;">
            <label for="newStudentName">Add Student</label>
            <div style="display:flex; gap:8px;">
                <input type="text" id="newStudentName" placeholder="Student name" style="flex:1;" onkeydown="if(event.key==='Enter'){addStudent();}">
                <button class="btn btn-primary" style="background:#003d7a; color:white;" onclick="addStudent()">Add</button>
            </div>
        </div>
    `;

    if (techs.length === 0) {
        html += '<p style="text-align:center; color:#999;">No students yet.</p>';
    } else {
        html += techs.map(t => `
            <div class="tech-row">
                <strong>${t.name}</strong>
                <button class="btn btn-secondary" style="padding:0.3rem 0.8rem; background:#dc3545; color:white; border:none;" onclick="removeStudent(${t.id})">Remove</button>
            </div>
        `).join('');
    }

    container.innerHTML = html;
}

async function addStudent() {
    const input = document.getElementById('newStudentName');
    const name = input.value.trim();

    if (!name) { alert('Please enter a name'); return; }

    const { data, error } = await db.from('techs').insert({ name }).select().single();
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
    const others = techs.filter(t => t.id !== currentTechId);
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

async function submitTechTicket() {
    const name = document.getElementById('techApptName').value.trim();
    const email = document.getElementById('techApptEmail').value.trim().toLowerCase();
    const device = document.getElementById('techApptDevice').value;
    const issue = document.getElementById('techApptIssue').value.trim();

    if (!name || !issue) {
        alert('Please fill in the customer name and issue.');
        return;
    }

    let data, error;
    for (let attempt = 0; attempt < 5; attempt++) {
        const trackingCode = generateTrackingCode();
        ({ data, error } = await db.from('repair_requests').insert({
            name,
            email,
            device,
            issue,
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
    closeModal('techTicketModal');

    document.getElementById('techApptName').value = '';
    document.getElementById('techApptEmail').value = '';
    document.getElementById('techApptIssue').value = '';

    alert(`Ticket created!\n\nTracking code: ${data.tracking_code}\n\nGive this to the customer — they can enter it on the site under "Track Repair" to check their status.`);
}

// ============================================================
// PUBLIC TICKET TRACKING (lookup by code, no login needed)
// ============================================================
const trackStatusMeta = {
    pending: { label: 'In the Pool', color: '#ffc107', text: '#333' },
    assigned: { label: 'Assigned', color: '#17a2b8', text: 'white' },
    in_progress: { label: 'In Progress', color: '#0d6efd', text: 'white' },
    completed: { label: 'Completed', color: '#28a745', text: 'white' }
};

async function trackRepair() {
    const input = document.getElementById('trackCodeInput');
    const result = document.getElementById('trackResult');
    const code = input.value.trim().toUpperCase();

    if (!code) {
        result.innerHTML = '<p style="color:#dc3545; margin-top:1rem;">Please enter a tracking code.</p>';
        return;
    }

    result.innerHTML = '<p style="color:#777; margin-top:1rem;">Looking up your repair...</p>';

    const { data, error } = await db.rpc('track_repair', { p_code: code }).maybeSingle();

    if (error) {
        console.error('Error tracking repair:', error);
        result.innerHTML = '<p style="color:#dc3545; margin-top:1rem;">Something went wrong. Please try again.</p>';
        return;
    }

    if (!data) {
        result.innerHTML = '<p style="color:#dc3545; margin-top:1rem;">No repair found with that code. Double-check it and try again.</p>';
        return;
    }

    const meta = trackStatusMeta[data.status] || { label: data.status, color: '#999', text: 'white' };
    result.innerHTML = `
        <div class="info-card" style="text-align:left; margin-top:1rem;">
            <h3>${data.device}</h3>
            <p style="color:#555;"><em>${data.issue}</em></p>
            <span class="status-badge" style="background:${meta.color}; color:${meta.text}; margin-top:0.5rem;">${meta.label}</span>
            <p style="margin-top:0.8rem; font-size:0.85rem; color:#999;">Submitted ${new Date(data.created_at).toLocaleDateString()}</p>
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
    alert('Assignment updated!');
}

async function startProgress(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'in_progress' }).eq('id', apptId);
    if (error) { console.error('Error starting progress:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'in_progress';

    populateAppointmentsModal();
    if (document.getElementById('myTicketsModal').style.display === 'flex') viewMyTickets();
}

async function saveTicketParts(apptId) {
    const partsUsed = document.getElementById(`parts-${apptId}`).value.trim();

    const { error } = await db.from('repair_requests').update({ parts_used: partsUsed }).eq('id', apptId);
    if (error) { console.error('Error saving parts:', error); alert('Failed to save parts.'); return; }

    appointments.find(a => a.id === apptId).parts_used = partsUsed;
    alert('Parts saved!');
}

async function markCompleted(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'completed' }).eq('id', apptId);
    if (error) { console.error('Error marking complete:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'completed';

    await syncStats();
    populateAppointmentsModal();
    if (document.getElementById('myTicketsModal').style.display === 'flex') viewMyTickets();
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
    populateAppointmentsModal();
}

async function restoreAppointment(apptId) {
    const { data, error } = await db.from('repair_requests').update({ deleted_at: null }).eq('id', apptId).select().single();
    if (error) { console.error('Error restoring ticket:', error); return; }

    deletedAppointments = deletedAppointments.filter(a => a.id !== apptId);
    appointments.push(data);
    await syncStats();
    populateAppointmentsModal(document.getElementById('nameSearch')?.value || '', 'deleted', document.getElementById('sortFilter')?.value || 'newest');
}

async function permanentlyDeleteAppointment(apptId) {
    if (!confirm('Permanently delete this ticket? This cannot be undone.')) return;

    const { error } = await db.from('repair_requests').delete().eq('id', apptId);
    if (error) { console.error('Error permanently deleting:', error); return; }

    deletedAppointments = deletedAppointments.filter(a => a.id !== apptId);
    populateAppointmentsModal(document.getElementById('nameSearch')?.value || '', 'deleted', document.getElementById('sortFilter')?.value || 'newest');
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
    if (!currentRole) return;
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

    document.getElementById('totalRepairs').textContent = totalRepairs;
    closeModal('updateStatsModal');
    alert('Statistics updated!');
}

// ============================================================
// REVIEWS
// ============================================================
// Tags for each star level
const reviewTagsByRating = {
    5: [
        '⚡ Super fast repair',
        '😊 Incredibly friendly',
        '💯 Outstanding service',
        '🔧 Perfectly fixed',
        '📱 Handled with great care',
        '💬 Excellent communication',
        '💰 Amazing value',
        '🎓 Very knowledgeable',
        '⏱️ Finished ahead of time',
        '👍 Highly recommend',
        '🌟 Exceeded expectations',
        '🏆 Best repair experience'
    ],
    4: [
        '⚡ Fast repair',
        '😊 Friendly staff',
        '💯 Great service',
        '🔧 Fixed my issue',
        '📱 Handled my device carefully',
        '💬 Good communication',
        '💰 Good value',
        '🎓 Knowledgeable team',
        '⏱️ Completed on time',
        '👍 Would recommend',
        '🔄 Minor issue but resolved'
    ],
    3: [
        '⏱️ Took a bit longer than expected',
        '💬 Communication could improve',
        '🔧 Issue was mostly fixed',
        '😐 Experience was okay',
        '💰 Fair value',
        '📋 Could be more organized',
        '🔄 Needed a follow-up visit',
        '👍 Decent service overall'
    ],
    2: [
        '⏳ Took too long',
        '💬 Poor communication',
        '🔧 Issue not fully resolved',
        '😞 Disappointing experience',
        '💰 Not worth the wait',
        '📋 Disorganized process',
        '❓ Unclear about repair status',
        '🔄 Had to come back multiple times'
    ],
    1: [
        '❌ Issue not fixed at all',
        '😠 Very poor experience',
        '⏳ Extremely long wait',
        '💬 No communication',
        '📱 Device not handled carefully',
        '💰 Waste of time',
        '👎 Would not recommend',
        '😔 Very disappointed'
    ]
};

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

    const comment = selectedTags.join(' · ');

    const { error } = await db.from('reviews').insert({ rating, comment });
    if (error) { console.error('Error submitting review:', error); alert('Failed to submit review.'); return; }

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
    populateAppointmentsModal();
    const indicator = document.getElementById('roleIndicator');
    const adminPanel = document.getElementById('adminPanel');
    const techToolbar = document.getElementById('techToolbar');
    const navLoginBtn = document.querySelector('.btn-nav-login');

    if (currentRole === 'admin') {
        indicator.textContent = 'Admin';
        indicator.style.background = '#ffd700';
        indicator.style.color = '#333';
        indicator.classList.remove('hidden');
        adminPanel.style.display = 'block';
        techToolbar.style.display = 'none';
    } else if (currentRole === 'tech') {
        indicator.textContent = currentTechName ? `Tech: ${currentTechName}` : 'Tech';
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

    if (navLoginBtn) navLoginBtn.style.display = currentRole ? 'none' : 'inline-block';

    calculateTotalRepairs();
    renderReviews();
}

// ============================================================
// TICKET POOL (Admin) — every ticket, with checkboxes to assign
// one or more students directly. Replaces the old per-project queue.
// ============================================================
async function onStatusFilterChange(value) {
    if (value === 'deleted') await loadDeletedAppointments();
    populateAppointmentsModal(document.getElementById('nameSearch').value, value, document.getElementById('sortFilter').value);
}

function populateAppointmentsModal(filterName = '', filterStatus = 'all', sortOrder = 'newest') {
    const container = document.getElementById('appointmentsContainer');
    if (!container) return;

    // Find duplicate emails
    const emailCounts = {};
    appointments.forEach(a => {
        if (a.email) emailCounts[a.email.toLowerCase()] = (emailCounts[a.email.toLowerCase()] || 0) + 1;
    });

    // Apply filters
    let filtered = [...appointments];
    if (filterName.trim()) {
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(filterName.toLowerCase()) ||
            (a.email && a.email.toLowerCase().includes(filterName.toLowerCase()))
        );
    }
    if (filterStatus !== 'all') {
        filtered = filtered.filter(a => a.status === filterStatus);
    }

    // Sort
    filtered.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    const pending = filtered.filter(a => a.status === 'pending');
    const assigned = filtered.filter(a => a.status === 'assigned');
    const inProgress = filtered.filter(a => a.status === 'in_progress');
    const completed = filtered.filter(a => a.status === 'completed');

    // Duplicate warning — emails with more than 1 ticket
    const duplicateEmails = Object.entries(emailCounts)
        .filter(([_, count]) => count > 1)
        .map(([email]) => email);

    let html = `
        <div style="display:flex; gap:8px; margin-bottom:1rem; flex-wrap:wrap;">
            <input
                type="text"
                id="nameSearch"
                placeholder="Search by name or email..."
                value="${filterName}"
                oninput="populateAppointmentsModal(this.value, document.getElementById('statusFilter').value, document.getElementById('sortFilter').value)"
                style="padding:0.4rem 0.8rem; border-radius:5px; border:1px solid #ccc; flex:1; min-width:150px;">
            <select id="statusFilter"
                onchange="onStatusFilterChange(this.value)"
                style="padding:0.4rem; border-radius:5px; border:1px solid #ccc;">
                <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>All Status</option>
                <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>In the Pool</option>
                <option value="assigned" ${filterStatus === 'assigned' ? 'selected' : ''}>Assigned</option>
                <option value="in_progress" ${filterStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
                <option value="deleted" ${filterStatus === 'deleted' ? 'selected' : ''}>Deleted</option>
            </select>
            <select id="sortFilter"
                onchange="populateAppointmentsModal(document.getElementById('nameSearch').value, document.getElementById('statusFilter').value, this.value)"
                style="padding:0.4rem; border-radius:5px; border:1px solid #ccc;">
                <option value="newest" ${sortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="oldest" ${sortOrder === 'oldest' ? 'selected' : ''}>Oldest First</option>
            </select>
        </div>`;

    if (filterStatus === 'deleted') {
        let deletedFiltered = [...deletedAppointments];
        if (filterName.trim()) {
            deletedFiltered = deletedFiltered.filter(a =>
                a.name.toLowerCase().includes(filterName.toLowerCase()) ||
                (a.email && a.email.toLowerCase().includes(filterName.toLowerCase()))
            );
        }
        deletedFiltered.sort((a, b) => {
            const dateA = new Date(a.deleted_at);
            const dateB = new Date(b.deleted_at);
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });

        html += deletedFiltered.length === 0
            ? '<p style="text-align:center; color:#999;">No deleted tickets.</p>'
            : deletedFiltered.map(appt => `
                <div style="background:#f8d7da; padding:1rem; border-radius:5px; margin-bottom:1rem; border-left:4px solid #dc3545;">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <small style="color:#555;">📧 ${appt.email || 'No email provided'}</small><br>
                    <em>${appt.issue}</em><br>
                    <small>Deleted: ${new Date(appt.deleted_at).toLocaleDateString()} at ${new Date(appt.deleted_at).toLocaleTimeString()}</small><br>
                    <div style="margin-top:0.5rem;">
                        <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745;" onclick="restoreAppointment(${appt.id})">Restore</button>
                        <button class="btn btn-secondary" style="padding:0.3rem 1rem; background:#dc3545;" onclick="permanentlyDeleteAppointment(${appt.id})">Delete Forever</button>
                    </div>
                </div>`).join('');

        container.innerHTML = html;
        return;
    }

    // Duplicate warning banner
    if (duplicateEmails.length > 0) {
        html += `
        <div style="background:#fff3cd; border:1px solid #ffc107; border-radius:5px; padding:0.8rem; margin-bottom:1rem;">
            ⚠️ <strong>Possible duplicate submissions detected:</strong><br>
            ${duplicateEmails.map(email => `
                <span style="display:inline-block; background:#ffc107; color:#333; padding:2px 8px; border-radius:10px; margin:3px; font-size:0.85rem; cursor:pointer;"
                    onclick="populateAppointmentsModal('${email}', 'all', 'newest')">
                    ${email} (${emailCounts[email]} tickets)
                </span>
            `).join('')}
            <br><small style="color:#666;">Click an email to filter their tickets</small>
        </div>`;
    }

    if (filtered.length === 0) {
        html += '<p style="text-align:center; color:#999;">No tickets match your search.</p>';
        container.innerHTML = html;
        return;
    }

    // Render a single ticket card
    const renderTicket = (appt, bgColor, borderColor) => {
        const isDuplicateEmail = appt.email && emailCounts[appt.email.toLowerCase()] > 1;
        const assignedIds = appt.assigned_tech_ids || [];
        const assignedNames = assignedIds.map(id => techs.find(t => t.id === id)?.name).filter(Boolean);

        const assignmentEditor = `
            <div style="margin-top:0.6rem; padding-top:0.6rem; border-top:1px solid rgba(0,0,0,0.08);">
                <small style="display:block; margin-bottom:0.3rem; color:#555;">Assign students:</small>
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:0.5rem;">
                    ${techs.length === 0 ? '<span style="color:#999; font-size:0.85rem;">No students added yet</span>' : techs.map(t => `
                        <label style="display:inline-flex; align-items:center; gap:4px; background:white; padding:3px 8px; border-radius:10px; border:1px solid #ccc; font-size:0.85rem; cursor:pointer;">
                            <input type="checkbox" class="assign-tech-${appt.id}" value="${t.id}" ${assignedIds.includes(t.id) ? 'checked' : ''}>
                            ${t.name}
                        </label>
                    `).join('')}
                </div>
                <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="updateTicketAssignment(${appt.id})">Save Assignment</button>
            </div>
        `;

        return `
        <div style="background:${bgColor}; padding:1rem; border-radius:5px; margin-bottom:1rem; border-left:4px solid ${borderColor};">
            <strong>${appt.name}</strong>
            ${isDuplicateEmail ? '<span style="background:#dc3545; color:white; font-size:0.75rem; padding:2px 6px; border-radius:10px; margin-left:6px;">⚠️ Duplicate Email</span>' : ''}
            - ${appt.device}<br>
            <small style="color:#555;">📧 ${appt.email || 'No email provided'}</small><br>
            ${appt.created_by ? `<small style="color:#555;">👤 Created by: ${appt.created_by}</small><br>` : ''}
            <small style="color:#555;">🎫 Ticket #${appt.id}</small><br>
            ${appt.tracking_code ? `<small style="color:#555;">🔑 Tracking code: <strong>${appt.tracking_code}</strong></small><br>` : ''}
            <em>${appt.issue}</em><br>
            <small>Submitted: ${new Date(appt.created_at).toLocaleDateString()} at ${new Date(appt.created_at).toLocaleTimeString()}</small><br>
            ${assignedNames.length > 0
                ? `<small>Assigned to: <strong>${assignedNames.join(', ')}</strong></small><br>`
                : '<small style="color:#999;">Unassigned — in the pool</small><br>'}
            ${appt.status === 'in_progress' && appt.parts_used ? `<small>🔩 Parts: ${appt.parts_used}</small><br>` : ''}
            ${printButtons(appt.id)}
            <div style="margin-top:0.5rem;">
                ${appt.status === 'assigned' ? `
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#17a2b8;" onclick="startProgress(${appt.id})">Start Progress</button>
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                ` : ''}
                ${appt.status === 'in_progress' ? `
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                ` : ''}
                <button class="btn btn-secondary" style="padding:0.3rem 1rem; background:#dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
            </div>
            ${appt.status !== 'completed' ? assignmentEditor : ''}
        </div>`;
    };

    if (pending.length > 0) {
        html += '<h3 style="color:#001f3f; margin-bottom:1rem;">In the Pool</h3>';
        pending.forEach(a => html += renderTicket(a, '#fff3cd', '#ffc107'));
    }
    if (assigned.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">Assigned</h3>';
        assigned.forEach(a => html += renderTicket(a, '#d1ecf1', '#17a2b8'));
    }
    if (inProgress.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">In Progress</h3>';
        inProgress.forEach(a => html += renderTicket(a, '#cfe2ff', '#0d6efd'));
    }
    if (completed.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">Completed Repairs</h3>';
        completed.forEach(a => html += renderTicket(a, '#d4edda', '#28a745'));
    }

    container.innerHTML = html;
}

// ============================================================
// MY TICKETS (Tech) — tickets the current student is assigned to
// ============================================================
async function viewMyTickets() {
    await loadMyTimeLogs();

    const activeAppts = appointments.filter(a =>
        (a.assigned_tech_ids || []).includes(currentTechId) && (a.status === 'assigned' || a.status === 'in_progress')
    );
    const completedAppts = appointments.filter(a =>
        (a.assigned_tech_ids || []).includes(currentTechId) && a.status === 'completed'
    );

    const container = document.getElementById('myTicketsContainer');
    let html = '';

    if (activeAppts.length === 0 && completedAppts.length === 0) {
        html = '<p style="text-align: center; color: #999; padding: 2rem;">No tickets assigned to you yet.</p>';
    } else {
        if (activeAppts.length > 0) {
            html += activeAppts.map(appt => {
                const inProgress = appt.status === 'in_progress';
                const teammates = (appt.assigned_tech_ids || [])
                    .map(id => techs.find(t => t.id === id)?.name)
                    .filter(n => n && n !== currentTechName);
                return `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid ${inProgress ? '#0d6efd' : '#ffc107'};">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <small style="color:#555;">🎫 Ticket #${appt.id}</small><br>
                    <em>${appt.issue}</em><br>
                    ${teammates.length > 0 ? `<small>Working with: ${teammates.join(', ')}</small><br>` : ''}
                    <span style="display: inline-block; margin: 0.5rem 0; padding: 0.3rem 0.8rem; background: ${inProgress ? '#0d6efd' : '#ffc107'}; color: ${inProgress ? 'white' : '#333'}; border-radius: 3px; font-size: 0.85rem;">
                        ${inProgress ? 'In Progress' : 'Assigned'}
                    </span>
                    ${printButtons(appt.id)}
                    <div style="margin-top:0.5rem;">
                        <input type="text" id="parts-${appt.id}" class="ticket-note-field" placeholder="Parts used (optional)" value="${appt.parts_used || ''}">
                        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                            <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="saveTicketParts(${appt.id})">Save Parts</button>
                            ${!inProgress ? `<button class="btn btn-primary" style="padding:0.3rem 1rem; background:#17a2b8; color:white;" onclick="startProgress(${appt.id})">Start Progress</button>` : ''}
                            ${inProgress ? `<button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745; color:white;" onclick="markCompleted(${appt.id})">Mark Completed</button>` : ''}
                        </div>
                    </div>
                    ${renderLogTimeSection(appt.id)}
                </div>`;
            }).join('');
        } else {
            html += '<p style="text-align:center; color:#999; padding:1rem;">No active tickets right now.</p>';
        }

        if (completedAppts.length > 0) {
            html += '<h3 style="color:#001f3f; margin:1.5rem 0 1rem;">Completed</h3>';
            html += completedAppts.map(appt => `
                <div style="background:#d4edda; padding:1rem; border-radius:8px; margin-bottom:1rem; border-left:4px solid #28a745;">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <small style="color:#555;">🎫 Ticket #${appt.id}</small><br>
                    <em>${appt.issue}</em><br>
                    ${printButtons(appt.id)}
                    ${renderLogTimeSection(appt.id)}
                </div>
            `).join('');
        }
    }

    container.innerHTML = html;
    openModal('myTicketsModal');
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

function formatTime12h(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function renderLogTimeSection(apptId) {
    const entries = myTimeLogs.filter(l => l.ticket_id === apptId);
    const entriesHtml = entries.length > 0
        ? entries.map(l => `
            <div style="font-size:0.8rem; color:#555; display:flex; justify-content:space-between; align-items:center; padding:2px 0;">
                <span>${new Date(l.work_date + 'T00:00:00').toLocaleDateString()}: ${formatTime12h(l.start_time)} – ${formatTime12h(l.end_time)} (${hoursBetween(l.start_time, l.end_time).toFixed(2)} hr)</span>
                <span style="cursor:pointer; color:#dc3545;" onclick="deleteTimeLog(${l.id})" title="Delete entry">✕</span>
            </div>
            ${l.note ? `<div style="font-size:0.8rem; color:#555; margin:0 0 4px 0.75rem;">📝 ${escapeHtml(l.note)}</div>` : ''}`).join('')
        : '<span style="font-size:0.8rem; color:#999;">No time logged yet</span>';

    return `
        <div style="margin-top:0.6rem; padding-top:0.6rem; border-top:1px solid rgba(0,0,0,0.08);">
            <small style="display:block; margin-bottom:0.3rem; color:#555;">Log time worked:</small>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:0.5rem;">
                <input type="date" id="logDate-${apptId}" value="${todayDateStr()}" style="padding:0.3rem; border-radius:5px; border:1px solid #ccc;">
                <input type="time" id="logStart-${apptId}" style="padding:0.3rem; border-radius:5px; border:1px solid #ccc;">
                <small style="color:#999;">to</small>
                <input type="time" id="logEnd-${apptId}" style="padding:0.3rem; border-radius:5px; border:1px solid #ccc;">
                <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="logTime(${apptId})">Log Time</button>
            </div>
            <textarea id="logNote-${apptId}" class="ticket-note-field" rows="2" placeholder="Notes for the Service Log: work done and what still needs to be done"></textarea>
            ${entriesHtml}
        </div>
    `;
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

    await viewMyTickets();
}

async function deleteTimeLog(logId) {
    if (!confirm('Delete this time entry?')) return;

    const { error } = await db.from('time_logs').delete().eq('id', logId);
    if (error) { console.error('Error deleting time log:', error); return; }

    myTimeLogs = myTimeLogs.filter(l => l.id !== logId);

    if (document.getElementById('myTicketsModal').style.display === 'flex') viewMyTickets();
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
// the WBL Hours sheet (the school's own .docx, filled and downloaded).
// Tickets and time logs are staff-only in the database (008), so these
// only fill in for a logged-in admin or tech. The Service Log renders
// into #printArea (the only thing shown when printing) and is cleared
// once the print dialog closes.
// ============================================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function printButtons(apptId) {
    return `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin:0.4rem 0;">
            <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="printServiceLog(${apptId})">🖨 Print Service Log</button>
            <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="downloadHoursSheets(${apptId}, 'creation')">⬇ Hours: Ticket Creation</button>
            <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="downloadHoursSheets(${apptId}, 'repair')">⬇ Hours: Repair Work</button>
        </div>`;
}

async function printServiceLog(apptId) {
    const appt = appointments.find(a => a.id === apptId);
    const { data: logs, error } = await db.from('time_logs')
        .select('*')
        .eq('ticket_id', apptId)
        .order('work_date')
        .order('start_time');
    if (error) { console.error('Error loading time logs:', error); alert('Could not load the time logged on this ticket.'); return; }

    const techName = id => techs.find(t => t.id === id)?.name || '';
    const studentNames = (appt.assigned_tech_ids || []).map(techName).filter(Boolean);
    const area = document.getElementById('printArea');
    area.innerHTML = serviceLogHtml(appt, logs, studentNames, techName);
    window.addEventListener('afterprint', () => { area.innerHTML = ''; }, { once: true });
    window.print();
}

function serviceLogHtml(appt, logs, studentNames, techName) {
    const rows = logs.filter(l => l.note).map(l => `
        <tr>
            <th>${new Date(l.work_date + 'T00:00:00').toLocaleDateString()}<br>AM or <span class="circled">PM</span></th>
            <td><strong>${escapeHtml(techName(l.tech_id))}:</strong> ${escapeHtml(l.note)}</td>
        </tr>`);
    while (rows.length < 7) rows.push('<tr class="blank-row"><th>Date<br>AM or PM</th><td></td></tr>');

    return `
    <div class="print-sheet service-log">
        <h1>SERVICE-LOG</h1>
        <table>
            <tr><th>Start date</th><td>${new Date(appt.created_at).toLocaleDateString()}</td></tr>
            <tr><th>Intake #</th><td>Ticket #${appt.id}</td></tr>
            <tr><th>Model of computer</th><td>${escapeHtml(appt.device)}</td></tr>
            <tr><th>Serial Number</th><td></td></tr>
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
async function downloadHoursSheets(apptId, kind) {
    const appt = appointments.find(a => a.id === apptId);
    const teamNames = ids => (ids || []).map(id => techs.find(t => t.id === id)?.name).filter(Boolean);
    let teams;

    if (kind === 'creation') {
        const start = new Date(appt.created_at);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const hhmm = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        teams = [{
            names: teamNames(appt.creation_tech_ids),
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
            if (!byTeam.has(key)) byTeam.set(key, { names: teamNames(l.team_tech_ids), sessions: new Map() });
            // Students who worked a session together each log it; list it once.
            byTeam.get(key).sessions.set(`${l.work_date} ${l.start_time} ${l.end_time}`, {
                date: new Date(l.work_date + 'T00:00:00').toLocaleDateString(),
                start: formatTime12h(l.start_time),
                end: formatTime12h(l.end_time)
            });
        }
        teams = [...byTeam.values()].map(t => ({ names: t.names, sessions: [...t.sessions.values()] }));
    }

    // The form has five date lines, so more sessions go on another sheet.
    const sheets = teams.flatMap(t => Array.from({ length: Math.ceil(t.sessions.length / 5) },
        (_, i) => ({ names: t.names, sessions: t.sessions.slice(i * 5, i * 5 + 5) })));

    const response = await fetch(HOURS_TEMPLATE);
    if (!response.ok) { alert('Could not load the Hours sheet template.'); return; }
    const docx = await JSZip.loadAsync(await response.arrayBuffer());
    const xml = await docx.file('word/document.xml').async('string');
    const label = kind === 'creation' ? 'Ticket-Creation' : 'Repair';

    for (const [n, sheet] of sheets.entries()) {
        const values = { DEVICE: `Ticket #${appt.id}`, PM: '✔' };
        // ponytail: the form has 6 name lines; a 7th student on one team is left off
        sheet.names.slice(0, 6).forEach((name, j) => { values[`NAME${j + 1}`] = name; });
        sheet.sessions.forEach((s, j) => {
            values[`DATE${j + 1}`] = s.date;
            values[`START${j + 1}`] = s.start;
            values[`END${j + 1}`] = s.end;
        });

        docx.file('word/document.xml', fillHoursTemplate(xml, values));
        const blob = await docx.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Ticket-${appt.id}-Hours-${label}${sheets.length > 1 ? `-${n + 1}` : ''}.docx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    if (id === 'updateStatsModal') populateStatsModal();
    if (id === 'reviewModal') updateReviewTags();
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

function scrollToAbout() {
    document.getElementById('about').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Clicking the role badge opens the Admin panel for Admin, or the
// tech identity picker for Tech (so a different student can switch in).
function onRoleIndicatorClick() {
    if (currentRole === 'admin') {
        const panel = document.getElementById('adminPanel');
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    } else if (currentRole === 'tech') {
        openTechPicker();
    }
}

function showTopic(id, btn) {
    document.querySelectorAll('.about-topic').forEach(section => section.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    document.querySelectorAll('.about-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// ============================================================
// START — waits for DOM so window.supabase is guaranteed loaded
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    renderPricing();

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
            const savedTechId = sessionStorage.getItem('bocesTechId');
            if (savedTechId) currentTechId = parseInt(savedTechId);
        } else {
            staffToken = null;
            sessionStorage.removeItem('bocesStaffToken');
            sessionStorage.removeItem('bocesTechId');
        }
    }

    loadData();
});
