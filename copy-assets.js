const fs = require('fs');
const path = require('path');

const staticSrc = path.join(__dirname, '.next', 'static');
const staticDest = path.join(__dirname, '.next', 'standalone', '.next', 'static');
const publicSrc = path.join(__dirname, 'public');
const publicDest = path.join(__dirname, '.next', 'standalone', 'public');

try {
  if (fs.existsSync(staticSrc)) {
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true });
    console.log('✓ Traced static assets successfully.');
  } else {
    console.warn('⚠️ Warning: .next/static not found.');
  }

  if (fs.existsSync(publicSrc)) {
    fs.mkdirSync(path.dirname(publicDest), { recursive: true });
    fs.cpSync(publicSrc, publicDest, { recursive: true });
    console.log('✓ Traced public assets successfully.');
  } else {
    console.warn('⚠️ Warning: public folder not found.');
  }
} catch (err) {
  console.error('❌ Failed to copy build assets:', err.message);
  process.exit(1);
}
