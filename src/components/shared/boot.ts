import '../../styles/app.css';
import type { AppSettings, Permission } from '../../types/domain';
import { currentSession, type Session } from '../../services/authentication/auth';
import { getSettings, list, setActor } from '../../services/api/store';
import { mountShell } from '../navigation/shell';
import { h } from '../../utils/dom';
import { button, emptyState, errorMessage, loading } from './ui';
import { todayISO } from '../../utils/dates';

export interface PageContext {
  main: HTMLElement;
  session: Session;
  settings: AppSettings;
  /** Re-run the page's render (e.g. after a save). */
  refresh: () => Promise<void>;
}

/**
 * Common bootstrap for every physical HTML page:
 * auth guard → permission check → shared shell → page render, with
 * loading and error states.
 */
export async function bootPage(opts: {
  id: string;
  title: string;
  permission?: Permission;
  render: (ctx: PageContext) => Promise<void>;
}): Promise<void> {
  document.title = `${opts.title} · ECCM Planning`;
  const app = document.getElementById('app')!;
  app.replaceChildren(loading());

  let session: Session | null = null;
  try {
    session = await currentSession();
  } catch (e) {
    app.replaceChildren(emptyState(`Could not check your sign-in: ${errorMessage(e)}`));
    return;
  }
  if (!session) {
    const next = location.pathname.split('/').pop() + location.search;
    location.replace(`login.html?next=${encodeURIComponent(next || 'index.html')}`);
    return;
  }
  setActor(session.profile.email);

  let settings: AppSettings;
  let badges: Record<string, number> = {};
  try {
    settings = await getSettings();
    // Queue counts in the nav: services waiting for review.
    const services = await list('services');
    const review = services.filter((s) => s.status === 'in_review' && s.date >= todayISO()).length;
    if (review && session.can('approve')) badges = { liturgy: review };
  } catch (e) {
    app.replaceChildren(emptyState(`Could not load data: ${errorMessage(e)}`, button('Try again', { onClick: () => location.reload() })));
    return;
  }

  const main = mountShell(opts.id, session, settings.churchName, badges);
  const ctx: PageContext = {
    main,
    session,
    settings,
    refresh: async () => {
      try {
        ctx.settings = await getSettings();
        await opts.render(ctx);
      } catch (e) {
        renderError(main, e, ctx.refresh);
      }
    },
  };

  if (opts.permission && !session.can(opts.permission)) {
    main.replaceChildren(emptyState('Your account does not have access to this page. Ask an administrator to change your role.'));
    return;
  }

  main.replaceChildren(loading());
  await ctx.refresh();
}

function renderError(main: HTMLElement, e: unknown, retry: () => Promise<void>) {
  console.error(e);
  main.replaceChildren(
    h('div', { class: 'empty', role: 'alert' },
      h('p', null, `Something went wrong: ${errorMessage(e)}`),
      button('Try again', { onClick: () => void retry() }),
    ),
  );
}
