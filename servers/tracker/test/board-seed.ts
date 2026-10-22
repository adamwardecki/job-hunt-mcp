// Made-up roles in the states the board cares about, for the board tests and a manual look at the page.

import { openDb } from '../src/db.ts';
import { Tracker } from '../src/tracker.ts';

export function seeded(path = ':memory:') {
  const t = new Tracker(openDb(path), { dbPath: path === ':memory:' ? null : path });
  const add = (company: string, title: string, slug: string) => t.upsertRole({ company, title, url: `https://jobs.ashbyhq.com/${slug}`, source: 'ashby' }).role.id;
  const verify = (id: number) => t.transition({ role_id: id, to: 'verified', reason: 'Checked ATS', evidence: 'https://jobs.ashbyhq.com/x: "Remote (EU)"', location_line: 'Remote (EU)', location_type: 'remote' });
  const found = add('Northwind', 'Backend Engineer', 'northwind/1');
  const scored = add('Contoso', 'Platform Engineer', 'contoso/2');
  verify(scored);
  t.transition({ role_id: scored, to: 'scored', reason: 'Fits the stack', score: 8 });
  const queued = add('Fabrikam', 'Staff Engineer', 'fabrikam/3');
  verify(queued);
  t.transition({ role_id: queued, to: 'scored', reason: 'Strong fit', score: 9 });
  t.transition({ role_id: queued, to: 'queued', reason: 'Top pick', question: 'Is a quarterly week in Lisbon OK?', blocked_by: 'user' });
  const { rule_id: rule } = t.addRule({ text: 'Skip staffing agencies', reason: 'User preference' });
  return { t, found, scored, queued, rule };
}
