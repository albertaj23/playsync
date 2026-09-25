import type { Lane } from '../../components/RaceTrack';
import type { Method } from './methods';

export type DotKind = 'ok' | 'over' | 'busy' | 'err' | 'lost';

export interface ResultView {
  ok: boolean; title: string; body: string; dots: DotKind[];
  legend: { kind: DotKind; label: string }[]; footer: string; batchId: string; methodLabel: string;
}

/** What the generic story needs from either experiment, so one component renders both. */
export interface Experiment {
  kind: 'stream' | 'count';
  amount: number; setAmount: (n: number) => void; amountLabel: string;
  limit?: number; setLimit?: (n: number) => void;
  delay?: { value: number; set: (n: number) => void; accounts: number; setAccounts: (n: number) => void };
  methods: Method[]; method: string; setMethod: (m: string) => void; methodBlocked: string | null;
  running: string | null; comparing: boolean; error: string | null;
  result: ResultView | null; lanes: Lane[]; comparisonBatch: string | undefined; hasComparison: boolean;
  /** Both resolve true when a result arrived. */
  run: () => Promise<boolean>; compareAll: () => Promise<boolean>;
}
