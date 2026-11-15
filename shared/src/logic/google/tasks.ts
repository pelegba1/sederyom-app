/**
 * Google Tasks adapter (design-doc §6.2).
 * Google Tasks is the source of truth; the server keeps a cache plus the
 * homework↔task link metadata. Writes go straight through.
 */
import type { DateStr, Source } from '../../index';
import { DateTime } from 'luxon';
import type { Adapter, AdapterContext, NormalizedEntity, PollResult } from '../entities';
import { withQuery } from '../http';
import type { GoogleRequester } from './requester';
import type { CursorStore } from './calendar';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export interface GoogleTaskResource {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  /** When it was completed (RFC 3339); Google sends it only for a completed task. */
  completed?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export interface GoogleTaskList {
  id: string;
  title?: string;
}

export interface NormalizedTask {
  googleId: string;
  listId: string;
  listTitle: string | null;
  title: string;
  notes: string | null;
  due: DateStr | null;
  completed: boolean;
  /**
   * When it was completed (ISO): Google's own time, or the moment of the tick for a task the
   * phone keeps. null while it is open, and for a task completed before this was kept: never a guess.
   */
  completedAt: string | null;
  deleted: boolean;
  updated: string | null;
}

export class GoogleTasksAdapter implements Adapter {
  readonly source: Source = 'google_tasks';

  constructor(
    private readonly tokens: GoogleRequester,
    private readonly cursors: CursorStore,
    private readonly opts: { zone: string },
  ) {}

  async listTaskLists(): Promise<GoogleTaskList[]> {
    const res = await this.tokens.request<{ items?: GoogleTaskList[] }>(`${TASKS_API}/users/@me/lists?maxResults=100`);
    return res.items ?? [];
  }

  async poll(ctx: AdapterContext): Promise<PollResult> {
    const lists = await this.listTaskLists();
    const entities: NormalizedEntity[] = [];
    const completeScopes: PollResult['completeScopes'] = [];

    // The lists themselves, so the compose sheet can offer a list picker without
    // a live round trip to Google. The listing is exhaustive, so removals prune.
    completeScopes.push({ kind: 'task_list' });
    for (const list of lists) {
      entities.push({
        source: this.source,
        kind: 'task_list',
        naturalKey: list.id,
        payload: { id: list.id, title: list.title ?? '(ללא שם)' },
      });
      const key = `gtasks:updatedMin:${list.id}`;
      const updatedMin = await this.cursors.get(key);
      const items = await this.listTasks(list.id, updatedMin);
      // Without an updatedMin the listing is exhaustive for that list.
      if (!updatedMin) completeScopes.push({ kind: 'task', partition: list.id });

      for (const item of items) {
        entities.push({
          source: this.source,
          kind: 'task',
          naturalKey: `${list.id}|${item.id}`,
          partition: list.id,
          payload: normalizeTask(list, item, this.opts.zone),
        });
      }
      // Overlap by a minute so a task updated during the request is not missed.
      await this.cursors.set(key, DateTime.fromJSDate(ctx.now).minus({ minutes: 1 }).toUTC().toISO()!);
    }

    return { entities, completeScopes };
  }

  private async listTasks(listId: string, updatedMin: string | null): Promise<GoogleTaskResource[]> {
    const items: GoogleTaskResource[] = [];
    let pageToken: string | undefined;
    do {
      const url = withQuery(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, {
        maxResults: 100,
        showCompleted: true,
        showHidden: true,
        showDeleted: true,
        updatedMin,
        pageToken,
      });
      const res = await this.tokens.request<{ items?: GoogleTaskResource[]; nextPageToken?: string }>(url);
      items.push(...(res.items ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken);
    return items;
  }

  // ---- write path (design-doc §6.2, Phase 4) ----

  async defaultListId(): Promise<string> {
    const lists = await this.listTaskLists();
    const first = lists[0];
    if (!first) throw new Error('the Google account has no task lists');
    return first.id;
  }

  async createTask(listId: string, input: { title: string; notes?: string | null; due?: DateStr | null }): Promise<GoogleTaskResource> {
    return this.tokens.request<GoogleTaskResource>(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        notes: input.notes ?? undefined,
        due: toGoogleDue(input.due ?? null),
      }),
    });
  }

  async patchTask(
    listId: string,
    taskId: string,
    input: { title?: string; notes?: string | null; due?: DateStr | null; completed?: boolean },
  ): Promise<GoogleTaskResource> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.notes !== undefined) body.notes = input.notes;
    if (input.due !== undefined) body.due = toGoogleDue(input.due);
    if (input.completed !== undefined) {
      body.status = input.completed ? 'completed' : 'needsAction';
      // Google keeps a stale completion timestamp unless it is cleared explicitly.
      if (!input.completed) body.completed = null;
    }
    return this.tokens.request<GoogleTaskResource>(
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.tokens.request<void>(
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
    );
  }
}

/** Google Tasks stores due as an RFC-3339 instant but only honours the date part. */
export function toGoogleDue(due: DateStr | null): string | null {
  if (!due) return null;
  return `${due}T00:00:00.000Z`;
}

export function fromGoogleDue(due: string | undefined, zone: string): DateStr | null {
  if (!due) return null;
  // The date part is what Google means; reading it in the local zone would
  // shift it by a day for anyone east of UTC — Jerusalem included.
  const dt = DateTime.fromISO(due, { zone: 'utc' });
  return dt.isValid ? dt.toISODate() : null;
}

export function normalizeTask(list: GoogleTaskList, item: GoogleTaskResource, zone: string): NormalizedTask {
  return {
    googleId: item.id,
    listId: list.id,
    listTitle: list.title ?? null,
    title: item.title?.trim() || '(ללא כותרת)',
    notes: item.notes ?? null,
    due: fromGoogleDue(item.due, zone),
    completed: item.status === 'completed',
    completedAt: item.status === 'completed' ? item.completed ?? null : null,
    deleted: Boolean(item.deleted),
    updated: item.updated ?? null,
  };
}
