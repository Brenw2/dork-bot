// Card 24 (docs/design/REVIEW.md "Fix 11"): the routine card in the chat, collapsed and expanded, at the
// iPhone and Duo sizes and on the wide desktop window. Measured in the page against the locked numbers.
// The bot here is "newsie" (a name colour, not the comp's #4CC38A), so every tint is computed from its own colour.
const NOTE_BOT = 'newsie';

// The same stamp for the fixture's message and for the "opened from a notification" link.
export const NOTE_AT = new Date(Date.now() - 36e5).toISOString();

export const ROUTINE_SCREENS = [
  { name: 'routine-collapsed', paired: true, extraBots: [NOTE_BOT], path: (p) => (p === 'duo-open-landscape' || p === 'desktop' ? `/?bot=${NOTE_BOT}` : `/chat/${NOTE_BOT}`), waitFor: 'Three stories today.', check: (page, posture) => checkRoutine(page, posture, 'collapsed') },
  { name: 'routine-expanded', paired: true, extraBots: [NOTE_BOT], path: (p) => (p === 'duo-open-landscape' || p === 'desktop' ? `/?bot=${NOTE_BOT}` : `/chat/${NOTE_BOT}`), waitFor: 'Three stories today.', act: (page) => page.getByLabel('Routine daily_digest', { exact: false }).first().click(), check: (page, posture) => checkRoutine(page, posture, 'expanded') },
  // Opened from a notification: the chat opens, the card is expanded and flashing. Run with Reduce Motion on: the colours
  // hold for a full second with no fade (Fix 11), so they can be read exactly; the fade itself is a timing, not a layout.
  { name: 'routine-notified', paired: true, extraBots: [NOTE_BOT], path: (p) => (p === 'duo-open-landscape' || p === 'desktop' ? `/?bot=${NOTE_BOT}&at=${encodeURIComponent(NOTE_AT)}` : `/chat/${NOTE_BOT}?at=${encodeURIComponent(NOTE_AT)}`), waitFor: 'Three stories today.', reducedMotion: true, settle: 100, check: (page, posture) => checkRoutine(page, posture, 'notified') },
  // The same notification tapped again while the chat is open (card collapsed by hand in between): a new `n`, so the
  // route changes, and the card must expand and flash again.
  { name: 'routine-retap', paired: true, extraBots: [NOTE_BOT], path: (p) => (p === 'duo-open-landscape' || p === 'desktop' ? `/?bot=${NOTE_BOT}&at=${encodeURIComponent(NOTE_AT)}&n=1` : `/chat/${NOTE_BOT}?at=${encodeURIComponent(NOTE_AT)}&n=1`), waitFor: 'Three stories today.', reducedMotion: true, settle: 100, act: retap, check: (page, posture) => checkRoutine(page, posture, 'notified') },
];

async function retap(page) {
  const head = page.getByLabel('Routine daily_digest', { exact: false }).first();
  await page.waitForTimeout(1300); // the first flash has finished
  await head.click(); // collapse by hand
  await page.waitForSelector('[aria-expanded=false][aria-label^="Routine daily_digest"]', { timeout: 5000 });
  await page.evaluate(() => {
    const u = new URL(location.href);
    u.searchParams.set('n', '2');
    history.pushState(history.state, '', u.toString());
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  await page.waitForSelector('[aria-expanded=true][aria-label^="Routine daily_digest"]', { timeout: 8000 }); // the same card, expanded again
}

export function checkRoutine(page, posture, state) {
  return page.evaluate(measureRoutine, { state, posture });
}

function measureRoutine({ state, posture }) {
  const problems = [];
  const near = (a, b, tol = 1.2) => Math.abs(a - b) <= tol;
  // The bot's colour (botColor in lib/theme.ts) and mix() over the app background, as the app does them.
  const palette = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
  let h = 0;
  for (const ch of 'newsie') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = palette[h % palette.length];
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (t) => `rgb(${rgb('#0F1012').map((v, i) => Math.round(v + (rgb(c)[i] - v) * t)).join(', ')})`;

  const head = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith('Routine daily_digest'));
  if (!head) return ['the routine card header is missing'];
  const card = head.parentElement;
  const cs = getComputedStyle(card);
  const hr = head.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const column = card.parentElement.parentElement.getBoundingClientRect(); // the transcript column (14 padding each side is inside it)
  const reply = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === 'Any time.');
  const open = head.getAttribute('aria-expanded') === 'true';
  const wantOpen = state !== 'collapsed';

  if (open !== wantOpen) problems.push(`the card should be ${wantOpen ? 'expanded' : 'collapsed'}, aria-expanded is ${head.getAttribute('aria-expanded')}`);
  if (!/^Routine daily_digest, .+/.test(head.getAttribute('aria-label'))) problems.push(`label should be "Routine {name}, {when}", got ${head.getAttribute('aria-label')}`);
  if (cs.borderTopLeftRadius !== '16px') problems.push(`card radius should be 16, got ${cs.borderTopLeftRadius}`);
  if (cs.overflow !== 'hidden') problems.push(`card should clip (overflow hidden), got ${cs.overflow}`);
  // Full width of the transcript column, like a reply (never a bubble, never narrower).
  if (!near(cr.width, column.width, 2)) problems.push(`card should be full width (${column.width.toFixed(1)}), got ${cr.width.toFixed(1)}`);
  // The fill and border while at rest are mix(c, .08) / mix(c, .22); while it flashes mix(c, .22) / mix(c, .60) (the border of the card itself stays the hairline's colour mix until the ring is drawn over it).
  const wantFill = state === 'notified' ? mix(0.22) : mix(0.08);
  if (cs.backgroundColor !== wantFill) problems.push(`card fill should be ${wantFill}, got ${cs.backgroundColor}`);
  const wantBorder = state === 'notified' ? mix(0.6) : mix(0.22);
  if (cs.borderTopColor !== wantBorder) problems.push(`card border should be ${wantBorder}, got ${cs.borderTopColor}`);
  if (parseFloat(cs.borderTopWidth) > 1) problems.push(`card border should be 0.5, got ${cs.borderTopWidth}`);

  // Header row.
  if (hr.height < 44) problems.push(`header must be at least 44 tall, got ${hr.height.toFixed(1)}`);
  const wantHeader = open ? 48 : 58;
  if (!near(hr.height, wantHeader)) problems.push(`${open ? 'expanded' : 'collapsed'} header should be ${wantHeader} tall, got ${hr.height.toFixed(1)}`);
  if (!open && !near(cr.height, 59, 1.5)) problems.push(`collapsed card should be about 59 tall, got ${cr.height.toFixed(1)}`);
  const leaf = (t, within = head) => [...within.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === t);
  const name = leaf('daily_digest');
  if (!name) problems.push('the routine name is missing from the header');
  else {
    const ns = getComputedStyle(name);
    if (ns.fontSize !== '15px' || ns.lineHeight !== '20px' || ns.fontWeight !== '600') problems.push(`name should be 15/20 semibold, got ${ns.fontSize}/${ns.lineHeight} ${ns.fontWeight}`);
    if (ns.color !== 'rgb(236, 237, 239)') problems.push(`name should be #ECEDEF, got ${ns.color}`);
  }
  const when = [...head.querySelectorAll('div')].find((d) => d.children.length === 0 && /^(Today|Yesterday|Tomorrow|[A-Z][a-z]{2} \d)/.test(d.textContent.trim()));
  if (!when) problems.push('the time is missing from the header');
  else {
    const ws = getComputedStyle(when);
    if (ws.fontSize !== '13px' || ws.lineHeight !== '18px') problems.push(`time should be 13/18, got ${ws.fontSize}/${ws.lineHeight}`);
    if (ws.color !== 'rgb(146, 152, 160)') problems.push(`time should be dim #9298A0, got ${ws.color}`);
    if (name && !near(when.getBoundingClientRect().left - name.getBoundingClientRect().right, 8, 1.5)) problems.push('time should sit 8 right of the name');
  }
  const preview = [...head.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.includes('Three stories today.'));
  if (open && preview) problems.push('the preview must be hidden when expanded');
  if (!open) {
    if (!preview) problems.push('the collapsed card needs its one-line preview');
    else {
      const ps = getComputedStyle(preview);
      if (ps.fontSize !== '13px' || ps.lineHeight !== '18px') problems.push(`preview should be 13/18, got ${ps.fontSize}/${ps.lineHeight}`);
      if (!near(preview.getBoundingClientRect().height, 18)) problems.push(`preview should be one line (18), got ${preview.getBoundingClientRect().height}`);
      if (!/^Three stories today\. The Mets won 4-2\./.test(preview.textContent)) problems.push(`preview should be the output with Markdown stripped, got "${preview.textContent}"`);
    }
  }
  // Icon disc and chevron box.
  const svgs = [...head.querySelectorAll('svg')];
  const disc = svgs[0]?.parentElement;
  if (!disc) problems.push('the clock disc is missing');
  else {
    const dr = disc.getBoundingClientRect();
    if (!near(dr.width, 28, 0.6) || !near(dr.height, 28, 0.6)) problems.push(`icon disc should be 28, got ${dr.width}x${dr.height}`);
    if (getComputedStyle(disc).backgroundColor !== mix(0.18)) problems.push(`icon disc should be ${mix(0.18)}, got ${getComputedStyle(disc).backgroundColor}`);
    if (!near(svgs[0].getBoundingClientRect().width, 16, 0.6)) problems.push('clock glyph should be 16');
    if (name && !near(name.getBoundingClientRect().left - dr.right, 10, 1)) problems.push(`name should sit 10 right of the disc, got ${(name.getBoundingClientRect().left - dr.right).toFixed(1)}`);
    if (!near(dr.left - hr.left, 12, 1)) problems.push(`disc should be 12 from the left, got ${(dr.left - hr.left).toFixed(1)}`);
  }
  const chev = svgs[1];
  if (!chev) problems.push('the chevron is missing');
  else {
    const box = chev.parentElement.parentElement.getBoundingClientRect();
    if (!near(box.width, 44, 0.6) || !near(box.height, 44, 0.6)) problems.push(`chevron box should be 44x44, got ${box.width}x${box.height}`);
    if (!near(hr.right - box.right, 4, 1)) problems.push(`chevron box should sit 4 from the right edge, got ${(hr.right - box.right).toFixed(1)}`);
    const cw = chev.getBoundingClientRect();
    const rotated = getComputedStyle(chev.parentElement).transform;
    if (open && rotated === 'none') problems.push('the chevron should point down when expanded');
    if (!open && rotated !== 'none' && rotated !== 'matrix(1, 0, 0, 1, 0, 0)') problems.push(`the chevron should point right when collapsed, got ${rotated}`);
    if (!open && !(near(cw.width, 9, 1) && near(cw.height, 15, 1))) problems.push(`chevron glyph should be 9x15, got ${cw.width}x${cw.height}`);
  }

  // Expanded: divider, then the body in the reply's own type.
  const para = [...card.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'Three stories today.' && !head.contains(d));
  if (open) {
    if (!para) problems.push('the expanded card should show the full output');
    else {
      const ps = getComputedStyle(para);
      const rs = reply ? getComputedStyle(reply) : null;
      if (ps.lineHeight !== '24px') problems.push(`body should have 24 lines, got ${ps.lineHeight}`);
      if (rs && ps.fontSize !== rs.fontSize) problems.push(`body should be the reply's size (${rs.fontSize}), got ${ps.fontSize}`);
      const bodyBox = para.getBoundingClientRect();
      if (!near(bodyBox.left - cr.left, 16.5, 1.5)) problems.push(`body should be 16 in from the left, got ${(bodyBox.left - cr.left).toFixed(1)}`);
      const divider = [...card.querySelectorAll('div')].find((d) => !d.children.length && !d.textContent && getComputedStyle(d).backgroundColor === mix(0.22) && d.getBoundingClientRect().height < 1.5);
      if (!divider) problems.push(`there should be a 0.5 divider in ${mix(0.22)} under the header`);
      else if (!near(divider.getBoundingClientRect().top, hr.bottom, 1.5)) problems.push('the divider should sit right under the header');
      const first = card.querySelector('[dir]');
      void first;
      if (divider && !near(bodyBox.top - divider.getBoundingClientRect().bottom, 12, 3)) problems.push(`body should start 12 under the divider, got ${(bodyBox.top - divider.getBoundingClientRect().bottom).toFixed(1)}`);
    }
    if (!document.body.innerText.includes('Markets are flat.')) problems.push('the whole output should show when expanded');
  } else if (para) problems.push('the collapsed card must not show the body');
  if (document.body.innerText.includes('Routine · daily_digest ·')) problems.push('the old "Routine · name · time" line should be gone');

  // Spacing: 16 above and below (rows around it), and it is its own container, not a bubble.
  const above = cr.top - (card.parentElement.previousElementSibling?.getBoundingClientRect().bottom ?? NaN);
  if (!Number.isNaN(above) && !near(above, 16, 2)) problems.push(`16 above the card, got ${above.toFixed(1)}`);
  const below = (card.parentElement.nextElementSibling?.getBoundingClientRect().top ?? NaN) - cr.bottom;
  if (!Number.isNaN(below) && !near(below, 16, 2)) problems.push(`16 below the card, got ${below.toFixed(1)}`);
  if (cr.right > innerWidth + 0.5 || cr.left < -0.5) problems.push('the card is drawn outside the window');
  void posture;
  return problems;
}
