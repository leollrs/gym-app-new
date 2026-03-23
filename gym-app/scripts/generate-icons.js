import sharp from 'sharp';
import { writeFileSync } from 'fs';

const BG = '#05070B';
const GOLD = '#D4AF37';

// SVG template — dark bg, gold "IF" lettermark, rounded square
const makeSvg = (size) => {
  const radius = size * 0.22;
  const fontSize = size * 0.38;
  const letterSpacing = size * -0.02;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <text
    x="50%" y="54%"
    dominant-baseline="middle"
    text-anchor="middle"
    font-family="'Arial Black', 'Helvetica Neue', sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${letterSpacing}"
    fill="${GOLD}"
  >IF</text>
</svg>`);
};

const sizes = [
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-192.png', size: 192 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  await sharp(makeSvg(size))
    .png()
    .toFile(`public/${name}`);
  console.log(`✓ public/${name}`);
}
