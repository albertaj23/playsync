import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ErrorBody, type RaceResult, type StrategyName } from '../lib/api';
import { Badge, Button, Card, Field, Segmented, cx, inputCls } from '../components/ui';

interface Method { name: StrategyName; label: string; idea: string; safe: boolean }

export const METHODS: Method[] = [
  { name: 'NAIVE', label: 'No protection', idea: 'Check if the account is free, then start. Two devices can both check before either starts.', safe: false },
  { name: 'TXN_RR', label: 'Basic grouping', idea: 'Bundles the steps together, but each device still looks at an old picture of the account.', safe: false },
  { name: 'SERIALIZABLE', label: 'Strictest mode', idea: 'The database refuses clashing requests outright; the losers try again.', safe: true },
  { name: 'PESSIMISTIC', label: 'Take a number', idea: 'Devices line up and go one at a time.', safe: true },
  { name: 'OPTIMISTIC', label: 'Check at the end', idea: 'Everyone goes ahead; if something changed meanwhile, they start over.', safe: true },
  { name: 'CONSTRAINT', label: 'Built-in rule', idea: 'A database rule makes a second player impossible. Only works for a one-device limit.', safe: true },
];

const labelOf = (n: StrategyName) => METHODS.find((m) => m.name === n)!.label;

/** One dot per device that pressed Play: green = allowed, red = allowed but over the limit, grey = told to wait. */
function DotGrid({ r }: { r: RaceResult }) {
  const allowedOk = r.granted - r.violations;
  const dots = [
    ...Array(allowedOk).fill('ok'), ...Array(r.violations).fill('over'),
    ...Array(r.rejected).fill('busy'), ...Array(r.errors).fill('err'),
  ] as string[];
  const color = { ok: 'bg-emerald-500', over: 'bg-rose-500', busy: 'bg-stone-300', err: 'bg-amber-400' } as Record<string, string>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {dots.map((d, i) => <span key={i} className={cx('h-3.5 w-3.5 rounded-full', color[d])} />)}
    </div>
  );
}

function verdict(r: RaceResult) {
  const limit = r.maxStreams * r.accounts;
  if (r.violations > 0) {
    return { ok: false, title: `Broken: ${r.granted} devices are playing, but the limit was ${limit}.`,
      body: `${r.violations} device${r.violations === 1 ? '' : 's'} got in that should have been turned away.` };
  }
  return { ok: true, title: `Protected: ${r.granted} device${r.granted === 1 ? '' : 's'} played, within the limit of ${limit}.`,
    body: `${r.rejected} were told the account is busy${r.errors ? `, and ${r.errors} gave up after retrying too many times` : ''}.` };
}

export default function StressTestPage() {
  const [method, setMethod] = useState<StrategyName>('NAIVE');
  const [devices, setDevices] = useState(30);
  const [limit, setLimit] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [raceDelayMs, setRaceDelayMs] = useState(20);
  const [accounts, setAccounts] = useState(1);
  const [running, setRunning] = useState<StrategyName | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [comparison, setComparison] = useState<RaceResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runOne(name: StrategyName): Promise<RaceResult | null> {
    setRunning(name);
    const r = await api.post<RaceResult & ErrorBody>('/lab/race',
      { strategy: name, concurrency: devices, maxStreams: limit, raceDelayMs, accounts, mode: 'NORMAL' });
    if (!r.ok) { setError(r.body.message ?? `Error ${r.status}`); return null; }
    return r.body;
  }

  async function run() {
    setError(null);
    setComparison([]);
    const r = await runOne(method);
    if (r) setResult(r);
    setRunning(null);
  }

  async function compareAll() {
    setError(null);
    setResult(null);
    const rows: RaceResult[] = [];
    for (const m of METHODS) {
      if (m.name === 'CONSTRAINT' && limit > 1) continue;
      const r = await runOne(m.name);
      if (r) { rows.push(r); setComparison([...rows]); }
    }
    setRunning(null);
  }

  const constraintBlocked = method === 'CONSTRAINT' && limit > 1;
  const v = result && verdict(result);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">Stress test</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          What happens if lots of devices press <strong>Play</strong> at the exact same moment? Pick how the app protects
          the account, then watch how many get through.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card title="Set up the test">
          <div className="space-y-5">
            <Field label={`Devices pressing Play at once: ${devices}`}>
              <input type="range" min={2} max={100} value={devices} onChange={(e) => setDevices(Number(e.target.value))} className="w-full accent-violet-600" />
            </Field>
            <div>
              <div className="mb-1 text-sm font-medium text-stone-700">Devices allowed to play together</div>
              <Segmented value={limit} onChange={setLimit} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-stone-700">Protection method</div>
              <div className="space-y-2">
                {METHODS.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setMethod(m.name)}
                    className={cx('w-full rounded-xl border p-3 text-left transition',
                      method === m.name ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/20' : 'border-stone-200 hover:border-stone-300')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-stone-900">{m.label}</span>
                      {!m.safe && <Badge tone="amber">risky</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">{m.idea}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <button onClick={() => setAdvanced((a) => !a)} className="text-sm text-stone-500 hover:text-stone-800">
                {advanced ? '▾' : '▸'} Advanced
              </button>
              {advanced && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Thinking time" hint="Pause between checking and starting">
                    <select className={inputCls} value={raceDelayMs} onChange={(e) => setRaceDelayMs(Number(e.target.value))}>
                      {[0, 5, 20, 50].map((n) => <option key={n} value={n}>{n} ms</option>)}
                    </select>
                  </Field>
                  <Field label="Accounts" hint="Spread devices over accounts">
                    <select className={inputCls} value={accounts} onChange={(e) => setAccounts(Number(e.target.value))}>
                      {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>

            {constraintBlocked && <p className="text-sm text-amber-700">“Built-in rule” only works when one device is allowed.</p>}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={run} disabled={!!running || constraintBlocked}>
                {running && comparison.length === 0 && !result ? 'Running…' : 'Run test'}
              </Button>
              <Button className="flex-1" onClick={compareAll} disabled={!!running}>Compare all</Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {running && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 text-sm text-violet-800">
              {devices} devices are pressing Play using “{labelOf(running)}”…
            </div>
          )}

          {result && v && (
            <Card>
              <div className={cx('rounded-xl p-4', v.ok ? 'bg-emerald-50' : 'bg-rose-50')}>
                <div className={cx('text-lg font-semibold', v.ok ? 'text-emerald-800' : 'text-rose-800')}>{v.ok ? '✅' : '❌'} {v.title}</div>
                <p className={cx('mt-1 text-sm', v.ok ? 'text-emerald-700' : 'text-rose-700')}>{v.body}</p>
              </div>
              <div className="mt-5"><DotGrid r={result} /></div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> allowed</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> allowed, over the limit</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-stone-300" /> told to wait</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> gave up</span>
              </div>
              <p className="mt-4 text-sm text-stone-500">
                Method: {labelOf(result.strategy)} · finished in {Math.round(result.wallMs)} ms ·{' '}
                <Link to="/nerds?tab=stress" className="font-medium text-violet-700 hover:underline">full numbers in Stats for nerds →</Link>
              </p>
            </Card>
          )}

          {comparison.length > 0 && (
            <Card title="All methods, same test" subtitle={`${devices} devices, ${limit} allowed`}>
              <ul className="divide-y divide-stone-100">
                {comparison.map((r) => {
                  const cv = verdict(r);
                  return (
                    <li key={r.strategy} className="flex items-center gap-3 py-3">
                      <span className="text-lg">{cv.ok ? '✅' : '❌'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-stone-900">{labelOf(r.strategy)}</div>
                        <div className="text-xs text-stone-500">
                          {r.granted} played · {r.rejected} told to wait{r.errors ? ` · ${r.errors} gave up` : ''} · {Math.round(r.wallMs)} ms
                        </div>
                      </div>
                      <Badge tone={cv.ok ? 'green' : 'red'}>{cv.ok ? 'protected' : 'broken'}</Badge>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-stone-500">
                The safe methods all hold the limit; they differ in cost.{' '}
                <Link to="/nerds?tab=stress" className="font-medium text-violet-700 hover:underline">Compare retries, deadlocks and timing →</Link>
              </p>
            </Card>
          )}

          {!result && comparison.length === 0 && !running && (
            <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center text-stone-500">
              <div className="text-3xl">⚡</div>
              <p className="mt-2 max-w-sm">Start with <strong>No protection</strong> and press <strong>Run test</strong>. Then try <strong>Take a number</strong>.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
