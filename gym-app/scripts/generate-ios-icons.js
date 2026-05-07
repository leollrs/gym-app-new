#!/usr/bin/env node
/**
 * Generates the full iOS App Icon set from a single 1024x1024 master PNG
 * using macOS `sips` (no extra deps). Also generates the watchOS icon set.
 *
 * Usage:
 *   node scripts/generate-ios-icons.js
 *
 * Master sources:
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png        (1024x1024)
 *   ios/App/TuGymPR Watch App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png  (1024x1024)
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------- iOS ----------
const iosIconDir = resolve(
  repoRoot,
  'ios/App/App/Assets.xcassets/AppIcon.appiconset'
);
const iosMaster = resolve(iosIconDir, 'AppIcon-512@2x.png');

// idiom, size in points, scale, pixel size, filename
const iosIcons = [
  { idiom: 'iphone', size: '20x20', scale: '2x', px: 40, file: 'AppIcon-20@2x.png' },
  { idiom: 'iphone', size: '20x20', scale: '3x', px: 60, file: 'AppIcon-20@3x.png' },
  { idiom: 'iphone', size: '29x29', scale: '2x', px: 58, file: 'AppIcon-29@2x.png' },
  { idiom: 'iphone', size: '29x29', scale: '3x', px: 87, file: 'AppIcon-29@3x.png' },
  { idiom: 'iphone', size: '40x40', scale: '2x', px: 80, file: 'AppIcon-40@2x.png' },
  { idiom: 'iphone', size: '40x40', scale: '3x', px: 120, file: 'AppIcon-40@3x.png' },
  { idiom: 'iphone', size: '60x60', scale: '2x', px: 120, file: 'AppIcon-60@2x.png' },
  { idiom: 'iphone', size: '60x60', scale: '3x', px: 180, file: 'AppIcon-60@3x.png' },
  { idiom: 'ipad', size: '20x20', scale: '1x', px: 20, file: 'AppIcon-20.png' },
  { idiom: 'ipad', size: '20x20', scale: '2x', px: 40, file: 'AppIcon-20@2x~ipad.png' },
  { idiom: 'ipad', size: '29x29', scale: '1x', px: 29, file: 'AppIcon-29.png' },
  { idiom: 'ipad', size: '29x29', scale: '2x', px: 58, file: 'AppIcon-29@2x~ipad.png' },
  { idiom: 'ipad', size: '40x40', scale: '1x', px: 40, file: 'AppIcon-40.png' },
  { idiom: 'ipad', size: '40x40', scale: '2x', px: 80, file: 'AppIcon-40@2x~ipad.png' },
  { idiom: 'ipad', size: '76x76', scale: '1x', px: 76, file: 'AppIcon-76.png' },
  { idiom: 'ipad', size: '76x76', scale: '2x', px: 152, file: 'AppIcon-76@2x.png' },
  { idiom: 'ipad', size: '83.5x83.5', scale: '2x', px: 167, file: 'AppIcon-83.5@2x.png' },
  { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', px: 1024, file: 'AppIcon-1024.png' },
];

// ---------- watchOS ----------
const watchIconDir = resolve(
  repoRoot,
  'ios/App/TuGymPR Watch App/Assets.xcassets/AppIcon.appiconset'
);
const watchMaster = resolve(watchIconDir, 'AppIcon-1024.png');

// Apple's current single-size watchOS icon set (universal idiom)
// Plus the legacy named sizes for older watchOS targets compatibility.
// We use "universal" with size 1024x1024 — the simplest, fully App-Store-acceptable form.
const watchIcons = [
  // Notification Center
  { px: 48, file: 'AppIcon-24@2x.png', role: 'notificationCenter', subtype: '38mm', size: '24x24', scale: '2x' },
  { px: 55, file: 'AppIcon-27.5@2x.png', role: 'notificationCenter', subtype: '42mm', size: '27.5x27.5', scale: '2x' },
  // Companion Settings
  { px: 58, file: 'AppIcon-29.png', role: 'companionSettings', size: '29x29', scale: '2x' },
  { px: 87, file: 'AppIcon-29@3x.png', role: 'companionSettings', size: '29x29', scale: '3x' },
  // Home Screen
  { px: 80, file: 'AppIcon-40@2x.png', role: 'appLauncher', subtype: '38mm', size: '40x40', scale: '2x' },
  { px: 88, file: 'AppIcon-44@2x.png', role: 'appLauncher', subtype: '40mm', size: '44x44', scale: '2x' },
  { px: 92, file: 'AppIcon-46@2x.png', role: 'appLauncher', subtype: '41mm', size: '46x46', scale: '2x' },
  { px: 100, file: 'AppIcon-50@2x.png', role: 'appLauncher', subtype: '44mm', size: '50x50', scale: '2x' },
  { px: 102, file: 'AppIcon-51@2x.png', role: 'appLauncher', subtype: '45mm', size: '51x51', scale: '2x' },
  { px: 108, file: 'AppIcon-54@2x.png', role: 'appLauncher', subtype: '49mm', size: '54x54', scale: '2x' },
  // Long Look notifications
  { px: 172, file: 'AppIcon-86@2x.png', role: 'quickLook', subtype: '38mm', size: '86x86', scale: '2x' },
  { px: 196, file: 'AppIcon-98@2x.png', role: 'quickLook', subtype: '42mm', size: '98x98', scale: '2x' },
  { px: 216, file: 'AppIcon-108@2x.png', role: 'quickLook', subtype: '44mm', size: '108x108', scale: '2x' },
  { px: 234, file: 'AppIcon-117@2x.png', role: 'quickLook', subtype: '45mm', size: '117x117', scale: '2x' },
  { px: 258, file: 'AppIcon-129@2x.png', role: 'quickLook', subtype: '49mm', size: '129x129', scale: '2x' },
  // Marketing
  { px: 1024, file: 'AppIcon-1024.png', idiom: 'watch-marketing', size: '1024x1024', scale: '1x' },
];

function ensureMaster(path) {
  if (!existsSync(path)) {
    console.error(`Master icon missing: ${path}`);
    process.exit(1);
  }
  // Verify dimensions
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], {
    encoding: 'utf8',
  });
  const m = out.match(/pixelWidth:\s*(\d+)\s+pixelHeight:\s*(\d+)/);
  if (!m || m[1] !== '1024' || m[2] !== '1024') {
    console.error(`Master must be 1024x1024 (got ${out.trim()})`);
    process.exit(1);
  }
}

function resize(master, outPath, px) {
  mkdirSync(dirname(outPath), { recursive: true });
  // Use --resampleHeightWidth for an exact square output
  execFileSync('sips', [
    '-s', 'format', 'png',
    '-z', String(px), String(px),
    master,
    '--out', outPath,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// ---------- iOS run ----------
console.log('Generating iOS app icons...');
ensureMaster(iosMaster);

for (const icon of iosIcons) {
  const out = resolve(iosIconDir, icon.file);
  resize(iosMaster, out, icon.px);
  console.log(`  ${icon.file}  ${icon.px}x${icon.px}`);
}

const iosContents = {
  images: iosIcons.map((i) => ({
    filename: i.file,
    idiom: i.idiom,
    scale: i.scale,
    size: i.size,
  })),
  info: { author: 'xcode', version: 1 },
};
writeFileSync(
  resolve(iosIconDir, 'Contents.json'),
  JSON.stringify(iosContents, null, 2) + '\n'
);
console.log(`  Contents.json (${iosIcons.length} entries)`);

// ---------- watchOS run ----------
console.log('\nGenerating watchOS app icons...');
ensureMaster(watchMaster);

for (const icon of watchIcons) {
  const out = resolve(watchIconDir, icon.file);
  resize(watchMaster, out, icon.px);
  console.log(`  ${icon.file}  ${icon.px}x${icon.px}`);
}

const watchContents = {
  images: watchIcons.map((i) => {
    const entry = {
      filename: i.file,
      idiom: i.idiom || 'watch',
      scale: i.scale,
      size: i.size,
    };
    if (i.role) entry.role = i.role;
    if (i.subtype) entry.subtype = i.subtype;
    return entry;
  }),
  info: { author: 'xcode', version: 1 },
};
writeFileSync(
  resolve(watchIconDir, 'Contents.json'),
  JSON.stringify(watchContents, null, 2) + '\n'
);
console.log(`  Contents.json (${watchIcons.length} entries)`);

console.log('\nDone.');
