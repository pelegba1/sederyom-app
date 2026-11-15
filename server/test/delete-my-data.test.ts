/**
 * "מחק את הנתונים שלי" (app/src/local/deleteMyData.ts): the work running
 * settles first; the friend boxes go next, then the device's row, and either
 * failing stops the rest; the
 * "בית ספר" calendar only when asked; the phone's storage last, whatever else
 * failed on the way; and the refreshes run again after, done or failed.
 */
import { describe, expect, it } from 'vitest';
import { deleteMyData, type DeleteDeps } from '../../app/src/local/deleteMyData';

function phone(opts: {
  deviceFails?: boolean; buddiesFail?: boolean; calendarId?: string | null; calendarFails?: boolean; googleFails?: boolean; settle?: () => Promise<void>;
} = {}) {
  const steps: string[] = [];
  const deps: DeleteDeps = {
    settle: async () => {
      await opts.settle?.();
      steps.push('settle');
    },
    release: () => void steps.push('release'),
    deleteBuddyBoxes: async () => {
      steps.push('buddies');
      if (opts.buddiesFail) throw new Error('לא הצלחנו להתחבר. כדאי לנסות שוב.');
    },
    deleteDevice: async () => {
      steps.push('device');
      if (opts.deviceFails) throw new Error('offline');
    },
    schoolCalendarId: () => (opts.calendarId === undefined ? 'school@group.calendar.google.com' : opts.calendarId),
    deleteCalendar: async (id) => {
      steps.push(`calendar ${id}`);
      if (opts.calendarFails) throw new Error('Google 403');
    },
    signOutGoogle: async () => {
      steps.push('google');
      if (opts.googleFails) throw new Error('revoke failed');
    },
    clearMashovLogin: async () => void steps.push('mashov'),
    cancelNotifications: async () => void steps.push('notifications'),
    wipeStorage: () => void steps.push('storage'),
  };
  return { deps, steps };
}

describe('deleting my data', () => {
  it('settles what runs, deletes the device, the calendar when asked, the logins, the notifications, then the storage', async () => {
    const { deps, steps } = phone();
    const outcome = await deleteMyData(deps, { calendar: true });
    expect(steps).toEqual(['settle', 'buddies', 'device', 'calendar school@group.calendar.google.com', 'google', 'mashov', 'notifications', 'storage', 'release']);
    expect(outcome).toEqual({ calendarKept: false });
  });

  it('waits for a refresh still running before it deletes anything', async () => {
    // A refresh mid-way: it writes the feed and follows the class when it finishes.
    let finish!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { deps, steps } = phone({
      settle: async () => {
        await refresh;
        steps.push('refresh done');
      },
    });
    const deleting = deleteMyData(deps, { calendar: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(steps).toEqual([]);
    finish();
    await deleting;
    expect(steps).toEqual(['refresh done', 'settle', 'buddies', 'device', 'google', 'mashov', 'notifications', 'storage', 'release']);
  });

  it('leaves the calendar when not asked, or when there is none', async () => {
    const notAsked = phone();
    await deleteMyData(notAsked.deps, { calendar: false });
    expect(notAsked.steps).not.toContainEqual(expect.stringMatching(/^calendar/));

    const none = phone({ calendarId: null });
    expect(await deleteMyData(none.deps, { calendar: true })).toEqual({ calendarKept: false });
    expect(none.steps).toEqual(['settle', 'buddies', 'device', 'google', 'mashov', 'notifications', 'storage', 'release']);
  });

  it('changes nothing on the phone when the device row could not be deleted, and lets the refreshes run again', async () => {
    const { deps, steps } = phone({ deviceFails: true });
    await expect(deleteMyData(deps, { calendar: true })).rejects.toThrow('offline');
    expect(steps).toEqual(['settle', 'buddies', 'device', 'release']);
  });

  it('deletes the friend boxes before the device, and stops when they could not be', async () => {
    const { deps, steps } = phone({ buddiesFail: true });
    await expect(deleteMyData(deps, { calendar: true })).rejects.toThrow('לא הצלחנו להתחבר');
    // Nothing on the phone changed: the device stays, and so do the storage and the logins.
    expect(steps).toEqual(['settle', 'buddies', 'release']);
  });

  it('goes on when Google refuses, and says the calendar stayed', async () => {
    const { deps, steps } = phone({ calendarFails: true, googleFails: true });
    expect(await deleteMyData(deps, { calendar: true })).toEqual({ calendarKept: true });
    expect(steps.slice(-2)).toEqual(['storage', 'release']);
  });
});
