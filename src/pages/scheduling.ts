import { bootPage, type PageContext } from '../components/shared/boot';
import { h, param, setParam } from '../utils/dom';
import {
  avatar, button, confirmDialog, emptyState, field, iconButton, input, modal, notice, pageHeader, panel, panelWithActions,
  pill, select, toast, withBusy,
} from '../components/shared/ui';
import { ensureService, primaryMinistry, serviceOn, specialTags } from '../components/shared/service-helpers';
import { workflowBar } from '../components/shared/workflow-bar';
import { loadSchedulingContext, remove, save } from '../services/api/store';
import { checkCandidate, hasBlockingConflicts, serviceConflicts, staffing, type Conflict, type SchedulingContext } from '../modules/conflict-detection';
import { autoFill, suggestCandidates } from '../modules/rotations';
import { isLocked } from '../modules/publishing';
import { addDays, formatLong, formatShort, isValidISODate, nextSunday, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import type { Assignment, Ministry, RoleDefinition, Service, Volunteer } from '../types/domain';

void bootPage({ id: 'scheduling', title: 'Ministry scheduling', render: renderPage });

async function renderPage(page: PageContext): Promise<void> {
  const { main, settings, session } = page;
  const ctx = await loadSchedulingContext();
  const activeMinistries = ctx.ministries.filter((m) => m.active);
  const ministry = activeMinistries.find((m) => m.id === param('ministry')) ?? primaryMinistry(ctx.ministries);
  const rawDate = param('date');
  const date = rawDate && isValidISODate(rawDate) ? rawDate : nextSunday(todayISO());
  setParam('date', date);

  const service = serviceOn(ctx.services, ministry.id, date);
  const roles = ctx.roles.filter((r) => r.ministryId === ministry.id && r.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const volById = new Map(ctx.volunteers.map((v) => [v.id, v]));
  const roleById = new Map(ctx.roles.map((r) => [r.id, r]));
  const canEdit = session.can('edit_schedule') && !(service && isLocked(service.status));
  const conflicts = service ? serviceConflicts(ctx, service.id) : [];
  const mine = service ? ctx.assignments.filter((a) => a.serviceId === service.id) : [];

  const go = async (d: string, ministryId = ministry.id) => {
    setParam('date', d);
    setParam('ministry', ministryId === primaryMinistry(ctx.ministries).id ? null : ministryId);
    await page.refresh();
  };

  /* ---------- Assign flow ---------- */
  const assign = async (role: RoleDefinition) => {
    const svc = await ensureService(ctx.services, ministry, date);
    const choice = await chooseCandidate(ctx, svc, role);
    if (!choice) return;
    const a: Assignment = {
      id: uid(), serviceId: svc.id, roleId: role.id, volunteerId: choice.volunteer.id,
      overridden: !!choice.overrideReason, overrideReason: choice.overrideReason ?? '', createdAt: new Date().toISOString(),
    };
    await save('assignments', a, { action: choice.overrideReason ? 'assign-override' : 'assign', details: `${choice.volunteer.name} as ${role.name} on ${date}${choice.overrideReason ? ` (override: ${choice.overrideReason})` : ''}` });
    toast(`${choice.volunteer.name} assigned as ${role.name}.`, 'success');
    await page.refresh();
  };

  const unassign = async (a: Assignment) => {
    const v = volById.get(a.volunteerId);
    await remove('assignments', [a.id], { action: 'unassign', details: `${v?.name ?? a.volunteerId} from ${roleById.get(a.roleId)?.name} on ${date}` });
    toast(`${v?.name ?? 'Volunteer'} removed.`);
    await page.refresh();
  };

  const toggleOverride = async (a: Assignment, list: Conflict[]) => {
    if (a.overridden) {
      await save('assignments', { ...a, overridden: false, overrideReason: '' }, { action: 'override-removed', details: `${volById.get(a.volunteerId)?.name} on ${date}` });
    } else {
      const reason = await overrideReason(list);
      if (!reason) return;
      await save('assignments', { ...a, overridden: true, overrideReason: reason }, { action: 'override', details: `${volById.get(a.volunteerId)?.name} on ${date}: ${reason}` });
    }
    await page.refresh();
  };

  /* ---------- Roster ---------- */
  const rosterRows = roles.map((r) => {
    const assigned = mine.filter((a) => a.roleId === r.id);
    const slots: HTMLElement[] = assigned.map((a) => {
      const v = volById.get(a.volunteerId);
      const cs = conflicts.filter((c) => c.assignmentId === a.id);
      const hasErr = cs.some((c) => c.severity === 'error');
      const cls = a.overridden ? 'is-overridden' : hasErr ? 'has-error' : cs.length ? 'has-warning' : '';
      return h('span', { class: `slot ${cls}`, 'data-testid': 'slot', title: cs.map((c) => c.message).join('\n') || undefined },
        avatar(v?.name ?? '?', a.volunteerId),
        h('span', { class: 'slot-name' }, v?.name ?? 'Removed volunteer'),
        a.overridden ? h('span', { class: 'pill pill-neutral' }, 'Override') : cs.length ? h('span', { class: `pill ${hasErr ? 'pill-negative' : 'pill-warning'}` }, `${cs.length} ${cs.length === 1 ? 'issue' : 'issues'}`) : null,
        canEdit && cs.length ? button(a.overridden ? 'Undo override' : 'Override', { variant: 'ghost', small: true, onClick: () => void toggleOverride(a, cs) }) : null,
        canEdit ? iconButton('x', `Remove ${v?.name ?? 'volunteer'} from ${r.name}`, () => void unassign(a)) : null,
      );
    });
    for (let i = assigned.length; i < r.minCount; i++) {
      slots.push(canEdit
        ? h('button', { type: 'button', class: 'slot-empty', 'data-testid': `assign-${r.id}`, onclick: () => void assign(r) }, '+ Assign')
        : h('span', { class: 'slot-empty', style: 'cursor:default' }, 'Open'));
    }
    if (canEdit && assigned.length >= r.minCount) slots.push(h('button', { type: 'button', class: 'slot-empty', style: 'height:30px', onclick: () => void assign(r), 'aria-label': `Add another ${r.name}` }, '+'));
    return h('div', { class: 'roster-row', 'data-role': r.id },
      h('div', { class: 'roster-role' }, h('div', { style: 'font-weight:500' }, r.name), h('div', { class: 'roster-need' }, `${Math.min(assigned.length, r.minCount)} of ${r.minCount}`)),
      h('div', { class: 'slots' }, ...slots),
    );
  });

  const st = service ? staffing(ctx, service) : { needed: roles.reduce((n, r) => n + r.minCount, 0), filled: 0, missing: roles.reduce((n, r) => n + r.minCount, 0) };

  const suggestBtn = button('Suggest a full team', { icon: 'wand', variant: 'secondary', disabled: !canEdit || st.missing === 0 });
  suggestBtn.addEventListener('click', () => void withBusy(suggestBtn, async () => {
    const svc = await ensureService(ctx.services, ministry, date);
    const proposals = autoFill(ctx, svc.id, uid, new Date().toISOString());
    if (!proposals.length) { toast('No conflict-free volunteers are available for the open roles.', 'error'); return; }
    const ok = await confirmDialog(`Assign ${proposals.length} volunteers?`, proposals.map((p) => `${roleById.get(p.roleId)?.name}: ${volById.get(p.volunteerId)?.name}`).join('\n'), 'Assign all');
    if (!ok) return;
    await save('assignments', proposals, { action: 'auto-fill', details: `${proposals.length} roles on ${date}` });
    toast(`${proposals.length} roles filled by rotation.`, 'success');
    await page.refresh();
  }));

  const clearBtn = button('Clear team', { variant: 'ghost', disabled: !canEdit || !mine.length });
  clearBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('Clear the whole team?', `All ${mine.length} assignments for ${formatLong(date)} are removed.`, 'Clear team', true))) return;
    await remove('assignments', mine.map((a) => a.id), { action: 'clear-team', details: date });
    await page.refresh();
  });

  /* ---------- Conflicts panel ---------- */
  const open = conflicts.filter((c) => !c.overridden);
  const overridden = conflicts.filter((c) => c.overridden);
  const conflictPanel = panel('Conflicts and warnings', !service || !conflicts.length
    ? emptyState(roles.length ? 'No conflicts for this service.' : 'This ministry has no roles yet. Add roles in Settings.')
    : h('ul', { class: 'conflict-list', 'data-testid': 'conflicts' },
      [...open].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)).map((c) => h('li', null,
        h('span', { class: `sev sev-${c.severity}`, 'aria-hidden': 'true' }),
        h('div', { style: 'flex:1' }, h('div', null, c.message), h('div', { style: 'font-size:12px;color:var(--muted)' }, c.severity === 'error' ? 'Blocking' : 'Warning')),
      )),
      overridden.map((c) => {
        const a = mine.find((x) => x.id === c.assignmentId);
        return h('li', null, h('span', { class: 'sev sev-ok', 'aria-hidden': 'true' }), h('div', { style: 'flex:1' }, h('div', { style: 'color:var(--muted)' }, c.message), h('div', { style: 'font-size:12px;color:var(--muted)' }, `Overridden: ${a?.overrideReason ?? ''}`)));
      }),
    ));

  /* ---------- Availability ---------- */
  const away = ctx.availability.filter((a) => a.date === date);
  const awayPanel = panel('Unavailable this day', away.length
    ? h('ul', { class: 'conflict-list' }, away.map((a) => h('li', null, avatar(volById.get(a.volunteerId)?.name ?? '?', a.volunteerId), h('div', null, h('div', null, volById.get(a.volunteerId)?.name ?? 'Unknown'), a.note ? h('div', { style: 'font-size:12px;color:var(--muted)' }, a.note) : null))))
    : emptyState('Nobody has marked this day unavailable.'));

  const dateInput = input({ type: 'date', value: date, 'aria-label': 'Service date', style: 'width:auto' });
  dateInput.addEventListener('change', () => { if (isValidISODate(dateInput.value)) void go(dateInput.value); });
  const ministrySel = activeMinistries.length > 1
    ? select(activeMinistries.map((m) => ({ value: m.id, label: m.name })), ministry.id, { 'aria-label': 'Ministry', style: 'width:auto', onchange: (e: Event) => void go(date, (e.target as HTMLSelectElement).value) })
    : null;

  main.replaceChildren(
    pageHeader('Ministry scheduling', null, [
      ministrySel ?? h('span'),
      iconButton('left', 'Previous week', () => void go(addDays(date, -7))),
      dateInput,
      iconButton('right', 'Next week', () => void go(addDays(date, 7))),
      h('a', { class: 'btn btn-secondary', href: `liturgy.html?date=${date}` }, 'Order of worship'),
    ]),
    h('div', { class: 'stack' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' },
        h('div', { class: 'stack', style: 'gap:4px' },
          h('h2', { class: 'panel-title' }, `${formatLong(date)} · ${ministry.name} · ${service?.startTime ?? ministry.defaultStart}–${service?.endTime ?? ministry.defaultEnd}`),
          h('div', { class: 'slots' }, specialTags(date, settings, ministry, service?.creedOverride ?? null), h('span', { class: 'num', style: 'color:var(--muted)' }, `${st.filled} of ${st.needed} roles filled`), open.some((c) => c.severity === 'error') ? pill(`${open.filter((c) => c.severity === 'error').length} blocking`, 'negative') : null),
        ),
        workflowBar(service, session, () => void page.refresh(), () => (service && hasBlockingConflicts(serviceConflicts(ctx, service.id)) ? ['The team has blocking conflicts.'] : [])),
      )),
      service && isLocked(service.status) ? notice('This service is published; the team is read-only. Unpublish it to make changes.', 'info') : null,
      !session.can('edit_schedule') ? notice('You can view the team. Scheduling needs the planner role.', 'info') : null,
      h('div', { class: 'grid grid-gap xl:grid-cols-[minmax(0,1fr)_360px] items-start' },
        panelWithActions('Team', [suggestBtn, clearBtn], roles.length ? h('div', { 'data-testid': 'roster' }, ...rosterRows) : emptyState('No roles are configured for this ministry.', h('a', { class: 'btn btn-secondary', href: 'settings.html#roles' }, 'Configure roles'))),
        h('div', { class: 'stack' }, conflictPanel, awayPanel, upcomingForMinistry(ctx, ministry, date)),
      ),
    ),
  );
}

function upcomingForMinistry(ctx: SchedulingContext, ministry: Ministry, current: string): HTMLElement {
  const dates = Array.from({ length: 6 }, (_, i) => addDays(nextSunday(todayISO()), i * 7));
  return panel('Next six Sundays', h('ul', { class: 'conflict-list' }, dates.map((d) => {
    const s = serviceOn(ctx.services, ministry.id, d);
    const st = s ? staffing(ctx, s) : null;
    return h('li', null,
      h('a', { href: `scheduling.html?date=${d}`, style: `flex:1;text-decoration:none;${d === current ? 'font-weight:500' : ''}`, 'aria-current': d === current ? 'date' : undefined }, formatShort(d)),
      h('span', { class: 'num', style: st && st.missing === 0 ? 'color:var(--data)' : 'color:var(--muted)' }, st ? `${st.filled}/${st.needed}` : '—'),
    );
  })));
}

function overrideReason(conflicts: Conflict[]): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = modal('Override conflict', { onClose: () => resolve(result) });
    const reason = input({ placeholder: 'e.g. Confirmed with Maria by phone', required: true });
    const err = h('p', { class: 'field-error', hidden: true }, 'A reason is required for the audit log.');
    m.body.append(
      h('ul', { class: 'stack', style: 'gap:4px;padding-left:18px;margin:0' }, conflicts.map((c) => h('li', null, c.message))),
      field('Reason for the override', reason, 'Recorded in the audit history.'), err,
    );
    m.footer.append(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Override', { variant: 'primary', onClick: () => {
      if (!reason.value.trim()) { err.hidden = false; reason.setAttribute('aria-invalid', 'true'); reason.focus(); return; }
      result = reason.value.trim(); m.close();
    } }));
    reason.focus();
  });
}

function chooseCandidate(ctx: SchedulingContext, svc: Service, role: RoleDefinition): Promise<{ volunteer: Volunteer; overrideReason?: string } | null> {
  return new Promise((resolve) => {
    let result: { volunteer: Volunteer; overrideReason?: string } | null = null;
    const m = modal(`Assign ${role.name} · ${formatShort(svc.date)}`, { wide: true, onClose: () => resolve(result) });
    const suggestions = suggestCandidates(ctx, svc.id, role.id, 50);
    const listEl = h('div', { 'data-testid': 'candidates' });
    const q = input({ type: 'search', placeholder: 'Search everyone, including people not eligible for this role', 'aria-label': 'Search volunteers' });

    const pickWith = async (v: Volunteer, cs: Conflict[]) => {
      if (cs.some((c) => c.severity === 'error')) {
        const reason = await overrideReason(cs);
        if (!reason) return;
        result = { volunteer: v, overrideReason: reason };
      } else result = { volunteer: v };
      m.close();
    };

    const row = (v: Volunteer, cs: Conflict[], reason: string, rank?: number) => {
      const err = cs.some((c) => c.severity === 'error');
      return h('div', { class: 'cand' },
        avatar(v.name, v.id),
        h('div', { style: 'min-width:0' },
          h('div', { style: 'font-weight:500' }, v.name, rank === 0 && !err ? h('span', { class: 'pill pill-info', style: 'margin-left:8px' }, 'Next in rotation') : null),
          h('div', { class: 'cand-reason' }, err ? cs.filter((c) => c.severity === 'error').map((c) => c.message).join(' ') : reason),
          !err && cs.length ? h('div', { class: 'cand-reason', style: 'color:var(--warning)' }, cs.map((c) => c.message).join(' ')) : null,
        ),
        button(err ? 'Assign anyway' : 'Assign', { small: true, variant: err ? 'ghost' : 'secondary', onClick: () => void pickWith(v, cs) }),
      );
    };

    const draw = () => {
      const term = q.value.trim().toLowerCase();
      if (term) {
        const found = ctx.volunteers.filter((v) => v.name.toLowerCase().includes(term));
        listEl.replaceChildren(...(found.length ? found.map((v) => row(v, checkCandidate(ctx, svc.id, role.id, v.id), v.roleIds.includes(role.id) ? 'Eligible' : 'Not eligible for this role')) : [emptyState('Nobody matches.')]));
        return;
      }
      if (!suggestions.length) { listEl.replaceChildren(emptyState(`Nobody is eligible for ${role.name} yet. Set role eligibility in the volunteer directory.`, h('a', { class: 'btn btn-secondary', href: 'volunteers.html' }, 'Open volunteers'))); return; }
      listEl.replaceChildren(...suggestions.map((s, i) => row(s.volunteer, s.conflicts, s.reason, i)));
    };
    q.addEventListener('input', draw);
    m.body.append(h('p', { style: 'color:var(--muted)' }, 'Ranked by fair rotation: longest since serving in this role, fewest recent services. People with conflicts are listed last.'), h('div', { class: 'search' }, q), listEl);
    draw();
    q.focus();
  });
}

