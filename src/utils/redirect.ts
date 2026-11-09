/** Only same-site page names are accepted as the post-login destination (prevents open redirects). */
export function safeNext(raw: string | null): string {
  if (!raw) return 'index.html';
  return /^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(raw) && !raw.startsWith('login.html') ? raw : 'index.html';
}
