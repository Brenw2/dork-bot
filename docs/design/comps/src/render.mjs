#!/usr/bin/env node
// Renders every comp in index.html to docs/design/comps/<id>.png.
//   node docs/design/comps/src/render.mjs [id-prefix]
// iPhone comps render at @2x (786x1704 px for 393x852 pt), desktop and Duo at @1x.
// Needs playwright-core (a devDependency) and Chromium (CHROMIUM_PATH or /usr/bin/chromium).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const SRC = resolve(import.meta.dirname);
const OUT = resolve(SRC, '..');
const only = process.argv[2];
const exe = process.env.CHROMIUM_PATH ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
for (const scale of [2, 1]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(join(SRC, 'index.html')).href);
  await page.waitForSelector('section.frame');
  const ids = await page.$$eval('section.frame', (els) => els.map((e) => ({ id: e.id, iphone: e.classList.contains('iphone') })));
  for (const { id, iphone } of ids) {
    if (iphone !== (scale === 2) || (only && !id.startsWith(only))) continue;
    await page.locator(`[id="${id}"]`).screenshot({ path: join(OUT, `${id}.png`) });
    console.log(`${id}.png`);
  }
  await page.close();
}
await browser.close();
