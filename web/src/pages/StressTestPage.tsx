import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ErrorBody, type LostUpdateResponse, type LostUpdateResult, type LostUpdateVariant, type RaceResult, type StrategyName } from '../lib/api';
import { uuid } from '../lib/uuid';
import { Badge, Button, Card, Field, Segmented, cx, inputCls } from '../components/ui';
import { Verdict } from '../components/Verdict';
import { RaceTrack, type Lane } from '../components/RaceTrack';
import { Mascot } from '../components/Mascot';
import { enterUp } from '../lib/motion';
import { useToast } from '../lib/toast';

const friendlyError = (status: number, msg?: string) =>
  status === 409 ? 'Another experiment is running. Try again in a moment ⏳' : (msg ?? `Something went wrong (${status})`);

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
  useEffect(() => { enterUp('.race-dot', { step: 12 }); }, [r]);
  const allowedOk = r.granted - r.violations;
  const dots = [
    ...Array(allowedOk).fill('ok'), ...Array(r.violations).fill('over'),
    ...Array(r.rejected).fill('busy'), ...Array(r.errors).fill('err'),
  ] as string[];
  const color = { ok: 'bg-emerald-500', over: 'bg-rose-500', busy: 'bg-stone-400', err: 'bg-amber-400' } as Record<string, string>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {dots.map((d, i) => <span key={i} className={cx('race-dot h-4 w-4 rounded-full', color[d])} />)}
    </div>
  );
}

function verdict(r: RaceResult) {
  const limit = r.maxStreams * r.accounts;
  if (r.violations > 0) {
    return { ok: false, title: `Whoa, ${r.granted} screens got in but only ${limit} ${limit === 1 ? 'was' : 'were'} allowed. That's the bug we're hunting 🐛`,
      body: `${r.violations} screen${r.violations === 1 ? '' : 's'} slipped through that should have been turned away.` };
  }
  return { ok: true, title: `Nice! Only ${r.granted} screen${r.granted === 1 ? '' : 's'} got in, exactly as allowed 🎉`,
    body: `${r.rejected} politely waited their turn${r.errors ? `, and ${r.errors} gave up after retrying too many times` : ''}.` };
}

function SavedLink({ batchId }: { batchId: string }) {
  return (
    <p className="mt-2 text-xs text-stone-400">
      Saved to the lab history ·{' '}
      <Link to={`/nerds?tab=runs&batch=${batchId}`} className="font-medium text-violet-300 hover:underline">
        see it in Stats for nerds →
      </Link>
    </p>
  );
}

// ------------------------------------------------------------------ "Pressing Play together"

function StreamLimitExperiment() {
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
  const [comparing, setComparing] = useState(false);
  const toast = useToast();

  async function runOne(name: StrategyName, batchId?: string): Promise<RaceResult | null> {
    setRunning(name);
    const r = await api.post<RaceResult & ErrorBody>('/lab/race',
      { strategy: name, concurrency: devices, maxStreams: limit, raceDelayMs, accounts, mode: 'NORMAL', batchId });
    if (!r.ok) { const m = friendlyError(r.status, r.body.message); setError(m); toast(m, 'warn'); return null; }
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
    setComparing(true);
    const batchId = uuid();
    const rows: RaceResult[] = [];
    for (const m of METHODS) {
      if (m.name === 'CONSTRAINT' && limit > 1) continue;
      const r = await runOne(m.name, batchId);
      if (r) { rows.push(r); setComparison([...rows]); }
    }
    setRunning(null);
    setComparing(false);
  }

  const constraintBlocked = method === 'CONSTRAINT' && limit > 1;
  const v = result && verdict(result);
  const comparisonBatch = comparison[0]?.batchId;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card title="Set up the test">
        <div className="space-y-5">
          <Field label={`Screens pressing Play at once: ${devices}`}>
            <input type="range" min={2} max={100} value={devices} onChange={(e) => setDevices(Number(e.target.value))} className="w-full accent-violet-600" />
          </Field>
          <div>
            <div className="mb-1 text-sm font-medium text-stone-700">Screens allowed to play together</div>
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
                    method === m.name ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'border-stone-200 hover:border-stone-300')}
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

          {constraintBlocked && <p className="text-sm text-amber-400">“Built-in rule” only works when one device is allowed.</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={run} disabled={!!running || constraintBlocked}>
              {running && comparison.length === 0 && !result ? 'Stampede in progress…' : 'Run test'}
            </Button>
            <Button className="flex-1" onClick={compareAll} disabled={!!running}>Compare all</Button>
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        {running && (
          <div className="flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-4 text-sm text-violet-400">
            <div className="bob shrink-0"><Mascot mood="wow" size={48} /></div>
            {devices} screens are all tapping Play at once with “{labelOf(running)}”…
          </div>
        )}

        {result && v && (
          <Card>
            <Verdict ok={v.ok} title={v.title} body={v.body} />
            <div className="mt-5"><DotGrid r={result} /></div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> allowed</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> allowed, over the limit</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-stone-400" /> told to wait</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> gave up</span>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              Method: {labelOf(result.strategy)} · finished in {Math.round(result.wallMs)} ms
            </p>
            <SavedLink batchId={result.batchId} />
          </Card>
        )}

        {(comparison.length > 0 || comparing) && (
          <Card title="All methods, same test" subtitle={`${devices} devices, ${limit} allowed`}>
            <RaceTrack lanes={METHODS.filter((m) => !(m.name === 'CONSTRAINT' && limit > 1)).map((m): Lane => {
              const r = comparison.find((c) => c.strategy === m.name);
              if (!r) return { key: m.name, label: m.label, state: running === m.name ? 'running' : 'waiting' };
              const cv = verdict(r);
              return { key: m.name, label: m.label, state: 'done', ok: cv.ok, badge: cv.ok ? 'protected' : 'broken',
                detail: `${r.granted} played · ${r.rejected} told to wait${r.errors ? ` · ${r.errors} gave up` : ''} · ${Math.round(r.wallMs)} ms` };
            })} />
            <p className="mt-3 text-sm text-stone-500">The safe methods all hold the limit; they differ in cost.</p>
            {comparisonBatch && <SavedLink batchId={comparisonBatch} />}
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
  );
}

// ------------------------------------------------------------------ "Counting plays" (lost update)

interface LostUpdateMethod { name: LostUpdateVariant; label: string; idea: string; safe: boolean }

const LOST_UPDATE_METHODS: LostUpdateMethod[] = [
  { name: 'NAIVE_RMW', label: 'Read, then write', idea: 'Each phone reads the number, adds one, writes it back. Two phones can read the same number.', safe: false },
  { name: 'ATOMIC', label: 'Let the database add', idea: 'The database does the +1 itself, one at a time.', safe: true },
  { name: 'LOCKED', label: 'Take a number', idea: 'Each phone waits its turn to read and write.', safe: true },
  { name: 'CAS', label: 'Check it didn’t change', idea: 'Write only if the number is still what you read; otherwise try again.', safe: true },
];

const luLabelOf = (n: LostUpdateVariant) => LOST_UPDATE_METHODS.find((m) => m.name === n)!.label;

function LostUpdateDotGrid({ r }: { r: LostUpdateResult }) {
  const dots = [...Array(r.finalCount).fill('ok'), ...Array(r.lost).fill('lost')] as string[];
  const color = { ok: 'bg-emerald-500', lost: 'bg-rose-500' } as Record<string, string>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {dots.map((d, i) => <span key={i} className={cx('race-dot h-4 w-4 rounded-full', color[d])} />)}
    </div>
  );
}

function luVerdict(r: LostUpdateResult) {
  if (r.lost > 0) {
    return { ok: false, title: `${r.succeeded} people listened, but the counter only says ${r.finalCount} 😬`,
      body: `${r.lost} play${r.lost === 1 ? ' was' : 's were'} lost along the way.` };
  }
  return { ok: true, title: `${r.succeeded} people listened, and the counter says ${r.finalCount} 🎉`, body: 'Every single play was counted.' };
}

function CountingPlaysExperiment() {
  const [method, setMethod] = useState<LostUpdateVariant>('NAIVE_RMW');
  const [people, setPeople] = useState(50);
  const [running, setRunning] = useState<LostUpdateVariant | null>(null);
  const [result, setResult] = useState<LostUpdateResult | null>(null);
  const [comparison, setComparison] = useState<LostUpdateResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const toast = useToast();

  // /lab/lost-update always runs a batch of trials (default 1 here) and returns { batchId, trials, aggregate };
  // the single result shown here is that one trial.
  async function runOne(variant: LostUpdateVariant, batchId?: string): Promise<LostUpdateResult | null> {
    setRunning(variant);
    const r = await api.post<LostUpdateResponse & ErrorBody>('/lab/lost-update',
      { variant, increments: people, raceDelayMs: 20, trials: 1, batchId });
    if (!r.ok) { const m = friendlyError(r.status, r.body.message); setError(m); toast(m, 'warn'); return null; }
    return r.body.trials[0] ?? null;
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
    setComparing(true);
    const batchId = uuid();
    const rows: LostUpdateResult[] = [];
    for (const m of LOST_UPDATE_METHODS) {
      const r = await runOne(m.name, batchId);
      if (r) { rows.push(r); setComparison([...rows]); }
    }
    setRunning(null);
    setComparing(false);
  }

  const v = result && luVerdict(result);
  const comparisonBatch = comparison[0]?.batchId;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card title="Set up the test">
        <div className="space-y-5">
          <p className="text-sm text-stone-600">
            Every time someone finishes a song, its play counter goes up by one. What if {people} people finish at
            the same moment?
          </p>
          <Field label={`People finishing at once: ${people}`}>
            <input type="range" min={2} max={100} value={people} onChange={(e) => setPeople(Number(e.target.value))} className="w-full accent-violet-600" />
          </Field>
          <div>
            <div className="mb-2 text-sm font-medium text-stone-700">Counting method</div>
            <div className="space-y-2">
              {LOST_UPDATE_METHODS.map((m) => (
                <button
                  key={m.name}
                  onClick={() => setMethod(m.name)}
                  className={cx('w-full rounded-xl border p-3 text-left transition',
                    method === m.name ? 'border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/20' : 'border-stone-200 hover:border-stone-300')}
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

          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={run} disabled={!!running}>
              {running && comparison.length === 0 && !result ? 'Stampede in progress…' : 'Run test'}
            </Button>
            <Button className="flex-1" onClick={compareAll} disabled={!!running}>Compare all</Button>
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        {running && (
          <div className="flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-4 text-sm text-violet-400">
            <div className="bob shrink-0"><Mascot mood="wow" size={48} /></div>
            {people} people are finishing songs using “{luLabelOf(running)}”…
          </div>
        )}

        {result && v && (
          <Card>
            <Verdict ok={v.ok} title={v.title} body={v.body} />
            <div className="mt-5"><LostUpdateDotGrid r={result} /></div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> counted</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> lost</span>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              Method: {luLabelOf(result.variant)} · finished in {Math.round(result.wallMs)} ms
            </p>
            <SavedLink batchId={result.batchId} />
          </Card>
        )}

        {(comparison.length > 0 || comparing) && (
          <Card title="All methods, same test" subtitle={`${people} people finishing at once`}>
            <RaceTrack lanes={LOST_UPDATE_METHODS.map((m): Lane => {
              const r = comparison.find((c) => c.variant === m.name);
              if (!r) return { key: m.name, label: m.label, state: running === m.name ? 'running' : 'waiting' };
              const cv = luVerdict(r);
              return { key: m.name, label: m.label, state: 'done', ok: cv.ok, badge: cv.ok ? 'accurate' : 'lost plays',
                detail: `counter says ${r.finalCount} of ${r.succeeded} · ${Math.round(r.wallMs)} ms` };
            })} />
            <p className="mt-3 text-sm text-stone-500">The safe methods all count exactly right; they differ in speed.</p>
            {comparisonBatch && <SavedLink batchId={comparisonBatch} />}
          </Card>
        )}

        {!result && comparison.length === 0 && !running && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-stone-300 px-6 py-16 text-center text-stone-500">
            <div className="text-3xl">🎧</div>
            <p className="mt-2 max-w-sm">Start with <strong>Read, then write</strong> and press <strong>Run test</strong>. Then try <strong>Let the database add</strong>.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function StressTestPage() {
  const [experiment, setExperiment] = useState<'stream' | 'counting'>('stream');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-stone-900">Stress test</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          {experiment === 'stream'
            ? <>What happens if lots of devices press <strong>Play</strong> at the exact same moment? Pick how the app protects the account, then watch how many get through.</>
            : <>What happens if lots of people finish a song at the exact same moment? Pick how the counter is updated, then watch whether every play is counted.</>}
        </p>
      </div>

      <Segmented
        value={experiment}
        onChange={setExperiment}
        options={[
          { value: 'stream', label: 'Pressing Play together' },
          { value: 'counting', label: 'Counting plays' },
        ]}
      />

      {experiment === 'stream' ? <StreamLimitExperiment /> : <CountingPlaysExperiment />}
    </div>
  );
}
