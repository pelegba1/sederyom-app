/**
 * The parents' check (parents mode, stage 3; `mashov/parentCheck.ts`): what
 * it is, when it last ran, and the buttons to run it, to send its report
 * and to read the report first. On the login screen, after a parent's login,
 * it runs by itself (`autoRun`).
 *
 * On the page between ruled lines like the rest of מצב חיבורים, no card.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';
import { PARENT_MASHOV_COPY as COPY } from '../lib/connections';
import { shortDateTime } from '../lib/format';
import { storedCheck, type ParentCheck } from '../mashov/parentCheck';
import { runParentCheckNow } from '../mashov/parentCheckRun';
import { font, space, type } from '../theme';
import { storage } from '../widget/feedCache';
import { Button, Ltr, Text, usePalette } from './ui';

export function ParentCheckPanel({ autoRun = false }: { autoRun?: boolean }): React.JSX.Element {
  const p = usePalette();
  const [report, setReport] = useState<ParentCheck | null>(() => storedCheck(storage));
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setFailed(false);
    try {
      setReport(await runParentCheckNow());
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (autoRun) void run();
  }, [autoRun, run]);

  const share = (): void => {
    if (report) void Share.share({ message: report.text }).catch(() => undefined);
  };

  return (
    <View style={[styles.panel, { borderTopColor: p.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>{COPY.checkTitle}</Text>
      <Text style={[styles.line, { color: p.textMuted }]}>{COPY.checkLead}</Text>
      {running ? (
        <View style={styles.running}>
          <ActivityIndicator color={p.accent} />
          <Text style={[styles.line, { color: p.textMuted }]}>{COPY.checkRunning}</Text>
        </View>
      ) : report ? (
        <Text style={[styles.line, { color: p.textMuted }]}>{COPY.checkAt(shortDateTime(report.at))}</Text>
      ) : null}
      {failed ? <Text style={[styles.line, { color: p.cancel }]}>{COPY.checkFailed}</Text> : null}
      <View style={styles.buttons}>
        {report ? <Button title={COPY.checkShare} disabled={running} onPress={share} /> : null}
        <Button title={report ? COPY.checkAgain : COPY.checkRun} variant={report ? 'ghost' : 'primary'} disabled={running} onPress={() => void run()} />
        {report ? <Button title={open ? COPY.checkHide : COPY.checkShow} variant="ghost" onPress={() => setOpen((o) => !o)} /> : null}
      </View>
      {report && open ? (
        <Text selectable style={[styles.report, { color: p.textMuted }]}>
          <Ltr style={[styles.report, { color: p.textMuted }]}>{report.text}</Ltr>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingTop: space.lg, marginTop: space.lg, borderTopWidth: 1, gap: space.sm },
  title: { fontFamily: font.bodySemi, fontSize: type.body },
  line: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  running: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  report: { fontFamily: font.body, fontSize: type.small - 1, lineHeight: 18 },
});
