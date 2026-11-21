// Card 30: paste photos. iOS (expo-clipboard mocked): the chip's rule and the paste itself. Desktop: the window
// paste/drop handlers, which the shared Composer installs for the 1:1 chat (and a room, once it takes pictures).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clipboard = vi.hoisted(() => ({ hasImageAsync: vi.fn(), getImageAsync: vi.fn() }));
const manipulator = vi.hoisted(() => ({ renderAsync: vi.fn(), saveAsync: vi.fn(), resize: vi.fn() }));
vi.mock('expo-clipboard', () => clipboard);
vi.mock('expo-image-picker', () => ({}));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({ resize: manipulator.resize, renderAsync: async () => ({ saveAsync: manipulator.saveAsync }) }),
  },
}));

import { clipboardHasImage, pasteClipboardImage } from '../components/pickImages';
import { imageHandlers, imagesIn } from '../components/pickImages.web';
import { MAX_IMAGES, MAX_SIDE, type Attachment } from '../lib/attachments';
import { runPaste, showPasteChip, type PasteChipState } from '../lib/pasteChip';

const jpeg = 'data:image/jpeg;base64,AAAA';
beforeEach(() => vi.resetAllMocks());

describe('clipboardHasImage (checked on focus)', () => {
  it('asks the clipboard and returns its answer', async () => {
    clipboard.hasImageAsync.mockResolvedValue(true);
    expect(await clipboardHasImage()).toBe(true);
    clipboard.hasImageAsync.mockResolvedValue(false);
    expect(await clipboardHasImage()).toBe(false);
  });
  it('an error means no chip', async () => {
    clipboard.hasImageAsync.mockRejectedValue(new Error('denied'));
    expect(await clipboardHasImage()).toBe(false);
  });
});

describe('pasteClipboardImage', () => {
  it('attaches a clipboard picture as a JPEG attachment, like a library photo', async () => {
    clipboard.getImageAsync.mockResolvedValue({ data: jpeg, size: { width: 800, height: 600 } });
    expect(await pasteClipboardImage(0)).toEqual([{ dataUrl: jpeg, width: 800, height: 600 }]);
    expect(clipboard.getImageAsync).toHaveBeenCalledWith({ format: 'jpeg', jpegQuality: 0.82 });
  });
  it('shrinks a picture longer than MAX_SIDE', async () => {
    clipboard.getImageAsync.mockResolvedValue({ data: jpeg, size: { width: MAX_SIDE * 2, height: MAX_SIDE } });
    manipulator.saveAsync.mockResolvedValue({ base64: 'BBBB', width: MAX_SIDE, height: MAX_SIDE / 2 });
    const [a] = await pasteClipboardImage(0);
    expect(a).toEqual({ dataUrl: 'data:image/jpeg;base64,BBBB', width: MAX_SIDE, height: MAX_SIDE / 2 });
    expect(manipulator.resize).toHaveBeenCalled();
  });
  it('says so in plain words when a huge picture cannot be shrunk', async () => {
    clipboard.getImageAsync.mockResolvedValue({ data: jpeg, size: { width: MAX_SIDE * 2, height: MAX_SIDE } });
    manipulator.saveAsync.mockRejectedValue(new Error('bad uri'));
    await expect(pasteClipboardImage(0)).rejects.toThrow('too big to paste');
  });
  it('nothing on the clipboard, or no room left: nothing attached', async () => {
    clipboard.getImageAsync.mockResolvedValue(null);
    expect(await pasteClipboardImage(0)).toEqual([]);
    clipboard.getImageAsync.mockClear();
    expect(await pasteClipboardImage(MAX_IMAGES)).toEqual([]);
    expect(clipboard.getImageAsync).not.toHaveBeenCalled();
  });
});

describe('Paste photo chip', () => {
  const on: PasteChipState = { accepts: true, enabled: true, focused: true, clipboardHasImage: true, attached: 0 };
  it('shows while the box is focused and the clipboard has a picture', () => expect(showPasteChip(on)).toBe(true));
  it.each([
    ['not focused', { focused: false }],
    ['clipboard has no picture', { clipboardHasImage: false }],
    ['the screen takes no pictures', { accepts: false }],
    ['offline', { enabled: false }],
    ['already at the picture limit', { attached: MAX_IMAGES }],
  ])('hidden when %s', (_n, patch) => expect(showPasteChip({ ...on, ...patch })).toBe(false));

  it('tapping it attaches the picture through onImages (same path as camera and library)', async () => {
    const got: Attachment[][] = [];
    clipboard.getImageAsync.mockResolvedValue({ data: jpeg, size: { width: 10, height: 10 } });
    await runPaste(pasteClipboardImage, 2, (m) => got.push(m), () => {});
    expect(got).toEqual([[{ dataUrl: jpeg, width: 10, height: 10 }]]);
  });
  it('a failed paste shows the error line and attaches nothing', async () => {
    const errors: string[] = [];
    const got: Attachment[][] = [];
    await runPaste(async () => { throw new Error('nope'); }, 0, (m) => got.push(m), (m) => errors.push(m));
    expect(errors).toEqual(['nope']);
    expect(got).toEqual([]);
  });
  it('an empty clipboard attaches nothing and shows no error', async () => {
    const onImages = vi.fn();
    const onError = vi.fn();
    await runPaste(async () => [], 0, onImages, onError);
    expect(onImages).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

// ---- Desktop: the window handlers ----
const png = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
const txt = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' });
const fakeAttachment = (): Attachment => ({ dataUrl: 'data:image/png;base64,AA', width: 1, height: 1 });
const item = (f: File) => ({ kind: 'file', type: f.type, getAsFile: () => f });
function pasteEvent(files: File[], data: Record<string, string> = {}) {
  const preventDefault = vi.fn();
  const e = {
    preventDefault,
    clipboardData: { items: files.map(item), types: Object.keys(data), getData: (t: string) => data[t] ?? '' },
  } as unknown as ClipboardEvent;
  return { e, preventDefault };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('desktop paste handler (Composer: 1:1 chat and rooms)', () => {
  it('Ctrl/Cmd+V of a screenshot attaches it and stops the browser from pasting it', async () => {
    const onImages = vi.fn();
    const h = imageHandlers(onImages, async () => fakeAttachment());
    const { e, preventDefault } = pasteEvent([png]);
    h.onPaste(e);
    await flush();
    expect(preventDefault).toHaveBeenCalled();
    expect(onImages).toHaveBeenCalledWith([fakeAttachment()]);
  });
  it('a text paste is left alone, so text still pastes', async () => {
    const onImages = vi.fn();
    const h = imageHandlers(onImages, async () => fakeAttachment());
    const { e, preventDefault } = pasteEvent([], { 'text/plain': 'hello' });
    h.onPaste(e);
    await flush();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onImages).not.toHaveBeenCalled();
  });
  it('rich text that carries a picture of itself (a spreadsheet range) pastes as text', async () => {
    const onImages = vi.fn();
    const h = imageHandlers(onImages, async () => fakeAttachment());
    const { e, preventDefault } = pasteEvent([png], { 'text/plain': 'a\tb', 'text/html': '<table></table>' });
    h.onPaste(e);
    await flush();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onImages).not.toHaveBeenCalled();
  });
  it('a copied web picture (html, no plain text) attaches', async () => {
    const onImages = vi.fn();
    const h = imageHandlers(onImages, async () => fakeAttachment());
    const { e, preventDefault } = pasteEvent([png], { 'text/html': '<img src="x">' });
    h.onPaste(e);
    await flush();
    expect(preventDefault).toHaveBeenCalled();
    expect(onImages).toHaveBeenCalled();
  });
  it('a pasted file that is not a picture is ignored', () => {
    expect(imagesIn([item(txt)] as unknown as DataTransferItemList)).toEqual([]);
  });
  it('drop attaches dropped pictures only; dragover accepts files', async () => {
    const onImages = vi.fn();
    const h = imageHandlers(onImages, async () => fakeAttachment());
    const preventDefault = vi.fn();
    h.onDragOver({ preventDefault, dataTransfer: { items: [{ kind: 'file' }] } } as unknown as DragEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    h.onDrop({ preventDefault, dataTransfer: { files: [png, txt] } } as unknown as DragEvent);
    await flush();
    expect(onImages).toHaveBeenCalledWith([fakeAttachment()]);
    h.onDrop({ preventDefault, dataTransfer: { files: [txt] } } as unknown as DragEvent);
    await flush();
    expect(onImages).toHaveBeenCalledTimes(1);
  });
});
