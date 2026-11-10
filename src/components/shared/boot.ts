import '../../styles/app.css';
import { h } from '../../utils/dom';
import { mark } from './icons';
import { button, emptyState, errorMessage, loading } from './ui';

export interface PageContext {
  main: HTMLElement;
  /** Re-run the page's render (e.g. after a save). */
  refresh: () => Promise<void>;
}

/** One-page shell: a slim header with the church mark, then the page. */
export async function bootPage(opts: { title: string; render: (ctx: PageContext) => Promise<void> }): Promise<void> {
  document.title = `${opts.title} · ECCM`;
  const app = document.getElementById('app')!;
  const main = h('main', { id: 'main', class: 'canvas', tabindex: '-1' }, loading());
  app.replaceChildren(
    h('a', { href: '#main', class: 'skip-link' }, 'Skip to content'),
    h('header', { class: 'app-head' },
      h('a', { href: './', class: 'brand' },
        mark(28),
        h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'ECCM'), h('span', { class: 'brand-scope' }, 'Liturgy planning')),
      ),
    ),
    main,
  );
  const ctx: PageContext = {
    main,
    refresh: async () => {
      try {
        await opts.render(ctx);
      } catch (e) {
        console.error(e);
        main.replaceChildren(emptyState(`Something went wrong: ${errorMessage(e)}`, button('Try again', { onClick: () => void ctx.refresh() })));
      }
    },
  };
  await ctx.refresh();
}
