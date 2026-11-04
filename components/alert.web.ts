// Alerts and menus on the web build (the desktop app): drawn in the app (components/Dialogs.tsx)
// instead of the system's dialogs. Same call shape as React Native's Alert, so screens don't change.
import type { AlertButton } from 'react-native';
import { showDialog, type DialogButton } from './Dialogs';

const asButtons = (buttons: AlertButton[] | undefined): DialogButton[] =>
  (buttons?.length ? buttons : [{ text: 'OK' }]).map((b) => ({ text: b.text ?? 'OK', style: b.style ?? 'default', onPress: b.onPress ? () => b.onPress?.() : undefined }));

export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) => showDialog({ kind: 'alert', title, message, buttons: asButtons(buttons) }),
  /**
   * Typed confirm. A message ending "Type <name> to confirm." keeps the destructive button off
   * until <name> is typed (the screen checks it again).
   */
  prompt: (title: string, message?: string, buttons?: { text?: string; style?: string; onPress?: (value?: string) => void }[], _type?: string) => {
    const expected = message?.match(/Type (\S+) to confirm/)?.[1];
    showDialog({
      kind: 'prompt',
      title,
      message: expected ? message?.replace(/\s*Type \S+ to confirm\.?/, '') : message,
      expected,
      buttons: (buttons ?? [{ text: 'OK' }]).map((b) => ({ text: b.text ?? 'OK', style: (b.style as DialogButton['style']) ?? 'default', onPress: b.onPress })),
    });
  },
};

export const Menu = {
  /** A menu next to what was clicked (the ⋯ button). */
  show: (title: string, items: AlertButton[], anchor?: { x: number; y: number }) =>
    showDialog({ kind: 'menu', title, anchor, items: asButtons(items) }),
};
