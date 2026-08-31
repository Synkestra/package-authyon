import { DEFAULT_EXPIRY_SKEW_MS } from "../config/defaults";

export interface AcquiredToken {
  accessToken: string;
  expiresAt: number;
}

/** In-memory single-flight provider for short-lived machine tokens. */
export class ExpiringTokenProvider {
  private token: AcquiredToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly acquire: () => Promise<AcquiredToken>,
    private readonly expirySkewMs = DEFAULT_EXPIRY_SKEW_MS,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - this.expirySkewMs) {
      return this.token.accessToken;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.acquire()
      .then((token) => {
        this.token = token;
        return token.accessToken;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  clear(): void {
    this.token = null;
  }
}
