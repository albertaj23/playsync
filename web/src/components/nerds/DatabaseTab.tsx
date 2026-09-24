import { useEffect, useState } from 'react';
import { api, type Health, type Overview } from '../../lib/api';
import { Badge, Card, Dot, Stat } from '../ui';

export function DatabaseTab() {
  const [health, setHealth] = useState<Health | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Health>('/health'),
      api.get<Overview>('/db/overview')
    ]).then(([h, o]) => {
      if (h.ok) setHealth(h.body);
      else setError(h.body?.error || 'Failed to fetch health');
      
      if (o.ok) setOverview(o.body);
      else setError((err) => err || 'Failed to fetch overview');
    }).catch(e => setError(e.message));
  }, []);

  if (error) return <p className="text-rose-600 text-sm">{error}</p>;
  if (!health || !overview) return <p className="text-stone-500 text-sm">Loading database info...</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="mysql_version" value={health.db?.version || '—'} />
        <Stat label="schema" value={health.db?.name || '—'} />
        <Stat label="default_isolation" value={health.db?.defaultIsolation || '—'} />
        <Stat 
          label="accounts" 
          value={overview.accounts ? `${overview.accounts.demo + overview.accounts.lab + overview.accounts.stepper}` : '0'} 
          hint={overview.accounts ? `${overview.accounts.demo} demo, ${overview.accounts.lab} lab, ${overview.accounts.stepper} stepper` : ''} 
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {overview.tables.map(t => {
          const isPlaybackSession = t.name === 'playback_session';
          const hasConstraint = isPlaybackSession && t.indexes.some(idx => idx.name === 'uq_one_active_per_account');
          
          return (
            <Card key={t.name} title={<span className="font-mono">{t.name}</span>} subtitle={`${t.rows} rows`} padded>
              <div className="space-y-4">
                {t.indexes.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-stone-500 mb-2">Indexes</h4>
                    <div className="flex flex-wrap gap-2">
                      {t.indexes.map(idx => {
                        let tone: 'violet' | 'sky' | 'stone' = 'stone';
                        let label = idx.name;
                        
                        if (idx.name === 'PRIMARY') {
                          tone = 'violet';
                          label = `PK(${idx.columns})`;
                        } else if (idx.unique) {
                          tone = 'sky';
                        }
                        
                        return (
                          <span key={idx.name} title={idx.columns} className="cursor-help">
                            <Badge tone={tone}>
                              {label}
                            </Badge>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {t.foreignKeys.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-stone-500 mb-2">Foreign Keys</h4>
                    <ul className="text-xs font-mono text-stone-600 space-y-1">
                      {t.foreignKeys.map(fk => (
                        <li key={fk.name}>
                          FK ({fk.columns}) → {fk.refTable}({fk.refColumns})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isPlaybackSession && (
                  <div className="mt-4 p-3 bg-stone-50 rounded-lg text-xs text-stone-600 flex items-start gap-2 border border-stone-100">
                    <div className="mt-0.5"><Dot tone={hasConstraint ? 'green' : 'stone'} /></div>
                    <div>
                      <span className="font-mono text-[11px]">uq_one_active_per_account</span> exists only while the CONSTRAINT strategy is in use.
                      {hasConstraint ? ' It is currently present.' : ' It is not present.'}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
