// The Linux desktop app's bridge (desktop/preload.cjs), or null on the phone and in a plain
// browser (the layout tests). Screens check `isDesktop` for desktop-only touches.
export interface DesktopBridge {
  platform: string;
  fetchStart(id: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean }>;
  fetchAbort(id: string): void;
  onFetchEvent(fn: (id: string, kind: 'chunk' | 'end' | 'error', data?: Uint8Array | string) => void): void;
  storeGet(key: string): Promise<string | null>;
  storeSet(key: string, value: string): Promise<void>;
  storeDelete(key: string): Promise<void>;
  storeBackend(): Promise<string>;
  openAuth(url: string): Promise<void>;
  closeAuth(): void;
  message(opts: {
    title: string;
    message?: string;
    buttons: string[];
    cancelId?: number;
    defaultId?: number;
    destructive?: boolean;
    checkboxLabel?: string;
  }): Promise<{ response: number; checked: boolean }>;
}

declare global {
  var dorkDesktop: DesktopBridge | undefined;
}

export const desktop: DesktopBridge | null = globalThis.dorkDesktop ?? null;
export const isDesktop = desktop !== null;
