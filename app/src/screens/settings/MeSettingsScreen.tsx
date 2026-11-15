/**
 * אני ובית הספר (a parent's phone: אני והילדים): who the app is for on this
 * phone and which school and class it follows. The audience switch, a
 * parent's own way into Mashov, the class (and a parent's children), the
 * invites to friends, a student's chat connection, and the absence rules. These all answer "who am I and
 * where do I study", so they share a page.
 *
 * The page's title follows the audience (`mePageTitle`): it is set once the
 * settings have loaded, since the stack knows the route before it knows who
 * the phone is for.
 */
import React, { useLayoutEffect } from 'react';
import type { SettingsResponse } from '@sederyom/shared';
import { useChat, useChildren, useSaveSettings, useSettings, useStatus } from '../../api/hooks';
import { CHAT_COPY } from '../../chat/copy';
import { Row } from '../../components/notebook';
import { useToast } from '../../components/Toast';
import { PARENT_MASHOV_COPY, isConnected, mashovWasRead } from '../../lib/connections';
import { AUDIENCE_COPY, mePageTitle } from '../../lib/onboarding';
import { isDemo } from '../../demo/phone';
import type { RootNavigation } from '../../navigation/types';
import { AbsenceRules, useAbsenceRulesShown } from './AbsenceRules';
import { ChildrenRows, ClassPicker, OnlyChildName } from './classes';
import { InviteRows } from './InviteRows';
import { SAVE_ERROR, Section, SettingsPage, SwitchRow, usePatch } from './parts';

export function MeSettingsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const parent = useSettings().data?.settings.audience === 'parent';
  useLayoutEffect(() => {
    navigation.setOptions({ title: mePageTitle(parent) });
  }, [navigation, parent]);
  return <SettingsPage>{(data) => <MeRows data={data} navigation={navigation} />}</SettingsPage>;
}

function MeRows({ data, navigation }: { data: SettingsResponse; navigation: RootNavigation }): React.JSX.Element {
  const toast = useToast();
  const status = useStatus();
  const children = useChildren();
  // The audience switch has a toast of its own on success, so it saves through this instance,
  // and its `busy` is this instance's: a row's `busy` and the mutate that saves it go together.
  const audience = useSaveSettings();
  const { patch } = usePatch();
  const absenceShown = useAbsenceRulesShown();
  const demo = isDemo();
  const s = data.settings;
  const parent = s.audience === 'parent';
  // A parent's own way into Mashov (stage 3), and once in, to the check in מצב חיבורים.
  const parentMashov = parent && mashovWasRead(status.data?.sources);
  const parentConnected = parentMashov && isConnected(status.data?.sources.find((x) => x.source === 'mashov'));

  return (
    <>
      {/* Who the app is for on this phone (docs/parents-plan.md); nothing is deleted either way. */}
      <SwitchRow
        label={AUDIENCE_COPY.settingsLabel}
        hint={AUDIENCE_COPY.settingsHint}
        value={parent}
        busy={audience.isPending}
        onChange={(value) => audience.mutate({ audience: value ? 'parent' : 'student' }, {
          onSuccess: () => toast.show(value ? AUDIENCE_COPY.toParent : AUDIENCE_COPY.toStudent),
          onError: () => toast.show(SAVE_ERROR),
        })}
      />
      {parent && !demo ? (
        <Row
          title={parentConnected ? PARENT_MASHOV_COPY.row : PARENT_MASHOV_COPY.connectRow}
          subtitle={parentConnected ? PARENT_MASHOV_COPY.rowHint : PARENT_MASHOV_COPY.connectRowHint}
          chevron
          accessibilityRole="button"
          onPress={() => navigation.navigate(parentConnected ? 'Connections' : 'MashovLogin')}
        />
      ) : null}
      <ClassPicker
        classes={data.classes}
        site={data.site}
        selectedId={s.classId}
        selectedName={s.className}
        onSelect={(option) => patch({ classId: option.id, className: option.name })}
      />
      {/* A parent of one child (no list yet) names it here, in place of the class's name; a list names its children in ChildrenRows.
          Only once a class is chosen, as ChildrenRows: a name typed before would go to whichever child Mashov adds first. */}
      {parent && !demo && s.classId && children.data === null ? <OnlyChildName /> : null}
      {parent && !demo && s.classId ? <ChildrenRows classes={data.classes} /> : null}
      <InviteRows />
      {/* A parent's phone has no chat connection (chat spec 1.2): no row, so the page's model is not even read there. */}
      {!parent ? <ChatConnectionRow navigation={navigation} /> : null}
      {/* No heading over rules that hide themselves (a parent's phone before their own Mashov was read). */}
      {absenceShown ? (
        <Section title="חיסורים">
          <AbsenceRules />
        </Section>
      ) : null}
    </>
  );
}

/** ״חיבור לצ׳אט״: how many chats are linked, or what the page is for; opens the page. */
function ChatConnectionRow({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const linked = useChat({ polling: false }).data?.chats.length ?? 0;
  return (
    <Row
      title={CHAT_COPY.row}
      subtitle={linked > 0 ? CHAT_COPY.rowLinked(linked) : CHAT_COPY.rowHint}
      chevron
      accessibilityRole="button"
      onPress={() => navigation.navigate('Chat')}
    />
  );
}
