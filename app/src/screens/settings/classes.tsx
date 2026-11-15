/**
 * The class on Settings (F18): the class picker, the grade-grouped chips
 * (also used by the onboarding screen), and a parent's children.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ClassOption, SchoolSiteState } from '@sederyom/shared';
import { MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { useAddChild, useChildren, useOnlyChildName, useRemoveChild, useRenameChild, useStatus } from '../../api/hooks';
import { AppIcon } from '../../components/AppIcon';
import { FilterChip, Row, ROW_GUTTER, SectionHeading } from '../../components/notebook';
import { SchoolSiteField } from '../../components/SchoolSiteField';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { Button, Text, TextInput, usePalette } from '../../components/ui';
import { isConnected } from '../../lib/connections';
import { CHILDREN_COPY, SCHOOL_SITE_COPY, classStepPage, displayClassName, groupClasses } from '../../lib/onboarding';
import type { ChildRow } from '../../local/phoneChildren';
import { font, space, type } from '../../theme';

// ---------------------------------------------------------------------------
// Class picker (F18)
// ---------------------------------------------------------------------------

/**
 * The school site's classes under grade headings (שכבה י׳ / י״א / י״ב, then
 * "אחר"), each class a filter chip: the chosen one is highlighted and ticked
 * (`FilterChip`). Chips show the class within its grade ("3 מוזיקה"); what is
 * saved is the site's own id and name, untouched. It brings no side padding.
 */
export function ClassGroups({
  classes, selectedId, onSelect,
}: {
  classes: ClassOption[];
  selectedId: string;
  onSelect: (option: ClassOption) => void;
}): React.JSX.Element {
  const p = usePalette();
  const groups = useMemo(() => groupClasses(classes), [classes]);
  if (classes.length === 0) {
    return (
      <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, marginTop: space.sm }}>
        {SCHOOL_SITE_COPY.listNotYet}
      </Text>
    );
  }
  return (
    <View style={{ gap: space.lg, marginTop: space.sm }}>
      {groups.map((group) => (
        <View key={group.grade || 'other'}>
          <SectionHeading>{group.label}</SectionHeading>
          <View style={styles.chips}>
            {group.items.map((item) => (
              <FilterChip
                key={item.id}
                label={item.short}
                selected={item.id === selectedId}
                accessibilityLabel={`כיתה ${item.display}`}
                onPress={() => onSelect({ id: item.id, name: item.name })}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * "כיתה": the class, opening the chips under the row. With no list (plan
 * Phase 3), what the class step offers, in short: one line on where the list
 * or the days come from, and the field to paste the timetable site's address,
 * there for a student who went on without a site too.
 */
export function ClassPicker({
  classes, site, selectedId, selectedName, onSelect,
}: {
  classes: ClassOption[];
  site: SchoolSiteState;
  selectedId: string;
  selectedName: string;
  onSelect: (option: ClassOption) => void;
}): React.JSX.Element {
  const p = usePalette();
  const status = useStatus();
  const [open, setOpen] = useState(false);
  const selected = classes.find((c) => c.id === selectedId);
  const shown = displayClassName(selected?.name ?? selectedName) || selectedId || (site.withoutSite ? SCHOOL_SITE_COPY.withoutRow : '');
  const page = classStepPage(classes.length, isConnected(status.data?.sources.find((s) => s.source === 'mashov')), site);
  const noList = page === 'connect'
    ? SCHOOL_SITE_COPY.connectLead
    : page === 'site' || site.withoutSite ? SCHOOL_SITE_COPY.withoutNow : SCHOOL_SITE_COPY.listNotYet;

  return (
    <View>
      <Row
        title="כיתה"
        subtitle={shown}
        accessibilityLabel={`כיתה: ${shown}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        // Opens here, under the row: the down arrow, turned up while open — not "to another screen" (Daniel).
        end={(
          <View style={open ? styles.flip : null}>
            <AppIcon name="chevronDown" color={p.textFaint} size={20} />
          </View>
        )}
      />
      {open && classes.length > 0 ? (
        <View style={[styles.gutter, styles.classes, { borderBottomColor: p.border }]}>
          <ClassGroups
            classes={classes}
            selectedId={selectedId}
            onSelect={(option) => {
              onSelect(option);
              setOpen(false);
            }}
          />
        </View>
      ) : null}
      {open && classes.length === 0 ? (
        <View style={[styles.gutter, styles.classes, styles.noClasses, { borderBottomColor: p.border }]}>
          <Text style={[styles.hint, { color: p.textMuted }]}>{noList}</Text>
          <SchoolSiteField />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A parent's children (parents mode, stage 2): each with the name this phone
 * keeps for it, renamed or taken off the list in a sheet, and a row that adds
 * a child in another class of the school on screen. A child at another school
 * comes by its invite link (`JoinBridge`).
 */
export function ChildrenRows({ classes }: { classes: ClassOption[] }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const children = useChildren();
  const add = useAddChild();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ChildRow | null>(null);
  const list = children.data?.list ?? [];
  const full = list.length >= MAX_FOLLOWED_CLASSES;

  const onAdd = (option: ClassOption): void => {
    setAdding(false);
    add.mutate(option, {
      onSuccess: (result) => toast.show(
        result === 'added' ? CHILDREN_COPY.added(displayClassName(option.name))
          : result === 'already' ? CHILDREN_COPY.already
            : result === 'full' ? CHILDREN_COPY.full
              : CHILDREN_COPY.noSite,
      ),
    });
  };

  return (
    <View>
      {list.map((child) => (
        <Row
          key={child.id}
          title={child.name}
          subtitle={child.shown ? `${child.className}, ${CHILDREN_COPY.shownNow}` : child.className}
          accessibilityRole="button"
          onPress={() => setEditing(child)}
        />
      ))}
      {children.data?.unsupported ? (
        <Text style={[styles.gutter, styles.hint, styles.childrenNote, { color: p.textMuted }]}>{CHILDREN_COPY.unsupported}</Text>
      ) : null}
      <Row
        title={CHILDREN_COPY.add}
        subtitle={full ? CHILDREN_COPY.full : CHILDREN_COPY.addHint}
        accessibilityRole="button"
        accessibilityState={{ expanded: adding, disabled: full }}
        onPress={full ? undefined : () => setAdding((v) => !v)}
        end={full ? undefined : (
          <View style={adding ? styles.flip : null}>
            <AppIcon name="chevronDown" color={p.textFaint} size={20} />
          </View>
        )}
      />
      {adding ? (
        <View style={[styles.gutter, styles.classes, { borderBottomColor: p.border }]}>
          <ClassGroups classes={classes} selectedId="" onSelect={onAdd} />
        </View>
      ) : null}
      <ChildSheet child={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

/**
 * The name this phone keeps for a child: the label, the field and the line that
 * says it stays here. The child's sheet saves it with its own button; the only
 * child's field (`OnlyChildName`) when the field is left, so it asks to be told.
 */
function ChildNameField({
  value, onChange, onFocus, onCommit,
}: {
  value: string;
  onChange: (name: string) => void;
  onFocus?: () => void;
  /** The field is left, or "done" is pressed on the keyboard. */
  onCommit?: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <>
      <Text style={[styles.pickerLabel, { color: p.textMuted }]}>{CHILDREN_COPY.nameLabel}</Text>
      <TextInput
        accessibilityLabel={CHILDREN_COPY.nameLabel}
        value={value}
        onChangeText={onChange}
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={onCommit}
        placeholder={CHILDREN_COPY.namePlaceholder}
        placeholderTextColor={p.textFaint}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onCommit?.();
        }}
        style={[styles.nameInput, { color: p.text, backgroundColor: p.surfaceAlt, borderBottomColor: focused ? p.accent : p.border, outlineColor: 'transparent', outlineWidth: 0 }]}
      />
      <Text style={[styles.hint, { color: p.textMuted }]}>{CHILDREN_COPY.nameHint}</Text>
    </>
  );
}

/**
 * A parent's name for an only child, under the class: with one child there is
 * no list yet, and the class's name stands for the child until this is filled.
 * Written to the phone as it is typed, so that a second child added before the
 * field is left takes it (`addChild` reads it then); the screens that show the
 * name are told when the field is left, on "done", and when the page closes
 * with the keyboard still up. An empty name gives the class's name back. The
 * list's first child takes the name once a second one comes. It stays on the
 * phone.
 */
export function OnlyChildName(): React.JSX.Element {
  const p = usePalette();
  const [saved, save] = useOnlyChildName();
  const [draft, setDraft] = useState(saved);
  // The name the screens hold as far as this field knows, and whether the parent is in the field.
  const told = useRef(saved);
  const inField = useRef(false);
  const latest = useRef({ draft, save });
  latest.current = { draft, save };

  // What the phone keeps is the field's start, and is again when it changes under the field (the list went down to one child).
  useEffect(() => {
    told.current = saved;
    if (!inField.current) setDraft(saved);
  }, [saved]);

  /** Tells the screens the draft is the name, unless they hold it already. */
  const tell = (): string => {
    const name = latest.current.draft.trim();
    if (name !== told.current) {
      told.current = name;
      latest.current.save(name);
    }
    return name;
  };
  // A page closed with the keyboard up never lets the field go: the screens are told then.
  useEffect(() => () => {
    tell();
  }, []);

  return (
    <View style={[styles.gutter, styles.onlyName, { borderBottomColor: p.border }]}>
      <ChildNameField
        value={draft}
        onChange={(text) => {
          setDraft(text);
          // Kept at once and told later: a tap on "add a child" does not leave the field.
          save(text, { quiet: true });
        }}
        onFocus={() => { inField.current = true; }}
        onCommit={() => {
          inField.current = false;
          setDraft(tell());
        }}
      />
    </View>
  );
}

/** One child: the name this phone keeps for it, and taking it off the list. */
export function ChildSheet({ child, onClose }: { child: ChildRow | null; onClose: () => void }): React.JSX.Element {
  const rename = useRenameChild();
  const remove = useRemoveChild();
  const [name, setName] = useState('');

  // Every opening starts from the name kept.
  useEffect(() => {
    if (child) setName(child.label);
  }, [child]);

  const footer = (
    <View style={styles.sheetFooter}>
      <View style={{ flex: 1 }}>
        <Button
          title={CHILDREN_COPY.save}
          disabled={remove.isPending}
          onPress={() => {
            if (child) rename(child.id, name);
            onClose();
          }}
        />
      </View>
      <Button
        title={CHILDREN_COPY.remove}
        variant="danger"
        disabled={remove.isPending}
        onPress={() => {
          if (child) remove.mutate(child.id, { onSettled: onClose });
        }}
      />
    </View>
  );

  return (
    <Sheet visible={child !== null} onClose={onClose} title={child?.className ?? ''} footer={footer}>
      <ChildNameField value={name} onChange={setName} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  hint: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  pickerLabel: { fontFamily: font.bodySemi, fontSize: type.small, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  classes: { paddingBottom: space.lg, borderBottomWidth: 1 },
  childrenNote: { paddingBottom: space.md },
  onlyName: { paddingTop: space.md, paddingBottom: space.sm, borderBottomWidth: 1 },
  sheetFooter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  nameInput: {
    borderBottomWidth: 1, borderTopStartRadius: 6, borderTopEndRadius: 6, paddingVertical: 12, paddingHorizontal: space.md,
    fontFamily: font.body, fontSize: type.body, marginBottom: space.sm, textAlign: 'right', writingDirection: 'rtl',
  },
  noClasses: { paddingTop: space.sm, gap: space.md },
  flip: { transform: [{ rotate: '180deg' }] },
});
