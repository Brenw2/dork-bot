// ---- Design fixes 3, 4 and 5, measured in the page (docs/design/REVIEW.md) ----
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const CARD_RGB = 'rgb(26, 28, 32)';
const fieldWidths = new Map(); // posture -> the message box's width with text in it (Send or Stop must not change it)

// The measure functions run inside the page: they share these helpers through window, installed once per page.
const helpers = () => `window.near = ${near.toString()}; window.CARD_RGB = ${JSON.stringify(CARD_RGB)}; window.stopInsteadOfSend = ${stopInsteadOfSend.toString()};`;
async function run(page, fn, ...args) {
  await page.addScriptTag({ content: helpers() });
  return page.evaluate(fn, ...args);
}
export async function checkComposer(page, posture) {
  const r = await run(page, measureComposer);
  fieldWidths.set(posture, r.width);
  return r.problems;
}
export const checkThinking = (page, posture) => run(page, measureThinking, fieldWidths.get(posture));
export const checkWorking = (page, posture) => run(page, measureWorking, fieldWidths.get(posture));
export const checkWorkingLong = (page) => run(page, measureWorkingLong);
export const checkApproval = (page, posture) => run(page, measureApproval, fieldWidths.get(posture));
export const checkAnswered = (page) => run(page, measureAnswered);

function measureComposer() {
  const problems = [];
  const px = parseFloat;
  const field = document.querySelector('[data-testid=composer-field]');
  const send = document.querySelector('[data-testid=composer-send]');
  const ta = document.querySelector('textarea');
  const plus = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Add a picture');
  if (!field || !send || !ta || !plus) return { width: 0, problems: ['message box parts are missing (field, Send, text, plus)'] };
  const f = field.getBoundingClientRect();
  const s = send.getBoundingClientRect();
  const pl = plus.getBoundingClientRect();
  const fs = getComputedStyle(field);
  const ts = getComputedStyle(ta);
  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  if (!near(f.height, 36)) problems.push(`field should be 36 tall with one line, got ${f.height}`);
  if (px(fs.borderTopLeftRadius) !== 18) problems.push(`field radius should be 18, got ${fs.borderTopLeftRadius}`);
  if (fs.backgroundColor !== 'rgb(26, 28, 32)') problems.push(`field should be #1A1C20, got ${fs.backgroundColor}`);
  if (ts.fontSize !== '17px' || ts.lineHeight !== '22px') problems.push(`message text should be 17/22, got ${ts.fontSize}/${ts.lineHeight}`);
  if (px(ts.paddingLeft) !== 14) problems.push(`text should start 14 in, got ${ts.paddingLeft}`);
  if (!near(pl.width, 36) || !near(pl.height, 36)) problems.push(`plus should be a 36 circle, got ${pl.width}x${pl.height}`);
  if (getComputedStyle(plus).backgroundColor !== 'rgb(26, 28, 32)') problems.push(`plus should be #1A1C20, got ${getComputedStyle(plus).backgroundColor}`);
  if (!near(s.width, 30) || !near(s.height, 30)) problems.push(`Send should be a 30 circle, got ${s.width}x${s.height}`);
  if (!near(f.right - s.right, 3, 1) || !near(f.bottom - s.bottom, 3, 1)) problems.push(`Send should sit 3 in from the field's corner, got right ${(f.right - s.right).toFixed(1)}, bottom ${(f.bottom - s.bottom).toFixed(1)}`);
  if (s.left < f.left || s.top < f.top) problems.push('Send is not inside the field');
  if (!near(f.left - pl.right, 8, 1)) problems.push(`plus to field gap should be 8, got ${(f.left - pl.right).toFixed(1)}`);
  return { width: f.width, problems };
}

// The typing bubble, from the moment a message is sent.
function measureThinking(width) {
  const problems = [];
  const typing = document.querySelector('[aria-label="Typing"]');
  if (!typing) return ['no typing bubble after Send'];
  const row = typing.firstElementChild;
  const [avatar, bubble] = row.children;
  const a = avatar.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const bs = getComputedStyle(bubble);
  if (!near(a.width, 28)) problems.push(`typing avatar should be 28, got ${a.width}`);
  if (!near(b.height, 36)) problems.push(`typing bubble should be 36 tall, got ${b.height}`);
  if (parseFloat(bs.borderTopLeftRadius) !== 18) problems.push(`typing bubble radius should be 18, got ${bs.borderTopLeftRadius}`);
  if (bs.backgroundColor !== CARD_RGB) problems.push(`typing bubble should be #1A1C20, got ${bs.backgroundColor}`);
  if (!near(b.left - a.right, 8, 1)) problems.push(`avatar to bubble gap should be 8, got ${(b.left - a.right).toFixed(1)}`);
  const dots = [...bubble.querySelectorAll('div')].filter((d) => d.children.length === 0 && near(d.getBoundingClientRect().width, 7));
  if (dots.length !== 3 || dots.some((d) => getComputedStyle(d).backgroundColor !== 'rgb(146, 152, 160)')) problems.push(`bubble should hold 3 dim 7 px dots, got ${dots.length}`);
  const body = document.body.innerText;
  if (/is thinking|still working|Still working/.test(body)) problems.push('no elapsed or "thinking" text should show before 10 s');
  problems.push(...stopInsteadOfSend(width));
  return problems;
}

// Stop where Send was, same size and place, and the field keeps its width.
function stopInsteadOfSend(width) {
  const problems = [];
  const stop = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Stop');
  const field = document.querySelector('[data-testid=composer-field]');
  if (!stop) return ['Stop should show while the reply runs'];
  const s = stop.getBoundingClientRect();
  const f = field.getBoundingClientRect();
  if (!near(s.width, 30) || !near(s.height, 30)) problems.push(`Stop should be a 30 circle, got ${s.width}x${s.height}`);
  if (getComputedStyle(stop).backgroundColor !== 'rgb(236, 237, 239)') problems.push(`Stop should be #ECEDEF, got ${getComputedStyle(stop).backgroundColor}`);
  if (!near(f.right - s.right, 3, 1) || !near(f.bottom - s.bottom, 3, 1)) problems.push('Stop should sit where Send does (3 in from the corner)');
  if (width && !near(f.width, width, 1)) problems.push(`the field should keep its width for Stop (${f.width} vs ${width} with Send)`);
  if ([...document.querySelectorAll('[role=button]')].some((e) => e.getAttribute('aria-label') === 'Send')) problems.push('Send should be hidden while the field is empty');
  return problems;
}

// The live step chip: friendly name, 32 tall, a step count; the typing row under it.
function measureWorking(width) {
  const problems = [];
  const chip = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label') || '').startsWith('Trello: read card'));
  if (!chip) return ['live step chip "Trello: read card…" is missing'];
  const c = chip.getBoundingClientRect();
  const cs = getComputedStyle(chip);
  if (chip.getAttribute('aria-label') !== 'Trello: read card… · 3 steps') problems.push(`chip text should be "Trello: read card… · 3 steps", got "${chip.getAttribute('aria-label')}"`);
  if (!near(c.height, 32)) problems.push(`chip should be 32 tall, got ${c.height}`);
  if (parseFloat(cs.borderTopLeftRadius) !== 16) problems.push(`chip radius should be 16, got ${cs.borderTopLeftRadius}`);
  if (cs.backgroundColor !== CARD_RGB) problems.push(`chip should be #1A1C20, got ${cs.backgroundColor}`);
  const label = [...chip.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.includes('Trello'));
  if (label && getComputedStyle(label).fontSize !== '13px') problems.push(`chip text should be 13, got ${getComputedStyle(label).fontSize}`);
  if (/mcp__|web_search|terminal/.test(document.body.innerText.replace(/summarize each card/, ''))) problems.push('raw tool names show outside the step list');
  const typing = document.querySelector('[aria-label="Typing"]');
  if (!typing) problems.push('the typing row should show under the chip');
  else {
    const gap = typing.getBoundingClientRect().top - c.bottom;
    if (Math.abs(gap - 10) > 2) problems.push(`chip to typing row should be 10 apart, got ${gap.toFixed(1)}`);
  }
  if (/Still working/.test(document.body.innerText)) problems.push('"Still working" should not show before 10 s');
  problems.push(...stopInsteadOfSend(width));
  return problems;
}

// After 10 s: "Still working · 48 s" under the typing row, indented past the avatar.
function measureWorkingLong() {
  const problems = [];
  const note = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /^Still working · \d+ s$/.test(d.textContent.trim()));
  if (!note) return [`"Still working · 48 s" is missing (page says: ${document.body.innerText.match(/Still working[^\n]*/)?.[0] ?? 'nothing'})`];
  const secs = Number(note.textContent.match(/(\d+) s/)[1]);
  if (secs < 48 || secs > 60) problems.push(`elapsed should read about 48 s, got ${secs}`);
  const typing = document.querySelector('[aria-label^="Typing"]');
  const [avatar] = typing.firstElementChild.children;
  const n = note.getBoundingClientRect();
  if (!near(n.left - avatar.getBoundingClientRect().left, 36, 1)) problems.push(`elapsed should be indented 36, got ${(n.left - avatar.getBoundingClientRect().left).toFixed(1)}`);
  if (getComputedStyle(note).fontSize !== '13px') problems.push(`elapsed should be 13, got ${getComputedStyle(note).fontSize}`);
  return problems;
}

// The approval card: in the transcript, 44 tall buttons in a 2x2 grid, no "still working" while it waits.
function measureApproval(width) {
  const problems = [];
  const card = document.querySelector('[data-testid=approval-card]');
  if (!card) return ['approval card is missing'];
  const cs = getComputedStyle(card);
  const c = card.getBoundingClientRect();
  if (cs.backgroundColor !== CARD_RGB) problems.push(`card should be #1A1C20, got ${cs.backgroundColor}`);
  if (parseFloat(cs.borderTopLeftRadius) !== 16 || parseFloat(cs.paddingTop) !== 14) problems.push(`card should be radius 16, padding 14, got ${cs.borderTopLeftRadius}/${cs.paddingTop}`);
  if (parseFloat(cs.borderTopWidth) !== 1) problems.push(`card border should be 1, got ${cs.borderTopWidth}`);
  // In the transcript: scrolls with the messages (the same scroller holds your message), never docked.
  const scroller = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowY;
      if (o === 'auto' || o === 'scroll') return a;
    }
    return null;
  };
  const mine = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'clean up my old drafts folder');
  if (!mine || scroller(card) !== scroller(mine)) problems.push('the card should be inside the transcript, with your message');
  for (let a = card; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed' || getComputedStyle(a).position === 'sticky') problems.push('the card should not be docked');
  const title = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'Run this command?');
  if (!title || getComputedStyle(title).fontSize !== '15px' || getComputedStyle(title).lineHeight !== '20px') problems.push('title should be 15/20');
  if (!document.body.innerText.includes('approver needs your OK')) problems.push('"approver needs your OK" is missing');
  if (!document.body.innerText.includes('Hermes flagged it: recursive delete')) problems.push('"Hermes flagged it: recursive delete" is missing');
  const cmd = [...card.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.includes('rm -rf'));
  if (!cmd) problems.push('the command is missing');
  else {
    const block = cmd.closest('[style*="background-color: rgb(11, 12, 14)"]') ?? cmd.parentElement.parentElement;
    if (getComputedStyle(block).backgroundColor !== 'rgb(11, 12, 14)') problems.push(`command block should be #0B0C0E, got ${getComputedStyle(block).backgroundColor}`);
    if (getComputedStyle(cmd).fontSize !== '13px' || getComputedStyle(cmd).lineHeight !== '18px') problems.push('command should be 13/18 mono');
  }
  const btn = (label) => [...card.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === label);
  const [once, session, always, deny] = ['Allow once', 'Allow in this chat', 'Always allow', 'Deny'].map(btn);
  if (!once || !session || !always || !deny) return [...problems, 'the card should offer all four answers Hermes sent'];
  const r = [once, session, always, deny].map((e) => e.getBoundingClientRect());
  const desk = innerWidth >= 1000;
  for (const [i, b] of r.entries()) {
    if (!near(b.height, desk ? 36 : 44)) problems.push(`button ${i + 1} should be ${desk ? 36 : 44} tall, got ${b.height}`);
    if (getComputedStyle([once, session, always, deny][i].querySelector('div')).fontSize !== '15px') problems.push(`button ${i + 1} text should be 15`);
  }
  if (!desk) {
    // Row 1: Allow once, Deny. Row 2: Allow in this chat, Always allow. Equal widths, 8 apart.
    if (!near(r[0].top, r[3].top) || !near(r[1].top, r[2].top)) problems.push('buttons should sit two to a row');
    if (!near(r[0].left, r[1].left) || !near(r[3].left, r[2].left)) problems.push('the grid columns should line up');
    if (!near(r[0].width, r[3].width, 1) || !near(r[1].width, r[2].width, 1) || !near(r[0].width, r[1].width, 1)) problems.push('the four buttons should be the same width');
    if (!near(r[3].left - r[0].right, 8, 1) || !near(r[1].top - r[0].bottom, 8, 1)) problems.push('buttons should be 8 apart');
    if (getComputedStyle(once).borderRadius !== '12px') problems.push(`buttons should be radius 12, got ${getComputedStyle(once).borderRadius}`);
  } else if (!(near(r[0].top, r[3].top) && r[0].left < r[1].left && r[1].left < r[2].left && r[2].left < r[3].left)) problems.push('desktop: one row in the order Allow once, Allow in this chat, Always allow, Deny');
  if (getComputedStyle(deny).borderTopColor !== 'rgb(240, 106, 106)') problems.push('Deny should have a #F06A6A border');
  if (!/^Answers right away\. No answer counts as Deny\.$/m.test(document.body.innerText)) problems.push('footer text is missing');
  if (!/^[45]:\d\d$/m.test(document.body.innerText)) problems.push('the mm:ss countdown is missing');
  if (/Still working|Typing/.test(document.body.innerText) || document.querySelector('[aria-label^="Typing"]')) problems.push('no typing row or "still working" while waiting for an OK');
  problems.push(...stopInsteadOfSend(width));
  if (c.height < 100) problems.push(`card looks too short (${c.height})`);
  return problems;
}

// Answered: the card collapses to "✓ Allowed once · <command>" and the run goes on below it.
function measureAnswered() {
  const problems = [];
  if (document.querySelector('[data-testid=approval-card]')) problems.push('the card should be gone once answered');
  const chip = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'Allowed once · rm -rf ~/notes/old-drafts');
  if (!chip) return [...problems, 'the "Allowed once · rm -rf …" chip is missing'];
  const box = chip.parentElement.getBoundingClientRect();
  if (!near(box.height, 32)) problems.push(`chip should be 32 tall, got ${box.height}`);
  if (!document.querySelector('[aria-label="Typing"]')) problems.push('the run goes on: the typing row should be back under the chip');
  return problems;
}

