// Card 30: the "Paste photo" chip above the message box (UI kit K9 chip: 32 tall, radius 16, padding 12, 13/600,
// `border` outline). The web build has no iOS clipboard, so the page sets __DORK_TEST_CLIPBOARD_IMAGE__ and the
// chip shows once the box is focused. Imported by test-layout.mjs.

function measurePasteChip() {
  const problems = [];
  const chip = [...document.querySelectorAll('[role=button]')].find((e) => e.getAttribute('aria-label') === 'Paste photo');
  const field = document.querySelector('[data-testid=composer-field]');
  if (!chip) return ['the Paste photo chip is missing after the box got focus'];
  if (!field) return ['message box is missing'];
  const near = (a, b) => Math.abs(a - b) <= 0.6;
  const c = chip.getBoundingClientRect();
  const f = field.getBoundingClientRect();
  const cs = getComputedStyle(chip);
  const label = chip.querySelector('div,span');
  const ls = getComputedStyle(label ?? chip);
  if (!near(c.height, 32)) problems.push(`chip should be 32 tall, got ${c.height}`);
  if (parseFloat(cs.borderTopLeftRadius) !== 16) problems.push(`chip radius should be 16, got ${cs.borderTopLeftRadius}`);
  if (parseFloat(cs.paddingLeft) !== 12 || parseFloat(cs.paddingRight) !== 12) problems.push(`chip padding should be 12, got ${cs.paddingLeft}/${cs.paddingRight}`);
  if (ls.fontSize !== '13px' || ls.fontWeight !== '600') problems.push(`chip text should be 13/600, got ${ls.fontSize}/${ls.fontWeight}`);
  if (cs.borderTopColor !== 'rgb(42, 45, 51)') problems.push(`chip outline should be #2A2D33, got ${cs.borderTopColor}`);
  if (c.bottom > f.top) problems.push('the chip should sit above the message box');
  if (c.bottom < f.top - 16) problems.push(`chip should be about 8 above the box, got ${(f.top - c.bottom).toFixed(1)}`);
  return problems;
}

export const PASTE_SCREENS = [
  {
    name: 'chat-paste-chip',
    mock: (page) => page.addInitScript(() => { globalThis.__DORK_TEST_CLIPBOARD_IMAGE__ = true; }),
    path: (p) => (p === 'duo-open-landscape' ? '/?bot=assistant' : '/chat/assistant'),
    waitFor: 'Any time.',
    act: async (page) => {
      await page.getByLabel('Message assistant').first().focus();
      await page.getByLabel('Paste photo').first().waitFor({ timeout: 5000 });
    },
    check: (page) => page.evaluate(measurePasteChip),
  },
];
