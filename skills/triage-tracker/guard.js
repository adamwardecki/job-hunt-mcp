/*
 * JOBHUNT triage guard (spec §12.3). Run with the browser's JavaScript tool immediately before every
 * delete round on a tracker board, and again after any click that changes the selection.
 *
 * Usage: replace the INPUT placeholder on the last line (the only occurrence) with a JSON object, then run
 * the whole file:
 *   {
 *     "column": "Saved",                      // header text of the column you are deleting from
 *     "protectedColumns": ["Applied"],        // header texts of columns that must not change
 *     "intended": ["Card title 1", "..."],    // exact titles you mean to delete (the selection must equal this)
 *     "expectedCounts": {"Applied": 5},       // optional: protected counts captured before the round
 *     "allColumns": ["Saved", "Applied", "Interviewing", "Offer", "Rejected"], // optional: every header on the board
 *     "titleSelector": ".job-title"           // optional: element inside a card that holds its title
 *   }
 *
 * It resolves each column by its header text (never by index or shared class), reads only that column's
 * descendants, and returns one line:
 *   JOBHUNT_TRIAGE_GUARD {"ok":true|false, "problems":[...], ...} JOBHUNT_END
 * The delete hook only lets a delete through when the latest guard line says ok:true and nothing but the
 * delete control and its confirm dialog was clicked since. Record protected counts from the output and
 * pass them as expectedCounts on the next round.
 */
((input) => {
  const norm = (s) => String(s || '').replace(/\(\s*\d+\s*\)|\b\d+\s*$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const columnNames = [...new Set([input.column, ...(input.protectedColumns || []), ...(input.allColumns || [])])];
  const problems = [];
  const boxesIn = (el) => [...el.querySelectorAll('input[type=checkbox], [role=checkbox]')];
  const isChecked = (b) => (b.matches('input') ? b.checked : b.getAttribute('aria-checked') === 'true');

  // Header candidates: smallest elements whose own text is exactly the column name (counts stripped).
  function headersFor(name) {
    const want = norm(name);
    return [...document.querySelectorAll('body *')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) return false;
      if (norm(el.textContent) !== want) return false;
      return ![...el.children].some((c) => norm(c.textContent) === want);
    });
  }

  // The column container: the largest ancestor of the header that holds no other column's header.
  function resolveColumn(name) {
    const others = columnNames.filter((n) => norm(n) !== norm(name)).flatMap(headersFor);
    const results = [];
    for (const h of headersFor(name)) {
      let el = h;
      let best = null;
      while (el.parentElement && el.parentElement !== document.body) {
        const p = el.parentElement;
        if (others.some((o) => p.contains(o))) break;
        best = p;
        el = p;
      }
      if (best) results.push({ header: h, container: best });
    }
    const uniq = results.filter((r, i) => results.findIndex((x) => x.container === r.container) === i);
    if (uniq.length !== 1) return { error: `column "${name}" resolved to ${uniq.length} containers by header text` };
    return uniq[0];
  }

  function cardOf(box, container) {
    let el = box;
    while (el.parentElement && el.parentElement !== container && boxesIn(el.parentElement).length === 1) el = el.parentElement;
    return el;
  }

  function titleOf(card) {
    const t = input.titleSelector && card.querySelector(input.titleSelector);
    const text = (t ? t.textContent : card.innerText || card.textContent || '').split('\n').map((s) => s.trim()).find(Boolean);
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function describe(name) {
    const col = resolveColumn(name);
    if (col.error) return { name, error: col.error };
    // Card checkboxes only: a box whose card wraps the header is a header control (e.g. "select all").
    const boxes = boxesIn(col.container).filter(
      (b) => !cardOf(b, col.container).contains(col.header) && !/select all|toggle all/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`),
    );
    const checked = boxes.filter(isChecked).map((b) => titleOf(cardOf(b, col.container)));
    const controls = [...col.container.querySelectorAll('button, [role=button]')]
      .filter((b) => /delete|trash|remove/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.textContent || ''}`))
      .slice(0, 5)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { label: (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      });
    return { name, container: col.container, count: boxes.length, checked, controls };
  }

  const target = describe(input.column);
  const out = { column: input.column, protected: {}, selected: [], missing: [], extra: [] };
  if (target.error) problems.push(target.error);
  else {
    out.count = target.count;
    out.selected = target.checked;
    const want = new Set((input.intended || []).map(norm));
    const have = new Set(target.checked.map(norm));
    out.missing = (input.intended || []).filter((t) => !have.has(norm(t)));
    out.extra = target.checked.filter((t) => !want.has(norm(t)));
    if (!target.checked.length) problems.push('nothing is selected in the target column');
    if (out.missing.length) problems.push(`intended but not selected: ${out.missing.join('; ')}`);
    if (out.extra.length) problems.push(`selected but not intended: ${out.extra.join('; ')}`);
    if (target.checked.length !== (input.intended || []).length) problems.push(`selection count ${target.checked.length} != intended ${(input.intended || []).length}`);
    out.delete_controls = target.controls;
  }

  for (const name of input.protectedColumns || []) {
    const p = describe(name);
    if (p.error) {
      problems.push(p.error);
      continue;
    }
    out.protected[name] = { count: p.count, checked: p.checked.length };
    if (p.checked.length) problems.push(`protected column "${name}" has ${p.checked.length} checked: ${p.checked.join('; ')}`);
    const expected = input.expectedCounts && input.expectedCounts[name];
    if (expected != null && expected !== p.count) problems.push(`protected column "${name}" count changed: expected ${expected}, now ${p.count}`);
  }

  // Anything checked anywhere outside the target column is a red flag too.
  if (!target.error) {
    const outside = boxesIn(document).filter((b) => isChecked(b) && !target.container.contains(b));
    if (outside.length) problems.push(`${outside.length} checkbox(es) checked outside "${input.column}"`);
  }

  out.ok = problems.length === 0;
  out.problems = problems;
  out.at = new Date().toISOString();
  const line = `JOBHUNT_TRIAGE_GUARD ${JSON.stringify(out)} JOBHUNT_END`;
  console.log(line);
  return line;
})(__JOBHUNT_GUARD_INPUT__);
