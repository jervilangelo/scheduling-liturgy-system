import type { Service } from '../../types/domain';
import type { Session } from '../../services/authentication/auth';
import { availableActions, TRANSITIONS, type WorkflowAction } from '../../modules/publishing';
import { runWorkflow } from '../../services/api/workflow';
import { h } from '../../utils/dom';
import { button, confirmDialog, errorMessage, statusPill, toast, withBusy } from './ui';

const CONFIRM: Partial<Record<WorkflowAction, [string, string]>> = {
  publish: ['Publish this service?', 'The plan and team become read-only and appear on the Published page. Song Last Sung dates are updated.'],
  unpublish: ['Unpublish this service?', 'It returns to draft so it can be edited, and is removed from the Published page.'],
  return: ['Return to draft?', 'The planner can edit it again and will need to resubmit it.'],
};

/**
 * Status + review actions for a service, shown on Liturgy, Scheduling and
 * Published. `precheck` returns warnings to confirm before submitting/approving.
 */
export function workflowBar(service: Service | undefined, session: Session, onDone: (s: Service) => void, precheck?: () => string[], beforeAction?: () => Promise<boolean>): HTMLElement {
  const wrap = h('div', { class: 'slots', 'data-testid': 'workflow' }, statusPill(service?.status ?? 'none'));
  if (!service) return wrap;
  for (const action of availableActions(service.status, session.can)) {
    const t = TRANSITIONS[action];
    const variant = action === 'publish' || action === 'approve' || action === 'submit' ? 'primary' : 'secondary';
    const b = button(t.label, { variant, small: true });
    b.dataset.action = action;
    b.addEventListener('click', () => void withBusy(b, async () => {
      if (beforeAction && !(await beforeAction())) return;
      const warnings = (action === 'submit' || action === 'approve' || action === 'publish') && precheck ? precheck() : [];
      if (warnings.length) {
        const ok = await confirmDialog(`${t.label} with ${warnings.length} open ${warnings.length === 1 ? 'issue' : 'issues'}?`, warnings.join('\n'), t.label);
        if (!ok) return;
      } else if (CONFIRM[action]) {
        const [title, msg] = CONFIRM[action]!;
        if (!(await confirmDialog(title, msg, t.label, action === 'unpublish'))) return;
      }
      try {
        const r = await runWorkflow(service, action);
        toast(`${t.label}: done.${r.songsUpdated ? ` Last Sung updated for ${r.songsUpdated} songs.` : ''}`, 'success');
        if (r.sheetMessage) toast(r.sheetMessage, r.sheetMessage.includes('could not') ? 'error' : 'info');
        onDone(r.service);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }));
    wrap.append(b);
  }
  return wrap;
}
