import type { DeviceMessage } from '../../lib/useDeviceSession';

export interface MessageView {
  tone: 'info' | 'warn' | 'bad' | 'good';
  title: string;
  body?: string;
}

const list = (names: string[]) =>
  names.length <= 1 ? names[0] ?? 'another device' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Turns a device message into words a non-technical user understands. */
export function describeMessage(m: DeviceMessage): MessageView {
  switch (m.kind) {
    case 'ask':
      return {
        tone: 'info',
        title: `Music is playing on ${list(m.holders)}.`,
        body: `Play here instead? ${list(m.holders)} will stop.`,
      };
    case 'busy':
      return {
        tone: 'warn',
        title: `${list(m.holders)} is using your account right now.`,
        body: 'Stop it there first, or allow more devices in Settings.',
      };
    case 'moved':
      return {
        tone: 'bad',
        title: m.to ? `Playback moved to ${m.to}.` : 'Playback moved to another device.',
        body: m.whileOffline ? 'That happened while this device was offline.' : undefined,
      };
    case 'timedOut':
      return {
        tone: 'bad',
        title: 'Playback stopped.',
        body: m.whileOffline
          ? 'This device was offline for too long, so the account let the stream go.'
          : 'This device stopped checking in, so the account let the stream go.',
      };
    case 'endedElsewhere':
      return { tone: 'bad', title: 'Playback was stopped from another screen.' };
    case 'finished':
      return { tone: 'good', title: 'Song finished.' };
    case 'error':
      return { tone: 'bad', title: 'Something went wrong.', body: m.text };
  }
}
