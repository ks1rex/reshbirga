/**
 * Generates favicon and app icon assets from logo-source.png.
 * Run from frontend/ directory: node scripts/generate-icons.cjs
 * Requires: sharp, png-to-ico (npm install -D sharp png-to-ico)
 */

const sharp = require('sharp');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const SRC  = path.resolve(__dirname, '../src/assets/logo-source.png');
const DEST = path.resolve(__dirname, '../public');

const PNG_SIZES = [
  { name: 'favicon-16x16.png',          size: 16  },
  { name: 'favicon-32x32.png',          size: 32  },
  { name: 'apple-touch-icon.png',        size: 180 },
  { name: 'android-chrome-192x192.png', size: 192 },
  { name: 'android-chrome-512x512.png', size: 512 },
  { name: 'logo.png',                   size: 256 },
];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(DEST, { recursive: true });

  for (const { name, size } of PNG_SIZES) {
    await sharp(SRC).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(DEST, name));
    console.log(`  ✓ ${name} (${size}×${size})`);
  }

  // ICO: embed 16, 32, 48 px layers
  const icoBuffers = await Promise.all(
    [16, 32, 48].map(size =>
      sharp(SRC).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    )
  );
  const icoData = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(DEST, 'favicon.ico'), icoData);
  console.log('  ✓ favicon.ico (16×16, 32×32, 48×48)');

  console.log('\nAll icons generated successfully.');
}

main().catch(err => { console.error(err); process.exit(1); });
