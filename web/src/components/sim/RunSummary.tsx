import { Verdict } from '../Verdict';
import { Stat } from '../ui';
import type { SimSummary } from '../../lib/sim';

export function summaryVerdict(s: SimSummary) {
  const k = s.kpis;
  return s.verdict === 'HELD'
    ? { ok: true, title: 'Limit held 🎉', body: `Every household stayed within its limit for the whole run. ${k.played} songs started.` }
    : { ok: false, title: `Limit broken ${k.newViolationEvents} time${k.newViolationEvents === 1 ? '' : 's'}, worst case ${k.peakExcess} over 🐛`, body: 'Some households had more screens playing than they were allowed.' };
}

/** The verdict plus the numbers a listener would feel. */
export function RunSummary({ summary }: { summary: SimSummary }) {
  const v = summaryVerdict(summary);
  const k = summary.kpis;
  return (
    <div className="space-y-4">
      <Verdict ok={v.ok} title={v.title} body={v.body} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Listeners happy" value={`${k.happinessPct}%`} tone={k.happinessPct < 80 ? 'red' : 'green'} />
        <Stat label="Time to play (p95)" value={`${k.p95Ms} ms`} />
        <Stat label="Songs per second" value={Math.round((k.played / Math.max(1, summary.wallMs / 1000)) * 10) / 10} />
        <Stat label="Tries repeated" value={k.retries} hint={`${k.deadlocks} clashes`} />
      </div>
    </div>
  );
}
