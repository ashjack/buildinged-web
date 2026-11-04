const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'firebase.md');
const output = path.join(root, 'src', 'assets', 'firebase-config.json');
const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

try {
  const text = fs.readFileSync(source, 'utf8');
  if (/private_key|BEGIN .*PRIVATE KEY|client_email|service_account/i.test(text)) {
    throw new Error('Server credentials detected. Never put server credentials in browser configuration.');
  }
  const firebase = {};
  for (const key of required) {
    const match = new RegExp(`\\b${key}\\s*:\\s*["']([^"'\\r\\n]+)["']`).exec(text);
    if (!match) throw new Error(`Missing Firebase browser configuration field: ${key}.`);
    firebase[key] = match[1];
  }
  const apiBaseUrl = process.env.BUILDINGED_API_URL ||
    'https://us-central1-buildinged-online.cloudfunctions.net/workspaceApi';
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('BUILDINGED_API_URL must use HTTPS (HTTP is allowed only for local emulators).');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ firebase, apiBaseUrl }, null, 2) + '\n');
  console.log('Generated ignored Firebase browser configuration. No configuration values were logged.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
