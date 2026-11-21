// Card 33: Dynamic Type at the largest standard iOS size (xxxL). The harness is a browser, which has no system text
// size, so `textScaleInit` does what iOS does to a <Text>: it multiplies each text's font size and line height and
// leaves every box height alone. A row with a fixed height then clips, a title with no room overflows, and a button
// that was sized to its label shrinks below 44. Chrome capped at maxScale.chrome (1.3) is scaled by the full 1.353
// here, which is slightly harsher than the phone, so a pass here is a pass there.
//
// The screens are the existing fixtures (bot list, chat, group chat, Usage, ...) run again with `textScale` set, so
// they use the same fake Hermes, rooms socket and usage captures as the unscaled runs.

/** iOS xxxL body text is 23 pt where Large is 17 pt. */
export const XXXL = 23 / 17;

/** Runs in the page before the app: keeps every text's size at `scale` times what the app drew. */
export function textScaleInit({ scale }) {
  const base = new WeakMap();
  const apply = () => {
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const field = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
      if (!own && !field) continue;
      let b = base.get(el);
      if (!b) {
        const cs = getComputedStyle(el);
        b = { size: parseFloat(cs.fontSize), line: /px$/.test(cs.lineHeight) ? parseFloat(cs.lineHeight) : null };
        base.set(el, b);
        el.style.setProperty('font-size', `${b.size * scale}px`, 'important');
        if (b.line !== null) el.style.setProperty('line-height', `${b.line * scale}px`, 'important');
      }
    }
  };
  addEventListener('DOMContentLoaded', () => new MutationObserver(apply).observe(document.body, { childList: true, subtree: true, characterData: true }));
  setInterval(apply, 40);
}

/** In the page: text that is cut off, or a page wider than the screen. `labels` are controls that must stay 44 x 44 or more. */
export function measureType({ labels, minHit }) {
  const problems = [];
  const W = innerWidth;
  const shown = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') return false;
    }
    return true;
  };
  const clamps = (cs) => cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' || cs.textOverflow === 'ellipsis';
  if (document.documentElement.scrollWidth > W + 1) problems.push(`the page is ${document.documentElement.scrollWidth}px wide on a ${W}px screen`);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const lines = []; // every painted line of text, for the overlap check below
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    const el = n.parentElement;
    if (!text || !el || el.closest('noscript') || !shown(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const raw = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!raw.length) continue;
    for (const r of raw) {
      // What is actually painted: cut down by every ancestor that clips (a clamped line's hidden lines drop out here).
      let { left, top, right, bottom } = r;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') [left, right] = [Math.max(left, c.left), Math.min(right, c.right)];
        if (cs.overflowY !== 'visible') [top, bottom] = [Math.max(top, c.top), Math.min(bottom, c.bottom)];
      }
      if (right - left > 0.5 && bottom - top > 0.5 && bottom > 0 && top < innerHeight && right > 0 && left < W) lines.push({ r: { left, top, right, bottom }, el, text });
    }
    // A line that ends in an ellipsis (numberOfLines) is a deliberate cut; anything else must be whole. Text that is
    // only out of view because its list scrolls is not cut off.
    let scrolledX = false;
    let scrolledY = false;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (clamps(cs)) break;
      const scrollsX = /auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1;
      const scrollsY = /auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1;
      const clipX = cs.overflowX !== 'visible' && !scrolledX && !scrollsX;
      const clipY = cs.overflowY !== 'visible' && !scrolledY && !scrollsY;
      scrolledX ||= scrollsX;
      scrolledY ||= scrollsY;
      if (!clipX && !clipY) continue;
      const box = a.getBoundingClientRect();
      const hit = raw.find((r) => (clipX && (r.left < box.left - 1 || r.right > box.right + 1)) || (clipY && (r.top < box.top - 1 || r.bottom > box.bottom + 1)));
      if (hit) {
        problems.push(`"${text.slice(0, 40)}" is cut off by its box (text ${hit.left.toFixed(0)}-${hit.right.toFixed(0)} x ${hit.top.toFixed(0)}-${hit.bottom.toFixed(0)}, box ${box.left.toFixed(0)}-${box.right.toFixed(0)} x ${box.top.toFixed(0)}-${box.bottom.toFixed(0)})`);
        break;
      }
    }
  }
  // Two different texts never share pixels (a row that is too short for its text spills onto the next one).
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > 4) problems.push(`"${a.text.slice(0, 30)}" overlaps "${b.text.slice(0, 30)}" (${w.toFixed(0)} x ${h.toFixed(0)} px)`);
    }
  }
  // A control with a label sits on a box at least minHit high and wide.
  const controls = [...document.querySelectorAll('[aria-label]')].filter(shown);
  for (const want of labels) {
    const el = controls.find((c) => c.getAttribute('aria-label').startsWith(want));
    if (!el) {
      problems.push(`missing control "${want}"`);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width < minHit - 0.5 || r.height < minHit - 0.5) problems.push(`"${want}" is ${r.width.toFixed(1)} x ${r.height.toFixed(1)}, under ${minHit}`);
  }
  return [...new Set(problems)];
}

/**
 * The xxxL runs: existing screens by name, again with the text scaled. Their own `check` and `act` are for the unscaled
 * pixel sizes, so each run gets the generic clipping check instead.
 */
export function typeScreens(screens, wanted) {
  const labels = {
    bots: ['More', 'New bot'],
    chat: ['Back to the bots'],
    'room-chat': ['Back to the bots', 'More for Ops room'],
    usage: ['Back to Bots'],
  };
  return wanted.map((name) => {
    const s = screens.find((x) => x.name === name);
    if (!s) throw new Error(`layout-type: no screen named ${name}`);
    const { check: _check, act: _act, ...rest } = s;
    return {
      ...rest,
      name: `${name}-xxxl`,
      postures: ['iphone', 'duo-closed'],
      textScale: XXXL,
      check: (page) => page.evaluate(measureType, { labels: labels[name] ?? [], minHit: 44 }),
    };
  });
}
