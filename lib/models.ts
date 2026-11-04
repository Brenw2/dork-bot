// Which models a bot can use, and which one its chat is on.
// Hermes lists them per bot at GET /api/model/options (the same list as its own model picker),
// and switches one chat with POST /api/sessions/<id>/model; the next message uses the new model.
// Plain TypeScript, no React, so it's unit-tested on a real capture (test/fixtures/model-options.json).

export interface ModelChoice {
  /** Hermes provider slug, e.g. "anthropic", "custom:dork". */
  provider: string;
  model: string;
}

export interface ProviderGroup {
  slug: string;
  /** What to show: "Anthropic", "Dork". */
  name: string;
  /** The provider the bot is set to in its Hermes settings. */
  current: boolean;
  /** A provider added by hand in Hermes's settings (here: Dork, the local model). */
  userDefined: boolean;
  models: string[];
}

export interface ModelCatalog {
  /** The bot's own setting (what a new chat starts on). */
  botDefault: ModelChoice | null;
  providers: ProviderGroup[];
}

interface RawProvider {
  slug?: string;
  name?: string;
  is_current?: boolean;
  is_user_defined?: boolean;
  authenticated?: boolean;
  models?: unknown;
  unavailable_models?: unknown;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Only providers Hermes is signed in to, only models it says are usable, the bot's own provider
 * first, then hand-added ones (Dork), then the rest. "-acp" providers are the same accounts again
 * over the editor protocol, so they're left out.
 */
export function parseModelOptions(raw: unknown): ModelCatalog {
  const body = (raw ?? {}) as { model?: unknown; provider?: unknown; providers?: RawProvider[] };
  const groups: ProviderGroup[] = [];
  for (const p of Array.isArray(body.providers) ? body.providers : []) {
    if (!p.slug || p.authenticated === false || p.slug.endsWith('-acp')) continue;
    const off = new Set(strings(p.unavailable_models));
    const models = [...new Set(strings(p.models))].filter((m) => !off.has(m));
    if (!models.length) continue;
    groups.push({
      slug: p.slug,
      name: displayName(p.name || p.slug),
      current: !!p.is_current,
      userDefined: !!p.is_user_defined,
      models,
    });
  }
  const rank = (g: ProviderGroup) => (g.current ? 0 : g.userDefined ? 1 : 2);
  const providers = groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);

  const model = typeof body.model === 'string' && body.model ? body.model : null;
  // body.provider can be the generic "custom"; the flagged group has the real slug ("custom:dork").
  const provider = providers.find((g) => g.current)?.slug ?? (typeof body.provider === 'string' ? body.provider : '');
  return { botDefault: model && provider ? { provider, model } : null, providers };
}

function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface ChatModel {
  /** What the chat is on now, as best we can tell. Null until the catalog loads. */
  choice: ModelChoice | null;
  /** Set when the chat's model can't work with the provider it'll go to. Says why, in plain words. */
  problem: string | null;
}

/**
 * Works out which model and provider the bot's chat is on.
 *
 * Hermes only reports a chat's model name, not its provider, so: the choice this phone made (if it's
 * still the chat's model), else the bot's own provider when it has that model, else the first
 * provider that has it. A chat with no switch goes to the bot's own provider, so if that provider
 * doesn't have the chat's model, every message fails (e.g. a bot moved to Anthropic while its chat
 * still says gemma4:31b): that's the problem we report.
 */
export function chatModel(sessionModel: string | null, saved: ModelChoice | null | undefined, catalog: ModelCatalog | null): ChatModel {
  if (!catalog) return { choice: saved ?? null, problem: null };
  const def = catalog.botDefault;
  if (!sessionModel) return { choice: def, problem: null };
  if (saved && saved.model === sessionModel) return { choice: saved, problem: null };
  const own = catalog.providers.find((g) => g.slug === def?.provider);
  if (own?.models.includes(sessionModel)) return { choice: { provider: own.slug, model: sessionModel }, problem: null };
  const other = catalog.providers.find((g) => g.models.includes(sessionModel));
  const ownName = own?.name ?? def?.provider ?? 'its provider';
  return {
    choice: other ? { provider: other.slug, model: sessionModel } : { provider: '', model: sessionModel },
    problem: `This chat is set to ${sessionModel}, but the bot now uses ${ownName}, which doesn't have it. Pick a model to fix it.`,
  };
}

export function providerName(catalog: ModelCatalog | null, slug: string): string {
  return catalog?.providers.find((g) => g.slug === slug)?.name ?? slug;
}

/**
 * The provider id a chat's model lock must name. Hermes checks a lock against the provider the
 * turn actually ran on, and a hand-added provider runs as plain "custom" (a lock naming
 * "custom:dork" gets a good reply thrown away as a "runtime mismatch"). "custom" means the
 * endpoint in the bot's own settings, so lock to it only once the bot itself is on that provider.
 */
export function lockProvider(slug: string): string {
  return slug.startsWith('custom:') ? 'custom' : slug;
}

/** What switchModel needs from the app's two Hermes clients (lib/hermes.ts, lib/manager.ts). */
export interface ModelSwitchDeps {
  setChatModel: (choice: ModelChoice) => Promise<void>;
  /** Null when the phone isn't connected to the bot manager (scripts/pair-hermes.sh). */
  setBotModel: ((choice: ModelChoice) => Promise<void>) | null;
}

/**
 * Switches a bot to a model, on the fly:
 * 1. the bot's own setting (so new chats and its provider match), when the manager is connected;
 * 2. then the open chat, which otherwise keeps sending its old model to the new provider.
 * Without the manager only the chat switches, which can't reach a hand-added provider like Dork
 * unless the bot is already set to it.
 */
export async function switchModel(choice: ModelChoice, botDefault: ModelChoice | null, deps: ModelSwitchDeps): Promise<void> {
  if (deps.setBotModel) await deps.setBotModel(choice);
  else if (choice.provider.startsWith('custom:') && botDefault?.provider !== choice.provider) {
    throw new Error(`Switching to ${choice.model} changes the bot's settings, so the app needs the Hermes sign-in first (scripts/pair-hermes.sh).`);
  }
  await deps.setChatModel({ provider: lockProvider(choice.provider), model: choice.model });
}

/** Case-insensitive filter on model and provider names. Drops providers left with no models. */
export function filterCatalog(catalog: ModelCatalog, query: string): ProviderGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalog.providers;
  return catalog.providers
    .map((g) => (g.name.toLowerCase().includes(q) ? g : { ...g, models: g.models.filter((m) => m.toLowerCase().includes(q)) }))
    .filter((g) => g.models.length);
}
