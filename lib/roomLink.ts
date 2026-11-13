// One shared /api/ws connection for the rooms screens (card 8). Opens when first used, reopens after the
// phone slept or the socket dropped, and retries a call once on a fresh socket. Plain TypeScript with an
// injectable url source and WebSocket constructor, so it's unit-tested in Node.
import { GatewayError, GatewaySocket, gatewayWsUrl, type WsCtor } from './gatewayWs';
import { RoomClient, type Call } from './rooms';

export class RoomLink {
  private socket: GatewaySocket | null = null;
  private opening: Promise<GatewaySocket> | null = null;
  private dead = true;

  constructor(
    /** `hermes serve` base URL and a fresh access token, or null when the phone isn't paired. */
    private readonly auth: () => Promise<{ adminUrl: string; token: string } | null>,
    private readonly Ctor: WsCtor,
  ) {}

  private async open(): Promise<GatewaySocket> {
    if (this.socket && !this.dead) return this.socket;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const a = await this.auth();
      if (!a) throw new GatewayError('Connect to Hermes first.');
      const s: GatewaySocket = new GatewaySocket(gatewayWsUrl(a.adminUrl, a.token), this.Ctor, {
        onClose: () => {
          if (this.socket === s) this.dead = true;
        },
      });
      await s.open();
      this.socket = s;
      this.dead = false;
      return s;
    })().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  readonly call: Call = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const attempt = async () => (await this.open()).call<T>(method, params);
    try {
      return await attempt();
    } catch (e) {
      // A dropped socket (sleep, network change) has no server error code: one retry on a new socket.
      // A server error (it has a code) stays an error. Resending is safe: groups.send is idempotent on event_id.
      if (e instanceof GatewayError && e.code === undefined) {
        this.dead = true;
        return attempt();
      }
      throw e;
    }
  };

  get client(): RoomClient {
    return new RoomClient(this.call);
  }

  /** The app went to the background: let go of the socket. The next call opens a new one. */
  close(): void {
    this.dead = true;
    this.socket?.close();
    this.socket = null;
  }
}
