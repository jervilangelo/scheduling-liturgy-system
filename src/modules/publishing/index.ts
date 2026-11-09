import type { Permission, ServiceStatus } from '../../types/domain';

/**
 * Review / approval workflow:
 *   draft → in_review → approved → published
 * A reviewer can send a service back to draft; publishing locks it read-only.
 * Unpublishing returns it to draft (and is audited).
 */
export type WorkflowAction = 'submit' | 'return' | 'approve' | 'publish' | 'unpublish';

interface Transition {
  from: ServiceStatus[];
  to: ServiceStatus;
  permission: Permission;
  label: string;
}

export const TRANSITIONS: Record<WorkflowAction, Transition> = {
  submit: { from: ['draft'], to: 'in_review', permission: 'submit_review', label: 'Submit for review' },
  return: { from: ['in_review', 'approved'], to: 'draft', permission: 'approve', label: 'Return to draft' },
  approve: { from: ['in_review'], to: 'approved', permission: 'approve', label: 'Approve' },
  publish: { from: ['approved'], to: 'published', permission: 'publish', label: 'Publish' },
  unpublish: { from: ['published'], to: 'draft', permission: 'publish', label: 'Unpublish' },
};

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
};

export function canTransition(status: ServiceStatus, action: WorkflowAction, has: (p: Permission) => boolean): boolean {
  const t = TRANSITIONS[action];
  return t.from.includes(status) && has(t.permission);
}

export function availableActions(status: ServiceStatus, has: (p: Permission) => boolean): WorkflowAction[] {
  return (Object.keys(TRANSITIONS) as WorkflowAction[]).filter((a) => canTransition(status, a, has));
}

export function nextStatus(status: ServiceStatus, action: WorkflowAction): ServiceStatus {
  const t = TRANSITIONS[action];
  if (!t.from.includes(status)) throw new Error(`Cannot ${action} a service that is ${STATUS_LABEL[status].toLowerCase()}.`);
  return t.to;
}

/** Published services are read-only for everyone; unpublish first to edit. */
export function isLocked(status: ServiceStatus): boolean {
  return status === 'published';
}
