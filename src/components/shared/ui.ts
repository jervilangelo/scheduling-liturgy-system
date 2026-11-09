import { h } from '../../utils/dom';
import { icon, type IconName } from './icons';
import type { ServiceStatus } from '../../types/domain';
import { STATUS_LABEL } from '../../modules/publishing';

/* ---------- Buttons ---------- */

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function button(label: string, opts: { variant?: BtnVariant; icon?: IconName; onClick?: (e: MouseEvent) => void; type?: 'button' | 'submit'; disabled?: boolean; title?: string; small?: boolean; ariaLabel?: string } = {}): HTMLButtonElement {
  const b = h('button', {
    type: opts.type ?? 'button',
    class: `btn btn-${opts.variant ?? 'secondary'}${opts.small ? ' btn-sm' : ''}`,
    disabled: opts.disabled,
    title: opts.title,
    'aria-label': opts.ariaLabel,
  }, opts.icon ? icon(opts.icon) : null, label ? h('span', null, label) : null);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

export function iconButton(name: IconName, label: string, onClick: (e: MouseEvent) => void, disabled = false): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, disabled }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/** Runs an async action with a busy state on the button. */
export async function withBusy(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try { await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}

/* ---------- Status ---------- */

export function statusPill(status: ServiceStatus | 'none'): HTMLElement {
  if (status === 'none') return h('span', { class: 'pill pill-neutral' }, 'Not started');
  const cls: Record<ServiceStatus, string> = { draft: 'pill-neutral', in_review: 'pill-warning', approved: 'pill-info', published: 'pill-positive' };
  return h('span', { class: `pill ${cls[status]}` }, STATUS_LABEL[status]);
}

export function pill(text: string, tone: 'neutral' | 'warning' | 'negative' | 'positive' | 'info' = 'neutral'): HTMLElement {
  return h('span', { class: `pill pill-${tone}` }, text);
}

/* ---------- Toasts ---------- */

let toastHost: HTMLElement | null = null;
export function toast(message: string, tone: 'info' | 'error' | 'success' = 'info'): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast toast-${tone}` }, message);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 200); }, tone === 'error' ? 6000 : 3200);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------- Modal ---------- */

type Appendable = Node | string | null | undefined | false;
/** An element whose append() skips null/false children. */
export type Host = Omit<HTMLElement, 'append'> & HTMLElement & { append(...nodes: Appendable[]): void };

function host(el: HTMLElement): Host {
  const native = el.append.bind(el);
  (el as Host).append = (...nodes: Appendable[]) => native(...nodes.filter((n): n is Node | string => n !== null && n !== undefined && n !== false));
  return el as Host;
}

export interface ModalHandle {
  close: () => void;
  body: Host;
  footer: Host;
  dialog: HTMLDialogElement;
}

export function modal(title: string, opts: { wide?: boolean; onClose?: () => void } = {}): ModalHandle {
  const body = host(h('div', { class: 'modal-body' }));
  const footer = host(h('div', { class: 'modal-footer' }));
  const titleId = `m-${Math.random().toString(36).slice(2)}`;
  const dialog = h('dialog', { class: `modal${opts.wide ? ' modal-wide' : ''}`, 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' },
      h('h2', { id: titleId, class: 'modal-title' }, title),
      iconButton('x', 'Close', () => close()),
    ),
    body,
    footer,
  );
  const close = () => { dialog.close(); };
  dialog.addEventListener('close', () => { dialog.remove(); opts.onClose?.(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { close, body, footer, dialog };
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const m = modal(title, { onClose: () => resolve(result) });
    m.body.append(h('p', { class: 'text-body' }, message));
    m.footer.append(
      button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
      button(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { result = true; m.close(); } }),
    );
  });
}

export function promptDialog(title: string, label: string, initial = '', confirmLabel = 'Save'): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = modal(title, { onClose: () => resolve(result) });
    const input = h('input', { class: 'input', value: initial, id: 'prompt-input' });
    const form = h('form', { onsubmit: (e: Event) => { e.preventDefault(); result = input.value; m.close(); } },
      field(label, input),
    );
    m.body.append(form);
    m.footer.append(
      button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
      button(confirmLabel, { variant: 'primary', onClick: () => { result = input.value; m.close(); } }),
    );
    input.focus();
  });
}

/* ---------- Forms ---------- */

let fieldSeq = 0;
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = control.id || `f-${++fieldSeq}`;
  control.id = id;
  const helpEl = help ? h('p', { class: 'field-help', id: `${id}-help` }, help) : null;
  if (helpEl) control.setAttribute('aria-describedby', helpEl.id);
  return h('div', { class: 'field' }, h('label', { for: id, class: 'field-label' }, label), control, helpEl);
}

export function input(attrs: Record<string, unknown> = {}): HTMLInputElement {
  return h('input', { class: 'input', type: 'text', ...attrs });
}

export function textarea(attrs: Record<string, unknown> = {}, value = ''): HTMLTextAreaElement {
  const t = h('textarea', { class: 'input textarea', ...attrs });
  t.value = value;
  return t;
}

export function select(options: { value: string; label: string }[], value: string, attrs: Record<string, unknown> = {}): HTMLSelectElement {
  return h('select', { class: 'input select', ...attrs }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

export function checkbox(label: string, checked: boolean, onChange?: (v: boolean) => void): HTMLLabelElement {
  const cb = h('input', { type: 'checkbox', class: 'checkbox', checked });
  if (onChange) cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: 'check-row' }, cb, h('span', null, label));
}

/* ---------- Layout bits ---------- */

export function panel(title: string | null, ...children: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'panel' }, title ? h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title)) : null, ...children);
}

export function panelWithActions(title: string, actions: Node[], ...children: (Node | null | false)[]): HTMLElement {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title), h('div', { class: 'panel-actions' }, ...actions)),
    ...children,
  );
}

export function emptyState(message: string, action?: Node): HTMLElement {
  return h('div', { class: 'empty' }, h('p', null, message), action ?? null);
}

export function loading(label = 'Loading'): HTMLElement {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, `${label}…`));
}

export function notice(message: string | Node, tone: 'warning' | 'info' | 'negative' = 'info'): HTMLElement {
  return h('div', { class: `notice notice-${tone}`, role: tone === 'negative' ? 'alert' : undefined }, icon(tone === 'info' ? 'info' : 'alert'), h('div', null, message));
}

export function pageHeader(title: string, subtitle: string | null, actions: Node[] = []): HTMLElement {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-head-text' }, h('h1', { class: 'page-title' }, title), subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
    actions.length ? h('div', { class: 'page-actions' }, ...actions) : null,
  );
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** Stable pale identity tint per person (not data colour). */
export function personTint(id: string): string {
  let hsh = 0;
  for (const c of id) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${(hsh * 137) % 360} 45% 92%)`;
}

export function avatar(name: string, id: string): HTMLElement {
  return h('span', { class: 'avatar', style: `background:${personTint(id)}`, 'aria-hidden': 'true' }, initials(name));
}
