// What each bot is doing right now, shared across screens: the chat publishes its mood, and the
// bot list (and the open Duo's other pane) shows it. A finished run shows 'done' for a moment.
import type { Mood } from './sprites';

export const DONE_MS = 1800;
const BUSY: Mood[] = ['thinking', 'working', 'talking'];

type Listener = () => void;

export class ActivityStore {
  private moods = new Map<string, Mood>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<Listener>();

  constructor(
    // Wrapped, not passed as is: called as this.cancel(...), a browser's own clearTimeout throws
    // "Illegal invocation" (it must be called on window), which blanked the desktop app.
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
    private readonly cancel: (t: ReturnType<typeof setTimeout>) => void = (t) => clearTimeout(t),
  ) {}

  get(bot: string): Mood {
    return this.moods.get(bot) ?? 'idle';
  }

  set(bot: string, mood: Mood): void {
    const prev = this.get(bot);
    if (mood === 'idle' && BUSY.includes(prev)) mood = 'done';
    if (mood === 'idle' && prev === 'done') return; // let the celebration finish
    if (mood === prev) return;
    const t = this.timers.get(bot);
    if (t) this.cancel(t);
    this.timers.delete(bot);
    this.moods.set(bot, mood);
    if (mood === 'done') {
      this.timers.set(
        bot,
        this.schedule(() => {
          this.timers.delete(bot);
          if (this.get(bot) === 'done') {
            this.moods.set(bot, 'idle');
            this.emit();
          }
        }, DONE_MS),
      );
    }
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const activity = new ActivityStore();
