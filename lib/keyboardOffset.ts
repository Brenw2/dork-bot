// KeyboardAvoidingView works out the keyboard's overlap from its own position, but on iOS it ignores a native
// stack header above it. The group screen (app/room/[id].tsx) keeps that header, so the avoiding view must be
// told how far down the screen it starts. The bot chat draws its own header (top = 0), so it needs no offset.
export function keyboardOffset(os: string, inPane: boolean, top: number): number {
  if (os !== 'ios' || inPane) return 0;
  return Number.isFinite(top) && top > 0 ? Math.round(top) : 0;
}
