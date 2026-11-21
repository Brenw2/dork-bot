// The "Paste photo" chip above the message box. Plain TypeScript, unit-tested; Composer draws it.
import { MAX_IMAGES, type Attachment } from '@/lib/attachments';

export interface PasteChipState {
  /** The screen takes pictures at all (it passed onImages). */
  accepts: boolean;
  /** Connected: the box isn't read-only. */
  enabled: boolean;
  /** The message box has focus. The clipboard is only looked at then, never in the background. */
  focused: boolean;
  /** Answer of the clipboard check made when the box got focus. */
  clipboardHasImage: boolean;
  /** Pictures already attached to this message. */
  attached: number;
}

export function showPasteChip(s: PasteChipState): boolean {
  return s.accepts && s.enabled && s.focused && s.clipboardHasImage && s.attached < MAX_IMAGES;
}

/** Attach the clipboard's picture like a camera or library photo: same onImages, same error line. */
export async function runPaste(
  paste: (already: number) => Promise<Attachment[]>,
  attached: number,
  onImages: (more: Attachment[]) => void,
  onError: (message: string) => void,
): Promise<void> {
  try {
    const more = await paste(attached);
    if (more.length) onImages(more);
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Could not paste that picture.');
  }
}
