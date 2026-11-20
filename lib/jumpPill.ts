// The "Jump to latest" pill (Design's streaming spec): show it only while the reader has scrolled up more than
// about one screen from the end AND new text has arrived since.
export function jumpVisible(o: { distanceFromEnd: number; viewport: number; unseen: boolean }): boolean {
  return o.unseen && o.viewport > 0 && o.distanceFromEnd > o.viewport;
}

/** How far the view is from the end of the transcript. The phone's list is inverted: its offset is the distance already. */
export function distanceFromEnd(o: { inverted: boolean; offset: number; content: number; viewport: number }): number {
  return Math.max(0, o.inverted ? o.offset : o.content - o.viewport - o.offset);
}
