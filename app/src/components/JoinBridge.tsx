/**
 * An invite link (ideas ה2, `lib/invite.ts`) as it reaches the app: the
 * link that opens it (`sederyom://join?…`, from the page at /join), and once
 * after an install from such a page (the store's referrer), only while the
 * phone follows no class, since nobody tapped anything in this app yet.
 *
 * No class yet: the link's class is followed at once. Another class: a
 * question first, since the timetable, the changes and the exams on every
 * screen change with it. On a parent's phone the question offers to add the
 * class beside the one it has, as another child's (parents mode, stage 2),
 * and a link to a child already there puts that child on screen. The same
 * class, or the demo: a line that says so, and nothing else.
 *
 * Rendered once, inside the navigation container, beside the push bridge.
 */
import { useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useAddChildFromInvite, useJoinClass } from '../api/hooks';
import { isDemo } from '../demo/phone';
import { storedFeed } from '../device/v2';
import { inviteFromInstall } from '../device/installReferrer';
import { joinOf, type JoinTarget } from '../lib/invite';
import { CHILDREN_COPY, displayClassName, INVITE_COPY } from '../lib/onboarding';
import { childOfClass, keepLinkLessons } from '../local/children';
import { pastedSite } from '../local/schoolSite';
import { userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { useToast } from './Toast';

export function JoinBridge(): null {
  const toast = useToast();
  const qc = useQueryClient();
  const { mutateAsync } = useJoinClass();
  const { mutateAsync: addAsync } = useAddChildFromInvite();
  // The listeners are set once; they read the toast and the mutations as they are when a link comes.
  const latest = useRef({ toast, mutateAsync, addAsync, qc });
  latest.current = { toast, mutateAsync, addAsync, qc };

  useEffect(() => {
    let alive = true;
    const join = (target: JoinTarget): void => {
      const { toast: say, mutateAsync: run } = latest.current;
      say.show(INVITE_COPY.joining);
      run(target).then(
        // As the phone is now: a parent's names the child's class, a student's is their own timetable.
        ({ className }) => say.show(userSettings().audience === 'parent' ? INVITE_COPY.joined(displayClassName(className)) : INVITE_COPY.joinedYours),
        (err: unknown) => say.show(err instanceof Error ? err.message : String(err)),
      );
    };
    const addChild = (target: JoinTarget): void => {
      const { toast: say, addAsync: run } = latest.current;
      say.show(INVITE_COPY.joining);
      run(target).then(
        ({ result, className }) => say.show(
          result === 'added' ? CHILDREN_COPY.added(displayClassName(className))
            : result === 'shown' ? CHILDREN_COPY.inviteShown(displayClassName(className))
              : result === 'full' ? CHILDREN_COPY.full
                : result === 'no_site' ? CHILDREN_COPY.noSite
                  : CHILDREN_COPY.already,
        ),
        (err: unknown) => say.show(err instanceof Error ? err.message : String(err)),
      );
    };
    const offer = (target: JoinTarget | null, fromInstall = false): void => {
      if (!alive || !target) return;
      const settings = userSettings();
      if (fromInstall && settings.classId) return;
      const say = latest.current.toast;
      if (isDemo()) {
        say.show(INVITE_COPY.demo);
        return;
      }
      const site = storedFeed(storage)?.class.siteUrl ?? pastedSite(storage);
      if (settings.classId === target.classId && site === target.siteUrl) {
        // The child's lessons may come with a link to the class already here (`LessonsBridge`).
        if (settings.audience === 'parent' && target.lessons?.length) {
          keepLinkLessons(storage, target.lessons);
          void latest.current.qc.invalidateQueries({ queryKey: keys.settings });
        }
        say.show(INVITE_COPY.already);
        return;
      }
      if (!settings.classId) {
        join(target);
        return;
      }
      if (settings.audience === 'parent') {
        // One of the children already: that child goes on screen, nothing asked.
        if (childOfClass(storage, target)) {
          addChild(target);
          return;
        }
        Alert.alert(CHILDREN_COPY.inviteTitle, CHILDREN_COPY.inviteBody(displayClassName(settings.className)), [
          { text: CHILDREN_COPY.cancel, style: 'cancel' },
          { text: CHILDREN_COPY.inviteReplace, onPress: () => join(target) },
          { text: CHILDREN_COPY.inviteAdd, onPress: () => addChild(target) },
        ]);
        return;
      }
      Alert.alert(INVITE_COPY.switchTitle, INVITE_COPY.switchBody(displayClassName(settings.className)), [
        { text: INVITE_COPY.switchNo, style: 'cancel' },
        { text: INVITE_COPY.switchYes, onPress: () => join(target) },
      ]);
    };

    void Linking.getInitialURL().then((url) => offer(joinOf(url))).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => offer(joinOf(url)));
    void inviteFromInstall(storage).then((target) => offer(target, true)).catch(() => undefined);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return null;
}
