// Client for the Hermes backend (`hermes serve`), which can create, list and
// delete profiles. A bot = a Hermes profile, so this is how the app makes bots.
// Chat still goes to the gateway's API server (lib/hermes.ts) with each bot's own key.
//
// Auth: Hermes's login gate (username/password provider). scripts/pair-hermes.sh
// signs in on b-lab and hands the app a refresh token; the app trades it for
// short-lived bearer tokens at /auth/native/refresh and keeps the newest one.
import { HermesClient, HermesError, normalizeUrl, type BotConnection, type FetchLike, type FetchResponse } from './hermes';
import { isValidBotName } from './pairing';
import type { ModelChoice } from './models';
import { CHARACTER_IDS, type CharacterId, type Look } from './sprites';

export interface ManagerAuth {
  /** `hermes serve` base URL, e.g. https://b-lab.tail7e27a7.ts.net:8443 */
  adminUrl: string;
  /** Gateway API server base URL the bots chat on, e.g. https://b-lab.tail7e27a7.ts.net */
  chatUrl: string;
  refreshToken: string;
}

export interface Profile {
  name: string;
  description: string;
  model: string | null;
  provider: string | null;
  isDefault: boolean;
}

export interface NewBot {
  name: string;
  job: string;
}

/** The profile new bots are cloned from. It must be pinned to Dork (local Ollama). */
export const TEMPLATE_PROFILE = 'assistant';
const KEY_VAR = 'API_SERVER_KEY';

export class HermesManager {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private auth: ManagerAuth,
    private readonly fetchImpl: FetchLike,
    /** Called with each new refresh token so the app can keep the newest. */
    private readonly onRefreshToken: (token: string) => void | Promise<void> = () => {},
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  get chatUrl(): string {
    return this.auth.chatUrl;
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt - 60 > this.now()) return this.access.token;
    const res = await this.raw('/auth/native/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.auth.refreshToken, provider: 'basic' }),
    });
    if (res.status === 401) {
      throw new HermesError('The sign-in to Hermes expired. Run scripts/pair-hermes.sh on b-lab and scan the code again.', 401);
    }
    if (!res.ok) throw new HermesError(`Hermes sign-in failed: HTTP ${res.status} ${await safeText(res)}`, res.status);
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_at?: number };
    if (!body.access_token) throw new HermesError('Hermes sign-in returned no token.');
    this.access = { token: body.access_token, expiresAt: body.expires_at ?? this.now() + 300 };
    if (body.refresh_token && body.refresh_token !== this.auth.refreshToken) {
      this.auth = { ...this.auth, refreshToken: body.refresh_token };
      await this.onRefreshToken(body.refresh_token);
    }
    return this.access.token;
  }

  private async raw(path: string, init: Parameters<FetchLike>[1] = {}): Promise<FetchResponse> {
    try {
      const fetchImpl = this.fetchImpl; // unbound, see HermesClient.request
      return await fetchImpl(`${normalizeUrl(this.auth.adminUrl)}${path}`, init);
    } catch (err) {
      throw new HermesError(`Can't reach Hermes at ${normalizeUrl(this.auth.adminUrl)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** An authenticated call to `hermes serve` (also used by lib/connectors.ts). */
  async api(path: string, method = 'GET', body?: unknown): Promise<FetchResponse> {
    const send = async () =>
      this.raw(path, {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let res = await send();
    if (res.status === 401) {
      // The access token may have been revoked or the server restarted: refresh once.
      this.access = null;
      res = await send();
    }
    return res;
  }

  async listProfiles(): Promise<Profile[]> {
    const res = await this.api('/api/profiles');
    if (!res.ok) throw await fail(res, "Couldn't list Hermes profiles");
    const body = (await res.json()) as { profiles?: RawProfile[] };
    return (body.profiles ?? []).map((p) => ({
      name: p.name,
      description: p.description ?? '',
      model: p.model ?? null,
      provider: p.provider ?? null,
      isDefault: !!p.is_default,
    }));
  }

  /**
   * Makes a bot: clones the Dork-pinned template profile (model, tools, skills;
   * not its memory), writes SOUL.md from the job, gives it its own API server
   * key, and waits until the gateway accepts that key.
   */
  async createBot(bot: NewBot, randomKey: () => string, opts: WaitOptions = {}): Promise<BotConnection> {
    const name = bot.name.trim().toLowerCase();
    const job = bot.job.trim();
    if (!isValidBotName(name)) throw new HermesError('Bot names are lowercase letters, numbers, - and _.');
    if (!job) throw new HermesError('Say what the bot does.');

    const template = (await this.listProfiles()).find((p) => p.name === TEMPLATE_PROFILE);
    if (!template) throw new HermesError(`The template profile "${TEMPLATE_PROFILE}" isn't on Hermes.`);
    if (!isLocalModel(template)) {
      throw new HermesError(`"${TEMPLATE_PROFILE}" isn't pinned to Dork (it uses ${template.provider}/${template.model}), so new bots would too.`);
    }

    const res = await this.api('/api/profiles', 'POST', {
      name,
      clone_from: TEMPLATE_PROFILE,
      description: job,
      soul: soulFor(name, job),
    });
    if (!res.ok) {
      const err = await fail(res, "Couldn't create the bot");
      if (res.status === 400 && err.message.includes('already exists')) {
        throw new HermesError(`There's already a bot called ${name}.`, 400);
      }
      throw err;
    }

    const key = randomKey();
    await this.setKey(name, key);
    const conn = { url: this.auth.chatUrl, bot: name, key };
    await waitForBot(conn, this.fetchImpl, opts);
    return conn;
  }

  /** Connects an existing profile: uses its key, or gives it one if it has none. */
  async connectExisting(name: string, randomKey: () => string, opts: WaitOptions = {}): Promise<BotConnection> {
    let key = await this.revealKey(name);
    if (!key) {
      key = randomKey();
      await this.setKey(name, key);
    }
    const conn = { url: this.auth.chatUrl, bot: name, key };
    await waitForBot(conn, this.fetchImpl, opts);
    return conn;
  }

  /**
   * Sets the bot's own model in its Hermes settings (what new chats start on, and what its
   * provider is). Same call as the Hermes dashboard's model picker.
   */
  async setBotModel(name: string, choice: { provider: string; model: string }): Promise<void> {
    const res = await this.api('/api/model/set', 'POST', { scope: 'main', provider: choice.provider, model: choice.model, profile: name });
    if (!res.ok) throw await fail(res, `Couldn't set ${name} to ${choice.model}`);
  }

  /**
   * The app's own settings for a bot (look, model pick, hidden), kept on Hermes in the
   * profile's config under `dork_bot`, so the phone and the desktop app share them.
   */
  async getMeta(name: string): Promise<BotMeta> {
    const res = await this.api(`/api/config?profile=${encodeURIComponent(name)}&include_defaults=false`);
    if (!res.ok) throw await fail(res, `Couldn't read ${name}'s settings`);
    const body = (await res.json()) as { dork_bot?: unknown };
    return cleanMeta(body.dork_bot);
  }

  /** Merges `patch` into the bot's `dork_bot` settings (Hermes deep-merges, other settings stay). */
  async setMeta(name: string, patch: BotMeta): Promise<void> {
    const res = await this.api(`/api/config?profile=${encodeURIComponent(name)}`, 'PUT', { config: { dork_bot: patch } });
    if (!res.ok) throw await fail(res, `Couldn't save ${name}'s settings`);
  }

  /**
   * A picture sent in a chat, as a data URL. Hermes keeps it as a file in the bot's profile
   * (the path is in the message, see lib/attachments.ts); its media endpoint won't serve profile
   * folders, but the file reader does.
   */
  async image(bot: string, path: string): Promise<string> {
    const res = await this.api(`/api/files/read?path=${encodeURIComponent(path)}&profile=${encodeURIComponent(bot)}`);
    if (!res.ok) throw await fail(res, "Couldn't load the picture");
    const body = (await res.json()) as { data_url?: string };
    if (!body.data_url?.startsWith('data:image/')) throw new HermesError("That file isn't a picture.");
    return body.data_url;
  }

  /** Permanently deletes the profile: its config, memory, chats and routines. */
  async deleteBot(name: string): Promise<void> {
    if (name === 'default') throw new HermesError("The default profile can't be deleted.");
    const res = await this.api(`/api/profiles/${encodeURIComponent(name)}`, 'DELETE');
    if (res.status === 404) return;
    if (!res.ok) throw await fail(res, `Couldn't delete ${name}`);
  }

  private async setKey(name: string, key: string): Promise<void> {
    const res = await this.api(`/api/env?profile=${encodeURIComponent(name)}`, 'PUT', { key: KEY_VAR, value: key });
    if (!res.ok) throw await fail(res, `Couldn't give ${name} a key`);
  }

  private async revealKey(name: string): Promise<string | null> {
    const res = await this.api(`/api/env/reveal?profile=${encodeURIComponent(name)}`, 'POST', { key: KEY_VAR });
    if (res.status === 404) return null;
    if (!res.ok) throw await fail(res, `Couldn't read ${name}'s key`);
    const body = (await res.json()) as { value?: string };
    return body.value && body.value.length >= 16 ? body.value : null;
  }
}

/** What the app stores per bot on Hermes (profile config, `dork_bot:` block). */
export interface BotMeta {
  look?: Look;
  model?: ModelChoice;
  /** Hidden from the app on every device; the bot stays on Hermes. */
  hidden?: boolean;
}

/** Keeps only well-formed fields: the block lives in a YAML file anyone can edit. */
export function cleanMeta(raw: unknown): BotMeta {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const meta: BotMeta = {};
  const look = r.look as Record<string, unknown> | undefined;
  if (look && CHARACTER_IDS.includes(look.character as CharacterId) && typeof look.variant === 'number' && typeof look.color === 'string') {
    meta.look = { character: look.character as CharacterId, variant: look.variant, color: look.color };
  }
  const model = r.model as Record<string, unknown> | undefined;
  if (model && typeof model.provider === 'string' && typeof model.model === 'string') {
    meta.model = { provider: model.provider, model: model.model };
  }
  if (typeof r.hidden === 'boolean') meta.hidden = r.hidden;
  return meta;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The gateway picks up a new key within a few seconds; poll until it does. */
export async function waitForBot(conn: BotConnection, fetchImpl: FetchLike, opts: WaitOptions = {}): Promise<void> {
  const { timeoutMs = 30_000, intervalMs = 2_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  const client = new HermesClient(conn, fetchImpl);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.check();
      return;
    } catch (err) {
      const status = (err as HermesError).status;
      if ((status !== 401 && status !== 404) || Date.now() >= deadline) {
        if (status === 401 || status === 404) {
          throw new HermesError(`${conn.bot} was created, but the gateway hasn't picked up its key yet. Try again in a minute; if it still fails, restart the gateway.`, status);
        }
        throw err;
      }
    }
    await sleep(intervalMs);
  }
}

export function isLocalModel(p: Pick<Profile, 'provider' | 'model'>): boolean {
  return p.provider === 'custom' || p.provider === 'ollama';
}

export function soulFor(name: string, job: string): string {
  const display = name.charAt(0).toUpperCase() + name.slice(1);
  return [
    `You are ${display}, one of Brennan's AI teammates in the Dork Bot app.`,
    '',
    `Your job: ${job}`,
    '',
    'Brennan messages you from his phone, like texting a coworker. Keep replies short and plain unless he asks for detail.',
    "Use your tools when they help, and say so when you can't do something.",
  ].join('\n');
}

interface RawProfile {
  name: string;
  description?: string;
  model?: string | null;
  provider?: string | null;
  is_default?: boolean;
}

export async function fail(res: FetchResponse, what: string): Promise<HermesError> {
  const text = await safeText(res);
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') detail = parsed.detail;
  } catch {
    // not JSON
  }
  return new HermesError(`${what}: ${detail || `HTTP ${res.status}`}`, res.status);
}

async function safeText(res: FetchResponse): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
