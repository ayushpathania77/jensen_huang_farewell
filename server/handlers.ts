import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSession, rateHash, readSession, sessionCookie, visitorHash } from './session.js';
import { MemoryTributeStore, RateLimitError, SupabaseTributeStore, type TributeStore } from './store.js';
import { MessageInputError, readMessageBody, validateMessage } from './messages.js';

export interface HandlerOptions {
  store: TributeStore;
  sessionSecret: string;
  secureCookies: boolean;
  trustProxy: boolean;
  now?: () => number;
}

export interface ApiError {
  error: { code: string; message: string };
  retryAfterSeconds?: number;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(value));
}

function fail(response: ServerResponse, status: number, code: string, message: string): void {
  send(response, status, { error: { code, message } } satisfies ApiError);
}

function validOrigin(request: IncomingMessage, trustProxy: boolean): boolean {
  const origin = header(request, 'origin');
  const host = header(request, 'host');
  if (!origin || !host || header(request, 'sec-fetch-site') === 'cross-site') return false;
  try {
    const forwardedProtocol = trustProxy ? header(request, 'x-forwarded-proto')?.split(',')[0].trim() : undefined;
    const encrypted = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted;
    const protocol = forwardedProtocol === 'https' || encrypted ? 'https' : 'http';
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export function createHandlers(options: HandlerOptions): { presence: Handler; tribute: Handler; messages: Handler } {
  if (options.sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const now = options.now ?? Date.now;

  function handler(action: 'presence' | 'tribute'): Handler {
    return async (request, response) => {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use POST for this request.');
        return;
      }
      if (!validOrigin(request, options.trustProxy)) {
        fail(response, 403, 'ORIGIN_NOT_ALLOWED', 'This request must come from this website.');
        return;
      }
      if (Number(header(request, 'content-length') ?? 0) > 1024) {
        fail(response, 413, 'REQUEST_TOO_LARGE', 'This request is too large.');
        return;
      }

      let session = readSession(header(request, 'cookie'), options.sessionSecret, now());
      const newSession = session === null;
      if (!session && action === 'tribute') {
        fail(response, 409, 'SESSION_REQUIRED', 'Please reconnect to the tribute and try again.');
        return;
      }
      session ??= createSession(options.sessionSecret, now());
      const ip = options.trustProxy
        ? header(request, 'x-forwarded-for')?.split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
        : request.socket.remoteAddress || 'unknown';

      try {
        const state = await options.store[action](visitorHash(session, options.sessionSecret), rateHash(ip, options.sessionSecret));
        if (newSession) response.setHeader('Set-Cookie', sessionCookie(session, options.secureCookies));
        send(response, 200, state);
      } catch (error) {
        if (error instanceof RateLimitError) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds));
          send(response, 429, {
            error: { code: 'RATE_LIMITED', message: 'A lot of tributes are arriving. Please try again shortly.' },
            retryAfterSeconds: error.retryAfterSeconds,
          } satisfies ApiError);
          return;
        }
        fail(response, 503, 'SERVICE_UNAVAILABLE', 'The live tribute is temporarily unavailable. Please try again.');
      }
    };
  }

  const messages: Handler = async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for messages.');
      return;
    }
    if (request.method === 'POST' && !validOrigin(request, options.trustProxy)) {
      fail(response, 403, 'ORIGIN_NOT_ALLOWED', 'This request must come from this website.');
      return;
    }
    try {
      if (request.method === 'GET') {
        send(response, 200, await options.store.readPublicMessages(30));
        return;
      }
      const session = readSession(header(request, 'cookie'), options.sessionSecret, now());
      if (!session) {
        fail(response, 409, 'SESSION_REQUIRED', 'Please reconnect to the tribute and try again.');
        return;
      }
      const input = validateMessage(await readMessageBody(request));
      const ip = options.trustProxy
        ? header(request, 'x-forwarded-for')?.split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
        : request.socket.remoteAddress || 'unknown';
      const result = await options.store.postMessage(visitorHash(session, options.sessionSecret), rateHash(ip, options.sessionSecret), input);
      send(response, 200, result);
    } catch (error) {
      if (error instanceof MessageInputError) {
        fail(response, error.status, error.code, error.message);
        return;
      }
      if (error instanceof RateLimitError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        send(response, 429, {
          error: { code: 'RATE_LIMITED', message: 'Give other builders a moment. You can share another farewell shortly.' },
          retryAfterSeconds: error.retryAfterSeconds,
        } satisfies ApiError);
        return;
      }
      fail(response, 503, 'SERVICE_UNAVAILABLE', 'The message wall is temporarily unavailable. Please try again.');
    }
  };

  return { presence: handler('presence'), tribute: handler('tribute'), messages };
}

export function validateEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.TRIBUTE_STORE && !['memory', 'supabase'].includes(environment.TRIBUTE_STORE)) {
    throw new Error('TRIBUTE_STORE must be supabase or memory.');
  }
  if (environment.TRIBUTE_STORE === 'memory' && environment.VERCEL_ENV === 'production') {
    throw new Error('The memory tribute store is forbidden in production.');
  }
  // Memory is deliberately local only, including when a preview deployment is public.
  if (environment.TRIBUTE_STORE === 'memory' && (environment.VERCEL || environment.VERCEL_ENV)) {
    throw new Error('The memory tribute store is only available in local development.');
  }
  if (!environment.SESSION_SECRET || environment.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.');
  }
  if (environment.TRIBUTE_STORE !== 'memory') {
    if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('The Supabase tribute service is not configured.');
    }
    if (new URL(environment.SUPABASE_URL).protocol !== 'https:') {
      throw new Error('SUPABASE_URL must use HTTPS.');
    }
  }
}

let runtime: { key: string; handlers: ReturnType<typeof createHandlers> } | undefined;

function runtimeHandlers(): ReturnType<typeof createHandlers> {
  const environment = process.env;
  validateEnvironment(environment);
  const key = [environment.TRIBUTE_STORE, environment.SESSION_SECRET, environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY, environment.VERCEL, environment.VERCEL_ENV].join('\0');
  if (runtime?.key === key) return runtime.handlers;
  const deployed = Boolean(environment.VERCEL || environment.VERCEL_ENV);
  const store = environment.TRIBUTE_STORE === 'memory'
    ? new MemoryTributeStore()
    : new SupabaseTributeStore(environment.SUPABASE_URL!, environment.SUPABASE_SERVICE_ROLE_KEY!);
  const handlers = createHandlers({
    store,
    sessionSecret: environment.SESSION_SECRET!,
    secureCookies: deployed,
    trustProxy: deployed,
  });
  runtime = { key, handlers };
  return handlers;
}

async function handleRuntime(action: 'presence' | 'tribute' | 'messages', request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await runtimeHandlers()[action](request, response);
  } catch {
    fail(response, 503, 'SERVICE_UNAVAILABLE', 'The live tribute is temporarily unavailable. Please try again.');
  }
}

export const handlePresence: Handler = (request, response) => handleRuntime('presence', request, response);
export const handleTribute: Handler = (request, response) => handleRuntime('tribute', request, response);
export const handleMessages: Handler = (request, response) => handleRuntime('messages', request, response);
