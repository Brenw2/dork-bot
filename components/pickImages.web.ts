// Picking pictures on the desktop (web build): a file picker, paste (Ctrl+V a screenshot), and
// drag-and-drop onto the chat. Each is shrunk to MAX_SIDE in a canvas. PNG screenshots that are
// already small stay PNG, so their text stays sharp.
import { useEffect } from 'react';
import { fitSize, MAX_IMAGES, type Attachment } from '@/lib/attachments';

export type PickSource = 'camera' | 'library';

export const PICK_SOURCES: { source: PickSource; label: string }[] = [{ source: 'library', label: 'Choose pictures…' }];

const KEEP_PNG_BYTES = 1_500_000;

export function pickImages(_source: PickSource, already = 0): Promise<Attachment[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])].slice(0, Math.max(0, MAX_IMAGES - already));
      resolve(await Promise.all(files.map(fromFile)));
    };
    // Closing the picker without choosing: there's no event; the promise just stays open, harmless.
    input.click();
  });
}

export async function fromFile(file: Blob): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const size = fitSize(bitmap.width, bitmap.height);
  if (file.type === 'image/png' && file.size <= KEEP_PNG_BYTES && size.width === bitmap.width) {
    bitmap.close();
    return { dataUrl: await readAsDataUrl(file), width: size.width, height: size.height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff'; // transparent PNGs onto white, not black, as JPEG
  g.fillRect(0, 0, size.width, size.height);
  g.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: size.width, height: size.height };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const imagesIn = (list: DataTransferItemList | FileList | null | undefined): File[] => {
  if (!list) return [];
  const files: File[] = [];
  for (const it of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && f.type.startsWith('image/')) files.push(f);
  }
  return files;
};

/** Paste a screenshot or drop pictures anywhere on the open chat to attach them. */
export function useImageDrop(onImages: (images: Attachment[]) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesIn(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      void Promise.all(files.map(fromFile)).then(onImages);
    };
    const onDragOver = (e: DragEvent) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const files = imagesIn(e.dataTransfer?.files);
      if (!files.length) return;
      e.preventDefault();
      void Promise.all(files.map(fromFile)).then(onImages);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onImages, enabled]);
}
