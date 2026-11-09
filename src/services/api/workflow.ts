import type { Service } from '../../types/domain';
import { nextStatus, STATUS_LABEL, type WorkflowAction } from '../../modules/publishing';
import { computeLastSungUpdates } from '../../modules/song-library';
import { getActor, list, save } from './store';
import { pushLastSung, sheetsAvailable } from './sheets';
import { todayISO } from '../../utils/dates';

export interface WorkflowResult {
  service: Service;
  songsUpdated: number;
  sheetMessage: string | null;
}

/**
 * Applies a review/publish transition and its side effects:
 * publishing stamps the approver, then moves each song's Last Sung forward
 * (locally, and in the SongList sheet when Supabase is configured).
 */
export async function runWorkflow(service: Service, action: WorkflowAction): Promise<WorkflowResult> {
  const to = nextStatus(service.status, action);
  const now = new Date().toISOString();
  const updated: Service = { ...service, status: to, updatedAt: now };
  if (action === 'submit') updated.submittedBy = getActor();
  if (action === 'approve') updated.approvedBy = getActor();
  if (action === 'publish') updated.publishedAt = now;
  if (action === 'unpublish' || action === 'return') { updated.publishedAt = null; if (action === 'return') updated.approvedBy = null; }

  await save('services', updated, { action, details: `${service.date}: ${STATUS_LABEL[service.status]} → ${STATUS_LABEL[to]}` });

  let songsUpdated = 0;
  let sheetMessage: string | null = null;
  if (action === 'publish') {
    const songs = await list('songs');
    // Only dates on or before today count as "sung"; a future Sunday is applied when it arrives (see Songs page).
    const updates = computeLastSungUpdates(songs, [updated], updated.date <= todayISO() ? updated.date : '0000-00-00');
    if (updates.length) {
      await save('songs', updates.map((u) => ({ ...u.song, lastSung: u.lastSung })), { action: 'last-sung', details: `${updates.length} songs from ${updated.date}` });
      songsUpdated = updates.length;
      if (sheetsAvailable) {
        try {
          const rows = updates.filter((u) => u.song.sheetRow).map((u) => ({ sheetRow: u.song.sheetRow!, title: u.song.title, lastSung: u.lastSung }));
          const n = await pushLastSung(rows);
          sheetMessage = `Updated Last Sung for ${n} songs in the SongList sheet.`;
        } catch (e) {
          sheetMessage = `Last Sung saved here, but the SongList sheet could not be updated: ${e instanceof Error ? e.message : e}`;
        }
      }
    }
  }
  return { service: updated, songsUpdated, sheetMessage };
}
