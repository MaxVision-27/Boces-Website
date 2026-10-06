// ============================================================
// WORKFLOW GUIDE (Tech and Admin) — a game-style tour of the real
// screens, with one step list per role.
// Each step spotlights one element (everything else dims) with a
// callout joined to it by a line. Two modes: "self" (click the
// highlighted button or press Next) and "present" (full screen, big
// text, arrow keys, talking points and a discussion question).
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

const SAMPLE_SEND_BACK_NOTE = 'The screen still flickers when the lid is half open. Check the display cable.';

function enterSandbox(role) {
    const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
    const ticket = (id, name, device, issue, status, team, days, make_model) => ({
        id, name, email: '', device, issue, status, tracking_code: `PRAC${id}`, created_at: daysAgo(days),
        assigned_tech_ids: team, creation_tech_ids: team, created_by: 'Sample', parts_used: '', review_note: null,
        make_model, serial_tag: `SN${id}X7`, contact_number: '(516) 555-0100', class_name: 'Culinary Arts', room_number: 'B112', computer_password: null
    });
    const log = (id, ticket_id, tech_id, days, start, end, note, team) => ({
        id, ticket_id, tech_id, work_date: daysAgo(days).slice(0, 10), start_time: start, end_time: end, note,
        team_tech_ids: team, created_at: daysAgo(days)
    });
    let tickets, logs;
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
    }

    appointments = tickets.map(t => ({ ...t }));
    myTimeLogs = [];
    db = fakeDb({ repair_requests: tickets, time_logs: logs, techs: techs.map(t => ({ ...t })), stats: [], forum_posts: posts });
    // Native dialogs would stall the tour; the page reload on exit brings them back.
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => SAMPLE_SEND_BACK_NOTE;
    populateAppointmentsModal();
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
// talk / ask: shown in presentation mode only.
const TECH_STEPS = [
    {
        title: 'Welcome to the Workflow Guide',
        text: "We'll walk through one repair, from drop-off to check-off, on the real screens. The tickets are practice ones, so go ahead and click what we highlight. Nothing is saved, emailed, or added to your hours.",
        setup: closeAllModals,
        talk: ['Every repair follows the same path.', 'Each step shows a button you will use in class.'],
        ask: 'What do you think happens to a device between drop-off and pickup?'
    },
    {
        title: 'A customer walks in',
        text: 'Someone just dropped off a laptop with a cracked screen. Every repair starts with New Ticket.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openTechTicketModal"]'),
        click: true,
        talk: ['There is no online form. A student at the desk creates every ticket.'],
        ask: 'What should you ask the customer before you take their device?'
    },
    {
        title: 'Fill in the Help Desk Ticket',
        text: "The customer's name, a contact number, their class and room, and the computer's make, model, and serial tag (usually on a sticker underneath). Only take the password if you need it to test. It stays hidden while the customer watches. We filled in an example.",
        setup: fillNewTicket,
        target: () => $g('#techTicketModal .form-row'),
        talk: ['These are the same boxes as the paper Help Desk Ticket.', 'The password is deleted automatically when the repair is done.'],
        ask: 'Why do we need the serial tag?'
    },
    {
        title: 'Describe the problem',
        text: 'Write the problem in the customer\'s words.',
        setup: fillNewTicket,
        target: () => $g('#techApptIssue'),
        talk: ["Write what the customer tells you, not your guess about what's wrong."],
        ask: "Why write the problem in the customer's own words?"
    },
    {
        title: 'Who is working with you?',
        text: 'Tick anyone helping on this repair. Everyone ticked gets 30 minutes of Ticket Creation hours.',
        target: () => $g('#techPartnerPicker'),
        talk: ['The hours sheet lists everyone on the ticket.', 'If the ticket moves to other students later, an admin changes it.'],
        ask: "Why does it matter who's on the ticket?"
    },
    {
        title: 'The whole New Ticket form',
        text: "That's everything on a new ticket: the customer, their device, the problem, and who's working on it. Next, create it.",
        setup: fillNewTicket,
        target: () => $g('#techTicketModal .modal-content'),
        section: true,
        talk: ['Every ticket has the same four parts.'],
        ask: 'Which part of the form do you think gets skipped most?'
    },
    {
        title: 'Create the ticket',
        text: 'Click Create Ticket.',
        target: () => $g('#techTicketModal [onclick^="submitTechTicket"]'),
        click: true,
        talk: ['The ticket is assigned to you and anyone you ticked.'],
        ask: 'What could go wrong if you skipped the ticket and just started fixing?'
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
        talk: ['The code is the only way a customer checks on a repair. They never need an account.'],
        ask: 'What should happen if a customer loses their code?'
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
        talk: ['This paper is the customer agreeing to let us work on their device.'],
        ask: 'Why get a signature before starting a repair?'
    },
    {
        title: 'Have the customer sign it',
        text: 'Both pages print filled in. The customer signs and dates both before they leave the device. Print it with the button at the top.',
        setup: async () => { if (!isOpen('paperPreviewModal')) { closeAllModals(); await previewHelpDesk(guideTicketId()); } },
        target: () => $g('#paperPreviewModal .modal-content'),
        section: true,
        talk: ['Keep the signed copy with the device.'],
        ask: 'What should you do if a customer will not sign?'
    },
    {
        title: 'Your tickets',
        text: 'Everything assigned to you is under My Tickets.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="viewMyTickets"]'),
        click: true,
        talk: ['You only see tickets you are on.'],
        ask: 'Why show each student only their own tickets?'
    },
    {
        title: 'Your ticket list',
        text: 'Active tickets are at the top and completed ones below. Each card shows its status and how much time you have logged on it.',
        setup: async () => { if (!isOpen('myTicketsModal')) { closeAllModals(); await viewMyTickets(); } },
        target: () => $g('#myTicketsModal .modal-content'),
        section: true,
        talk: ['This list is your to-do list for the day.'],
        ask: 'How would you decide which ticket to work on first?'
    },
    {
        title: 'Each ticket is a folder',
        text: 'Open the ticket to do the work.',
        setup: async () => { if (!isOpen('myTicketsModal')) { closeAllModals(); await viewMyTickets(); } },
        target: () => $g(`#myTicketsContainer .folder-card[onclick="openTicketWorkspace(${guideTicketId()})"]`),
        click: true,
        talk: ['The card shows the status and how much time you have logged.'],
        ask: 'What would you check first when you open a ticket?'
    },
    {
        title: 'What to do next',
        text: 'The box at the top always tells you the next step. Press Start Repair when you begin working.',
        setup: async () => { await ensureWorkspace(); await sandboxStatus('assigned'); },
        target: () => $g('#ticketWorkspaceContainer .ws-next button'),
        click: true,
        talk: ['Start Repair tells the customer their device is being worked on.'],
        ask: 'Why tell the customer the repair has started?'
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
        talk: ['Say what you did and what still needs doing.', 'Your teammates read these notes.'],
        ask: 'What makes a note useful to the next student who picks up the device?'
    },
    {
        title: 'Save the session',
        text: 'Click Save Session.',
        target: () => wsCard('Log a work session')?.querySelector('[onclick^="logTime"]'),
        click: true,
        talk: ['Log it the same day, while you still remember the times.'],
        ask: 'What happens to your hours if you forget to log a session?'
    },
    {
        title: 'Work so far',
        text: "Every session from everyone on the ticket shows here, oldest first. You can delete only your own.",
        setup: ensureWorkspace,
        target: () => wsCard('Work so far'),
        talk: ['This is how a team hands off work between class days.'],
        ask: 'How would you catch up on a ticket someone else started?'
    },
    {
        title: 'Parts',
        text: 'If the customer bought a part for this repair, list it here. Leave it blank if it did not need one.',
        setup: ensureWorkspace,
        target: () => wsCard('Parts'),
        talk: ['We never charge for labor. Customers buy their own parts.'],
        ask: 'Why is it helpful to record which part went in?'
    },
    {
        title: 'Paperwork',
        text: 'Open a form to see exactly what will print. Click Service Log.',
        setup: ensureWorkspace,
        target: () => wsCard('Paperwork')?.querySelector('[onclick^="previewServiceLog"]'),
        click: true,
        talk: ['The Service Log and Hours sheets fill in from your sessions.'],
        ask: 'Why check a form before you print it?'
    },
    {
        title: 'The real form',
        text: 'Below is the school Service Log, filled in from the sessions. When the repair is done, print it with this button.',
        setup: () => showServiceLogPreview(guideTicketId()),
        target: () => $g('#paperPreviewActions button'),
        talk: ['Serial number, date completed and accessories are written by hand.'],
        ask: 'Who reads these forms after you hand them in?'
    },
    {
        title: 'The whole preview',
        text: "The form's name, a note on what fills in, the Print button, and the sheet itself. Scroll inside the outline to see the full sheet.",
        setup: () => showServiceLogPreview(guideTicketId()),
        target: () => $g('#paperPreviewModal .modal-content'),
        section: true,
        talk: ['The Help Desk Ticket and Hours sheets open the same way, each with a Print button.'],
        ask: 'What would you check on this sheet before printing it?'
    },
    {
        title: 'Finished and tested?',
        text: 'When the repair works, press Ready for Check-Off. An admin checks the device before it counts as complete.',
        setup: async () => { await ensureWorkspace(); await sandboxStatus('in_progress'); },
        target: () => $g('#ticketWorkspaceContainer .ws-next button'),
        click: true,
        talk: ['Students never mark their own repair complete.'],
        ask: 'Why have an admin check every repair?'
    },
    {
        title: 'Waiting for check-off',
        text: 'Now it waits for the admin. If they send it back, their note shows up right here, and you fix it and send it again.',
        setup: ensureWorkspace,
        target: () => $g('#ticketWorkspaceContainer .ws-next'),
        talk: ['A sent-back ticket is normal. Read the note and try again.'],
        ask: 'What would you do if the admin sent your repair back?'
    },
    {
        title: 'The whole ticket',
        text: "That's a ticket: the problem and team at the top, the next-step box, and logging your sessions. Work so far, Parts, Paperwork, and Ticket details fold away. Click a name to open it.",
        setup: ensureWorkspace,
        target: () => $g('#ticketWorkspaceModal .modal-content'),
        section: true,
        talk: ['Top to bottom, the page follows the order you work in.'],
        ask: 'Which part of this page will you use every class?'
    },
    {
        title: 'Your hours',
        text: 'My Hours lists every session you logged, with your total. Use it to check your Hours sheets.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openMyHours"]'),
        talk: ['Your Work-Based Learning hours come from these sessions.'],
        ask: 'How could logging hours help you later, for a job or a reference?'
    },
    {
        title: 'Stuck? Check the Forum',
        text: 'Other students post how they fixed things: the steps, YouTube videos, and part links. Look here before you ask someone.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openForum"]'),
        click: true,
        talk: ['Someone may have fixed the same device last month.'],
        ask: 'Why search the forum before asking a classmate?'
    },
    {
        title: 'Search and filter',
        text: 'Type a device or a problem, pick a device type, or tap filters like Screen or Battery.',
        setup: ensureForum,
        target: () => $g('#forumFilters'),
        talk: ['Filters only work because every post has to pick at least one.'],
        ask: 'What would you type to find help with a laptop that will not charge?'
    },
    {
        title: 'Read a post',
        text: "Each card shows the device and its filters. Open Jordan's fix for a flickering laptop screen.",
        setup: ensureForum,
        target: () => $g('#forumList .folder-card[onclick="showForumPost(3)"]'),
        click: true,
        talk: ['Read a couple of posts before your first repair on a new device.'],
        ask: 'What would make you trust a post?'
    },
    {
        title: 'What a good post looks like',
        text: 'The device, the steps that fixed it, and a video to watch. Short, clear, and easy to follow.',
        setup: () => ensureForumPost(3),
        target: () => $g('#forumModal .modal-content'),
        section: true,
        talk: ['Good posts say what the problem really was, not just what they tried.'],
        ask: 'What would you add to make this post even more helpful?'
    },
    {
        title: 'Share a fix',
        text: 'Fixed something tricky? Post it so the next student can learn from you.',
        setup: ensureForum,
        target: () => $g('#forumNewBtn'),
        click: true,
        talk: ['Teaching someone else is the best way to remember a fix.'],
        ask: 'What kind of fix is worth posting?'
    },
    {
        title: 'Title, device, and filters',
        text: 'Give it a clear title, the exact device, its type, and at least one filter so others can find it. We filled in an example.',
        setup: fillForumSample,
        target: () => forumFormCard('#forumTitle'),
        talk: ['The exact model matters. "HP 250 G8" is much more useful than "HP laptop".'],
        ask: 'Which filters would you pick for a laptop that overheats and shuts off?'
    },
    {
        title: 'How you fixed it',
        text: 'Number your steps. Add links to videos or the part you used, one per line.',
        setup: fillForumSample,
        target: () => forumFormCard('#forumBody'),
        talk: ['Write it for someone who has never opened this device.'],
        ask: 'Why number the steps?'
    },
    {
        title: 'Add your ticket notes (optional)',
        text: 'Pick a repair you finished and its session notes come over. Only the notes, never the customer. You can edit them before posting.',
        setup: fillForumSampleNotes,
        target: () => forumFormCard('#forumNotes'),
        talk: ['Your notes already tell the story of the repair.'],
        ask: 'What should you remove from notes before sharing them?'
    },
    {
        title: 'The whole post form',
        text: "That's everything in a post. Keep it clean: posts with swear words are blocked.",
        setup: fillForumSampleNotes,
        target: () => $g('#forumModal .modal-content'),
        section: true,
        talk: ['Leave out customer names, emails, and passwords.'],
        ask: 'What makes a post easy to follow?'
    },
    {
        title: 'Post it',
        text: 'Click Post.',
        setup: fillForumSampleNotes,
        target: () => $g('#forumDetail [onclick^="saveForumPost"]'),
        click: true,
        talk: ['Everyone on the team can find it right away.'],
        ask: 'When is the best time to write a post: right after the repair, or later?'
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
        talk: ['Your ticket notes show at the bottom under Notes from the repair.'],
        ask: 'What fix have you done that others should know about?'
    },
    {
        title: 'Tech Tools',
        text: 'Everything you need lives here: New Ticket, My Tickets, My Hours, the Forum, and this guide.',
        setup: closeAllModals,
        target: () => $g('#techToolbar'),
        section: true,
        talk: ['If you get lost, come back to Tech Tools.'],
        ask: 'Which button will you use most?'
    },
    {
        title: "That's the whole path",
        text: 'Drop-off, ticket, work sessions, check-off. Exit the guide to go back to the real site.',
        setup: closeAllModals,
        talk: ['Questions before we start on real devices?'],
        ask: 'Which step do you think is easiest to forget?'
    }
];

const CHECK_ID = 57, NEW_ID = 60;
const nextStepBox = () => $g('#ticketWorkspaceContainer .ws-next');

const ADMIN_STEPS = [
    {
        title: 'Welcome to the Admin Guide',
        text: "This walks through your side of the workflow: checking off repairs, picking students for new tickets, and keeping track of your students. Everything here is practice data. Nothing is saved or sent.",
        setup: closeAllModals,
        talk: ['Students do the repairs. You make sure each one is right before it goes home.'],
        ask: 'Why should someone other than the student sign off on a repair?'
    },
    {
        title: 'Start in the Ticket Pool',
        text: 'Every ticket lands here. The number on the button is how many repairs are waiting for your check-off.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick*="ticketPoolModal"]'),
        click: true,
        talk: ['Check the count at the start and end of every class.'],
        ask: 'How often should repairs be checked off?'
    },
    {
        title: 'Repairs waiting for you',
        text: 'Repairs the students say are finished sit at the top. Open one.',
        setup: async () => { await sandboxStatus('review', CHECK_ID, { review_note: null }); ensurePool(); },
        target: () => $g(`#appointmentsContainer .folder-card[onclick="openTicketWorkspace(${CHECK_ID})"]`),
        click: true,
        talk: ['Tickets are grouped by status, with check-offs at the top.'],
        ask: 'What would you look for before opening a ticket?'
    },
    {
        title: 'Check the device',
        text: 'Test the device yourself. Then approve it, or send it back with what still needs doing.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: nextStepBox,
        talk: ['Only you can mark a repair complete. The database enforces it.'],
        ask: 'What should you test before approving a screen replacement?'
    },
    {
        title: 'Read what they did',
        text: "Every session from the students on this ticket, with their notes. Read it before you decide.",
        setup: () => ensureWorkspace(CHECK_ID),
        target: () => wsCard('Work so far'),
        talk: ['Good notes make check-off fast.'],
        ask: 'What makes a student note easy to check?'
    },
    {
        title: 'Not right yet? Send it back',
        text: "Click Send Back. You'll type what still needs doing. In practice mode we fill in an example for you.",
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: () => $g('#ticketWorkspaceContainer .ws-next [onclick^="sendBack"]'),
        click: true,
        talk: ['Be specific so the students know exactly what to fix.'],
        ask: 'What makes a send-back note helpful instead of frustrating?'
    },
    {
        title: 'The students see your note',
        text: 'Your note now sits at the top of their ticket. When they fix it, they send it back to you for another check.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('in_progress', CHECK_ID, { review_note: SAMPLE_SEND_BACK_NOTE }); },
        target: nextStepBox,
        talk: ['A sent-back ticket is normal. It is how students learn to test their own work.'],
        ask: 'How should students respond when a repair is sent back?'
    },
    {
        title: 'Approve the repair',
        text: 'The students fixed it and sent it again. It works, so press Approve & Complete.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('review', CHECK_ID, { review_note: null }); },
        target: () => $g('#ticketWorkspaceContainer .ws-next [onclick^="markCompleted"]'),
        click: true,
        talk: ['Completed repairs count toward the total on the home page.'],
        ask: 'What should happen next with the customer?'
    },
    {
        title: 'Paperwork',
        text: 'Open the Help Desk Ticket, Service Log, and Hours sheets from here. Each one shows a preview of the real form before you print it.',
        setup: async () => { await ensureWorkspace(CHECK_ID); await sandboxStatus('completed', CHECK_ID, { review_note: null }); },
        target: () => wsCard('Paperwork'),
        talk: ['Hours sheets split by team, so a handoff starts a new sheet.'],
        ask: 'When should paperwork be printed and handed in?'
    },
    {
        title: 'The whole ticket, from your side',
        text: "The check-off box sits at the top. Below it, click a name to open that section: the students on it, their work, parts, paperwork, ticket details with the customer's contact, and delete.",
        setup: () => ensureWorkspace(CHECK_ID),
        target: () => $g('#ticketWorkspaceModal .modal-content'),
        section: true,
        talk: ['You see what the students see, plus your controls.'],
        ask: 'What would you check on a ticket before approving it?'
    },
    {
        title: 'The whole Ticket Pool',
        text: 'Search and filters at the top, then every ticket grouped by status. Check-offs come first, then tickets that need students.',
        setup: async () => { await sandboxStatus('pending', NEW_ID, { assigned_tech_ids: [] }); ensurePool(); },
        target: () => $g('#ticketPoolModal .modal-content'),
        section: true,
        talk: ['Filter by status to focus on one group, or search a customer by name or email.'],
        ask: 'Which group should be empty by the end of each class?'
    },
    {
        title: 'New tickets need students',
        text: 'Tickets with nobody on them wait under In the Pool. Open the new one.',
        setup: async () => { await sandboxStatus('pending', NEW_ID, { assigned_tech_ids: [] }); ensurePool(); },
        target: () => $g(`#appointmentsContainer .folder-card[onclick="openTicketWorkspace(${NEW_ID})"]`),
        click: true,
        talk: ['Students usually pick their own team when they create a ticket. This is for the ones that come in without one.'],
        ask: 'How would you decide which students take a repair?'
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
        talk: ['We ticked Priya as an example.'],
        ask: 'When would you move a ticket to different students?'
    },
    {
        title: 'Save it',
        text: 'Click Save Students.',
        target: () => wsCard('Students on this ticket')?.querySelector(`#saveStudents-${NEW_ID}`),
        click: true,
        talk: ['The ticket moves from In the Pool to Assigned.'],
        ask: 'What should the students do first once they are assigned?'
    },
    {
        title: 'Deleting a ticket',
        text: 'Delete takes a ticket out of the pool. It is not gone: bring it back any time from the Deleted filter.',
        setup: () => ensureWorkspace(NEW_ID),
        target: () => wsCard('Delete ticket'),
        talk: ['Use it for duplicates or tickets made by mistake.'],
        ask: 'Why keep deleted tickets instead of erasing them?'
    },
    {
        title: 'A new ticket, from your side',
        text: 'Details, the next step, the students on it, and delete. Once students are on it, they take it from here.',
        setup: () => ensureWorkspace(NEW_ID),
        target: () => $g('#ticketWorkspaceModal .modal-content'),
        section: true,
        talk: ['New tickets have no sessions yet, so Work so far is empty.'],
        ask: 'What should happen if nobody picks up a new ticket?'
    },
    {
        title: 'Your students',
        text: 'Manage Students shows every student at a glance.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openManageStudents"]'),
        click: true,
        talk: ['Add new students here at the start of the year.'],
        ask: 'What would you want to know about each student every week?'
    },
    {
        title: 'Hours and tickets for each student',
        text: 'Each card shows the student\'s class (AM or PM), hours logged, active tickets, and any waiting for your check-off. Open, Rename, Move to the other class, or Remove a student here.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); openStudentId = null; await openManageStudents(); } else { showStudent(null); } },
        target: () => $g('#manageStudentsContainer .folder-card'),
        talk: ['Rename keeps their tickets and hours. Remove takes them off every ticket.'],
        ask: 'Who might need a nudge based on these numbers?'
    },
    {
        title: "Open a student",
        text: "Click Open to see one student's work.",
        target: () => $g('#manageStudentsContainer [onclick="showStudent(2)"]'),
        click: true,
        talk: ['Great for parent conferences and grading.'],
        ask: 'How could this page help with grading?'
    },
    {
        title: 'Everything they worked on',
        text: 'Their tickets, including ones handed off to others, and every session they logged with its notes.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); await openManageStudents(); } showStudent(2); },
        target: () => $g('#manageStudentsContainer .folder-list'),
        talk: ['Open any ticket from here. The back arrow returns to this student.'],
        ask: 'What would a strong student page look like by the end of the year?'
    },
    {
        title: "A student's whole page",
        text: 'Their hours, their tickets, and every session they logged. Use ← All students to go back to the list.',
        setup: async () => { if (!isOpen('manageStudentsModal')) { closeAllModals(); await openManageStudents(); } showStudent(2); },
        target: () => $g('#manageStudentsModal .modal-content'),
        section: true,
        talk: ['Handed-off tickets stay on their page, so their work is never lost.'],
        ask: "What would you look for on a student's page before grading?"
    },
    {
        title: 'The Forum',
        text: 'Students share fixes, videos, and part links here. Open it to read along.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openForum"]'),
        click: true,
        talk: ['Reading the forum shows you what students are learning.'],
        ask: 'What should students never post in the forum?'
    },
    {
        title: 'Read a post',
        text: "Open Priya's post about a phone battery.",
        setup: ensureForum,
        target: () => $g('#forumList .folder-card[onclick="showForumPost(4)"]'),
        click: true,
        talk: ['Check that the advice is right and safe.'],
        ask: 'How would you spot wrong advice?'
    },
    {
        title: 'Remove a post if needed',
        text: 'You can delete any post: customer info, off-topic posts, or advice that could damage a device. Swear words are already blocked.',
        setup: () => ensureForumPost(4),
        target: () => $g('#forumDetail [onclick^="deleteForumPost"]'),
        talk: ['Students can only edit or delete their own posts.'],
        ask: 'When would you delete a post instead of asking the student to fix it?'
    },
    {
        title: 'The whole Forum',
        text: 'Search, device types, filters, and every post, newest first.',
        setup: ensureForum,
        target: () => $g('#forumModal .modal-content'),
        section: true,
        talk: ['Point students here before they ask you a question.'],
        ask: 'How could you use the forum in class?'
    },
    {
        title: "The students' guide",
        text: 'Techs have their own Workflow Guide under Tech Tools. Pick Present to the class to teach it on the projector.',
        setup: closeAllModals,
        target: () => $g('#adminPanel [onclick^="openWorkflowGuide"]'),
        talk: ['It uses practice tickets too, so students can click anything.'],
        ask: 'When in the year should students go through the guide?'
    },
    {
        title: 'The Admin Panel',
        text: 'Everything you need lives here: Manage Students, Update Stats, Ticket Pool, the Forum, this guide, and Logout.',
        setup: closeAllModals,
        target: () => $g('#adminPanel'),
        section: true,
        talk: ['If you get lost, come back to the Admin Panel.'],
        ask: 'Which button will you use most?'
    },
    {
        title: "That's the admin side",
        text: 'Check off repairs, pick students, and keep an eye on your roster. Exit the guide to go back to the real site.',
        setup: closeAllModals,
        talk: ['Questions?'],
        ask: 'Which part of this will take the most of your time?'
    }
];

let guide = null;
let guideTarget = null;

function openWorkflowGuide() {
    openModal('guideChooserModal');
}

function startGuide(mode) {
    const role = currentRole === 'admin' ? 'admin' : 'tech';
    closeModal('guideChooserModal');
    enterSandbox(role);
    guide = { i: 0, mode, steps: role === 'admin' ? ADMIN_STEPS : TECH_STEPS };
    document.body.classList.toggle('guide-present', mode === 'present');
    if (mode === 'present') document.documentElement.requestFullscreen?.().catch(() => {});
    document.getElementById('guideLayer').hidden = false;
    document.getElementById('sandboxBanner').hidden = false;
    document.addEventListener('keydown', guideKeys);
    window.addEventListener('resize', placeGuide);
    document.addEventListener('scroll', placeGuide, true);
    // The dimmed layer takes the mouse, so pass the wheel to the outlined popup.
    document.getElementById('guideBlock').addEventListener('wheel', e => {
        guideTarget?.closest('.modal-content')?.scrollBy(0, e.deltaY);
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
    const present = guide.mode === 'present';
    const last = guide.i === guide.steps.length - 1;
    await step.setup?.();

    // Modals and results can take a moment to appear.
    guideTarget = null;
    for (let t = 0; step.target && t < 20 && !(guideTarget = step.target()); t++) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (step.click && guideTarget) guideTarget.addEventListener('click', onGuideTargetClick, { once: true });

    const box = document.getElementById('guideBox');
    box.innerHTML = `
        <p class="guide-count">Step ${guide.i + 1} of ${guide.steps.length}</p>
        <h3>${step.title}</h3>
        <p>${step.text}</p>
        ${present && step.talk ? `<ul class="guide-talk">${step.talk.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
        ${present && step.ask ? `<p class="guide-ask"><strong>Discuss:</strong> ${step.ask}</p>` : ''}
        ${step.click && !present ? '<p class="guide-hint">Click the highlighted button, or press Next.</p>' : ''}
        <div class="guide-nav">
            <button type="button" class="btn btn-primary guide-exit" onclick="exitGuide()">Exit</button>
            <span>
                ${guide.i > 0 ? '<button type="button" class="btn btn-primary guide-back" onclick="guideBack()">Back</button>' : ''}
                <button type="button" class="btn btn-primary" onclick="${last ? 'exitGuide()' : 'guideNext()'}">${last ? 'Finish' : 'Next'}</button>
            </span>
        </div>
        ${present ? '<p class="guide-keys">← → to move · Esc to exit</p>' : ''}`;

    // Section steps outline a whole area: its popup moves to the top and
    // shrinks so everything fits inside the outline, with the box below.
    const room = innerHeight - document.getElementById('sandboxBanner').offsetHeight;
    document.body.classList.toggle('guide-section', !!step.section);
    document.documentElement.style.setProperty('--guide-room', `${room - box.offsetHeight - 80}px`);

    // Center the target, unless it's tall: then put it at the top so the box fits below.
    if (guideTarget && !step.section) {
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
