import type { HouseholdInfo } from './types.js';

const FAMILIES = ['Iyer', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Haddad', 'Novak', 'Rossi', 'Kaplan', 'Mendez', 'Oyelaran', 'Petrov', 'Sato', 'Dubois', 'Garcia', 'Nguyen'];
const PEOPLE = ['Meera', 'Arjun', 'Zoe', 'Kenji', 'Amara', 'Luca', 'Noor', 'Mateo', 'Ines', 'Tariq', 'Freya', 'Diego', 'Yuki', 'Sana', 'Omar', 'Hana'];
const KINDS: { name: string; type: string }[] = [
  { name: 'iPhone', type: 'MOBILE' }, { name: 'iPad', type: 'TABLET' }, { name: 'MacBook', type: 'DESKTOP' }, { name: 'Browser', type: 'WEB' },
];

/** Deterministic display names so the same run always reads the same. */
export function buildNames(households: { accountId: number; deviceIds: number[] }[]): HouseholdInfo[] {
  return households.map((h, i) => ({
    id: i,
    name: `The ${FAMILIES[i % FAMILIES.length]} household`,
    devices: h.deviceIds.map((_, d) => {
      const kind = KINDS[d % KINDS.length]!;
      return { id: d, name: `${PEOPLE[(i + d) % PEOPLE.length]}'s ${kind.name}`, type: kind.type };
    }),
  }));
}
