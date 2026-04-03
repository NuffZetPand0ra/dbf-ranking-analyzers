const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const rawFileName = process.env.GOOGLE_SITE_VERIFICATION_FILE;

if (!rawFileName) {
  process.exit(0);
}

const fileName = String(rawFileName).trim();
const isValidName = /^google[a-zA-Z0-9]+\.html$/.test(fileName);
if (!isValidName) {
  console.error(
    'Invalid GOOGLE_SITE_VERIFICATION_FILE. Expected format: google<token>.html'
  );
  process.exit(1);
}

const existing = fs
  .readdirSync(rootDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^google[a-zA-Z0-9]+\.html$/.test(entry.name))
  .map((entry) => entry.name);

for (const name of existing) {
  if (name !== fileName) {
    fs.unlinkSync(path.join(rootDir, name));
  }
}

const targetPath = path.join(rootDir, fileName);
const payload = `google-site-verification: ${fileName}\n`;
fs.writeFileSync(targetPath, payload, 'utf8');
console.log(`Generated ${fileName} for Google site verification.`);
