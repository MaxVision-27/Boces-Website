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
    const { data, error } = await db.from('repair_requests').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error loading appointments:', error); return; }
    appointments = data || [];
    calculateTotalRepairs();
    populateAppointmentsModal();
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

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ password, role })
        });

        const { success } = await res.json();

        if (success) {
            currentRole = role;
            sessionStorage.setItem('bocesRole', role);
            updateRoleDisplay();
            closeModal('loginModal');
            document.getElementById('loginPassword').value = '';

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
        } else {
            alert('Incorrect password!');
        }
    } catch (err) {
        console.error('Login error:', err);
        alert('Login failed. Check your internet connection and try again.');
    }
}

function logout() {
    currentRole = null;
    currentTechId = null;
    currentTechName = null;
    sessionStorage.removeItem('bocesRole');
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
    const date = document.getElementById('techApptDate').value;
    const time = document.getElementById('techApptTime').value;

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
            date,
            time,
            status: 'assigned',
            flagged: false,
            flag_reason: null,
            assigned_tech_ids: [currentTechId],
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

    const { data, error } = await db.from('repair_requests')
        .select('device, issue, status, created_at')
        .eq('tracking_code', code)
        .maybeSingle();

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

async function saveTicketNotes(apptId) {
    const notesField = document.getElementById(`notes-${apptId}`);
    const partsField = document.getElementById(`parts-${apptId}`);
    const notes = notesField.value.trim();
    const partsUsed = partsField.value.trim();

    const { error } = await db.from('repair_requests').update({ notes, parts_used: partsUsed }).eq('id', apptId);
    if (error) { console.error('Error saving notes:', error); alert('Failed to save notes.'); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.notes = notes;
    appt.parts_used = partsUsed;
    alert('Notes saved!');
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

async function deleteAppointment(apptId) {
    if (!confirm('Are you sure you want to delete this request?')) return;

    const { error } = await db.from('repair_requests').delete().eq('id', apptId);
    if (error) { console.error('Error deleting:', error); return; }

    appointments = appointments.filter(a => a.id !== apptId);
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
                onchange="populateAppointmentsModal(document.getElementById('nameSearch').value, this.value, document.getElementById('sortFilter').value)"
                style="padding:0.4rem; border-radius:5px; border:1px solid #ccc;">
                <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>All Status</option>
                <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>In the Pool</option>
                <option value="assigned" ${filterStatus === 'assigned' ? 'selected' : ''}>Assigned</option>
                <option value="in_progress" ${filterStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
            <select id="sortFilter"
                onchange="populateAppointmentsModal(document.getElementById('nameSearch').value, document.getElementById('statusFilter').value, this.value)"
                style="padding:0.4rem; border-radius:5px; border:1px solid #ccc;">
                <option value="newest" ${sortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                <option value="oldest" ${sortOrder === 'oldest' ? 'selected' : ''}>Oldest First</option>
            </select>
        </div>`;

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
            ${appt.tracking_code ? `<small style="color:#555;">🔑 Tracking code: <strong>${appt.tracking_code}</strong></small><br>` : ''}
            <em>${appt.issue}</em><br>
            <small>Submitted: ${new Date(appt.created_at).toLocaleDateString()} at ${new Date(appt.created_at).toLocaleTimeString()}</small><br>
            <small>Preferred: ${appt.date} at ${appt.time}</small><br>
            ${assignedNames.length > 0
                ? `<small>Assigned to: <strong>${assignedNames.join(', ')}</strong></small><br>`
                : '<small style="color:#999;">Unassigned — in the pool</small><br>'}
            ${appt.status === 'in_progress' && appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
            ${appt.status === 'in_progress' && appt.parts_used ? `<small>🔩 Parts: ${appt.parts_used}</small><br>` : ''}
            ${appt.status === 'completed' && appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
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
                    <em>${appt.issue}</em><br>
                    <small>Date: ${appt.date} at ${appt.time}</small><br>
                    ${teammates.length > 0 ? `<small>Working with: ${teammates.join(', ')}</small><br>` : ''}
                    <span style="display: inline-block; margin: 0.5rem 0; padding: 0.3rem 0.8rem; background: ${inProgress ? '#0d6efd' : '#ffc107'}; color: ${inProgress ? 'white' : '#333'}; border-radius: 3px; font-size: 0.85rem;">
                        ${inProgress ? 'In Progress' : 'Assigned'}
                    </span>
                    <div style="margin-top:0.5rem;">
                        <textarea id="notes-${appt.id}" class="ticket-note-field" placeholder="Diagnosis / progress notes..." rows="2">${appt.notes || ''}</textarea>
                        <input type="text" id="parts-${appt.id}" class="ticket-note-field" placeholder="Parts used (optional)" value="${appt.parts_used || ''}">
                        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                            <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="saveTicketNotes(${appt.id})">Save Notes</button>
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
                    <em>${appt.issue}</em><br>
                    ${appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
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
            </div>`).join('')
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
        end_time: endTime
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
document.addEventListener('DOMContentLoaded', () => {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const savedRole = sessionStorage.getItem('bocesRole');
    if (savedRole) currentRole = savedRole;

    const savedTechId = sessionStorage.getItem('bocesTechId');
    if (savedTechId) currentTechId = parseInt(savedTechId);

    loadData();
});
