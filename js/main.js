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
    const device = document.getElementById('apptDevice').value;
    const issue = document.getElementById('apptIssue').value.trim();
    const date = document.getElementById('apptDate').value;
    const time = document.getElementById('apptTime').value;

    if (!name || !issue || !date) { alert('Please fill in all required fields'); return; }

    const { data, error } = await db.from('repair_requests').insert({
        name,
        device,
        issue,
        date,
        time,
        status: 'pending',
        group_id: null,
        group_name: 'Unassigned'
    }).select().single();

    if (error) {
        if (error.message.includes('Repair limit reached')) {
            alert('Sorry, we are currently at full capacity (20 repairs). Please visit us in person or try again later.');
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
    document.getElementById('apptIssue').value = '';
    document.getElementById('apptDate').value = '';
    selectedGroupId = null;

    alert('Repair request submitted! A team will be assigned by the instructor.');
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
async function submitReview() {
    console.log('rating el:', document.getElementById('reviewRating'));
    console.log('comment el:', document.getElementById('reviewComment'));

    const rating = parseInt(document.getElementById('reviewRating').value);
    const comment = document.getElementById('reviewComment').value.trim();

    if (!comment) { alert('Please write a comment.'); return; }

    const { error } = await db.from('reviews').insert({ rating, comment });
    if (error) { console.error('Error submitting review:', error); alert('Failed to submit review.'); return; }

    document.getElementById('reviewComment').value = '';

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
            <p>"${r.comment}"</p>
            <strong>— Anonymous</strong>
        </div>
    `).join('');
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

function populateAppointmentsModal() {
    const container = document.getElementById('appointmentsContainer');
    if (!container) return;

    const pending = appointments.filter(a => a.status === 'pending');
    const assigned = appointments.filter(a => a.status === 'assigned');
    const completed = appointments.filter(a => a.status === 'completed');

    if (appointments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No repair requests yet.</p>';
        return;
    }

    let html = '';

    if (pending.length > 0) {
        html += '<h3 style="color: #001f3f; margin-bottom: 1rem;">Pending Assignment</h3>';
        pending.forEach(appt => {
            html += `
                <div style="background: #fff3cd; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #ffc107;">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <em>${appt.issue}</em><br>
                    <small>Preferred: ${appt.date} at ${appt.time}</small><br>
                    <div style="margin-top: 0.5rem;">
                        <select id="assign-${appt.id}" style="padding: 0.3rem; margin-right: 0.5rem;">
                            <option value="">Select Team...</option>
                            ${groups.map(g => `<option value="${g.id}">${g.name} (${g.period})</option>`).join('')}
                        </select>
                        <button class="btn btn-primary" style="padding: 0.3rem 1rem;" onclick="assignToGroup(${appt.id})">Assign</button>
                        <button class="btn btn-secondary" style="padding: 0.3rem 1rem; background: #dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                    </div>
                </div>`;
        });
    }

    if (assigned.length > 0) {
        html += '<h3 style="color: #001f3f; margin: 2rem 0 1rem;">Assigned to Teams</h3>';
        assigned.forEach(appt => {
            html += `
                <div style="background: #d1ecf1; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #17a2b8;">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <em>${appt.issue}</em><br>
                    <small>Assigned to: <strong>${appt.group_name}</strong></small><br>
                    <small>Date: ${appt.date} at ${appt.time}</small><br>
                    <div style="margin-top: 0.5rem;">
                        <button class="btn btn-primary" style="padding: 0.3rem 1rem; background: #28a745;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                        <button class="btn btn-secondary" style="padding: 0.3rem 1rem;" onclick="unassignAppointment(${appt.id})">Unassign</button>
                    </div>
                </div>`;
        });
    }

    if (completed.length > 0) {
        html += '<h3 style="color: #001f3f; margin: 2rem 0 1rem;">Completed Repairs</h3>';
        completed.forEach(appt => {
            html += `
                <div style="background: #d4edda; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #28a745;">
                    <strong>${appt.name}</strong> - ${appt.device}<br>
                    <em>${appt.issue}</em><br>
                    <small>Completed by: <strong>${appt.group_name}</strong></small><br>
                    <button class="btn btn-secondary" style="padding: 0.3rem 1rem; margin-top: 0.5rem; background: #dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                </div>`;
        });
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
    if (id === 'appointmentModal' && !selectedGroupId) {
        document.querySelector('#appointmentModal h2').textContent = 'Schedule Repair Appointment';
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