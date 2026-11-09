// Fails the build if anything privileged ended up in the compiled frontend.
// The Supabase anon key is public by design and allowed; a service_role key is not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist';
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(root);

const patterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/GOOGLE_SERVICE_ACCOUNT_JSON\s*[:=]/, 'Google service account'],
  [/"type"\s*:\s*"service_account"/, 'Google service account JSON'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]/, 'service role key variable'],
];

const problems = [];
for (const f of files.filter((x) => /\.(js|html|css|json|map|txt)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of patterns) if (re.test(text)) problems.push(`${f}: ${label}`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role && payload.role !== 'anon') problems.push(`${f}: JWT with role "${payload.role}"`);
    } catch { /* not a JWT */ }
  }
}

if (problems.length) {
  console.error('Privileged secrets found in the build:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`No privileged secrets in ${files.length} built files.`);
