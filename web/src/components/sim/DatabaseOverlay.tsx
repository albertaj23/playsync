import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { api, type LockSnapshot } from '../../lib/api';
import type { SimState, StrategyName } from '../../lib/sim';
import { Stat } from '../ui';

const SQL: Record<StrategyName, string> = {
  NAIVE: `-- autocommit, no transaction
SELECT max_streams FROM account WHERE account_id = ?;
SELECT COUNT(*) FROM playback_session WHERE account_id = ? AND status = 'PLAYING' AND lease_expires_at > NOW(3) AND device_id <> ?;
-- (server hesitation sleeps here)
INSERT INTO playback_session (...) VALUES (...);   -- check and write are NOT atomic together`,
  TXN_RR: `START TRANSACTION;  -- REPEATABLE READ (or READ COMMITTED)
SELECT max_streams ...;        -- plain snapshot read
SELECT COUNT(*) ... ;          -- plain snapshot read: both racers see the same old picture
INSERT INTO playback_session ...; COMMIT;   -- write skew`,
  SERIALIZABLE: `START TRANSACTION;  -- SERIALIZABLE
SELECT COUNT(*) ...;           -- becomes a shared next-key lock (phantom protection)
INSERT INTO playback_session ...;   -- two racers deadlock (1213); the loser retries`,
  PESSIMISTIC: `START TRANSACTION;  -- READ COMMITTED
SELECT ... FROM account WHERE account_id = ? FOR UPDATE;   -- the account row is a mutex
SELECT COUNT(*) ...; INSERT INTO playback_session ...; COMMIT;`,
  OPTIMISTIC: `START TRANSACTION;  -- READ COMMITTED
SELECT state_version FROM account ...; SELECT COUNT(*) ...;
UPDATE account SET state_version = state_version + 1 WHERE account_id = ? AND state_version = ?;  -- compare-and-set
-- 0 rows affected => someone else won: ROLLBACK and retry
INSERT INTO playback_session ...; COMMIT;`,
  CONSTRAINT: `START TRANSACTION;  -- READ COMMITTED
UPDATE playback_session SET status = 'EXPIRED' ... lapsed rows of this account;
INSERT INTO playback_session ...;   -- UNIQUE(active_account_id): a second PLAYING row => error 1062
COMMIT;`,
  TRIGGER: `START TRANSACTION;  -- READ COMMITTED
INSERT INTO playback_session ...;
-- BEFORE INSERT trigger: SELECT COUNT(*) (plain read, cannot see uncommitted rows) >= max_streams => SIGNAL 45000
-- still races: it looks safe but is write skew hidden in the database
COMMIT;`,
  REDIS_LEASE: `-- Redis (one atomic Lua script): SET slot:<account>:<n> <device>:<ts> NX PX <lease>   -- n < max_streams
-- no free slot => rejected. Winner then, in MySQL: START TRANSACTION; INSERT INTO playback_session ...; COMMIT;
-- TAKEOVER steals the oldest slot, then MySQL trims any excess (two stores, eventual preemption)`,
};

export const SCENARIO_FOR: Record<StrategyName, string> = {
  NAIVE: 'RACE_TXN_RR', TXN_RR: 'RACE_TXN_RR', SERIALIZABLE: 'SERIALIZABLE_DEADLOCK',
  PESSIMISTIC: 'PESSIMISTIC_RC', OPTIMISTIC: 'OPTIMISTIC_CAS', CONSTRAINT: 'PESSIMISTIC_RC', TRIGGER: 'RACE_TXN_RR', REDIS_LEASE: 'OPTIMISTIC_CAS',
};

/** "Show the database": the technical side of the run, allowed here because this is the nerd overlay. */
export function DatabaseOverlay({ sim, scenarioId, onClose }: { sim: SimState; scenarioId?: string; onClose: () => void }) {
  const [locks, setLocks] = useState<LockSnapshot | null>(null);
  const [iso, setIso] = useState<Record<string, string>>({});
  useEffect(() => {
    api.get<{ name: string; defaultIsolation: string }[]>('/strategies').then((r) => r.ok && setIso(Object.fromEntries(r.body.map((s) => [s.name, s.defaultIsolation]))));
    let stop = false;
    const tick = async () => { const r = await api.get<LockSnapshot>('/lab/locks'); if (!stop && r.ok) setLocks(r.body); };
    void tick();
    const id = window.setInterval(tick, 1000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { stop = true; window.clearInterval(id); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const cfg = sim.config;
  const k = sim.kpis;
  const isolation = cfg.strategy === 'TXN_RR' ? cfg.isolation : (iso[cfg.strategy] ?? '…');
  const why = scenarioId ?? SCENARIO_FOR[cfg.strategy];
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-label="The database" onClick={(e) => e.stopPropagation()}
        className="surface sheet-side h-full w-full max-w-lg space-y-5 overflow-y-auto border-l border-fg/10 p-5 font-mono text-xs text-stone-700 shadow-2xl">
        <header className="flex items-center justify-between font-sans">
          <h2 className="text-lg font-semibold text-stone-900">The database, right now</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-xl hover:bg-fg/8"><X size={18} /></button>
        </header>
        <div className="grid grid-cols-2 gap-2 font-sans">
          <Stat label="strategy" value={cfg.strategy} />
          <Stat label="isolation" value={isolation} />
          <Stat label="lock waits now" value={locks ? locks.waits.length : '…'} tone={locks && locks.waits.length > 0 ? 'amber' : undefined} hint={locks ? `${locks.locks.length} locks held` : undefined} />
          <Stat label="deadlocks (1213)" value={k?.deadlocks ?? 0} tone={(k?.deadlocks ?? 0) > 0 ? 'red' : undefined} />
          <Stat label="lock timeouts (1205)" value={k?.lockTimeouts ?? 0} />
          <Stat label="claims in flight" value={sim.queueDepth} hint="pool connections busy" />
        </div>
        <div>
          <div className="label-caps mb-1 font-sans">What one press runs</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-fg/[0.06] p-3 leading-relaxed">{SQL[cfg.strategy]}</pre>
        </div>
        <div className="font-sans">
          <div className="label-caps mb-1">Retries so far</div>
          <p className="font-mono">{k?.retries ?? 0} retries · {k?.failed ?? 0} gave up · {k?.moved ?? 0} moves</p>
        </div>
        <Link to={`/nerds?tab=stepper&scenario=${why}`} className="inline-block rounded-xl bg-violet-500/12 px-4 py-2 font-sans text-sm font-semibold text-violet-400 hover:bg-violet-500/20">Why did this happen? →</Link>
      </aside>
    </div>,
    document.body,
  );
}
