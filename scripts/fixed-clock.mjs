// Opt-in (LAYOUT_FIXED_CLOCK=1): the layout suite's clock stands still at 09:00 today, in Node (fixtures) and in the
// page, so two runs of the same build draw identical screens (time labels, "resets in", routine times). Used for
// strict RGB comparisons between builds (the theme plumbing: Classic must not move a pixel). Off by default.
// It also turns on reduced motion, so the bots' sprites and the card animations hold still.
export const FIXED = process.env.LAYOUT_FIXED_CLOCK === '1';
const base = new Date();
base.setHours(9, 0, 0, 0);
export const T = base.getTime();

if (FIXED) {
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...a) {
      if (a.length === 0) super(T);
      else super(...a);
    }
    static now() {
      return T;
    }
  };
}

/** Page side: Date.now() and new Date() start at T and advance with the page, so labels stay put to the minute. */
export async function fixClock(context) {
  if (!FIXED) return;
  await context.addInitScript((t) => {
    const Real = Date;
    const start = performance.now();
    const now = () => t + Math.round(performance.now() - start);
    globalThis.Date = class extends Real {
      constructor(...a) {
        if (a.length === 0) super(now());
        else super(...a);
      }
      static now() {
        return now();
      }
    };
  }, T);
}
