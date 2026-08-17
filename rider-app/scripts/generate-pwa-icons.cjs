// One-off script — generates the rider-app's PWA icon set from public/logo.png.
// Not part of the build; run manually with `node scripts/generate-pwa-icons.cjs`
// whenever the source logo changes.
const path = require('path');
const sharp = require('sharp');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SOURCE = path.join(PUBLIC_DIR, 'logo.png');
const THEME_PURPLE = '#6D28D9';

async function main() {
  const out = (name) => path.join(PUBLIC_DIR, name);

  // Plain icons — logo as-is (already square with transparent padding),
  // upscaled with high-quality resampling for the 512 size.
  await sharp(SOURCE).resize(192, 192, { kernel: 'lanczos3' }).png().toFile(out('icon-192.png'));
  await sharp(SOURCE).resize(512, 512, { kernel: 'lanczos3' }).png().toFile(out('icon-512.png'));

  // Maskable icons — OS applies its own mask shape (circle/squircle), so
  // content must sit inside the ~80% safe zone on an opaque background,
  // not transparent, or the mask leaves visible gaps.
  async function maskable(size, filename) {
    const logoSize = Math.round(size * 0.7);
    const logo = await sharp(SOURCE).resize(logoSize, logoSize, { kernel: 'lanczos3' }).png().toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 4, background: THEME_PURPLE },
    })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(out(filename));
  }
  await maskable(192, 'maskable-icon-192.png');
  await maskable(512, 'maskable-icon-512.png');

  // Apple touch icon — iOS flattens alpha on homescreen tiles, so give it
  // an opaque white background rather than transparency.
  const appleLogo = await sharp(SOURCE).resize(150, 150, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: '#FFFFFF' } })
    .composite([{ input: appleLogo, gravity: 'center' }])
    .png()
    .toFile(out('apple-touch-icon.png'));

  // Favicon
  await sharp(SOURCE).resize(32, 32, { kernel: 'lanczos3' }).png().toFile(out('favicon-32.png'));
  await sharp(SOURCE).resize(16, 16, { kernel: 'lanczos3' }).png().toFile(out('favicon-16.png'));

  console.log('PWA icons generated in', PUBLIC_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
