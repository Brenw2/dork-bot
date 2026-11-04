// Alerts and action menus on the web build. React Native Web's Alert does nothing, so:
// - the desktop app shows native desktop dialogs (desktop/main.mjs → dialog.showMessageBox);
// - a plain browser falls back to window.confirm / window.prompt.
// Same call shape as React Native's Alert.alert / Alert.prompt, so screens don't change.
import type { AlertButton } from 'react-native';
import { desktop } from './desktop';

async function alert(title: string, message?: string, buttons: AlertButton[] = [{ text: 'OK' }]): Promise<void> {
  const list = buttons.length ? buttons : [{ text: 'OK' }];
  if (desktop) {
    const cancelId = list.findIndex((b) => b.style === 'cancel');
    const { response } = await desktop.message({
      title,
      message,
      buttons: list.map((b) => b.text ?? 'OK'),
      cancelId,
      defaultId: Math.max(0, list.findIndex((b) => b.style !== 'cancel')),
      destructive: list.some((b) => b.style === 'destructive'),
    });
    if (response >= 0) list[response]?.onPress?.();
    return;
  }
  const action = list.find((b) => b.style !== 'cancel');
  if (list.length === 1 || !action) {
    globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
    list[0]?.onPress?.();
  } else if (globalThis.confirm?.([title, message].filter(Boolean).join('\n\n'))) action.onPress?.();
}

/**
 * Alert.prompt (typed confirm: the message ends "Type <name> to confirm."). The desktop dialog
 * has no text box, so it asks with a checkbox that must be ticked, and hands the name on only
 * then; the screen checks it as usual.
 */
async function prompt(
  title: string,
  message?: string,
  buttons?: { text?: string; style?: string; onPress?: (value?: string) => void }[],
): Promise<void> {
  const list = buttons ?? [{ text: 'OK' }];
  const expected = message?.match(/Type (\S+) to confirm/)?.[1];
  const action = list.find((b) => b.style !== 'cancel');
  if (desktop) {
    const cancelIndex = list.findIndex((b) => b.style === 'cancel');
    const { response, checked } = await desktop.message({
      title,
      message: expected ? message?.replace(/\s*Type \S+ to confirm\.?/, '') : message,
      buttons: list.map((b) => b.text ?? 'OK'),
      cancelId: cancelIndex,
      defaultId: Math.max(0, cancelIndex),
      destructive: list.some((b) => b.style === 'destructive'),
      checkboxLabel: expected ? `Yes, delete ${expected} for good` : undefined,
    });
    const picked = list[response];
    if (!picked || picked.style === 'cancel') return;
    picked.onPress?.(expected ? (checked ? expected : '') : '');
    return;
  }
  const typed = globalThis.prompt?.([title, message].filter(Boolean).join('\n\n'));
  if (typed !== null && typed !== undefined) action?.onPress?.(typed);
}

export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) => void alert(title, message, buttons),
  prompt: (title: string, message?: string, buttons?: { text?: string; style?: string; onPress?: (value?: string) => void }[], _type?: string) =>
    void prompt(title, message, buttons),
};
