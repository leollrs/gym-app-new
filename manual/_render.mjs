import pkg from '/Users/leollorens/gym-app-ad/node_modules/playwright/index.js';
const { chromium } = pkg;
import { readFileSync } from 'node:fs';

const DIR = '/Users/leollorens/gym-app-new/manual';
const URL = 'file://' + DIR + '/index.html';
const mode = process.argv[2] || 'shots';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1460, height: 1040 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

async function shot(hash, name){
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForTimeout(550);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/_shot-${name}.png` });
  console.log('shot', name);
}

if (mode === 'shots'){
  await shot('#/', 'cover');
  await shot('#/member/inicio', 'member-inicio');
  await shot('#/member/sesion', 'member-sesion');
  await shot('#/member/recompensas', 'member-recompensas');
  await shot('#/trainer/perfil-cliente', 'trainer-perfil');
  await shot('#/numbers', 'numbers');
  // English check
  await page.evaluate(() => { localStorage.setItem('tugym-manual-lang','en'); });
  await page.reload({ waitUntil:'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await shot('#/member/checkin', 'member-checkin-en');
  await page.evaluate(() => { localStorage.setItem('tugym-manual-lang','es'); });
}

if (mode === 'pdf'){
  const lang = process.argv[3] || 'es';
  // Lay out at true A4 pixel width (210mm @96dpi) so print-doc connectors are
  // measured at the same width page.pdf() renders — otherwise they drift.
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.evaluate(l => { localStorage.setItem('tugym-manual-lang', l); }, lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(500);
  const out = `${DIR}/TuGymPR-Manual-${lang.toUpperCase()}.pdf`;
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  const kb = (readFileSync(out).length/1024).toFixed(0);
  console.log('pdf', out, kb+'KB');
}

await browser.close();
console.log('done');
