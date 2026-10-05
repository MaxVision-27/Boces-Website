// ============================================================
// TECH FORUM — students share how they fixed a device: the steps,
// YouTube and part links, and optionally the session notes from a
// ticket they finished (notes only, never the customer). Every post
// has a device name, a device type and problem filters for searching.
// Staff only in the database (015_forum.sql). Authors edit or delete
// their own posts; an admin can delete any.
// ============================================================
const FORUM_DEVICE_TYPES = ['Laptop', 'Desktop', 'Tablet', 'Phone', 'Other'];
const FORUM_TAGS = ['Screen', 'Battery', 'Charging', 'Keyboard', 'Storage', 'RAM', 'Software',
    'Virus', 'Water damage', 'Overheating', "Won't turn on", 'Wi-Fi', 'Data recovery', 'Other'];

// Whole words only, so "class" and "assembly" pass. Same list as the
// database trigger, which has the final say.
const FORUM_SWEAR_PATTERN = /\b(fuck\w*|motherfuck\w*|shit\w*|bullshit\w*|bitch\w*|bastards?|assholes?|ass|dicks?|cunts?|piss(ed|ing)?|sluts?|whores?|nigg(er|a)s?|fag(got)?s?|retard(ed|s)?)\b/i;
const FORUM_LINK_PATTERN = /^https?:\/\/[^\s"<>]+$/i;

let forumPosts = [];

async function openForum() {
    const { data, error } = await db.from('forum_posts').select('*').order('created_at', { ascending: false });
    if (error) { console.error('Error loading forum:', error); alert('Could not load the forum.'); return; }
    forumPosts = data;

    const filters = document.getElementById('forumTagFilters');
    if (!filters.children.length) {
        filters.innerHTML = FORUM_TAGS.map(tag =>
            `<button type="button" class="forum-filter" aria-pressed="false" onclick="toggleForumTag(this)">${escapeHtml(tag)}</button>`).join('');
    }
    showForumList();
    openModal('forumModal');
}

function toggleForumTag(btn) {
    btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') !== 'true');
    renderForumList();
}

function showForumList() {
    document.getElementById('forumListView').hidden = false;
    document.getElementById('forumDetail').hidden = true;
    renderForumList();
}

function forumTagChips(tags) {
    return tags.map(t => `<span class="forum-tag">${escapeHtml(t)}</span>`).join('');
}

function renderForumList() {
    const query = document.getElementById('forumSearch').value.trim().toLowerCase();
    const type = document.getElementById('forumType').value;
    const tags = [...document.querySelectorAll('.forum-filter[aria-pressed="true"]')].map(b => b.textContent);

    const shown = forumPosts.filter(p =>
        (!type || p.device_type === type) &&
        (!tags.length || tags.some(t => p.tags.includes(t))) &&
        (!query || [p.title, p.device, p.body, p.ticket_notes].join(' ').toLowerCase().includes(query)));

    document.getElementById('forumList').innerHTML = shown.length
        ? `<div class="folder-list">${shown.map(p => `
            <button type="button" class="folder-card" onclick="showForumPost(${p.id})">
                <span class="folder-top"><strong>${escapeHtml(p.title)}</strong> <span class="forum-type">${escapeHtml(p.device_type)}</span></span>
                <span class="folder-issue">${escapeHtml(p.device)}</span>
                <span class="forum-tags">${forumTagChips(p.tags)}</span>
                <span class="folder-meta">${escapeHtml(p.author_name)} · ${new Date(p.created_at).toLocaleDateString()}${p.ticket_notes ? ' · Ticket notes' : ''} <strong>Read →</strong></span>
            </button>`).join('')}</div>`
        : `<p class="ws-hint" style="text-align:center; padding:1.5rem 0;">${forumPosts.length ? 'No posts match. Try fewer filters or another word.' : 'No posts yet. Fixed something tricky? Be the first to share it.'}</p>`;
}

function linkify(text) {
    return escapeHtml(text).replace(/https?:\/\/[^\s<"]+/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function forumLinkLabel(url) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return /(^|\.)youtu(\.be|be\.com)$/.test(host) ? `▶ Video on ${host}` : `${host} ↗`;
}

function canEditForumPost(p) {
    return currentRole === 'admin' || (currentTechId && p.tech_id === currentTechId);
}

function showForumPost(id) {
    const p = forumPosts.find(x => x.id === id);
    const links = p.links.filter(l => FORUM_LINK_PATTERN.test(l));
    document.getElementById('forumListView').hidden = true;
    const detail = document.getElementById('forumDetail');
    detail.hidden = false;
    detail.dataset.post = id; // which post is showing
    detail.innerHTML = `
        <button class="ws-back" onclick="showForumList()">← All posts</button>
        <div class="ws-header">
            <div>
                <p class="ws-eyebrow">${escapeHtml(p.device)} · ${escapeHtml(p.device_type)}</p>
                <h2>${escapeHtml(p.title)}</h2>
            </div>
        </div>
        <p class="forum-tags" style="margin-bottom:0.5rem;">${forumTagChips(p.tags)}</p>
        <p class="ws-hint">Posted by ${escapeHtml(p.author_name)} on ${new Date(p.created_at).toLocaleDateString()}${p.updated_at ? ' (edited)' : ''}</p>

        <section class="ws-card">
            <h3>How I fixed it</h3>
            <p class="forum-body">${linkify(p.body)}</p>
        </section>

        ${links.length ? `
        <section class="ws-card">
            <h3>Helpful links</h3>
            <ul class="forum-links">${links.map(l => `<li><a href="${escapeHtml(l)}" target="_blank" rel="noopener noreferrer">${escapeHtml(forumLinkLabel(l))}</a></li>`).join('')}</ul>
        </section>` : ''}

        ${p.ticket_notes ? `
        <section class="ws-card">
            <h3>Notes from the repair</h3>
            <p class="forum-body">${linkify(p.ticket_notes)}</p>
        </section>` : ''}

        ${canEditForumPost(p) ? `
        <div class="ws-actions">
            ${currentTechId && p.tech_id === currentTechId ? `<button class="btn btn-outline" onclick="openForumForm(${p.id})">Edit</button>` : ''}
            <button class="btn btn-danger" onclick="deleteForumPost(${p.id})">Delete</button>
        </div>` : ''}`;
    detail.closest('.modal-content').scrollTop = 0;
}

// Finished tickets this student worked on (or any finished ticket, for
// an admin): the ones whose notes can be copied into a post.
function forumNoteTickets() {
    const done = appointments.filter(a => a.status === 'completed');
    if (currentRole === 'admin') return done;
    const loggedOn = new Set(myTimeLogs.map(l => l.ticket_id));
    return done.filter(a => (a.assigned_tech_ids || []).includes(currentTechId) || loggedOn.has(a.id));
}

async function openForumForm(editId = null) {
    const p = editId ? forumPosts.find(x => x.id === editId) : null;
    await loadMyTimeLogs();
    const tickets = forumNoteTickets();
    document.getElementById('forumListView').hidden = true;
    const detail = document.getElementById('forumDetail');
    detail.hidden = false;
    detail.dataset.post = '';
    detail.innerHTML = `
        <button class="ws-back" onclick="showForumList()">← All posts</button>
        <h2>${p ? 'Edit your post' : 'Share a fix'}</h2>
        <p class="ws-hint">Help the next student who gets this problem. Leave out customer names, emails, and passwords.</p>

        <section class="ws-card">
            <label>Title <input type="text" id="forumTitle" maxlength="120" value="${escapeHtml(p?.title || '')}" placeholder="Example: Replacing a cracked screen on a Dell Latitude"></label>
            <div class="ws-fields" style="grid-template-columns: 2fr 1fr;">
                <label>Device name <input type="text" id="forumDevice" maxlength="80" value="${escapeHtml(p?.device || '')}" placeholder="Example: Dell Latitude 5420"></label>
                <label>Device type
                    <select id="forumDeviceType">
                        <option value="">Choose one</option>
                        ${FORUM_DEVICE_TYPES.map(t => `<option ${p?.device_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </label>
            </div>
            <p class="forum-label">Filters <span class="ws-hint">(pick at least one so others can find this)</span></p>
            <div class="ws-actions" style="margin-bottom:1rem;">
                ${FORUM_TAGS.map(t => `<label class="pick-chip"><input type="checkbox" class="forum-tag-pick" value="${escapeHtml(t)}" ${p?.tags.includes(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`).join('')}
            </div>
        </section>

        <section class="ws-card">
            <label>How I fixed it
                <textarea id="forumBody" rows="6" maxlength="5000" placeholder="Example: The screen flickered only when the lid moved, so I reseated the display cable behind the hinge cover. Take out the two screws under the rubber feet first.">${escapeHtml(p?.body || '')}</textarea>
            </label>
            <label>Helpful links <span class="ws-hint">(optional, one per line)</span>
                <textarea id="forumLinks" rows="3" placeholder="Example:&#10;https://www.youtube.com/watch?v=...&#10;https://www.ifixit.com/...">${escapeHtml((p?.links || []).join('\n'))}</textarea>
            </label>
        </section>

        <section class="ws-card">
            <h3>Notes from a ticket <span class="ws-hint">(optional)</span></h3>
            <p class="ws-hint">Pick a repair you finished to copy its session notes into your post. Only the notes come over, never the customer. You can edit them before posting.</p>
            ${tickets.length ? `
            <label>Finished ticket
                <select id="forumTicket" onchange="importForumTicketNotes(this.value)">
                    <option value="">None</option>
                    ${tickets.map(a => `<option value="${a.id}" ${p?.ticket_id === a.id ? 'selected' : ''}>Ticket #${a.id} · ${escapeHtml(a.device)}</option>`).join('')}
                </select>
            </label>` : '<p class="ws-hint" style="margin:0;">You have no finished tickets yet.</p>'}
            <textarea id="forumNotes" rows="4" maxlength="5000" ${p?.ticket_notes ? '' : 'hidden'} placeholder="Notes from the ticket">${escapeHtml(p?.ticket_notes || '')}</textarea>
        </section>

        <p class="forum-error" id="forumError" hidden></p>
        <button class="btn btn-primary" onclick="saveForumPost(${editId})">${p ? 'Save Changes' : 'Post'}</button>`;
    detail.closest('.modal-content').scrollTop = 0;
}

async function importForumTicketNotes(ticketId) {
    const notes = document.getElementById('forumNotes');
    if (!ticketId) { notes.value = ''; notes.hidden = true; return; }

    const { data: logs, error } = await db.from('time_logs')
        .select('*')
        .eq('ticket_id', Number(ticketId))
        .order('work_date')
        .order('start_time');
    if (error) { console.error('Error loading ticket notes:', error); alert('Could not load that ticket\'s notes.'); return; }

    const techName = id => techs.find(t => t.id === id)?.name || 'A student';
    notes.value = logs.filter(l => l.note)
        .map(l => `${new Date(l.work_date + 'T00:00:00').toLocaleDateString()} · ${techName(l.tech_id)}: ${l.note}`)
        .join('\n') || 'No notes were logged on this ticket.';
    notes.hidden = false;

    // Fill in what the ticket already knows.
    const appt = appointments.find(a => a.id === Number(ticketId));
    const type = { Smartphone: 'Phone' }[appt.device] || appt.device;
    const typeSelect = document.getElementById('forumDeviceType');
    if (!typeSelect.value && FORUM_DEVICE_TYPES.includes(type)) typeSelect.value = type;
}

async function saveForumPost(editId) {
    const val = id => document.getElementById(id)?.value.trim() || '';
    const ticketId = Number(val('forumTicket')) || null;
    const post = {
        title: val('forumTitle'),
        device: val('forumDevice'),
        device_type: val('forumDeviceType'),
        tags: [...document.querySelectorAll('.forum-tag-pick:checked')].map(cb => cb.value),
        body: val('forumBody'),
        links: val('forumLinks').split('\n').map(l => l.trim()).filter(Boolean),
        ticket_id: ticketId,
        ticket_notes: ticketId ? val('forumNotes') || null : null
    };

    const problem =
        post.title.length < 3 ? 'Give your post a title.' :
        post.device.length < 2 ? 'Add the device name, like "Dell Latitude 5420".' :
        !post.device_type ? 'Choose the device type.' :
        !post.tags.length ? 'Pick at least one filter so others can find your post.' :
        post.body.length < 10 ? 'Describe how you fixed it.' :
        post.links.find(l => !FORUM_LINK_PATTERN.test(l)) ? `This link doesn't look right: ${post.links.find(l => !FORUM_LINK_PATTERN.test(l))}. Links start with https://` :
        post.links.length > 10 ? 'Keep it to 10 links or fewer.' :
        FORUM_SWEAR_PATTERN.test([post.title, post.device, post.body, ...post.links, post.ticket_notes].join(' ')) ? 'Please keep it clean: remove the flagged word and try again.' :
        null;
    const errorBox = document.getElementById('forumError');
    errorBox.hidden = !problem;
    errorBox.textContent = problem || '';
    if (problem) { errorBox.scrollIntoView({ block: 'center' }); return; }

    const request = editId
        ? db.from('forum_posts').update(post).eq('id', editId).select().single()
        : db.from('forum_posts').insert({ ...post, tech_id: currentTechId, author_name: currentTechName || 'Admin' }).select().single();
    const { data, error } = await request;
    if (error) {
        console.error('Error saving post:', error);
        errorBox.hidden = false;
        errorBox.textContent = /keep it clean/.test(error.message) ? error.message : 'Could not save your post. Try again.';
        return;
    }

    forumPosts = [data, ...forumPosts.filter(x => x.id !== data.id)];
    showForumPost(data.id);
}

async function deleteForumPost(id) {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    const { error } = await db.from('forum_posts').delete().eq('id', id);
    if (error) { console.error('Error deleting post:', error); alert('Could not delete the post.'); return; }
    forumPosts = forumPosts.filter(p => p.id !== id);
    showForumList();
}
