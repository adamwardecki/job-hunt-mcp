// Kanban board for the job-hunt tracker. Plain JS, no build step; served by board-server.ts.
// Every move is POST /api/move, which runs the tracker's transition rules. All text goes in with textContent.

const LABELS = { found: 'Found', verified: 'Verified', scored: 'Scored', queued: 'Queued', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', dropped: 'Dropped', closed: 'Closed' };
const FOLDED = new Set(['dropped', 'closed']);
const OUTCOMES = ['rejected', 'withdrawn', 'role_closed'];
const STOPPED = 'The board has stopped. Run /j-hunt:board in Claude to start it again.';
const STALE = 'This link is out of date. Run /j-hunt:board in Claude for a fresh one.';

const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const expanded = new Set();
let view = null;
let lastKey = '';
let requests = 0;
// While a card is dragged or a move form is open, polling must not redraw the board under the user.
// Derived from the page rather than kept as a flag, so it cannot get stuck.
let dragging = false;
const isBusy = () => dragging || document.querySelector('form.move') !== null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function say(message) {
  statusEl.textContent = message;
}

async function api(path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new Error(STOPPED); // fetch rejects only when the server is unreachable
  }
  if (res.status === 401) throw new Error(STALE);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The board answered ${res.status}.`);
  return data;
}

async function refresh() {
  // A hidden tab doesn't poll, so a forgotten tab can't keep the board listening; focus revives it.
  if (document.hidden) return;
  const seq = ++requests;
  try {
    if (isBusy()) {
      await api('/api/health'); // keeps the idle timer from stopping the board while a form is open
      return;
    }
    const next = await api('/api/board');
    // A newer refresh supersedes this one, and a form or drag may have started while it was in flight.
    if (seq !== requests || isBusy()) return;
    // Redrawing identical data would drop keyboard focus every 30 s, so only draw what changed.
    const key = JSON.stringify(next);
    if (!view || key !== lastKey) {
      const previous = view;
      view = next;
      try {
        render();
      } catch (err) {
        view = previous;
        throw err;
      }
      lastKey = key;
    }
    say('');
  } catch (err) {
    say(err.message);
  }
}

function targets(role) {
  return view.moves[role.status] || [];
}

function age(ts) {
  const then = Date.parse(ts);
  if (!ts || Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 864e5);
  return days < 1 ? 'today' : `${days}d ago`;
}

function render() {
  boardEl.replaceChildren(...view.statuses.map(column));
}

function column(status) {
  const roles = view.roles.filter((r) => r.status === status);
  const col = el('section', 'col');
  col.dataset.status = status;
  col.setAttribute('aria-label', LABELS[status]);
  const head = el('h2');
  if (FOLDED.has(status)) {
    col.classList.toggle('folded', !expanded.has(status));
    const toggle = el('button', 'fold', `${LABELS[status]} (${roles.length})`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded.has(status)));
    // Flip in place rather than render(): a redraw would throw away an open move form.
    toggle.addEventListener('click', () => {
      const open = !expanded.has(status);
      if (open) expanded.add(status);
      else expanded.delete(status);
      col.classList.toggle('folded', !open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    head.append(toggle);
  } else {
    // Without a label the heading reads as "Found3".
    head.setAttribute('aria-label', `${LABELS[status]}, ${roles.length} ${roles.length === 1 ? 'role' : 'roles'}`);
    head.append(el('span', '', LABELS[status]), el('span', '', String(roles.length)));
  }
  const list = el('div', 'cards');
  for (const role of roles) list.append(card(role));
  col.append(head, list);
  return col;
}

function card(role) {
  const node = el('article', 'card');
  node.append(el('div', 'company', role.company), el('div', 'title', role.title));
  const meta = [role.score != null ? `Score ${role.score}` : '', role.location_type || '', age(role.last_event)].filter(Boolean).join(' · ');
  if (meta) node.append(el('div', 'meta', meta));
  if (role.question) node.append(el('div', 'needs', `Needs you: ${role.question}`));
  const actions = el('div', 'actions');
  if (role.url && /^https?:\/\//i.test(role.url)) {
    const link = el('a', '', 'Posting');
    link.href = role.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  if (targets(role).length) {
    const move = el('button', '', 'Move to…');
    move.type = 'button';
    move.setAttribute('aria-label', `Move ${role.company}, ${role.title}`);
    move.addEventListener('click', () => openForm(node, role, null, move));
    actions.append(move);
    node.classList.add('draggable');
    node.addEventListener('pointerdown', (e) => startDrag(e, node, role));
  }
  node.append(actions);
  return node;
}

// Pointer events cover mouse and touch. The card follows the pointer as a fixed "ghost"; only legal columns light up.
function startDrag(e, node, role) {
  if (!e.isPrimary || isBusy() || e.button !== 0 || e.target.closest('a, button, input, textarea, select, form')) return;
  const allowed = new Set(targets(role));
  const rect = node.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  let ghost = null;
  node.setPointerCapture(e.pointerId);
  const columns = () => [...boardEl.querySelectorAll('.col')];
  // The legal column under the pointer gets a slot the card's size, so the drop target is unambiguous.
  const slot = el('div', 'slot');
  let over = null;
  const hover = (x, y) => {
    const col = document.elementFromPoint(x, y)?.closest('.col');
    const next = col && allowed.has(col.dataset.status) ? col : null;
    if (next === over) return;
    over?.classList.remove('over');
    slot.remove();
    over = next;
    if (!over) return;
    over.classList.add('over');
    slot.style.height = `${rect.height}px`;
    over.querySelector('.cards')?.append(slot);
  };

  const onMove = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      dragging = true;
      ghost = node.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.width = `${rect.width}px`;
      document.body.append(ghost);
      node.classList.add('dragging');
      for (const col of columns()) {
        const ok = allowed.has(col.dataset.status);
        col.classList.toggle('target', ok);
        col.classList.toggle('dim', !ok && col.dataset.status !== role.status);
      }
    }
    ghost.style.left = `${ev.clientX - dx}px`;
    ghost.style.top = `${ev.clientY - dy}px`;
    hover(ev.clientX, ev.clientY);
    // Nudge the board sideways near its edges so far columns can be reached.
    const edge = boardEl.getBoundingClientRect();
    if (ev.clientX < edge.left + 40) boardEl.scrollLeft -= 16;
    else if (ev.clientX > edge.right - 40) boardEl.scrollLeft += 16;
  };
  const end = (drop) => {
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey);
    if (!ghost) return;
    dragging = false;
    ghost.remove();
    node.classList.remove('dragging');
    const to = drop ? over?.dataset.status : null;
    slot.remove();
    for (const col of columns()) col.classList.remove('target', 'dim', 'over');
    if (to && allowed.has(to)) openForm(node, role, to, node.querySelector('.actions button'));
  };
  const onUp = () => end(true);
  const onCancel = () => end(false);
  const onKey = (ev) => {
    if (ev.key === 'Escape') end(false);
  };
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey);
}

function labelled(text, control) {
  const label = el('label', '', text);
  label.append(control);
  return label;
}

function option(value, text) {
  const node = el('option', '', text);
  node.value = value;
  return node;
}

// Asks for exactly what transition requires for the target; the server checks it again.
function fieldsFor(to) {
  if (to === 'applied') {
    const text = el('textarea');
    text.name = 'evidence';
    text.rows = 3;
    text.required = true;
    return [labelled('Confirmation text, pasted from the employer’s page or email. This only records the application; nothing is submitted.', text)];
  }
  if (to === 'dropped') {
    const rule = el('select');
    rule.name = 'rule';
    rule.append(option('', 'A quote from the employer’s page'), ...view.rules.map((r) => option(`rule:${r.id}`, `Rule ${r.id}: ${r.text}`)));
    const quote = el('textarea');
    quote.name = 'quote';
    quote.rows = 3;
    quote.placeholder = 'Verbatim quote, with the page URL';
    return [labelled('Evidence', rule), labelled('Quote', quote)];
  }
  if (to === 'closed') {
    const outcome = el('select');
    outcome.name = 'outcome';
    outcome.append(...OUTCOMES.map((o) => option(o, o.replace('_', ' '))));
    return [labelled('Outcome', outcome)];
  }
  return [];
}

function valuesFor(to, extra) {
  const value = (name) => extra.querySelector(`[name="${name}"]`)?.value.trim() || undefined;
  if (to === 'applied') return { evidence: value('evidence') };
  if (to === 'dropped') return { evidence: value('rule') || value('quote') };
  if (to === 'closed') return { outcome: value('outcome') };
  return {};
}

// The card moves only after the server accepts; a refused move leaves it in place with the server's message.
function openForm(node, role, to, opener) {
  document.querySelector('form.move')?.remove();
  const form = el('form', 'move');
  const pick = el('select');
  pick.name = 'to';
  pick.append(...targets(role).map((s) => option(s, LABELS[s])));
  if (to) pick.value = to;
  const reason = el('input');
  reason.name = 'reason';
  reason.required = true;
  reason.value = 'Moved on the board';
  const extra = el('div');
  const error = el('p', 'error');
  error.setAttribute('role', 'alert');
  const save = el('button', 'primary', 'Move');
  save.type = 'submit';
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  const buttons = el('div', 'buttons');
  buttons.append(save, cancel);
  const draw = () => extra.replaceChildren(...fieldsFor(pick.value));
  pick.addEventListener('change', draw);
  draw();
  cancel.addEventListener('click', () => {
    form.remove();
    if (opener?.isConnected) opener.focus();
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    save.disabled = true;
    error.textContent = '';
    try {
      await api('/api/move', { role_id: role.id, to: pick.value, reason: reason.value.trim(), ...valuesFor(pick.value, extra) });
      form.remove();
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });
  form.append(labelled('Move to', pick), labelled('Reason', reason), extra, error, buttons);
  node.append(form);
  (to ? reason : pick).focus();
}

if (!token) {
  say('This link has no token. Run /j-hunt:board in Claude for a fresh link.');
} else {
  refresh();
  setInterval(refresh, 30_000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
}
