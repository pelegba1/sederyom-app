/**
 * A Google Calendar event's details: when, which calendar, where. Its footer
 * keeps "hide this event" one tap away — the action that used to live only
 * behind a long press on the row.
 *
 *   <EventSheet visible={open} event={event} onClose={close} onHide={hide} />
 */
import React from 'react';
import { View } from 'react-native';
import type { CalendarEvent } from '@sederyom/shared';
import { isolateRanges } from '../lib/format';
import { eventTimeLabel, type Part } from '../lib/today';
import { space } from '../theme';
import { DetailRow } from './LessonSheet';
import { Sheet } from './Sheet';
import { Button } from './ui';

export interface EventSheetProps {
  visible: boolean;
  /** Kept after closing, so the sheet does not empty while it slides away. */
  event: CalendarEvent | null;
  onClose: () => void;
  /** Asks whether to hide the event (or its series) from the app. */
  onHide: (event: CalendarEvent) => void;
}

export function EventSheet({ visible, event, onClose, onHide }: EventSheetProps): React.JSX.Element {
  const time: Part[] | null = event ? (event.allDay ? [{ text: 'כל היום' }] : [{ text: eventTimeLabel(event), ltr: true }]) : null;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={event ? isolateRanges(event.summary) : ''}
      footer={event ? <Button title="להסתיר את האירוע מהאפליקציה" variant="ghost" onPress={() => onHide(event)} /> : undefined}
    >
      {event && time ? (
        <View style={{ paddingBottom: space.sm }}>
          <DetailRow label="שעה" value={time} />
          {/* The calendar's name in quotes: "אחר הצהריים" alone read as a time of day (W4, Maya). */}
          <DetailRow label="יומן" value={event.calendarName ? `״${event.calendarName}״ ב־Google` : 'Google'} />
          {event.location ? <DetailRow label="מיקום" value={isolateRanges(event.location)} /> : null}
          {event.seriesId ? <DetailRow label="חוזר" value="אירוע קבוע, חלק מסדרה" /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}
