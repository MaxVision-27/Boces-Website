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
let groups = [];
let totalRepairs = 0;
let appointments = [];
let techs = [];
let currentTechId = null;
let currentTechName = null;
let currentTechGroupId = null;

// ============================================================
// LOAD ALL DATA FROM SUPABASE ON PAGE START
// ============================================================
async function loadData() {
    await Promise.all([
        loadGroups(),
        loadAppointments(),
        loadStats(),
        loadTechs(),
        renderReviews()
    ]);
    hydrateTechIdentity();
    updateRoleDisplay();
}

async function loadGroups() {
    const { data, error } = await db.from('groups').select('*').order('created_at', { ascending: true });
    if (error) { console.error('Error loading groups:', error); return; }
    groups = data || [];
    calculateTotalRepairs();
    refreshGroupsUI();
}

async function loadAppointments() {
    const { data, error } = await db.from('repair_requests').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error loading appointments:', error); return; }
    appointments = data || [];
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

// Reattach currentTechName/currentTechGroupId from the roster after a saved
// session (sessionStorage only kept the id). If the roster no longer has
// that id (teacher removed them), clear the stale identity.
function hydrateTechIdentity() {
    if (!currentTechId) return;
    const tech = techs.find(t => t.id === currentTechId);
    if (tech) {
        currentTechName = tech.name;
        currentTechGroupId = tech.group_id;
    } else {
        currentTechId = null;
        currentTechName = null;
        currentTechGroupId = null;
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
    currentTechGroupId = null;
    sessionStorage.removeItem('bocesRole');
    sessionStorage.removeItem('bocesTechId');
    updateRoleDisplay();
}

// ============================================================
// TECH IDENTITY (roster picker shown after "Tech" login)
// ============================================================
function openTechPicker() {
    const container = document.getElementById('techPickerContainer');

    if (techs.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#999;">No techs on the roster yet. Ask your teacher to add you in Manage Techs.</p>';
    } else {
        const byGroup = {};
        techs.forEach(t => {
            const key = t.group_id || 'unassigned';
            if (!byGroup[key]) byGroup[key] = [];
            byGroup[key].push(t);
        });

        let html = '';
        groups.forEach(g => {
            if (byGroup[g.id]) {
                html += `<div class="roster-group-label">${g.name} (${g.period})</div>`;
                html += byGroup[g.id].map(t => `<button type="button" class="tech-pick-btn" onclick="selectTech(${t.id})">${t.name}</button>`).join('');
            }
        });
        if (byGroup['unassigned']) {
            html += `<div class="roster-group-label">Unassigned</div>`;
            html += byGroup['unassigned'].map(t => `<button type="button" class="tech-pick-btn" onclick="selectTech(${t.id})">${t.name}</button>`).join('');
        }
        container.innerHTML = html;
    }

    openModal('techPickerModal');
}

function selectTech(techId, showAlert = true) {
    const tech = techs.find(t => t.id === techId);
    if (!tech) return;

    currentTechId = tech.id;
    currentTechName = tech.name;
    currentTechGroupId = tech.group_id;
    sessionStorage.setItem('bocesTechId', tech.id);

    closeModal('techPickerModal');
    updateRoleDisplay();
    if (showAlert) alert(`Welcome, ${tech.name}!`);
}

// ============================================================
// GROUPS
// ============================================================
async function createGroup() {
    const name = document.getElementById('groupName').value.trim();
    const period = document.getElementById('groupPeriod').value;

    if (!name) { alert('Please enter a group name'); return; }

    const { data, error } = await db.from('groups').insert({
        name,
        period,
        repairs: 0,
        projects: []
    }).select().single();

    if (error) { console.error('Error creating group:', error); alert('Failed to create group.'); return; }

    groups.push(data);
    refreshGroupsUI();
    closeModal('createGroupModal');
    document.getElementById('groupName').value = '';
    alert('Group created successfully!');
}

async function deleteGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!confirm(`Are you sure you want to delete "${group.name}"? This cannot be undone.`)) return;

    await db.from('repair_requests').update({ group_id: null, group_name: 'Unassigned', status: 'pending' }).eq('group_id', groupId);
    await db.from('techs').update({ group_id: null }).eq('group_id', groupId);

    const { error } = await db.from('groups').delete().eq('id', groupId);
    if (error) { console.error('Error deleting group:', error); return; }

    groups = groups.filter(g => g.id !== groupId);
    appointments = appointments.map(a => a.group_id === groupId ? { ...a, group_id: null, group_name: 'Unassigned', status: 'pending' } : a);
    techs = techs.map(t => t.group_id === groupId ? { ...t, group_id: null } : t);
    if (currentTechGroupId === groupId) currentTechGroupId = null;
    refreshGroupsUI();
    alert('Group deleted successfully!');
}

async function uploadGroupImage(groupId, input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const group = groups.find(g => g.id === groupId);
        if (!group.projects) group.projects = [];
        group.projects.unshift(e.target.result);
        if (group.projects.length > 4) group.projects = group.projects.slice(0, 4);

        const { error } = await db.from('groups').update({ projects: group.projects }).eq('id', groupId);
        if (error) { console.error('Error saving image:', error); return; }
        refreshGroupsUI();
    };
    reader.readAsDataURL(file);
}

// ============================================================
// TECH ROSTER MANAGEMENT (Admin)
// ============================================================
function openManageTechs() {
    populateManageTechsModal();
    openModal('manageTechsModal');
}

function populateManageTechsModal() {
    const groupOptions = groups.map(g => `<option value="${g.id}">${g.name} (${g.period})</option>`).join('');
    const newTechGroupSelect = document.getElementById('newTechGroup');
    if (newTechGroupSelect) newTechGroupSelect.innerHTML = `<option value="">Unassigned</option>${groupOptions}`;

    const list = document.getElementById('techsListContainer');
    if (!list) return;

    if (techs.length === 0) {
        list.innerHTML = '<p style="color:#999;">No techs on the roster yet.</p>';
        return;
    }

    list.innerHTML = techs.map(t => `
        <div class="tech-row">
            <strong>${t.name}</strong>
            <select onchange="reassignTech(${t.id}, this.value)">
                <option value="">Unassigned</option>
                ${groups.map(g => `<option value="${g.id}" ${t.group_id === g.id ? 'selected' : ''}>${g.name} (${g.period})</option>`).join('')}
            </select>
            <button class="btn btn-secondary" style="padding:0.3rem 0.8rem; background:#dc3545; color:white; border:none;" onclick="deleteTech(${t.id})">Remove</button>
        </div>
    `).join('');
}

async function addTech() {
    const nameInput = document.getElementById('newTechName');
    const groupSelect = document.getElementById('newTechGroup');
    const name = nameInput.value.trim();
    const groupId = groupSelect.value ? parseInt(groupSelect.value) : null;

    if (!name) { alert('Please enter a name'); return; }

    const { data, error } = await db.from('techs').insert({ name, group_id: groupId }).select().single();
    if (error) { console.error('Error adding tech:', error); alert('Failed to add tech.'); return; }

    techs.push(data);
    techs.sort((a, b) => a.name.localeCompare(b.name));
    nameInput.value = '';
    populateManageTechsModal();
}

async function reassignTech(techId, groupIdRaw) {
    const groupId = groupIdRaw ? parseInt(groupIdRaw) : null;
    const { error } = await db.from('techs').update({ group_id: groupId }).eq('id', techId);
    if (error) { console.error('Error reassigning tech:', error); return; }

    const tech = techs.find(t => t.id === techId);
    if (tech) tech.group_id = groupId;
    if (currentTechId === techId) currentTechGroupId = groupId;
}

async function deleteTech(techId) {
    if (!confirm('Remove this tech from the roster?')) return;

    const { error } = await db.from('techs').delete().eq('id', techId);
    if (error) { console.error('Error deleting tech:', error); return; }

    techs = techs.filter(t => t.id !== techId);
    if (currentTechId === techId) {
        currentTechId = null;
        currentTechName = null;
        currentTechGroupId = null;
        sessionStorage.removeItem('bocesTechId');
        updateRoleDisplay();
    }
    populateManageTechsModal();
}

// ============================================================
// REPAIR REQUESTS — created directly by a logged-in Tech
// ============================================================
function openTechTicketModal() {
    if (!currentTechId) { openTechPicker(); return; }
    if (!currentTechGroupId) { alert('You need to be assigned to a team first. Ask your teacher to add you in Manage Techs.'); return; }
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
    if (!currentTechGroupId) { alert('You need to be assigned to a team first.'); return; }

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

    const group = groups.find(g => g.id === currentTechGroupId);

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
            group_id: currentTechGroupId,
            group_name: group ? group.name : 'Unassigned',
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
    pending: { label: 'Pending Assignment', color: '#ffc107', text: '#333' },
    assigned: { label: 'Assigned to a Team', color: '#17a2b8', text: 'white' },
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
            <span class="group-badge" style="background:${meta.color}; color:${meta.text}; margin-top:0.5rem;">${meta.label}</span>
            <p style="margin-top:0.8rem; font-size:0.85rem; color:#999;">Submitted ${new Date(data.created_at).toLocaleDateString()}</p>
        </div>
    `;
}

async function assignToGroup(apptId) {
    const select = document.getElementById(`assign-${apptId}`);
    const groupId = parseInt(select.value);
    if (!groupId) { alert('Please select a team'); return; }

    const group = groups.find(g => g.id === groupId);

    const { error } = await db.from('repair_requests').update({
        group_id: groupId,
        group_name: group.name,
        status: 'assigned'
    }).eq('id', apptId);

    if (error) { console.error('Error assigning:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.group_id = groupId;
    appt.group_name = group.name;
    appt.status = 'assigned';

    populateAppointmentsModal();
    alert(`Assigned to ${group.name}!`);
}

async function unassignAppointment(apptId) {
    const { error } = await db.from('repair_requests').update({
        group_id: null,
        group_name: 'Unassigned',
        status: 'pending'
    }).eq('id', apptId);

    if (error) { console.error('Error unassigning:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.group_id = null;
    appt.group_name = 'Unassigned';
    appt.status = 'pending';

    populateAppointmentsModal();
}

async function startProgress(apptId) {
    const { error } = await db.from('repair_requests').update({ status: 'in_progress' }).eq('id', apptId);
    if (error) { console.error('Error starting progress:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'in_progress';

    populateAppointmentsModal();
    if (document.getElementById('viewGroupRepairsModal').style.display === 'flex') {
        viewGroupRepairs(appt.group_id);
    }
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

    const group = groups.find(g => g.id === appt.group_id);
    if (group) {
        group.repairs = (group.repairs || 0) + 1;
        await db.from('groups').update({ repairs: group.repairs }).eq('id', group.id);
    }

    await syncStats();
    populateAppointmentsModal();
    refreshGroupsUI();
    if (document.getElementById('viewGroupRepairsModal').style.display === 'flex' && appt.group_id) {
        viewGroupRepairs(appt.group_id);
    }
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
// STATS
// ============================================================
async function syncStats() {
    const total = groups.reduce((sum, g) => sum + (g.repairs || 0), 0);
    totalRepairs = total;
    document.getElementById('totalRepairs').textContent = totalRepairs;
    await db.from('stats').update({ total_repairs: total }).eq('id', 1);
}

function calculateTotalRepairs() {
    totalRepairs = groups.reduce((sum, g) => sum + (g.repairs || 0), 0);
    const el = document.getElementById('totalRepairs');
    if (el) el.textContent = totalRepairs;
}

function populateStatsModal() {
    const calculatedTotal = groups.reduce((sum, g) => sum + g.repairs, 0);
    document.getElementById('totalRepairsInput').value = totalRepairs;
    document.getElementById('totalRepairsInput').placeholder = `Auto-calculated: ${calculatedTotal}`;

    const container = document.getElementById('groupStatsContainer');
    container.innerHTML = groups.map(group => `
        <div class="form-group">
            <label>${group.name} (${group.period}) - Repairs Completed</label>
            <input type="number" id="group-${group.id}" value="${group.repairs}" min="0">
        </div>
    `).join('');
}

async function updateStats() {
    const manualTotal = parseInt(document.getElementById('totalRepairsInput').value);

    for (const group of groups) {
        const input = document.getElementById(`group-${group.id}`);
        if (input) {
            const newVal = parseInt(input.value) || 0;
            if (newVal !== group.repairs) {
                group.repairs = newVal;
                await db.from('groups').update({ repairs: newVal }).eq('id', group.id);
            }
        }
    }

    const calculatedTotal = groups.reduce((sum, g) => sum + g.repairs, 0);
    totalRepairs = (!isNaN(manualTotal) && manualTotal !== calculatedTotal) ? manualTotal : calculatedTotal;

    await db.from('stats').update({ total_repairs: totalRepairs }).eq('id', 1);

    refreshGroupsUI();
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

function openMyQueue() {
    if (!currentTechGroupId) { alert('You need to be assigned to a team first. Ask your teacher to add you in Manage Techs.'); return; }
    viewGroupRepairs(currentTechGroupId);
}

// Called anywhere group data changes — keeps the total-repairs stat and
// (if it happens to be open) the Manage Groups modal in sync.
function refreshGroupsUI() {
    calculateTotalRepairs();
    const modal = document.getElementById('manageGroupsModal');
    if (modal && modal.style.display === 'flex') populateManageGroupsModal();
}

// Groups have no public-facing display anymore — this is the admin-only
// management view (create/delete groups, upload project photos).
function openManageGroups() {
    populateManageGroupsModal();
    openModal('manageGroupsModal');
}

function populateManageGroupsModal() {
    const container = document.getElementById('manageGroupsContainer');
    if (!container) return;

    if (groups.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No groups yet.</p>';
        return;
    }

    container.innerHTML = groups.map(group => `
        <div class="group-card">
            <h3>${group.name}</h3>
            <span class="group-badge badge-${group.period.toLowerCase()}">${group.period} Class</span>
            <p style="font-size: 1.1rem; font-weight: 600; margin: 0.8rem 0;">
                ${group.repairs} Repairs Completed
            </p>
            <div class="project-gallery">
                ${!group.projects || group.projects.length === 0
        ? '<p style="grid-column: 1/-1; text-align: center; color: #999; font-size: 0.85rem;">No project photos yet</p>'
        : group.projects.slice(0, 3).map(p => `<img src="${p}" class="project-img" alt="Project">`).join('')
    }
            </div>
            <input type="file" accept="image/*" onchange="uploadGroupImage(${group.id}, this)" style="margin-top:8px; margin-bottom:6px;">
            <button class="btn-delete-group" onclick="deleteGroup(${group.id})">Delete Group</button>
        </div>
    `).join('');
}

// ============================================================
// TICKET MANAGER — with search, filter, sort, duplicate warning
// ============================================================
function populateAppointmentsModal(filterName = '', filterStatus = 'all', sortOrder = 'newest') {
    const container = document.getElementById('appointmentsContainer');
    if (!container) return;

    // Find duplicate emails
    const emailCounts = {};
    const nameCounts = {};
    appointments.forEach(a => {
        if (a.email) emailCounts[a.email.toLowerCase()] = (emailCounts[a.email.toLowerCase()] || 0) + 1;
        nameCounts[a.name.toLowerCase()] = (nameCounts[a.name.toLowerCase()] || 0) + 1;
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
                <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>Pending</option>
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
        const createdByStaff = appt.created_by && appt.created_by !== 'customer';
        return `
        <div style="background:${bgColor}; padding:1rem; border-radius:5px; margin-bottom:1rem; border-left:4px solid ${borderColor};">
            <strong>${appt.name}</strong>
            ${isDuplicateEmail ? '<span style="background:#dc3545; color:white; font-size:0.75rem; padding:2px 6px; border-radius:10px; margin-left:6px;">⚠️ Duplicate Email</span>' : ''}
            - ${appt.device}<br>
            <small style="color:#555;">📧 ${appt.email || 'No email provided'}</small><br>
            ${createdByStaff ? `<small style="color:#555;">👤 Entered by tech: ${appt.created_by}</small><br>` : ''}
            ${appt.tracking_code ? `<small style="color:#555;">🔑 Tracking code: <strong>${appt.tracking_code}</strong></small><br>` : ''}
            <em>${appt.issue}</em><br>
            <small>Submitted: ${new Date(appt.created_at).toLocaleDateString()} at ${new Date(appt.created_at).toLocaleTimeString()}</small><br>
            <small>Preferred: ${appt.date} at ${appt.time}</small><br>
            <div style="margin-top:0.5rem;">
                ${appt.status === 'pending' ? `
                    <select id="assign-${appt.id}" style="padding:0.3rem; margin-right:0.5rem;">
                        <option value="">Select Team...</option>
                        ${groups.map(g => `<option value="${g.id}">${g.name} (${g.period})</option>`).join('')}
                    </select>
                    <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="assignToGroup(${appt.id})">Assign</button>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; background:#dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                ` : ''}
                ${appt.status === 'assigned' ? `
                    <small>Assigned to: <strong>${appt.group_name}</strong></small><br>
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#17a2b8; margin-top:0.5rem;" onclick="startProgress(${appt.id})">Start Progress</button>
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745; margin-top:0.5rem;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; margin-top:0.5rem;" onclick="unassignAppointment(${appt.id})">Unassign</button>
                ` : ''}
                ${appt.status === 'in_progress' ? `
                    <small>In progress with: <strong>${appt.group_name}</strong></small><br>
                    ${appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
                    ${appt.parts_used ? `<small>🔩 Parts: ${appt.parts_used}</small><br>` : ''}
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745; margin-top:0.5rem;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; margin-top:0.5rem;" onclick="unassignAppointment(${appt.id})">Unassign</button>
                ` : ''}
                ${appt.status === 'completed' ? `
                    <small>Completed by: <strong>${appt.group_name}</strong></small><br>
                    ${appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; margin-top:0.5rem; background:#dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                ` : ''}
            </div>
        </div>`;
    };

    if (pending.length > 0) {
        html += '<h3 style="color:#001f3f; margin-bottom:1rem;">Pending Assignment</h3>';
        pending.forEach(a => html += renderTicket(a, '#fff3cd', '#ffc107'));
    }
    if (assigned.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">Assigned to Teams</h3>';
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

function viewGroupRepairs(groupId) {
    const group = groups.find(g => g.id === groupId);
    const isOwnGroup = currentRole === 'tech' && currentTechGroupId === groupId;
    const groupAppts = appointments.filter(a => a.group_id === groupId && (a.status === 'assigned' || a.status === 'in_progress'));

    document.getElementById('groupRepairsTitle').textContent = `${group.name} - Repair Queue`;

    const container = document.getElementById('groupRepairsContainer');
    if (groupAppts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">No repairs currently assigned to this team.</p>';
    } else {
        container.innerHTML = groupAppts.map(appt => {
            const inProgress = appt.status === 'in_progress';
            return `
            <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid ${inProgress ? '#0d6efd' : '#ffc107'};">
                <strong>${appt.name}</strong> - ${appt.device}<br>
                <em>${appt.issue}</em><br>
                <small>Date: ${appt.date} at ${appt.time}</small><br>
                <span style="display: inline-block; margin: 0.5rem 0; padding: 0.3rem 0.8rem; background: ${inProgress ? '#0d6efd' : '#ffc107'}; color: ${inProgress ? 'white' : '#333'}; border-radius: 3px; font-size: 0.85rem;">
                    ${inProgress ? 'In Progress' : 'Assigned'}
                </span>
                ${isOwnGroup ? `
                <div style="margin-top:0.5rem;">
                    <textarea id="notes-${appt.id}" class="ticket-note-field" placeholder="Diagnosis / progress notes..." rows="2">${appt.notes || ''}</textarea>
                    <input type="text" id="parts-${appt.id}" class="ticket-note-field" placeholder="Parts used (optional)" value="${appt.parts_used || ''}">
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button class="btn btn-primary" style="padding:0.3rem 1rem;" onclick="saveTicketNotes(${appt.id})">Save Notes</button>
                        ${!inProgress ? `<button class="btn btn-primary" style="padding:0.3rem 1rem; background:#17a2b8; color:white;" onclick="startProgress(${appt.id})">Start Progress</button>` : ''}
                        ${inProgress ? `<button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745; color:white;" onclick="markCompleted(${appt.id})">Mark Completed</button>` : ''}
                    </div>
                </div>
                ` : `
                ${appt.notes ? `<small>📝 ${appt.notes}</small><br>` : ''}
                `}
            </div>`;
        }).join('');
    }
    openModal('viewGroupRepairsModal');
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
