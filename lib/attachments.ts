// Photos and screenshots in chats. Plain TypeScript, unit-tested.
//
// Sending: Hermes's session chat takes OpenAI-style content parts, so a message with pictures is
// [{type: 'text', text}, {type: 'image_url', image_url: {url: 'data:image/jpeg;base64,…'}}…].
// The request limit is 10 MB, so pictures are shrunk before sending (MAX_SIDE, JPEG).
//
// History: Hermes saves each picture as a file under the bot's profile and keeps only its path in
// the message text: "…\n\n[Image attached at: /home/…/native-inputs/…/api_….png]\n[screenshot]".
// The app strips those lines from what it shows and loads the file back through hermes serve
// (GET /api/files/read?path=…&profile=<bot> → {data_url}), so both devices show the picture.

/** Longest side, in pixels, of a picture as sent. Big enough to read a screenshot's text. */
export const MAX_SIDE = 2000;
/** Keep the whole request well under Hermes's 10 MB limit (base64 adds a third). */
export const MAX_TOTAL_BYTES = 7_000_000;
export const MAX_IMAGES = 6;

export interface Attachment {
  /** data:image/…;base64,… */
  dataUrl: string;
  width?: number;
  height?: number;
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** The `message` field for a chat turn: plain text, or parts when there are pictures. */
export function messageBody(text: string, images: Attachment[]): string | ContentPart[] {
  if (!images.length) return text;
  const parts: ContentPart[] = [];
  // Hermes needs some text; a picture on its own still says what it is.
  parts.push({ type: 'text', text: text.trim() || (images.length === 1 ? 'Here’s a picture.' : `Here are ${images.length} pictures.`) });
  for (const im of images) parts.push({ type: 'image_url', image_url: { url: im.dataUrl } });
  return parts;
}

/** Bytes a data URL decodes to (roughly; base64 is 4 chars per 3 bytes). */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  return Math.floor(((url.length - comma - 1) * 3) / 4);
}

/** Why these pictures can't go in one message, or null if they can. */
export function attachmentProblem(images: Attachment[]): string | null {
  if (images.length > MAX_IMAGES) return `Up to ${MAX_IMAGES} pictures per message.`;
  const total = images.reduce((n, im) => n + dataUrlBytes(im.dataUrl), 0);
  if (total > MAX_TOTAL_BYTES) return 'Those pictures are too big for one message. Send fewer at a time.';
  return null;
}

const ATTACHED = /^\[Image attached at: (.+)\]$/;

/** Splits a stored user message into what to show and the pictures' paths on Hermes. */
export function splitStoredImages(content: string): { text: string; images: string[] } {
  const images: string[] = [];
  const kept: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(ATTACHED);
    if (m) {
      images.push(m[1].trim());
      // Hermes follows each one with a "[screenshot]" / "[image]" label line.
      if (/^\[(screenshot|image|photo)\]$/i.test(lines[i + 1]?.trim() ?? '')) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  if (!images.length) return { text: content, images };
  // The text Hermes gave a picture-only message ("Here's a picture.") is ours; hide it.
  const text = kept.join('\n').trim();
  return { text: /^Here(’|')s a picture\.$|^Here are \d+ pictures\.$/.test(text) ? '' : text, images };
}

/** Fits width × height inside MAX_SIDE, keeping the shape. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
