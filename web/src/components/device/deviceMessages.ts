import type { DeviceMessage } from '../../lib/useDeviceSession';

export interface MessageView {
  tone: 'info' | 'warn' | 'bad' | 'good';
  title: string;
  body?: string;
}

const list = (names: string[]) =>
  names.length <= 1 ? names[0] ?? 'another device' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Turns a device message into friendly words a non-technical user understands. */
export function describeMessage(m: DeviceMessage): MessageView {
  switch (m.kind) {
    case 'ask':
      return {
        tone: 'info',
        title: `${list(m.holders)} is already playing music.`,
        body: `Want it here instead? ${list(m.holders)} will pause its turn.`,
      };
    case 'busy':
      return {
        tone: 'warn',
        title: `Hold on, ${list(m.holders)} is using your account right now.`,
        body: 'Stop it there first, or let more devices play in Settings.',
      };
    case 'moved':
      return {
        tone: 'info',
        title: m.to ? `Your music hopped over to ${m.to} 🎧` : 'Your music hopped to another device 🎧',
        body: m.whileOffline ? 'That happened while this device was offline.' : undefined,
      };
    case 'timedOut':
      return {
        tone: 'warn',
        title: 'We lost touch, so we let this spot go.',
        body: m.whileOffline
          ? 'This device was offline for a while. Tap Play to grab it back.'
          : 'This device stopped checking in. Tap Play to grab it back.',
      };
    case 'endedElsewhere':
      return { tone: 'info', title: 'Someone stopped the music from another screen.' };
    case 'finished':
      return { tone: 'good', title: 'That was a good one! 🎶 Song finished.' };
    case 'error':
      return { tone: 'bad', title: 'Oops, something went wrong.', body: m.text };
  }
}
