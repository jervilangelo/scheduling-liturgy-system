import '../styles/app.css';
import { h } from '../utils/dom';
import { mark } from '../components/shared/icons';
import { avatar, button, errorMessage, field, input, notice, withBusy } from '../components/shared/ui';
import { currentSession, sendSignInLink, signInDemo, signInWithPassword } from '../services/authentication/auth';
import { isSupabaseConfigured } from '../services/supabase/client';
import { list } from '../services/api/store';
import { ROLE_LABEL } from '../modules/permissions';
import { safeNext } from '../utils/redirect';

async function main() {
  document.title = 'Sign in · ECCM Planning';
  const app = document.getElementById('app')!;
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  try {
    if (await currentSession()) { location.replace(next); return; }
  } catch { /* show form */ }

  const card = h('div', { class: 'login-card' });
  const side = h('div', { class: 'login-side' },
    h('div', { class: 'brand', style: 'padding:0' }, mark(32), h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'ECCM'), h('span', { class: 'brand-scope' }, 'Liturgy and ministry planning'))),
    h('div', { class: 'stack', style: 'max-width:46ch' },
      h('p', { style: 'font-size:20px;line-height:1.35' }, 'Plan each Sunday’s order of worship and the team that serves it.'),
      h('p', { style: 'color:var(--muted)' }, 'Communion on the first Sunday, CPP on the second and the creed on the last are added for you, so planners start from the right order.'),
    ),
    h('p', { style: 'color:var(--muted);font-size:12px' }, isSupabaseConfigured ? 'Signed-in sessions are kept on this device until you sign out.' : 'Demo mode: no backend is configured, so data stays in this browser.'),
  );
  app.className = '';
  app.replaceChildren(h('div', { class: 'login' }, side, h('main', { class: 'login-main' }, card)));

  const err = h('div', { 'aria-live': 'assertive' });

  if (isSupabaseConfigured) {
    const email = input({ type: 'email', autocomplete: 'username', required: true, name: 'email' });
    const password = input({ type: 'password', autocomplete: 'current-password', required: true, name: 'password' });
    const submit = button('Sign in', { variant: 'primary', type: 'submit' });
    const form = h('form', { class: 'stack', style: 'gap:16px' }, field('Email', email), field('Password', password), err, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.replaceChildren();
      void withBusy(submit, async () => {
        try {
          await signInWithPassword(email.value.trim(), password.value);
          location.replace(next);
        } catch (ex) {
          err.replaceChildren(notice(`Sign-in failed: ${errorMessage(ex)}`, 'negative'));
        }
      });
    });
    const linkBtn = button('Email me a sign-in link', { variant: 'ghost' });
    linkBtn.addEventListener('click', () => void withBusy(linkBtn, async () => {
      err.replaceChildren();
      if (!email.value.trim()) { err.replaceChildren(notice('Enter your email first.', 'warning')); email.focus(); return; }
      try {
        await sendSignInLink(email.value.trim(), new URL(next, location.href).href);
        err.replaceChildren(notice('Check your inbox for a sign-in link.', 'info'));
      } catch (ex) {
        err.replaceChildren(notice(errorMessage(ex), 'negative'));
      }
    }));
    card.append(h('h1', { class: 'page-title' }, 'Sign in'), h('p', { class: 'page-sub' }, 'Use the account your church administrator created for you.'), form, linkBtn);
  } else {
    const profiles = await list('profiles');
    card.append(
      h('h1', { class: 'page-title' }, 'Sign in'),
      h('p', { class: 'page-sub' }, 'Choose a sample account. Each one shows what that role can do.'),
      h('div', { class: 'demo-accounts' }, profiles.map((p) =>
        h('button', {
          type: 'button', class: 'demo-account', 'data-testid': `demo-${p.role}`,
          onclick: () => { signInDemo(p.id); location.replace(next); },
        }, avatar(p.displayName, p.id), h('span', { class: 'user-meta' }, h('span', { class: 'user-name' }, p.displayName), h('span', { class: 'user-role' }, `${ROLE_LABEL[p.role]} · ${p.email}`))),
      )),
      notice('Demo accounts need no password and are not secure. Configure Supabase for real sign-in.', 'info'),
    );
  }
}

void main();
