let currentRole = null;
let groups = [];
let totalRepairs = 0;
let appointments = [];
let selectedGroupId = null;

const passwords = {
    admin: 'admin123',
    tech: 'tech123'
};

function loadData() {
    const saved = localStorage.getItem('bocesData');
    if (saved) {
        const data = JSON.parse(saved);
        groups = data.groups || [];
        totalRepairs = data.totalRepairs || 0;
        appointments = data.appointments || [];
    }
    calculateTotalRepairs();
    updateDisplay();
}

function saveData() {
    localStorage.setItem('bocesData', JSON.stringify({
        groups,
        totalRepairs,
        appointments
    }));
}

function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    if (id === 'updateStatsModal') {
        populateStatsModal();
    }
    if (id === 'appointmentModal' && !selectedGroupId) {
        // Reset modal title if opened from hero button
        document.querySelector('#appointmentModal h2').textContent = 'Schedule Repair Appointment';
        // Show all time options
        document.getElementById('apptTime').innerHTML = `
                    <option>8:30 AM - 9:30 AM</option>
                    <option>11:45 - 2:20 PM</option>
                `;
    }
}

function scheduleWithGroup(groupId) {
    selectedGroupId = groupId;
    const group = groups.find(g => g.id === groupId);
    openModal('appointmentModal');

    // Update modal title to show which group
    const modalTitle = document.querySelector('#appointmentModal h2');
    modalTitle.textContent = `Request Repair`;

    // Set time options based on AM/PM
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

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function login() {
    const role = document.getElementById('loginRole').value;
    const password = document.getElementById('loginPassword').value;

    if (password === passwords[role]) {
        currentRole = role;
        updateRoleDisplay();
        closeModal('loginModal');
        document.getElementById('loginPassword').value = '';
        alert('Login successful!');
    } else {
        alert('Incorrect password!');
    }
}

function logout() {
    currentRole = null;
    updateRoleDisplay();
}

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

    // Re-render groups to show/hide delete buttons based on role
    updateDisplay();
}

function createGroup() {
    const name = document.getElementById('groupName').value;
    const period = document.getElementById('groupPeriod').value;

    if (!name) {
        alert('Please enter a group name');
        return;
    }

    groups.push({
        id: Date.now(),
        name,
        period,
        repairs: 0,
        projects: []
    });

    saveData();
    updateDisplay();
    closeModal('createGroupModal');
    document.getElementById('groupName').value = '';
    alert('Group created successfully!');
}

function submitAppointment() {
    const name = document.getElementById('apptName').value;
    const device = document.getElementById('apptDevice').value;
    const issue = document.getElementById('apptIssue').value;
    const date = document.getElementById('apptDate').value;
    const time = document.getElementById('apptTime').value;

    if (!name || !issue || !date) {
        alert('Please fill in all required fields');
        return;
    }

    const appointment = {
        id: Date.now(),
        name,
        device,
        issue,
        date,
        time,
        status: 'pending',
        groupId: null,
        groupName: 'Unassigned'
    };

    appointments.push(appointment);
    populateAppointmentsModal();
    console.log(appointments);

    saveData();
    closeModal('appointmentModal');
    document.getElementById('apptName').value = '';
    document.getElementById('apptIssue').value = '';
    document.getElementById('apptDate').value = '';

    selectedGroupId = null;
    alert('Repair request submitted! A team will be assigned by the instructor.');
}

function populateStatsModal() {
    // Calculate current total from groups
    const calculatedTotal = groups.reduce((sum, group) => sum + group.repairs, 0);
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

function updateStats() {
    const manualTotal = parseInt(document.getElementById('totalRepairsInput').value);

    groups.forEach(group => {
        const input = document.getElementById(`group-${group.id}`);
        if (input) {
            group.repairs = parseInt(input.value) || 0;
        }
    });

    // Calculate total from groups
    const calculatedTotal = groups.reduce((sum, group) => sum + group.repairs, 0);

    // Use manual total if provided and different, otherwise use calculated
    if (!isNaN(manualTotal) && manualTotal !== calculatedTotal) {
        totalRepairs = manualTotal;
    } else {
        totalRepairs = calculatedTotal;
    }

    saveData();
    updateDisplay();
    closeModal('updateStatsModal');
    alert('Statistics updated!');
}

function calculateTotalRepairs() {
    // Calculate total from all groups
    const calculatedTotal = groups.reduce((sum, group) => sum + (group.repairs || 0), 0);

    // Always use the calculated total from groups
    totalRepairs = calculatedTotal;

    return totalRepairs;
}

function updateDisplay() {
    // Recalculate total repairs every time display updates
    calculateTotalRepairs();
    populateAppointmentsModal();

    document.getElementById('totalRepairs').textContent = totalRepairs;

    const container = document.getElementById('groupsContainer');
    if (groups.length === 0) {
        container.innerHTML = '<p style="text-align: center; grid-column: 1/-1;">No groups yet. Admin can create groups.</p>';
    } else {
        container.innerHTML = groups.map(group => `
                    <div class="group-card">
                        <h3>${group.name}</h3>
                        <span class="group-badge badge-${group.period.toLowerCase()}">${group.period} Class</span>
                        <p style="font-size: 1.2rem; font-weight: 600; margin: 1rem 0;">
                            ${group.repairs} Repairs Completed
                        </p>
                        <h4 style="margin-top: 1rem;">Top Projects:</h4>
                        <div class="project-gallery">
                            ${group.projects.length === 0 ?
            '<p style="grid-column: 1/-1; text-align: center; color: #999;">No projects yet</p>' :
            group.projects.slice(0, 3).map(p =>
                `<img src="${p}" class="project-img" alt="Project">`
            ).join('')
        }
                        </div>
                        ${currentRole === 'admin' ? `
                        <button class="btn-delete-group" onclick="deleteGroup(${group.id})">
                            Delete Group
                        </button>
                        ` : ''}
                        ${currentRole === 'tech' ? `
                        <button class="btn btn-primary" style="width: 100%; margin-top: 0.5rem;" onclick="viewGroupRepairs(${group.id})">
                            View Assigned Repairs
                        </button>
                        ` : ''}
                    </div>
                `).join('');
    }
}

function deleteGroup(groupId) {
    const group = groups.find(g => g.id === groupId);

    if (confirm(`Are you sure you want to delete "${group.name}"? This action cannot be undone.`)) {
        // Remove the group
        groups = groups.filter(g => g.id !== groupId);

        // Remove any appointments assigned to this group
        appointments = appointments.filter(a => a.groupId !== groupId);

        saveData();
        updateDisplay();
        alert('Group deleted successfully!');
    }
}

function scrollToGroups() {
    const groupsSection = document.querySelector('.groups-section');
    groupsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateAppointmentsModal() {
    const container = document.getElementById('appointmentsContainer');

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
                        </div>
                    `;
        });
    }

    if (assigned.length > 0) {
        html += '<h3 style="color: #001f3f; margin: 2rem 0 1rem;">Assigned to Teams</h3>';
        assigned.forEach(appt => {
            html += `
                        <div style="background: #d1ecf1; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #17a2b8;">
                            <strong>${appt.name}</strong> - ${appt.device}<br>
                            <em>${appt.issue}</em><br>
                            <small>Assigned to: <strong>${appt.groupName}</strong></small><br>
                            <small>Date: ${appt.date} at ${appt.time}</small><br>
                            <div style="margin-top: 0.5rem;">
                                <button class="btn btn-primary" style="padding: 0.3rem 1rem; background: #28a745;" onclick="markCompleted(${appt.id})">Mark Completed</button>
                                <button class="btn btn-secondary" style="padding: 0.3rem 1rem;" onclick="unassignAppointment(${appt.id})">Unassign</button>
                            </div>
                        </div>
                    `;
        });
    }

    if (completed.length > 0) {
        html += '<h3 style="color: #001f3f; margin: 2rem 0 1rem;">Completed Repairs</h3>';
        completed.forEach(appt => {
            html += `
                        <div style="background: #d4edda; padding: 1rem; border-radius: 5px; margin-bottom: 1rem; border-left: 4px solid #28a745;">
                            <strong>${appt.name}</strong> - ${appt.device}<br>
                            <em>${appt.issue}</em><br>
                            <small>Completed by: <strong>${appt.groupName}</strong></small><br>
                            <button class="btn btn-secondary" style="padding: 0.3rem 1rem; margin-top: 0.5rem; background: #dc3545;" onclick="deleteAppointment(${appt.id})">Delete</button>
                        </div>
                    `;
        });
    }

    container.innerHTML = html;
}

function assignToGroup(apptId) {
    const select = document.getElementById(`assign-${apptId}`);
    const groupId = parseInt(select.value);

    if (!groupId) {
        alert('Please select a team');
        return;
    }

    const appt = appointments.find(a => a.id === apptId);
    const group = groups.find(g => g.id === groupId);

    appt.groupId = groupId;
    appt.groupName = group.name;
    appt.status = 'assigned';

    saveData();
    populateAppointmentsModal();
    alert(`Assigned to ${group.name}!`);
}

function unassignAppointment(apptId) {
    const appt = appointments.find(a => a.id === apptId);
    appt.groupId = null;
    appt.groupName = 'Unassigned';
    appt.status = 'pending';

    saveData();
    populateAppointmentsModal();
}

function markCompleted(apptId) {
    const appt = appointments.find(a => a.id === apptId);
    appt.status = 'completed';

    saveData();
    populateAppointmentsModal();
    alert('Repair marked as completed!');
}

function deleteAppointment(apptId) {
    if (confirm('Are you sure you want to delete this request?')) {
        appointments = appointments.filter(a => a.id !== apptId);
        saveData();
        populateAppointmentsModal();
    }
}

function viewGroupRepairs(groupId) {
    const group = groups.find(g => g.id === groupId);
    const groupAppts = appointments.filter(a => a.groupId === groupId && a.status !== 'completed');

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
                            ${appt.status === 'assigned' ? 'In Progress' : appt.status}
                        </span>
                    </div>
                `).join('');
    }

    openModal('viewGroupRepairsModal');
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

loadData();
updateRoleDisplay();