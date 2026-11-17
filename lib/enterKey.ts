// Desktop (web) composers: Enter sends, Shift+Enter is a new line. A multiline TextInput on web never fires
// onSubmitEditing, so each composer has to watch the key itself. Ignore Enter while an IME is composing text.
export type KeyEvent = { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean } };

export function isSendEnter(e: KeyEvent): boolean {
  const n = e.nativeEvent;
  return n.key === 'Enter' && !n.shiftKey && !n.isComposing;
}
