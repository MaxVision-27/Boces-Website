// ============================================================
// WORKFLOW GUIDE (Tech) — a game-style tour of the real screens.
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

function enterSandbox() {
    const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
    const me = { id: 1, name: currentTechName || 'You' };
    const sampleTicket = {
        id: 41, name: 'Riley Chen', email: '', device: 'Desktop', issue: "Won't turn on after a storm.",
        status: 'in_progress', tracking_code: 'Z9X1CV', created_at: daysAgo(2), assigned_tech_ids: [1, 2],
        creation_tech_ids: [1, 2], created_by: 'Jordan (sample)', parts_used: '', review_note: null
    };
    const sampleLog = {
        id: 7, ticket_id: 41, tech_id: 2, work_date: daysAgo(1).slice(0, 10), start_time: '13:15:00', end_time: '14:00:00',
        note: 'Power supply fan does not spin. Tested with a spare PSU and it boots. Next: customer orders a PSU.',
        team_tech_ids: [1, 2], created_at: daysAgo(1)
    };

    techs = [me, { id: 2, name: 'Jordan (sample)' }, { id: 3, name: 'Priya (sample)' }];
    currentTechId = me.id;
    currentTechName = me.name;
    appointments = [{ ...sampleTicket }];
    myTimeLogs = [];
    db = fakeDb({ repair_requests: [sampleTicket], time_logs: [sampleLog], techs: techs.map(t => ({ ...t })), stats: [] });
}

const $g = sel => document.querySelector(sel);
const wsCard = title => [...document.querySelectorAll('#ticketWorkspaceContainer .ws-card')]
    .find(c => c.querySelector('h3')?.textContent === title);
const isOpen = id => document.getElementById(id).style.display === 'flex';
const guideTicketId = () => appointments.at(-1).id;

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

// Going Back past Start Repair or Ready for Check-Off puts the practice
// ticket back in the status that step expects.
async function sandboxStatus(status) {
    const appt = appointments.find(a => a.id === guideTicketId());
    if (appt.status !== status) {
        await db.from('repair_requests').update({ status }).eq('id', appt.id);
        appt.status = status;
        renderTicketWorkspace();
    }
}

async function ensureWorkspace() {
    closeModal('paperPreviewModal');
    if (!isWorkspaceOpen() || workspaceTicketId !== guideTicketId()) {
        closeAllModals();
        await openTicketWorkspace(guideTicketId());
    }
}

// target: the element to spotlight (none = centered message).
// click: the step is done by pressing that element; Next presses it too.
// talk / ask: shown in presentation mode only.
const GUIDE_STEPS = [
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
        title: 'Describe the problem',
        text: 'Fill in the customer\'s name, their email if they have one, the device, and the problem in their words. We filled in an example.',
        setup: () => {
            if (!isOpen('techTicketModal')) { closeAllModals(); openTechTicketModal(); }
            $g('#techApptName').value ||= 'Jamie Rivera';
            $g('#techApptEmail').value ||= 'jrivera@school.edu';
            $g('#techApptDevice').value = 'Laptop';
            $g('#techApptIssue').value ||= 'Screen is cracked in the top left corner and flickers when opened.';
        },
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
        target: () => $g('#createdTrackingCode'),
        talk: ['The code is the only way a customer checks on a repair. They never need an account.'],
        ask: 'What should happen if a customer loses their code?'
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
        setup: async () => { if (!isOpen('paperPreviewModal')) { await ensureWorkspace(); await previewServiceLog(guideTicketId()); } },
        target: () => $g('#paperPreviewActions button'),
        talk: ['Serial number, date completed and accessories are written by hand.'],
        ask: 'Who reads these forms after you hand them in?'
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
        title: 'Your hours',
        text: 'My Hours lists every session you logged, with your total. Use it to check your Hours sheets.',
        setup: closeAllModals,
        target: () => $g('#techToolbar [onclick^="openMyHours"]'),
        talk: ['Your Work-Based Learning hours come from these sessions.'],
        ask: 'How could logging hours help you later, for a job or a reference?'
    },
    {
        title: "That's the whole path",
        text: 'Drop-off, ticket, work sessions, check-off. Exit the guide to go back to the real site.',
        setup: closeAllModals,
        talk: ['Questions before we start on real devices?'],
        ask: 'Which step do you think is easiest to forget?'
    }
];

let guide = null;
let guideTarget = null;

function openWorkflowGuide() {
    openModal('guideChooserModal');
}

function startGuide(mode) {
    closeModal('guideChooserModal');
    enterSandbox();
    guide = { i: 0, mode };
    document.body.classList.toggle('guide-present', mode === 'present');
    if (mode === 'present') document.documentElement.requestFullscreen?.().catch(() => {});
    document.getElementById('guideLayer').hidden = false;
    document.getElementById('sandboxBanner').hidden = false;
    document.addEventListener('keydown', guideKeys);
    window.addEventListener('resize', placeGuide);
    document.addEventListener('scroll', placeGuide, true);
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
    const step = GUIDE_STEPS[guide.i];
    const present = guide.mode === 'present';
    const last = guide.i === GUIDE_STEPS.length - 1;
    await step.setup?.();

    // Modals and results can take a moment to appear.
    guideTarget = null;
    for (let t = 0; step.target && t < 20 && !(guideTarget = step.target()); t++) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (step.click && guideTarget) guideTarget.addEventListener('click', onGuideTargetClick, { once: true });

    const box = document.getElementById('guideBox');
    box.innerHTML = `
        <p class="guide-count">Step ${guide.i + 1} of ${GUIDE_STEPS.length}</p>
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

    // Center the target, unless it's tall: then put it at the top so the box fits below.
    if (guideTarget) {
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
    const step = GUIDE_STEPS[guide.i];
    if (guide.i === GUIDE_STEPS.length - 1) return exitGuide();
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
    block.style.clipPath = GUIDE_STEPS[guide.i].click
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
