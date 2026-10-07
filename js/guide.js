// ============================================================
// WORKFLOW GUIDE (Tech and Admin) — a game-style tour of the real
// screens, with one step list per role.
// Each step spotlights one element (everything else dims) with a
// callout joined to it by a line. Students go at their own pace: click
// the highlighted button or press Next (arrow keys work too). Steps are
// grouped into chapters, listed with their step numbers in Contents.
//
// It always runs in a sandbox: `db` (main.js) is swapped for an
// in-memory fake with no network, the roster and tickets are samples,
// and leaving reloads the page, so nothing from the tour survives.
// Every database call in main.js goes through `db`, so nothing real
// can be read, saved, or emailed while the guide is open.
// ============================================================

function fakeDb(tables) {
    let nextId = 42;
    const from = table => {
        const rows = tables[table] ||= [];
        let op = 'select', payload, one = false;
        const filters = [];
        const match = r => filters.every(f => f(r));
        const run = () => {
            let data;
            if (op === 'insert') {
                data = payload.map(p => ({ id: nextId++, created_at: new Date().toISOString(), ...p }));
                // What the real database triggers fill in (013_hours_teams.sql)
                data.forEach(r => {
                    if (table === 'repair_requests') r.creation_tech_ids = r.assigned_tech_ids;
                    if (table === 'time_logs') r.team_tech_ids = tables.repair_requests.find(t => t.id === r.ticket_id)?.assigned_tech_ids;
                });
                rows.push(...data);
            } else if (op === 'update') {
                data = rows.filter(match);
                data.forEach(r => Object.assign(r, payload));
            } else if (op === 'delete') {
                data = rows.filter(match);
                for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
            } else {
                data = rows.filter(match);
            }
            data = data.map(r => ({ ...r }));
            return { data: one ? data[0] ?? null : data, error: null };
        };
        const q = {
            select: () => q,
            insert: p => { op = 'insert'; payload = [].concat(p); return q; },
            update: p => { op = 'update'; payload = p; return q; },
            delete: () => { op = 'delete'; return q; },
            eq: (col, val) => { filters.push(r => r[col] === val); return q; },
            order: () => q,
            single: () => { one = true; return q; },
            maybeSingle: () => { one = true; return q; },
            then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
        };
        return q;
    };
    return { from, rpc: async () => ({ data: null, error: null }) };
}

const SAMPLE_PART = 'Power supply for Dell OptiPlex 7080';
const SAMPLE_SEND_BACK_NOTE = 'The screen still flickers when the lid is half open. Check the display cable.';

function enterSandbox(role) {
    const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
    const ticket = (id, name, device, issue, status, team, days, make_model) => ({
        id, name, email: '', device, issue, status, tracking_code: `PRAC${id}`, created_at: daysAgo(days),
        assigned_tech_ids: team, creation_tech_ids: team, created_by: 'Sample', parts_used: '', review_note: null,
        make_model, serial_tag: `SN${id}X7`, contact_number: '(516) 555-0100', class_name: 'Culinary Arts', room_number: 'B112', computer_password: null,
        priority: false, drop_off_id: null
    });
    // A customer who joined today's line, in the class being shown.
    const dropOff = session => ({
        id: 7, created_at: daysAgo(0), visit_date: todayDateStr(), session, name: 'Taylor Brooks (sample)', contact_number: null,
        class_name: 'Cosmetology', room_number: 'A104', device: 'Laptop', make_model: null, issue: null, line_code: 101
    });
    const log = (id, ticket_id, tech_id, days, start, end, note, team) => ({
        id, ticket_id, tech_id, work_date: daysAgo(days).slice(0, 10), start_time: start, end_time: end, note,
        team_tech_ids: team, created_at: daysAgo(days)
    });
    let tickets, logs, requests;
    const posts = [
        {
            id: 3, created_at: daysAgo(6), updated_at: null, tech_id: 2, author_name: 'Jordan (sample)',
            title: 'Laptop screen flickers when the lid moves', device: 'Dell Latitude 5420', device_type: 'Laptop', tags: ['Screen'],
            body: 'It was the display cable, not the panel. Take off the hinge covers (two screws under the back rubber feet), reseat the cable at both ends, and test before you close it up.',
            links: ['https://www.youtube.com/results?search_query=dell+latitude+5420+display+cable'], ticket_id: null, ticket_notes: null
        },
        {
            id: 4, created_at: daysAgo(2), updated_at: null, tech_id: 3, author_name: 'Priya (sample)',
            title: 'Phone battery dead by lunch', device: 'iPhone 12', device_type: 'Phone', tags: ['Battery', 'Software'],
            body: 'Check Settings > Battery > Battery Health first. Under 80% means it needs a new battery. Above that, look for an app with lots of background activity.',
            links: ['https://www.ifixit.com/Device/iPhone_12'], ticket_id: 30,
            ticket_notes: 'Battery health 71%. Customer is ordering a battery.\nInstalled the new battery. Health reads 100%.'
        }
    ];

    if (role === 'admin') {
        techs = [{ id: 1, name: 'Alex (sample)', session: 'AM' }, { id: 2, name: 'Jordan (sample)', session: 'PM' }, { id: 3, name: 'Priya (sample)', session: 'PM' }];
        currentTechId = null;
        tickets = [
            ticket(58, 'Sam Patel', 'Smartphone', 'Battery drains by lunch.', 'in_progress', [1], 3, 'iPhone 12'),
            ticket(57, 'Jamie Rivera', 'Laptop', 'Screen is cracked in the top left corner and flickers.', 'review', [2, 3], 4, 'Dell Latitude 5420'),
            ticket(60, 'Morgan Blake', 'Tablet', 'Charging port is loose.', 'pending', [], 0, 'iPad 9th gen')
        ];
        logs = [
            log(7, 57, 2, 3, '13:15:00', '14:00:00', 'Took off the bezel. LCD panel is cracked. Customer is ordering one.', [2, 3]),
            log(8, 57, 3, 1, '13:15:00', '14:00:00', 'Installed the new panel and tested it. No flicker.', [2, 3]),
            log(9, 58, 1, 1, '13:15:00', '14:00:00', 'Battery health is 61%. Customer is ordering a battery.', [1])
        ];
        tickets[0].priority = true;
        requests = [dropOff('PM')];
    } else {
        currentSession ||= 'PM';
        const me = { id: 1, name: currentTechName || 'You', session: currentSession };
        techs = [me, { id: 2, name: 'Jordan (sample)', session: currentSession }, { id: 3, name: 'Priya (sample)', session: currentSession }];
        currentTechId = me.id;
        currentTechName = me.name;
        tickets = [
            ticket(35, 'Casey Morgan', 'Laptop', 'Keyboard missing keys.', 'completed', [1], 9, 'HP 250 G8'),
            ticket(41, 'Riley Chen', 'Desktop', "Won't turn on after a storm.", 'in_progress', [1, 2], 2, 'Dell OptiPlex 7080')
        ];
        logs = [
            log(5, 35, 1, 8, '13:00:00', '13:45:00', 'Ordered the keyboard for the HP 250 G8. Pop the old keys off with a plastic pry tool.', [1]),
            log(6, 35, 1, 6, '13:15:00', '14:00:00', 'Swapped the keyboard. Tested every key in Notepad.', [1]),
            log(7, 41, 2, 1, '13:15:00', '14:00:00', 'Power supply fan does not spin. Tested with a spare PSU and it boots. Next: customer orders a PSU.', [1, 2])
        ];
        requests = [dropOff(currentSession), { ...dropOff(currentSession), id: 8, name: 'Taylor Brooks Jr (sample)', class_name: 'Welding', room_number: 'A110', device: 'Tablet', line_code: 102 }];
    }

    appointments = tickets.map(t => ({ ...t }));
    myTimeLogs = [];
    dropOffs = requests.map(r => ({ ...r }));
    realDb ??= db; // logout still reaches the real database
    db = fakeDb({ repair_requests: tickets, time_logs: logs, techs: techs.map(t => ({ ...t })), stats: [], forum_posts: posts, drop_off_requests: requests });
    // Native dialogs would stall the tour; the page reload on exit brings them back.
    window.alert = () => {};
    window.confirm = () => true;
    askText = async ({ title, value }) => ({ 'Waiting for part': SAMPLE_PART, 'Send it back': SAMPLE_SEND_BACK_NOTE })[title] ?? value;
    populateAppointmentsModal();
    renderDropOffs();
    return showHomeView(); // the visible section still shows real tickets
}

const $g = sel => document.querySelector(sel);
// Folded sections open when the guide points at them.
const wsCard = title => {
    const card = [...document.querySelectorAll('#ticketWorkspaceContainer .ws-card')]
        .find(c => c.querySelector('h3')?.textContent === title);
    if (card?.tagName === 'DETAILS') card.open = true;
    return card;
};
const isOpen = id => document.getElementById(id).style.display === 'flex';
const guideTicketId = () => appointments.at(-1).id;

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    // Back to the role's first tab (display only, so it can't race a step's own setup).
    showView(currentRole === 'admin' ? 'ticketPoolModal' : 'myTicketsModal');
}

// Going Back past a status change puts the practice ticket back in the
// status (and note) that step expects.
async function sandboxStatus(status, id = guideTicketId(), extra = {}) {
    const appt = appointments.find(a => a.id === id);
    const update = { status, ...extra };
    if (Object.keys(update).some(k => appt[k] !== update[k])) {
        await db.from('repair_requests').update(update).eq('id', id);
        Object.assign(appt, update);
        populateAppointmentsModal();
        renderTicketWorkspace();
    }
}

function fillNewTicket() {
    if (!isOpen('techTicketModal')) { closeAllModals(); openTechTicketModal(); }
    const example = {
        techApptName: 'Jamie Rivera', techApptContact: '(516) 555-0123', techApptClass: 'Culinary Arts AM', techApptRoom: 'B112',
        techApptModel: 'Dell Latitude 5420', techApptSerial: '7XK3LM2',
        techApptIssue: 'Screen is cracked in the top left corner and flickers when opened.'
    };
    Object.entries(example).forEach(([id, value]) => { $g(`#${id}`).value ||= value; });
    $g('#techApptDevice').value = 'Laptop';
}

async function showServiceLogPreview(id) {
    if (!isOpen('paperPreviewModal')) { await ensureWorkspace(id); await previewServiceLog(id); }
}

async function ensureForum() {
    if (!isOpen('forumModal')) { closeAllModals(); await openForum(); }
    else showForumList();
}

async function ensureForumForm() {
    if (!isOpen('forumModal')) { closeAllModals(); await openForum(); }
    if (document.getElementById('forumDetail').hidden || !$g('#forumTitle')) await openForumForm();
}

async function ensureForumPost(id) {
    if (!isOpen('forumModal')) { closeAllModals(); await openForum(); }
    const detail = document.getElementById('forumDetail');
    if (detail.hidden || detail.dataset.post !== String(id)) showForumPost(id);
}

const forumFormCard = field => $g(field)?.closest('.ws-card');

// The example post the tech tour writes, filled in only where empty.
async function fillForumSample() {
    await ensureForumForm();
    $g('#forumTitle').value ||= 'Replacing missing keys on an HP keyboard';
    $g('#forumDevice').value ||= 'HP 250 G8';
    $g('#forumDeviceType').value ||= 'Laptop';
    if (!$g('.forum-tag-pick:checked')) $g('.forum-tag-pick[value="Keyboard"]').checked = true;
    $g('#forumBody').value ||= 'Order the whole keyboard, not single keys.\n1. Take out the battery and the screws under the rubber feet.\n2. Pop the keyboard up from the top edge with a plastic pry tool.\n3. Flip up the ribbon cable latch before you pull the keyboard out.';
    $g('#forumLinks').value ||= 'https://www.youtube.com/results?search_query=hp+250+g8+keyboard+replacement';
}

async function fillForumSampleNotes() {
    await fillForumSample();
    const pick = $g('#forumTicket');
    if (pick && !pick.value) { pick.value = '35'; await importForumTicketNotes('35'); }
}

async function ensureWorkspace(id = guideTicketId()) {
    closeModal('paperPreviewModal');
    if (!isWorkspaceOpen() || workspaceTicketId !== id) {
        closeAllModals();
        await openTicketWorkspace(id);
    }
}

function ensurePool() {
    if (!isOpen('ticketPoolModal')) {
        closeAllModals();
        populateAppointmentsModal();
        openModal('ticketPoolModal');
    }
}

// target: the element to spotlight (none = centered message).
// click: the step is done by pressing that element; Next presses it too.
// chapter: this step starts a chapter in the table of contents.
const TECH_STEPS = [
    {
        chapter: "Welcome",
        title: 'Welcome to the Workflow Guide',
        text: "We'll walk through one repair, from drop-off to check-off, on the real screens. The tickets are practice ones, so go ahead and click what we highlight. Nothing is saved, emailed, or added to your hours.",
        setup: closeAllModals,
    },
    {
        chapter: "Make a ticket",
        title: 'A customer walks in',
        text: 'Someone just dropped off a laptop with a cracked screen. Every repair starts with New Ticket.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openTechTicketModal"]'),
        click: true,
    },
    {
        title: 'Fill in the Help Desk Ticket',
        text: "The customer's name, a contact number, their class and room, and the computer's make, model, and serial tag (usually on a sticker underneath). Only take the password if you need it to test. It stays hidden while the customer watches. We filled in an example.",
        setup: fillNewTicket,
        target: () => $g('#techTicketModal .form-row'),
    },
    {
        title: 'Describe the problem',
        text: 'Write the problem in the customer\'s words.',
        setup: fillNewTicket,
        target: () => $g('#techApptIssue'),
    },
    {
        title: 'Who is working with you?',
        text: 'Tick anyone helping on this repair. Everyone ticked gets 30 minutes of Ticket Creation hours.',
        target: () => $g('#techPartnerPicker'),
    },
    {
        title: 'The whole New Ticket form',
        text: "That's everything on a new ticket: the customer, their device, the problem, and who's working on it. Next, create it.",
        setup: fillNewTicket,
        target: () => $g('#techTicketModal .modal-content'),
        section: true,
    },
    {
        title: 'Create the ticket',
        text: 'Click Create Ticket.',
        target: () => $g('#techTicketModal [onclick^="submitTechTicket"]'),
        click: true,
    },
    {
        title: 'Give the customer their code',
        text: 'This is their tracking code. Copy it or write it down for them. They type it under Track Repair to check on their device.',
        setup: () => {
            if (!isOpen('ticketCreatedModal')) {
                closeAllModals();
                $g('#createdTrackingCode').textContent = appointments.at(-1).tracking_code;
                openModal('ticketCreatedModal');
            }
        },
        target: () => $g('#ticketCreatedModal .modal-content'),
        section: true,
    },
    {
        title: 'Print the Help Desk Ticket',
        text: 'Click Print Help Desk Ticket. It comes out filled in from what you typed.',
        setup: () => {
            if (!isOpen('ticketCreatedModal')) {
                closeAllModals();
                $g('#createdTrackingCode').textContent = appointments.at(-1).tracking_code;
                $g('#printHelpDeskBtn').dataset.ticket = guideTicketId();
                openModal('ticketCreatedModal');
            }
        },
        target: () => $g('#printHelpDeskBtn'),
        click: true,
    },
    {
        title: 'Have the customer sign it',
        text: 'Both pages print filled in. The customer signs and dates both before they leave the device. Print it with the button at the top.',
        setup: async () => { if (!isOpen('paperPreviewModal')) { closeAllModals(); await previewHelpDesk(guideTicketId()); } },
        target: () => $g('#paperPreviewModal .modal-content'),
        section: true,
    },
    {
        chapter: "Check in today's line",
        title: "Today's line",
        text: "Customers can join today's line from their phone before school. They only give their name, class, room and device type, and get a line number, like a fast food order. Type the number they show you into the Drop-offs search (or their full name if they lost it). Check them in before walk-ins: Customer is here starts New Ticket with that filled in, you ask for the rest, and the ticket gets a Priority badge.",
        setup: () => { closeAllModals(); showView('dropOffsView'); },
        target: () => $g('#dropOffsView'),
        section: true,
    },
    {
        chapter: "Work on a ticket",
        title: 'Your tickets',
        text: 'Everything assigned to you is under My Tickets.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="viewMyTickets"]'),
        click: true,
    },
    {
        title: 'Your ticket list',
        text: 'Active tickets are at the top and completed ones below. Each card shows its status and how much time you have logged on it.',
        setup: async () => { if (!isOpen('myTicketsModal')) { closeAllModals(); await viewMyTickets(); } },
        target: () => $g('#myTicketsModal'),
        section: true,
    },
    {
        title: 'Each ticket is a folder',
        text: 'Open the ticket to do the work.',
        setup: async () => { if (!isOpen('myTicketsModal')) { closeAllModals(); await viewMyTickets(); } },
        target: () => $g(`#myTicketsContainer .folder-card[onclick="openTicketWorkspace(${guideTicketId()})"]`),
        click: true,
    },
    {
        title: 'What to do next',
        text: 'The box at the top always tells you the next step. Press Start Repair when you begin working.',
        setup: async () => { await ensureWorkspace(); await sandboxStatus('assigned'); },
        target: () => $g('#ticketWorkspaceContainer .ws-next button'),
        click: true,
    },
    {
        title: 'Log a work session',
        text: 'Every time you work on it, log the date, when you started and stopped, and what you did. We filled in an example. This fills in the Service Log and your Hours sheet.',
        setup: async () => {
            await ensureWorkspace();
            const id = guideTicketId();
            $g(`#logStart-${id}`).value ||= '13:15';
            $g(`#logEnd-${id}`).value ||= '14:00';
            $g(`#logNote-${id}`).value ||= 'Took off the bezel. The LCD panel is cracked. Next: the customer orders a replacement panel.';
        },
        target: () => wsCard('Log a work session'),
    },
    {
        title: 'Save the session',
        text: 'Click Save Session.',
        target: () => wsCard('Log a work session')?.querySelector('[onclick^="logTime"]'),
        click: true,
    },
    {
        title: 'Work so far',
        text: "Every session from everyone on the ticket shows here, oldest first. You can delete only your own.",
        setup: ensureWorkspace,
        target: () => wsCard('Work so far'),
    },
    {
        title: 'Parts',
        text: 'If the customer bought a part for this repair, list it here. Leave it blank if it did not need one.',
        setup: ensureWorkspace,
        target: () => wsCard('Parts'),
    },
    {
        title: 'Need a part?',
        text: "If the customer has to buy a part, before you start or partway through, press Waiting for part and write which part. Their tracker shows Waiting for part with the part's name. When they bring it in, press Part arrived to keep repairing.",
        setup: async () => { await ensureWorkspace(); await sandboxStatus('in_progress'); },
        target: () => $g('#ticketWorkspaceContainer .ws-next [onclick^="waitForPart"]')
    },
    {
        title: 'Paperwork',
        text: 'Open a form to see exactly what will print. Click Service Log.',
        setup: ensureWorkspace,
        target: () => wsCard('Paperwork')?.querySelector('[onclick^="previewServiceLog"]'),
        click: true,
    },
    {
        title: 'The real form',
        text: 'Below is the school Service Log, filled in from the sessions. When the repair is done, print it with this button.',
        setup: () => showServiceLogPreview(guideTicketId()),
        target: () => $g('#paperPreviewActions button'),
    },
    {
        title: 'The whole preview',
        text: "The form's name, a note on what fills in, the Print button, and the sheet itself. Scroll inside the outline to see the full sheet.",
        setup: () => showServiceLogPreview(guideTicketId()),
        target: () => $g('#paperPreviewModal .modal-content'),
        section: true,
    },
    {
        title: 'Finished and tested?',
        text: 'When the repair works, press Ready for Check-Off. An admin checks the device before it counts as complete.',
        setup: async () => { await ensureWorkspace(); await sandboxStatus('in_progress'); },
        target: () => $g('#ticketWorkspaceContainer .ws-next button'),
        click: true,
    },
    {
        title: 'Waiting for check-off',
        text: 'Now it waits for the admin. If they send it back, their note shows up right here, and you fix it and send it again.',
        setup: ensureWorkspace,
        target: () => $g('#ticketWorkspaceContainer .ws-next'),
    },
    {
        title: 'The whole ticket',
        text: "That's a ticket: the problem and team at the top, the next-step box, and logging your sessions. Work so far, Parts, Paperwork, and Ticket details fold away. Click a name to open it.",
        setup: ensureWorkspace,
        target: () => $g('#ticketWorkspaceModal'),
        section: true,
    },
    {
        chapter: "Your hours",
        title: 'Your hours',
        text: 'My Hours lists every session you logged, with your total. Use it to check your Hours sheets.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openMyHours"]'),
    },
    {
        chapter: "The Forum",
        title: 'Stuck? Check the Forum',
        text: 'Other students post how they fixed things: the steps, YouTube videos, and part links. Look here before you ask someone.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openForum"]'),
        click: true,
    },
    {
        title: 'Search and filter',
        text: 'Type a device or a problem, pick a device type, or tap filters like Screen or Battery.',
        setup: ensureForum,
        target: () => $g('#forumFilters'),
    },
    {
        title: 'Read a post',
        text: "Each card shows the device and its filters. Open Jordan's fix for a flickering laptop screen.",
        setup: ensureForum,
        target: () => $g('#forumList .folder-card[onclick="showForumPost(3)"]'),
        click: true,
    },
    {
        title: 'What a good post looks like',
        text: 'The device, the steps that fixed it, and a video to watch. Short, clear, and easy to follow.',
        setup: () => ensureForumPost(3),
        target: () => $g('#forumModal .modal-content'),
        section: true,
    },
    {
        title: 'Share a fix',
        text: 'Fixed something tricky? Post it so the next student can learn from you.',
        setup: ensureForum,
        target: () => $g('#forumNewBtn'),
        click: true,
    },
    {
        title: 'Title, device, and filters',
        text: 'Give it a clear title, the exact device, its type, and at least one filter so others can find it. We filled in an example.',
        setup: fillForumSample,
        target: () => forumFormCard('#forumTitle'),
    },
    {
        title: 'How you fixed it',
        text: 'Number your steps. Add links to videos or the part you used, one per line.',
        setup: fillForumSample,
        target: () => forumFormCard('#forumBody'),
    },
    {
        title: 'Add your ticket notes (optional)',
        text: 'Pick a repair you finished and its session notes come over. Only the notes, never the customer. You can edit them before posting.',
        setup: fillForumSampleNotes,
        target: () => forumFormCard('#forumNotes'),
    },
    {
        title: 'The whole post form',
        text: "That's everything in a post. Keep it clean: posts with swear words are blocked.",
        setup: fillForumSampleNotes,
        target: () => $g('#forumModal .modal-content'),
        section: true,
    },
    {
        title: 'Post it',
        text: 'Click Post.',
        setup: fillForumSampleNotes,
        target: () => $g('#forumDetail [onclick^="saveForumPost"]'),
        click: true,
    },
    {
        title: 'Your post is live',
        text: 'It is in the list for everyone now. You can edit or delete your own posts any time.',
        setup: async () => {
            const mine = forumPosts.find(p => p.tech_id === currentTechId);
            if (mine) await ensureForumPost(mine.id);
        },
        target: () => $g('#forumModal .modal-content'),
        section: true,
    },
    {
        chapter: "Wrapping up",
        title: 'Tech Tools',
        text: 'This page is Tech Tools. New Ticket, the Forum, and this guide are at the top; your tickets, drop-offs, and hours are in the tabs below. Log Out is in the top bar.',
        setup: closeAllModals,
        target: () => $g('#techToolbar'),
        section: true,
    },
    {
        title: "That's the whole path",
        text: 'Drop-off, ticket, work sessions, check-off. Exit the guide to go back to the real site.',
        setup: closeAllModals,
    }
];

const CHECK_ID = 57, NEW_ID = 60;
const nextStepBox = () => $g('#ticketWorkspaceContainer .ws-next');

const ADMIN_STEPS = [
    {
        chapter: "Welcome",
        title: 'Welcome to the Admin Guide',
        text: "This walks through your side of the workflow: checking off repairs, picking students for new tickets, and keeping track of your students. Everything here is practice data. Nothing is saved or sent.",
        setup: closeAllModals,
    },
    {
        chapter: "Check off a repair",
        title: 'Start in the Ticket Pool',
        text: 'Every ticket lands here. The number on the tab is how many repairs are waiting for your check-off.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick*="ticketPoolModal"]'),
        click: true,
    },
    {
        title: 'Repairs waiting for you',
        text: 'Repairs the students say are finished sit at the top. Open one.',
        setup: async () => { await sandboxStatus('review', CHECK_ID, { review_note: null }); ensurePool(); },
        target: () => $g(`#appointmentsContainer .folder-card[onclick="openTicketWorkspace(${CHECK_ID})"]`),
        click: true,
    },
    {
        title: 'Check the device',
        text: 'Test the device yourself. Then approve it, or send it back with what still needs doing.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: nextStepBox,
    },
    {
        title: 'Read what they did',
        text: "Every session from the students on this ticket, with their notes. Read it before you decide.",
        setup: () => ensureWorkspace(CHECK_ID),
        target: () => wsCard('Work so far'),
    },
    {
        title: 'Not right yet? Send it back',
        text: "Click Send Back. You'll type what still needs doing. In practice mode we fill in an example for you.",
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: () => $g('#ticketWorkspaceContainer .ws-next [onclick^="sendBack"]'),
        click: true,
    },
    {
        title: 'The students see your note',
        text: 'Your note now sits at the top of their ticket. When they fix it, they send it back to you for another check.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('in_progress', CHECK_ID, { review_note: SAMPLE_SEND_BACK_NOTE }); },
        target: nextStepBox,
    },
    {
        title: 'Approve the repair',
        text: 'The students fixed it and sent it again. It works, so press Approve & Complete.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: () => $g('#ticketWorkspaceContainer .ws-next [onclick^="markCompleted"]'),
        click: true,
    },
    {
        title: 'Paperwork',
        text: 'Open the Help Desk Ticket, Service Log, and Hours sheets from here. Each one shows a preview of the real form before you print it.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('completed', CHECK_ID, { review_note: null }); },
        target: () => wsCard('Paperwork'),
    },
    {
        title: 'The whole ticket, from your side',
        text: "The check-off box sits at the top. Below it, click a name to open that section: the students on it, their work, parts, paperwork, ticket details with the customer's contact, and delete.",
        setup: () => ensureWorkspace(CHECK_ID),
        target: () => $g('#ticketWorkspaceModal'),
        section: true,
    },
    {
        title: 'The whole Ticket Pool',
        text: 'Search and filters at the top, then every ticket grouped by status. Check-offs come first, then tickets that need students.',
        setup: async () => { await sandboxStatus('pending', NEW_ID, { assigned_tech_ids: [] }); ensurePool(); },
        target: () => $g('#ticketPoolModal'),
        section: true,
    },
    {
        chapter: "New tickets",
        title: 'New tickets need students',
        text: 'Tickets with nobody on them wait under In the Pool. Open the new one.',
        setup: async () => { await sandboxStatus('pending', NEW_ID, { assigned_tech_ids: [] }); ensurePool(); },
        target: () => $g(`#appointmentsContainer .folder-card[onclick="openTicketWorkspace(${NEW_ID})"]`),
        click: true,
    },
    {
        title: 'Pick the students',
        text: 'Tick everyone who will work on it. If you hand it to new students later, change it here. Their time starts a new Hours sheet.',
        setup: async () => {
            await ensureWorkspace(NEW_ID);
            const box = $g(`.assign-tech-${NEW_ID}[value="3"]`);
            if (box && !$g(`.assign-tech-${NEW_ID}:checked`)) box.checked = true;
        },
        target: () => wsCard('Students on this ticket'),
    },
    {
        title: 'Save it',
        text: 'Click Save Students.',
        target: () => wsCard('Students on this ticket')?.querySelector(`#saveStudents-${NEW_ID}`),
        click: true,
    },
    {
        title: 'Deleting a ticket',
        text: 'Delete takes a ticket out of the pool. It is not gone: bring it back any time from the Deleted filter.',
        setup: () => ensureWorkspace(NEW_ID),
        target: () => wsCard('Delete ticket'),
    },
    {
        title: 'A new ticket, from your side',
        text: 'Details, the next step, the students on it, and delete. Once students are on it, they take it from here.',
        setup: () => ensureWorkspace(NEW_ID),
        target: () => $g('#ticketWorkspaceModal'),
        section: true,
    },
    {
        chapter: "Today's line",
        title: "Today's line",
        text: "Customers can join today's line from their phone. It's same-day only, so nobody books days ahead and forgets. Each customer gets a line number; techs find them by that number, or by full name if it's lost. Techs check them in first, and those tickets get a Priority badge. Take someone out if the lab is closed.",
        setup: () => { closeAllModals(); showView('dropOffsView'); },
        target: () => $g('#dropOffsView'),
        section: true,
    },
    {
        chapter: "Your students",
        title: 'Your students',
        text: 'Manage Students shows every student at a glance.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openManageStudents"]'),
        click: true,
    },
    {
        title: 'Hours and tickets for each student',
        text: 'Each card shows the student\'s class (AM or PM), hours logged, active tickets, and any waiting for your check-off. Open, Rename, Move to the other class, or Remove a student here.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); openStudentId = null; await openManageStudents(); } else { showStudent(null); } },
        target: () => $g('#manageStudentsContainer .folder-card'),
    },
    {
        title: "Open a student",
        text: "Click Open to see one student's work.",
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); await openManageStudents(); } showStudent(null); },
        target: () => $g('#manageStudentsContainer [onclick="showStudent(2)"]'),
        click: true,
    },
    {
        title: 'Everything they worked on',
        text: 'Their tickets, including ones handed off to others, and every session they logged with its notes.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); await openManageStudents(); } showStudent(2); },
        target: () => $g('#manageStudentsContainer .folder-list'),
    },
    {
        title: "A student's whole page",
        text: 'Their hours, their tickets, and every session they logged. Use ← All students to go back to the list.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); await openManageStudents(); } showStudent(2); },
        target: () => $g('#manageStudentsModal'),
        section: true,
    },
    {
        chapter: "The Forum",
        title: 'The Forum',
        text: 'Students share fixes, videos, and part links here. Open it to read along.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openForum"]'),
        click: true,
    },
    {
        title: 'Read a post',
        text: "Open Priya's post about a phone battery.",
        setup: ensureForum,
        target: () => $g('#forumList .folder-card[onclick="showForumPost(4)"]'),
        click: true,
    },
    {
        title: 'Remove a post if needed',
        text: 'You can delete any post: customer info, off-topic posts, or advice that could damage a device. Swear words are already blocked.',
        setup: () => ensureForumPost(4),
        target: () => $g('#forumDetail [onclick^="deleteForumPost"]'),
    },
    {
        title: 'The whole Forum',
        text: 'Search, device types, filters, and every post, newest first.',
        setup: ensureForum,
        target: () => $g('#forumModal .modal-content'),
        section: true,
    },
    {
        chapter: "Wrapping up",
        title: "The students' guide",
        text: 'Techs have their own Workflow Guide under Tech Tools. Pick Present to the class to teach it on the projector.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openWorkflowGuide"]'),
    },
    {
        title: 'The Admin Panel',
        text: 'This page is the Admin Panel. The Forum, Update Stats, and this guide are at the top; the Ticket Pool, Drop-offs, and Manage Students are tabs. Log Out is in the top bar.',
        setup: closeAllModals,
        target: () => $g('#adminPanel'),
        section: true,
    },
    {
        title: "That's the admin side",
        text: 'Check off repairs, pick students, and keep an eye on your roster. Exit the guide to go back to the real site.',
        setup: closeAllModals,
    }
];

let guide = null;
let guideTarget = null;

// Table of contents: a chapter runs from its first step to the step
// before the next chapter, e.g. "Make a ticket · Steps 2–10".
const roleSteps = () => currentRole === 'admin' ? ADMIN_STEPS : TECH_STEPS;
const guideChapters = steps => steps.flatMap((s, i) => s.chapter ? [{ title: s.chapter, from: i }] : [])
    .map((c, k, all) => ({ ...c, to: (all[k + 1]?.from ?? steps.length) - 1 }));
const stepRange = c => c.from === c.to ? `Step ${c.from + 1}` : `Steps ${c.from + 1}–${c.to + 1}`;
const tocHtml = (steps, go, current = -1) => guideChapters(steps).map(c => `
    <button type="button" class="guide-toc-item${current >= c.from && current <= c.to ? ' current' : ''}" onclick="${go}(${c.from})">
        <strong>${c.title}</strong><span>${stepRange(c)}</span>
    </button>`).join('');

function openWorkflowGuide() {
    document.getElementById('guideContents').innerHTML = tocHtml(roleSteps(), 'startGuide');
    openModal('guideChooserModal');
}

async function startGuide(startAt = 0) {
    const role = currentRole === 'admin' ? 'admin' : 'tech';
    closeModal('guideChooserModal');
    // Wait for the first tab to show the practice tickets, or it can switch
    // back over a step that starts on another tab (like today's line).
    await enterSandbox(role);
    guide = { i: startAt, steps: roleSteps() };
    document.getElementById('guideLayer').hidden = false;
    document.getElementById('sandboxBanner').hidden = false;
    document.addEventListener('keydown', guideKeys);
    window.addEventListener('resize', placeGuide);
    document.addEventListener('scroll', placeGuide, true);
    // The dimmed layer takes the mouse, so pass the wheel to the outlined popup.
    document.getElementById('guideBlock').addEventListener('wheel', e => {
        (guideTarget?.closest('.modal-content') || document.scrollingElement).scrollBy(0, e.deltaY);
    }, { passive: true });
    showGuideStep();
}

function exitGuide() {
    // A reload throws away the sandbox and brings back the real database.
    location.reload();
}

function guideKeys(e) {
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); guideNext(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); guideBack(); }
    if (e.key === 'Escape') exitGuide();
}

async function showGuideStep() {
    const step = guide.steps[guide.i];
    const last = guide.i === guide.steps.length - 1;
    const chapter = guideChapters(guide.steps).findLast(c => c.from <= guide.i);
    await step.setup?.();

    // Modals and results can take a moment to appear.
    guideTarget = null;
    for (let t = 0; step.target && t < 20 && !(guideTarget = step.target()); t++) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (step.click && guideTarget) guideTarget.addEventListener('click', onGuideTargetClick, { once: true });

    const box = document.getElementById('guideBox');
    box.innerHTML = `
        <p class="guide-count">Step ${guide.i + 1} of ${guide.steps.length} · ${chapter?.title || ''}</p>
        <h3>${step.title}</h3>
        <p>${step.text}</p>
        ${step.click ? '<p class="guide-hint">Click the highlighted button, or press Next.</p>' : ''}
        <div class="guide-nav">
            <span>
                <button type="button" class="btn btn-primary guide-exit" onclick="exitGuide()">Exit</button>
                <button type="button" class="btn btn-primary guide-back" onclick="guideShowContents()">Contents</button>
            </span>
            <span>
                ${guide.i > 0 ? '<button type="button" class="btn btn-primary guide-back" onclick="guideBack()">Back</button>' : ''}
                <button type="button" class="btn btn-primary" onclick="${last ? 'exitGuide()' : 'guideNext()'}">${last ? 'Finish' : 'Next'}</button>
            </span>
        </div>`;

    // Section steps outline a whole area: its popup moves to the top and
    // shrinks so everything fits inside the outline, with the box below.
    const room = innerHeight - document.getElementById('sandboxBanner').offsetHeight;
    document.body.classList.toggle('guide-section', !!step.section);
    document.documentElement.style.setProperty('--guide-room', `${room - box.offsetHeight - 80}px`);

    // Center the target, unless it's tall: then put it at the top so the box fits below.
    // Staff page sections scroll with the page, so those get scrolled to as well.
    if (guideTarget && (!step.section || !guideTarget.closest('.modal'))) {
        const room = innerHeight - document.getElementById('sandboxBanner').offsetHeight;
        const tall = (room - guideTarget.offsetHeight) / 2 < box.offsetHeight + 44; // box won't fit above or below
        guideTarget.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'instant' });
    }
    placeGuide();
    setTimeout(placeGuide, 300); // after the modal's open animation
}

function onGuideTargetClick() {
    // Let the button's own action run, then move on.
    setTimeout(() => { guide.i++; showGuideStep(); }, 250);
}

function guideNext() {
    const step = guide.steps[guide.i];
    if (guide.i === guide.steps.length - 1) return exitGuide();
    if (step.click && guideTarget) return guideTarget.click(); // does the step, then advances
    guide.i++;
    showGuideStep();
}

// Contents inside the guide: jump to any chapter, or go back to the step you were on.
function guideShowContents() {
    guideTarget?.removeEventListener('click', onGuideTargetClick);
    document.getElementById('guideBox').innerHTML = `
        <p class="guide-count">Contents</p>
        <h3>Jump to a part</h3>
        <div class="guide-toc">${tocHtml(guide.steps, 'guideGo', guide.i)}</div>
        <div class="guide-nav"><span></span>
            <button type="button" class="btn btn-primary" onclick="guideGo(${guide.i})">Back to step ${guide.i + 1}</button>
        </div>`;
    placeGuide();
}

function guideGo(i) {
    guide.i = i;
    showGuideStep();
}

function guideBack() {
    if (guide.i === 0) return;
    guideTarget?.removeEventListener('click', onGuideTargetClick);
    guide.i--;
    showGuideStep();
}

function placeGuide() {
    if (!guide) return;
    const spot = document.getElementById('guideSpot');
    const block = document.getElementById('guideBlock');
    const box = document.getElementById('guideBox');
    const line = document.querySelector('#guideLine line');
    const gap = 28, margin = 16;
    const W = innerWidth, H = innerHeight - document.getElementById('sandboxBanner').offsetHeight; // keep clear of the banner
    const bw = box.offsetWidth, bh = box.offsetHeight;

    if (!guideTarget) {
        spot.className = 'none';
        block.style.clipPath = 'none';
        line.style.display = 'none';
        box.style.left = `${(W - bw) / 2}px`;
        box.style.top = `${Math.max(margin, (H - bh) / 2)}px`;
        return;
    }

    const r = guideTarget.getBoundingClientRect();
    const pad = 8;
    const s = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    spot.className = '';
    Object.assign(spot.style, { left: `${s.l}px`, top: `${s.t}px`, width: `${s.r - s.l}px`, height: `${s.b - s.t}px` });

    // Clicks pass through the hole only when the step is done by clicking.
    block.style.clipPath = guide.steps[guide.i].click
        ? `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ${s.l}px ${s.t}px, ${s.r}px ${s.t}px, ${s.r}px ${s.b}px, ${s.l}px ${s.b}px, ${s.l}px ${s.t}px)`
        : 'none';

    // Put the callout below, above, right or left of the spotlight, wherever it fits.
    const clampX = x => Math.min(Math.max(margin, x), W - bw - margin);
    const clampY = y => Math.min(Math.max(margin, y), H - bh - margin);
    const cx = (s.l + s.r) / 2, cy = (s.t + s.b) / 2;
    let x, y, from, to;
    if (H - s.b >= bh + gap + margin) {
        x = clampX(cx - bw / 2); y = s.b + gap;
        from = [cx, s.b]; to = [Math.min(Math.max(cx, x + 24), x + bw - 24), y];
    } else if (s.t >= bh + gap + margin) {
        x = clampX(cx - bw / 2); y = s.t - gap - bh;
        from = [cx, s.t]; to = [Math.min(Math.max(cx, x + 24), x + bw - 24), y + bh];
    } else if (W - s.r >= bw + gap + margin) {
        x = s.r + gap; y = clampY(cy - bh / 2);
        from = [s.r, cy]; to = [x, Math.min(Math.max(cy, y + 24), y + bh - 24)];
    } else if (s.l >= bw + gap + margin) {
        x = s.l - gap - bw; y = clampY(cy - bh / 2);
        from = [s.l, cy]; to = [x + bw, Math.min(Math.max(cy, y + 24), y + bh - 24)];
    } else { // no room: pin to the bottom of the screen
        x = clampX(cx - bw / 2); y = H - bh - margin;
        from = [cx, s.b]; to = [Math.min(Math.max(cx, x + 24), x + bw - 24), y];
    }
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    line.style.display = '';
    line.setAttribute('x1', from[0]); line.setAttribute('y1', from[1]);
    line.setAttribute('x2', to[0]); line.setAttribute('y2', to[1]);
}
