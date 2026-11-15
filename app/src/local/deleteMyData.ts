/**
 * "מחק את הנתונים שלי" (plan Phase 3): everything the app keeps about the
 * student goes, in an order where each step still has what it needs.
 *
 * 0. First the work already running settles (`settle`): a refresh, a Mashov
 *    read, the summaries. None starts from here on, and the ones running
 *    finish, so none writes back what the steps below wipe, registers the
 *    phone again or schedules a notification after they were cancelled. They
 *    start again once the delete is over (`release`), done or failed.
 * 1. The friend boxes this phone wrote (`DELETE /v2/buddies/boxes`), while
 *    the phone still has the device that owns them and the secrets they come
 *    from. Then the device's row on the server (`DELETE /v2/device`), with
 *    the device's key. If either fails nothing else goes, so trying again
 *    finds everything as it was: a phone wiped while its row stays would keep
 *    getting the class's pushes with no way left to stop them.
 * 2. The "בית ספר" calendar in Google, when the student asked, while the
 *    phone is still signed in. A failure here is said, not fatal: the student
 *    can delete the calendar in Google, and stopping would keep everything else.
 * 3. Google's sign-in (revoked, not just signed out) and Mashov's login.
 * 4. Every notification, scheduled or shown.
 * 5. The phone's storage, last: the steps above read their keys from it.
 *
 * Pure apart from what it is given, so the order is tested with fakes
 * (`deleteMyDataRun.ts` gives it the phone's).
 */
export interface DeleteDeps {
  /** Stops new refreshes and summaries, and waits for the ones running. */
  settle(): Promise<void>;
  /** Lets them run again: after the wipe, or after a step 1 that failed. */
  release(): void;
  /** Every friend box this phone wrote (friends spec 4.5). */
  deleteBuddyBoxes(): Promise<void>;
  deleteDevice(): Promise<void>;
  /** The calendar the phone made, if it made one and is still signed in to Google. */
  schoolCalendarId(): string | null;
  deleteCalendar(id: string): Promise<void>;
  signOutGoogle(): Promise<void>;
  clearMashovLogin(): Promise<void>;
  cancelNotifications(): Promise<void>;
  wipeStorage(): void;
}

export interface DeleteOutcome {
  /** The student asked for the "בית ספר" calendar to go, and Google refused. */
  calendarKept: boolean;
}

/** Throws when the friend boxes or the server's row could not be deleted; then nothing on the phone has changed. */
export async function deleteMyData(deps: DeleteDeps, opts: { calendar: boolean }): Promise<DeleteOutcome> {
  await deps.settle();
  try {
    await deps.deleteBuddyBoxes();
    await deps.deleteDevice();

    let calendarKept = false;
    const calendarId = opts.calendar ? deps.schoolCalendarId() : null;
    if (calendarId) {
      try {
        await deps.deleteCalendar(calendarId);
      } catch {
        calendarKept = true;
      }
    }

    // Each of these on its own: one failing must not keep the others, or the wipe.
    await deps.signOutGoogle().catch(() => undefined);
    await deps.clearMashovLogin().catch(() => undefined);
    await deps.cancelNotifications().catch(() => undefined);
    deps.wipeStorage();
    return { calendarKept };
  } finally {
    deps.release();
  }
}
