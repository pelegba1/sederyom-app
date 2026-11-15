/**
 * "מחק את הנתונים שלי" on the phone: `deleteMyData` with the phone's own
 * friend boxes, device record, Google sign-in, Mashov login, notifications and storage.
 * And "לצאת מההדגמה", its last two steps alone (`leaveDemoNow`).
 */
import CookieManager from '@react-native-cookies/cookies';
import * as Notifications from 'expo-notifications';
import { deleteBuddyBoxesNow } from '../buddies/run';
import { deleteDevice } from '../device/v2';
import { mirrorState } from '../google/mirror';
import { googleAccount, phoneGoogleRequester, signOutOfGoogle } from '../google/phone';
import { runningGoogleRead } from '../google/run';
import { clearJar } from '../mashov/cookieJar';
import { mashovSessionIdle } from '../mashov/lock';
import { runningMashovRead } from '../mashov/run';
import { storage } from '../widget/feedCache';
import { requestWidgetUpdate } from '../widget/update';
import { deleteMyData, type DeleteOutcome } from './deleteMyData';
import { holdForDelete, releaseAfterDelete } from './source';

const CALENDARS = 'https://www.googleapis.com/calendar/v3/calendars';

/** Every notification the phone scheduled or shows. */
async function cancelNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}

/**
 * The phone's storage, all of it, and the widgets drawn again from nothing. Not a list of keys: the own exam
 * board (`local/ownBoard.ts`), and the one kept aside for each of a parent's children, go with the rest.
 */
function wipeStorage(): void {
  storage.clearAll();
  requestWidgetUpdate();
}

/**
 * "לצאת מההדגמה" (`demo/mode.ts`): the demo kept nothing anywhere but on the
 * phone, so only the delete's last steps: no notification, and an empty
 * storage, the switch with it. No call to the server or to Google, which the
 * demo never reached.
 */
export async function leaveDemoNow(): Promise<void> {
  await cancelNotifications().catch(() => undefined);
  wipeStorage();
}

/** The "בית ספר" calendar this phone made, while it is signed in to Google to delete it. */
export function deletableSchoolCalendar(): string | null {
  return googleAccount() ? mirrorState(storage).calendarId : null;
}

export function deleteMyDataNow(opts: { calendar: boolean }): Promise<DeleteOutcome> {
  return deleteMyData(
    {
      // The refresh and the summaries, and a Mashov or Google read begun outside a refresh (a login, a connect),
      // and any job on the Mashov session: a parent's scan of the schools, or the check.
      settle: () => holdForDelete([runningMashovRead(), runningGoogleRead(), mashovSessionIdle()]),
      release: releaseAfterDelete,
      deleteBuddyBoxes: deleteBuddyBoxesNow,
      deleteDevice: () => deleteDevice(storage),
      schoolCalendarId: deletableSchoolCalendar,
      deleteCalendar: async (id) => {
        try {
          await phoneGoogleRequester().request(`${CALENDARS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (err) {
          // Deleted in Google already: what was asked for is done.
          const status = (err as { status?: number }).status;
          if (status !== 404 && status !== 410) throw err;
        }
      },
      signOutGoogle: signOutOfGoogle,
      clearMashovLogin: async () => {
        await CookieManager.clearAll(true);
        // iOS keeps `fetch`'s cookies apart from the WebView's: those go too.
        await clearJar();
      },
      cancelNotifications,
      wipeStorage,
    },
    opts,
  );
}
