// ---- Design fixes 6 and 9, measured in the page (docs/design/REVIEW.md) ----
// Each measure function runs inside the page, so it carries its own helpers.

const evalIn = (page, fn, ...args) => page.evaluate(fn, ...args);
export const checkErrorCard = (page) => evalIn(page, measureErrorCard);
export const checkErrorDetails = (page) => evalIn(page, measureErrorDetails);
export const checkBanner = (page) => evalIn(page, measureBanner);
export const checkNotSent = (page) => evalIn(page, measureNotSent);
export const checkConnectors = (page) => evalIn(page, measureConnectors);
export const checkConnectorDetail = (page) => evalIn(page, measureConnectorDetail);
export const checkLook = (page) => evalIn(page, measureLook);
export const checkNotifications = (page) => evalIn(page, measureNotifications);
export const checkButtons = (page, posture, screen) => evalIn(page, measureButtons, screen);

function measureErrorCard() {
  const problems = [];
  const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
  const card = document.querySelector('[data-testid=failure-card]');
  if (!card) return ['the error card is missing'];
  const cs = getComputedStyle(card);
  const text = document.body.innerText;
  if (cs.backgroundColor !== 'rgb(36, 23, 26)') problems.push(`card should be #24171A, got ${cs.backgroundColor}`);
  if (parseFloat(cs.borderTopLeftRadius) !== 14) problems.push(`card radius should be 14, got ${cs.borderTopLeftRadius}`);
  if (parseFloat(cs.paddingTop) !== 12 || parseFloat(cs.paddingLeft) !== 14) problems.push(`card padding should be 12x14, got ${cs.paddingTop}/${cs.paddingLeft}`);
  if (!/failer hit an error/.test(card.innerText)) problems.push('title should read "failer hit an error"');
  if (!card.innerText.includes('Hermes said: model runner crashed (HTTP 500)')) problems.push(`detail should quote Hermes: ${card.innerText}`);
  const detail = [...card.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.startsWith('Hermes said'));
  if (!detail || getComputedStyle(detail).color !== 'rgb(201, 169, 172)' || getComputedStyle(detail).fontSize !== '13px') problems.push('the "Hermes said" line should be 13 #C9A9AC');
  const btn = (l) => [...card.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === l);
  const again = btn('Try again');
  const details = btn('Details');
  if (!again || !details) return [...problems, 'the card needs Try again and Details'];
  for (const [b, n] of [[again, 'Try again'], [details, 'Details']]) {
    const r = b.getBoundingClientRect();
    if (!near(r.height, 30)) problems.push(`${n} should be a 30 tall small button, got ${r.height}`);
    if (parseFloat(getComputedStyle(b).borderTopLeftRadius) !== 15) problems.push(`${n} radius should be 15`);
  }
  if (getComputedStyle(details).backgroundColor !== 'rgb(34, 37, 42)') problems.push(`Details should be #22252A, got ${getComputedStyle(details).backgroundColor}`);
  if (/HTTP \d{3} \{/.test(text) || text.includes('"error"')) problems.push('raw HTTP text with JSON shows outside Details');
  if (document.querySelector('[data-testid=failure-banner]')) problems.push('a turn failure is a card, not a banner');
  // Under your message, in the transcript.
  const mine = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'what time is sunset');
  if (!mine || mine.getBoundingClientRect().bottom > card.getBoundingClientRect().top) problems.push('the card should sit under your message');
  return problems;
}

function measureErrorDetails() {
  const problems = [];
  const raw = document.querySelector('[data-testid=failure-raw]');
  if (!raw) return ['Details should show the raw error'];
  if (!raw.textContent.includes('HTTP 500') || !raw.textContent.includes('model runner crashed')) problems.push(`Details should hold the raw error, got "${raw.textContent}"`);
  if (![...document.querySelectorAll('[role=button]')].some((e) => e.getAttribute('aria-label') === 'Copy')) problems.push('Details needs a Copy button');
  return problems;
}

function measureBanner() {
  const problems = [];
  const banner = document.querySelector('[data-testid=failure-banner]');
  if (!banner) return ['the "Can\'t reach b-lab" banner is missing'];
  const cs = getComputedStyle(banner);
  if (cs.backgroundColor !== 'rgb(36, 23, 26)') problems.push(`banner should be #24171A, got ${cs.backgroundColor}`);
  if (!/^Can't reach b-lab\. Trying again in [1-5] s\.$/m.test(banner.innerText)) problems.push(`banner text should be "Can't reach b-lab. Trying again in N s.", got "${banner.innerText}"`);
  const btn = [...banner.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Retry now');
  if (!btn) problems.push('banner needs "Retry now"');
  else if (Math.abs(btn.getBoundingClientRect().height - 30) > 0.6) problems.push(`Retry now should be 30 tall, got ${btn.getBoundingClientRect().height}`);
  if (/Error:|Failed to fetch|ERR_/.test(document.body.innerText)) problems.push('a raw network error shows');
  return problems;
}

function measureNotSent() {
  const problems = [];
  const line = document.querySelector('[data-testid=not-sent]');
  if (!line) return ['"Not sent. Tap to retry." is missing'];
  const mine = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.trim() === 'what time is sunset');
  const l = line.getBoundingClientRect();
  if (!mine || l.top < mine.getBoundingClientRect().bottom - 1) problems.push('the line should sit under your bubble');
  if (Math.abs(innerWidth - l.right) > 40 && l.right < innerWidth * 0.5) problems.push('the line should be right-aligned under your bubble');
  const text = [...line.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent.startsWith('Not sent'));
  if (!text || getComputedStyle(text).color !== 'rgb(240, 106, 106)' || getComputedStyle(text).fontSize !== '12px') problems.push('text should be 12 #F06A6A');
  const bang = [...line.querySelectorAll('div')].find((d) => d.children.length === 1 && Math.abs(d.getBoundingClientRect().width - 16) < 0.6);
  if (!bang) problems.push('the line needs a 16 circle with "!"');
  if (document.querySelector('[data-testid=failure-banner]')) problems.push('a message that was not sent is a line under it, not a banner');
  return problems;
}

// Grouped list rows: min 52, container radius 12 on #1A1C20; small buttons 30; Remove is not a row button.
function measureConnectors() {
  const problems = [];
  const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
  const rows = [...document.querySelectorAll('[role=button]')].filter((e) => /tools\. Details|Needs you to sign in\. Details/.test(e.getAttribute('aria-label') || ''));
  if (!rows.length) return ['no Connected rows'];
  for (const r of rows) if (r.getBoundingClientRect().height < 51.5) problems.push(`row "${r.getAttribute('aria-label')}" should be at least 52 tall`);
  const group = rows[0].parentElement.parentElement;
  const gs = getComputedStyle(group);
  if (gs.backgroundColor !== 'rgb(26, 28, 32)' || parseFloat(gs.borderTopLeftRadius) !== 12) problems.push(`the list should be one #1A1C20 container with radius 12, got ${gs.backgroundColor} / ${gs.borderTopLeftRadius}`);
  if (rows.length > 1 && !(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom < 2)) problems.push('rows should sit in one container, not 8-10 apart');
  if ([...document.querySelectorAll('[role=button]')].some((e) => e.getAttribute('aria-label') === 'Remove')) problems.push('Remove is no longer a per-row button');
  const signIn = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Sign in');
  if (!signIn) problems.push('"Sign in" is missing');
  else {
    const r = signIn.getBoundingClientRect();
    if (!near(r.height, 30) || parseFloat(getComputedStyle(signIn).borderTopLeftRadius) !== 15) problems.push(`Sign in should be a 30 tall small button, radius 15, got ${r.height}`);
  }
  for (const b of document.querySelectorAll('[role=button]')) {
    const l = b.getAttribute('aria-label') || '';
    if (/^(Connect|Add) /.test(l) && l !== 'Connect custom connector' && l !== 'Add a picture' && !near(b.getBoundingClientRect().height, 30)) problems.push(`"${l}" should be a 30 tall small button, got ${b.getBoundingClientRect().height}`);
  }
  const custom = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Connect custom connector');
  if (custom && !near(custom.getBoundingClientRect().height, 50)) problems.push(`the custom Connect button should be 50 tall, got ${custom.getBoundingClientRect().height}`);
  const headerOf = (re) => [...document.querySelectorAll('[role=heading], h1, h2, h3, h4, h5, h6, div')].find((d) => re.test(d.textContent.trim()) && d.children.length <= 1 && getComputedStyle(d).fontSize === '13px');
  for (const [label, re] of [['Connected', /^Connected$/i], ['Add a connector', /^Add a connector$/i], ['Custom connector', /^Custom connector$/i]]) {
    const h = headerOf(re);
    if (!h) problems.push(`section header "${label}" should be 13`);
    else if (getComputedStyle(h).textTransform !== 'uppercase') problems.push(`section header "${label}" should be uppercase, got ${getComputedStyle(h).textTransform} on <${h.tagName}>`);
  }
  return problems;
}

function measureConnectorDetail() {
  const problems = [];
  const body = document.body.innerText;
  if (!/Tools · 14/i.test(body)) problems.push('the tools list is missing');
  if (!document.body.innerText.includes('t13')) problems.push('every tool should be listed');
  const remove = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label') || '').startsWith('Remove connector'));
  if (!remove) return [...problems, 'Remove connector… is missing'];
  const t = [...remove.querySelectorAll('div')].find((d) => d.children.length === 0);
  if (getComputedStyle(t).color !== 'rgb(240, 106, 106)') problems.push(`Remove should be #F06A6A, got ${getComputedStyle(t).color}`);
  if (remove.getBoundingClientRect().height < 51.5) problems.push('the Remove row should be at least 52 tall');
  return problems;
}

// Look: Save is in the sheet header (not a 50 tall button), Cancel on the left, Style is a grouped list.
function measureLook() {
  const problems = [];
  const buttons = [...document.querySelectorAll('[role=button]')];
  const save = buttons.find((e) => e.getAttribute('aria-label') === 'Save');
  const cancel = buttons.find((e) => e.getAttribute('aria-label') === 'Cancel');
  if (!save || !cancel) return ['Look needs Cancel and Save in the sheet header'];
  const s = save.getBoundingClientRect();
  const c = cancel.getBoundingClientRect();
  if (s.top > 120 || c.top > 120) problems.push(`Save and Cancel should be in the header, at y ${s.top} / ${c.top}`);
  if (!(c.left < innerWidth / 2 && s.left > innerWidth / 2)) problems.push('Cancel should be on the left and Save on the right');
  if (s.height > 49) problems.push(`Save should be a header text button, not a ${s.height} tall slab`);
  const w = getComputedStyle([...save.querySelectorAll('div')].find((d) => d.children.length === 0)).fontWeight;
  if (Number(w) < 600 && w !== 'bold') problems.push(`Save should be semibold, got ${w}`);
  return problems;
}

function measureNotifications() {
  const problems = [];
  const switches = [...document.querySelectorAll('input[role=switch], [role=switch]')];
  if (!switches.length) return ['no switches'];
  const on = switches.find((s) => s.checked ?? s.getAttribute('aria-checked') === 'true');
  if (!on) return ['a bot switch should be on'];
  // react-native-web draws the track and the thumb as the two divs before the input.
  const box = on.parentElement;
  const [track, thumb] = box.children;
  const tc = getComputedStyle(track).backgroundColor;
  const hc = getComputedStyle(thumb).backgroundColor;
  if (tc !== 'rgb(76, 195, 138)') problems.push(`switch track should be #4CC38A when on, got ${tc}`);
  if (hc !== 'rgb(255, 255, 255)') problems.push(`switch thumb should be white, got ${hc}`);
  const row = [...document.querySelectorAll('div')].find((d) => d.contains(on) && d.getBoundingClientRect().height >= 51.5 && d.getBoundingClientRect().height < 80);
  if (!row) problems.push('switch rows should be at least 52 tall');
  if (document.body.innerText.includes('PER BOT') === false && !/per bot/i.test(document.body.innerText)) problems.push('"Per bot" section header is missing');
  return problems;
}

// Buttons: only 50 (primary and secondary) and 30 (small) exist on the phone.
function measureButtons(screen) {
  const problems = [];
  const want = { new: ['Create bot'], add: ['Add'] }[screen] ?? [];
  for (const l of want) {
    const b = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === l);
    if (!b) problems.push(`"${l}" is missing`);
    else if (Math.abs(b.getBoundingClientRect().height - 50) > 0.6) problems.push(`"${l}" should be a 50 tall primary button, got ${b.getBoundingClientRect().height}`);
  }
  if (screen === 'new') {
    for (const b of document.querySelectorAll('[role=button]')) {
      if (!/^Add /.test(b.getAttribute('aria-label') || '')) continue;
      if (Math.abs(b.getBoundingClientRect().height - 30) > 0.6 && b.getBoundingClientRect().height < 51) problems.push(`"${b.getAttribute('aria-label')}" should be small (30) or a full row`);
    }
  }
  return problems;
}
