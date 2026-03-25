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
let selectedGroupId = null;

// ============================================================
// LOAD ALL DATA FROM SUPABASE ON PAGE START
// ============================================================
async function loadData() {
    await Promise.all([
        loadGroups(),
        loadAppointments(),
        loadStats(),
        renderReviews()
    ]);
    updateRoleDisplay();
}

async function loadGroups() {
    const { data, error } = await db.from('groups').select('*').order('created_at', { ascending: true });
    if (error) { console.error('Error loading groups:', error); return; }
    groups = data || [];
    calculateTotalRepairs();
    renderGroups();
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
            alert('Login successful!');
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
    sessionStorage.removeItem('bocesRole');
    updateRoleDisplay();
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
    renderGroups();
    closeModal('createGroupModal');
    document.getElementById('groupName').value = '';
    alert('Group created successfully!');
}

async function deleteGroup(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!confirm(`Are you sure you want to delete "${group.name}"? This cannot be undone.`)) return;

    await db.from('repair_requests').update({ group_id: null, group_name: 'Unassigned', status: 'pending' }).eq('group_id', groupId);

    const { error } = await db.from('groups').delete().eq('id', groupId);
    if (error) { console.error('Error deleting group:', error); return; }

    groups = groups.filter(g => g.id !== groupId);
    appointments = appointments.map(a => a.group_id === groupId ? { ...a, group_id: null, group_name: 'Unassigned', status: 'pending' } : a);
    renderGroups();
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
        renderGroups();
    };
    reader.readAsDataURL(file);
}

// ============================================================
// REPAIR REQUESTS
// ============================================================
async function submitAppointment() {
    const name = document.getElementById('apptName').value.trim();
    const email = document.getElementById('apptEmail').value.trim().toLowerCase();
    const device = document.getElementById('apptDevice').value;
    const issue = document.getElementById('apptIssue').value.trim();
    const date = document.getElementById('apptDate').value;
    const time = document.getElementById('apptTime').value;

    if (!name || !email || !issue || !date) {
        alert('Please fill in all required fields');
        return;
    }

    // Validate email format
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!validEmail) {
        alert('Please enter a valid email address.');
        return;
    }

    // Auto-flag suspicious content
    const suspiciousWords = ['test', 'asdf', 'fake', 'hello', '123', 'abc', 'xxx'];
    const isSuspicious =
        suspiciousWords.some(word =>
            issue.toLowerCase().includes(word) ||
            name.toLowerCase().includes(word)
        ) ||
        issue.length < 15 ||
        /^(.)\1+$/.test(issue) ||
        !/[a-zA-Z]{3,}/.test(issue) ||
        name.length < 2;

    const { data, error } = await db.from('repair_requests').insert({
        name,
        email,
        device,
        issue,
        date,
        time,
        status: isSuspicious ? 'flagged' : 'pending',
        flagged: isSuspicious,
        flag_reason: isSuspicious ? 'Auto-flagged: suspicious content' : null,
        group_id: null,
        group_name: 'Unassigned'
    }).select().single();

    if (error) {
        if (error.message.includes('Too many submissions')) {
            alert('You have already submitted 2 tickets today. Please visit us in person if this is urgent.');
        } else if (error.message.includes('Repair limit reached')) {
            alert('Sorry, we are currently at full capacity (20 repairs). Please try again later.');
        } else {
            console.error('Error submitting request:', error);
            alert('Failed to submit request.');
        }
        return;
    }

    appointments.push(data);
    populateAppointmentsModal();
    closeModal('appointmentModal');

    document.getElementById('apptName').value = '';
    document.getElementById('apptEmail').value = '';
    document.getElementById('apptIssue').value = '';
    document.getElementById('apptDate').value = '';
    selectedGroupId = null;

    if (isSuspicious) {
        alert('Your request has been submitted and is pending review by our team.');
    } else {
        alert('Repair request submitted! A team will be assigned by the instructor.');
    }
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
    renderGroups();
    alert('Repair marked as completed!');
}

async function deleteAppointment(apptId) {
    if (!confirm('Are you sure you want to delete this request?')) return;

    const { error } = await db.from('repair_requests').delete().eq('id', apptId);
    if (error) { console.error('Error deleting:', error); return; }

    appointments = appointments.filter(a => a.id !== apptId);
    populateAppointmentsModal();
}

async function approveTicket(apptId) {
    const { error } = await db.from('repair_requests').update({
        status: 'pending',
        flagged: false,
        flag_reason: null
    }).eq('id', apptId);

    if (error) { console.error('Error approving ticket:', error); return; }

    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'pending';
    appt.flagged = false;
    appt.flag_reason = null;

    populateAppointmentsModal();
    alert('Ticket approved and moved to pending!');
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

    renderGroups();
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

    if (currentRole === 'admin') {
        indicator.textContent = 'Admin';
        indicator.style.background = '#ffd700';
        adminPanel.style.display = 'block';
    } else if (currentRole === 'tech') {
        indicator.textContent = 'Tech';
        indicator.style.background = '#4169e1';
        indicator.style.color = 'white';
        adminPanel.style.display = 'none';
    } else {
        indicator.textContent = 'Guest';
        indicator.style.background = 'white';
        indicator.style.color = '#333';
        adminPanel.style.display = 'none';
    }
    renderGroups();
    renderReviews();
}

function renderGroups() {
    calculateTotalRepairs();
    const container = document.getElementById('groupsContainer');
    if (!container) return;

    if (groups.length === 0) {
        container.innerHTML = '<p style="text-align: center; grid-column: 1/-1;">No groups yet. Admin can create groups.</p>';
        return;
    }

    container.innerHTML = groups.map(group => `
        <div class="group-card">
            <h3>${group.name}</h3>
            <span class="group-badge badge-${group.period.toLowerCase()}">${group.period} Class</span>
            <p style="font-size: 1.2rem; font-weight: 600; margin: 1rem 0;">
                ${group.repairs} Repairs Completed
            </p>
            <h4 style="margin-top: 1rem;">Top Projects:</h4>
            <div class="project-gallery">
                ${!group.projects || group.projects.length === 0
        ? '<p style="grid-column: 1/-1; text-align: center; color: #999;">No projects yet</p>'
        : group.projects.slice(0, 3).map(p => `<img src="${p}" class="project-img" alt="Project">`).join('')
    }
            </div>
            ${currentRole === 'admin' ? `
            <input type="file" accept="image/*" onchange="uploadGroupImage(${group.id}, this)" style="margin-top:8px; margin-bottom:6px;">
            <button class="btn-delete-group" onclick="deleteGroup(${group.id})">Delete Group</button>
            ` : ''}
            ${currentRole === 'tech' ? `
            <button class="btn btn-primary" style="width: 100%; margin-top: 0.5rem;" onclick="viewGroupRepairs(${group.id})">
                View Assigned Repairs
            </button>
            ` : ''}
        </div>
    `).join('');
}

function updateDisplay() { renderGroups(); }

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

    const flagged = filtered.filter(a => a.status === 'flagged');
    const pending = filtered.filter(a => a.status === 'pending');
    const assigned = filtered.filter(a => a.status === 'assigned');
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
                <option value="flagged" ${filterStatus === 'flagged' ? 'selected' : ''}>Flagged</option>
                <option value="pending" ${filterStatus === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="assigned" ${filterStatus === 'assigned' ? 'selected' : ''}>Assigned</option>
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
        return `
        <div style="background:${bgColor}; padding:1rem; border-radius:5px; margin-bottom:1rem; border-left:4px solid ${borderColor};">
            <strong>${appt.name}</strong>
            ${isDuplicateEmail ? '<span style="background:#dc3545; color:white; font-size:0.75rem; padding:2px 6px; border-radius:10px; margin-left:6px;">⚠️ Duplicate Email</span>' : ''}
            - ${appt.device}<br>
            <small style="color:#555;">📧 ${appt.email || 'No email provided'}</small><br>
            <em>${appt.issue}</em><br>
            <small>Submitted: ${new Date(appt.created_at).toLocaleDateString()} at ${new Date(appt.created_at).toLocaleTimeString()}</small><br>
            <small>Preferred: ${appt.date} at ${appt.time}</small><br>
            ${appt.flag_reason ? `<small>🚩 ${appt.flag_reason}</small><br>` : ''}
            <div style="margin-top:0.5rem;">
                ${appt.status === 'flagged' ? `
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745;" onclick="approveTicket(${appt.id})">Approve</button>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; background:#dc3545;" onclick="deleteAppointment(${appt.id})">Reject</button>
                ` : ''}
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
                    <button class="btn btn-primary" style="padding:0.3rem 1rem; background:#28a745; margin-top:0.5rem;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; margin-top:0.5rem;" onclick="unassignAppointment(${appt.id})">Unassign</button>
                ` : ''}
                ${appt.status === 'completed' ? `
                    <small>Completed by: <strong>${appt.group_name}</strong></small><br>
                    <button class="btn btn-secondary" style="padding:0.3rem 1rem; margin-top:0.5rem; background:#dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                ` : ''}
            </div>
        </div>`;
    };

    if (flagged.length > 0) {
        html += '<h3 style="color:#dc3545; margin-bottom:1rem;">⚠️ Flagged for Review</h3>';
        flagged.forEach(a => html += renderTicket(a, '#ffe0e0', '#dc3545'));
    }
    if (pending.length > 0) {
        html += '<h3 style="color:#001f3f; margin-bottom:1rem;">Pending Assignment</h3>';
        pending.forEach(a => html += renderTicket(a, '#fff3cd', '#ffc107'));
    }
    if (assigned.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">Assigned to Teams</h3>';
        assigned.forEach(a => html += renderTicket(a, '#d1ecf1', '#17a2b8'));
    }
    if (completed.length > 0) {
        html += '<h3 style="color:#001f3f; margin:2rem 0 1rem;">Completed Repairs</h3>';
        completed.forEach(a => html += renderTicket(a, '#d4edda', '#28a745'));
    }

    container.innerHTML = html;
}

function viewGroupRepairs(groupId) {
    const group = groups.find(g => g.id === groupId);
    const groupAppts = appointments.filter(a => a.group_id === groupId && a.status === 'assigned');

    document.getElementById('groupRepairsTitle').textContent = `${group.name} - Assigned Repairs`;

    const container = document.getElementById('groupRepairsContainer');
    if (groupAppts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">No repairs currently assigned to this team.</p>';
    } else {
        container.innerHTML = groupAppts.map(appt => `
            <div style="background: #f8f9fa; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #001f3f;">
                <strong>${appt.name}</strong> - ${appt.device}<br>
                <em>${appt.issue}</em><br>
                <small>Date: ${appt.date} at ${appt.time}</small><br>
                <span style="display: inline-block; margin-top: 0.5rem; padding: 0.3rem 0.8rem; background: #17a2b8; color: white; border-radius: 3px; font-size: 0.85rem;">
                    In Progress
                </span>
            </div>
        `).join('');
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
    if (id === 'appointmentModal' && !selectedGroupId) {
        document.querySelector('#appointmentModal h2').textContent = 'Walk-In';
        document.getElementById('apptTime').innerHTML = `
            <option>8:30 AM - 9:30 AM</option>
            <option>11:45 - 2:20 PM</option>
        `;
    }
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function scheduleWithGroup(groupId) {
    selectedGroupId = groupId;
    const group = groups.find(g => g.id === groupId);
    openModal('appointmentModal');
    document.querySelector('#appointmentModal h2').textContent = 'Request Repair';

    const timeSelect = document.getElementById('apptTime');
    if (group.period === 'AM') {
        timeSelect.innerHTML = `
            <option>8:30 AM - 9:30 AM</option>
            <option>9:30 AM - 10:30 AM</option>
            <option>10:30 AM - 11:30 AM</option>
        `;
    } else {
        timeSelect.innerHTML = `
            <option>12:00 PM - 1:00 PM</option>
            <option>1:00 PM - 2:00 PM</option>
            <option>2:00 PM - 3:00 PM</option>
        `;
    }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

function scrollToGroups() {
    document.querySelector('.groups-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleAdminPanel() {
    const role = document.getElementById('roleIndicator').textContent.trim();
    const panel = document.getElementById('adminPanel');
    if (role === 'Admin') {
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }
}

function showTopic(id) {
    document.querySelectorAll('.about-topic').forEach(section => {
        section.style.display = 'none';
        section.classList.remove('active');
    });
    const target = document.getElementById(id);
    target.style.display = 'block';
    target.classList.add('active');
}

function filterTeams() {
    const filter = document.getElementById('teamFilter').value;
    document.querySelectorAll('.group-card').forEach(card => {
        const badge = card.querySelector('.group-badge');
        if (!badge) return;
        const period = badge.textContent.includes('AM') ? 'AM' : 'PM';
        card.style.display = (filter === 'all' || filter === period) ? 'block' : 'none';
    });
}

// ============================================================
// START — waits for DOM so window.supabase is guaranteed loaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const savedRole = sessionStorage.getItem('bocesRole');
    if (savedRole) currentRole = savedRole;

    loadData();
});