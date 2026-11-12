import { randomUUID } from 'node:crypto';
import { isPublicMessage, MessageInputError, type MessageList, type MessageResult, type MessageSubmission, type PublicMessage } from './messages.js';

export interface TributeState {
  totalTributes: number;
  onlineNow: number;
  participated: boolean;
}

export interface ContributionState extends TributeState {
  added: boolean;
}

export interface TributeStore {
  presence(visitorHash: string, rateKey: string): Promise<TributeState>;
  tribute(visitorHash: string, rateKey: string): Promise<ContributionState>;
  readPublicMessages(limit?: number): Promise<MessageList>;
  postMessage(visitorHash: string, rateKey: string, input: MessageSubmission): Promise<MessageResult>;
}

export const PRESENCE_WINDOW_MS = 90_000;
export const RATE_WINDOW_MS = 60_000;
export const PRESENCE_RATE_LIMIT = 600;
export const TRIBUTE_RATE_LIMIT = 60;

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many requests. Please try again shortly.');
    this.name = 'RateLimitError';
  }
}

/** Explicit development adapter. Never use this for deployed shared counts. */
export class MemoryTributeStore implements TributeStore {
  private readonly participants = new Set<string>();
  private readonly activity = new Map<string, number>();
  private readonly rates = new Map<string, { window: number; count: number; expiresAt: number }>();
  private readonly messages: PublicMessage[] = [];
  private readonly messageRequests = new Map<string, PublicMessage>();

  constructor(private readonly now: () => number = Date.now) {}

  private checkRate(action: string, rateKey: string, limit: number, windowMs = RATE_WINDOW_MS, consume = true): void {
    const now = this.now();
    const window = Math.floor(now / windowMs);
    const key = `${action}:${rateKey}`;
    const previous = this.rates.get(key);
    const count = previous?.window === window ? previous.count : 0;
    if (count >= limit) {
      throw new RateLimitError(Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)));
    }
    if (!consume) return;
    this.rates.set(key, { window, count: count + 1, expiresAt: (window + 1) * windowMs });
    for (const [oldKey, value] of this.rates) {
      if (value.expiresAt < now - 86_400_000) this.rates.delete(oldKey);
    }
  }

  private state(visitorHash: string): TributeState {
    const now = this.now();
    let onlineNow = 0;
    for (const [visitor, seen] of this.activity) {
      if (seen > now - PRESENCE_WINDOW_MS) onlineNow += 1;
      if (seen < now - 86_400_000) this.activity.delete(visitor);
    }
    return {
      totalTributes: this.participants.size,
      onlineNow,
      participated: this.participants.has(visitorHash),
    };
  }

  async presence(visitorHash: string, rateKey: string): Promise<TributeState> {
    this.checkRate('presence', rateKey, PRESENCE_RATE_LIMIT);
    this.activity.set(visitorHash, this.now());
    return this.state(visitorHash);
  }

  async tribute(visitorHash: string, rateKey: string): Promise<ContributionState> {
    this.checkRate('tribute', rateKey, TRIBUTE_RATE_LIMIT);
    const added = !this.participants.has(visitorHash);
    this.participants.add(visitorHash);
    this.activity.set(visitorHash, this.now());
    return { ...this.state(visitorHash), added };
  }

  async readPublicMessages(limit = 30): Promise<MessageList> {
    return { messages: this.messages.slice(0, Math.min(30, Math.max(1, limit))).map((message) => ({ ...message })), totalMessages: this.messages.length };
  }

  async postMessage(visitorHash: string, rateKey: string, input: MessageSubmission): Promise<MessageResult> {
    const key = `${visitorHash}:${input.requestId}`;
    const previous = this.messageRequests.get(key);
    if (previous) return { message: { ...previous }, added: false, totalMessages: this.messages.length };
    this.checkRate('message-visitor', visitorHash, 3, 600_000, false);
    this.checkRate('message-network', rateKey, 20, 60_000, false);
    this.checkRate('message-visitor', visitorHash, 3, 600_000);
    this.checkRate('message-network', rateKey, 20, 60_000);
    const message = { id: randomUUID(), name: input.name, body: input.body, createdAt: new Date(this.now()).toISOString() };
    this.messages.unshift(message);
    this.messageRequests.set(key, message);
    return { message: { ...message }, added: true, totalMessages: this.messages.length };
  }
}

function validState(value: unknown): value is TributeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return Number.isSafeInteger(state.totalTributes) && (state.totalTributes as number) >= 0
    && Number.isSafeInteger(state.onlineNow) && (state.onlineNow as number) >= 0
    && typeof state.participated === 'boolean';
}

export class SupabaseTributeStore implements TributeStore {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.request(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data as { message?: unknown; details?: unknown } | null;
      if (error?.message === 'RATE_LIMITED') {
        const retry = Number(error.details);
        throw new RateLimitError(Number.isInteger(retry) && retry > 0 && retry <= 600 ? retry : 60);
      }
      if (error?.message === 'INVALID_MESSAGE') throw new MessageInputError('Please use a short plain-text farewell without links.');
      if (error?.message === 'MESSAGE_REMOVED') {
        throw new MessageInputError('This message was removed. Please write a new farewell.', 410, 'MESSAGE_REMOVED');
      }
      // Do not expose provider messages, queries, keys, or request bodies to visitors.
      throw new Error('The tribute database request failed.');
    }
    return data;
  }

  async presence(visitorHash: string, rateKey: string): Promise<TributeState> {
    const result = await this.rpc('tribute_touch', { p_visitor_hash: visitorHash, p_rate_key: rateKey });
    if (!validState(result)) throw new Error('The tribute database returned an invalid response.');
    return { totalTributes: result.totalTributes, onlineNow: result.onlineNow, participated: result.participated };
  }

  async tribute(visitorHash: string, rateKey: string): Promise<ContributionState> {
    const result = await this.rpc('tribute_join', { p_visitor_hash: visitorHash, p_rate_key: rateKey });
    if (!validState(result) || typeof (result as ContributionState).added !== 'boolean') {
      throw new Error('The tribute database returned an invalid response.');
    }
    return {
      totalTributes: result.totalTributes,
      onlineNow: result.onlineNow,
      participated: result.participated,
      added: (result as ContributionState).added,
    };
  }

  async readPublicMessages(limit = 30): Promise<MessageList> {
    const result = await this.rpc('tribute_messages_read', { p_limit: Math.min(30, Math.max(1, limit)) }) as MessageList | null;
    if (!result || !Array.isArray(result.messages) || result.messages.length > 30 || !result.messages.every(isPublicMessage)
      || !Number.isSafeInteger(result.totalMessages) || result.totalMessages < result.messages.length) {
      throw new Error('The message database returned an invalid response.');
    }
    return { messages: result.messages, totalMessages: result.totalMessages };
  }

  async postMessage(visitorHash: string, rateKey: string, input: MessageSubmission): Promise<MessageResult> {
    const result = await this.rpc('tribute_message_post', {
      p_visitor_hash: visitorHash, p_rate_key: rateKey, p_request_id: input.requestId, p_name: input.name, p_body: input.body,
    }) as MessageResult | null;
    if (!result || !isPublicMessage(result.message) || typeof result.added !== 'boolean'
      || !Number.isSafeInteger(result.totalMessages) || result.totalMessages < 1) {
      throw new Error('The message database returned an invalid response.');
    }
    return { message: result.message, added: result.added, totalMessages: result.totalMessages };
  }
}
