export interface TributeStats {
  totalTributes: number;
  onlineNow: number;
  participated: boolean;
}

export class TributeRequestError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TributeRequestError';
  }
}

export function isStats(value: unknown): value is TributeStats {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return Number.isSafeInteger(data.totalTributes) && (data.totalTributes as number) >= 0
    && Number.isSafeInteger(data.onlineNow) && (data.onlineNow as number) >= 0
    && typeof data.participated === 'boolean';
}

export async function requestTributeState(endpoint: 'presence' | 'tribute', signal?: AbortSignal): Promise<TributeStats & { added?: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: '{}',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : 'SERVICE_UNAVAILABLE';
      const message = code === 'RATE_LIMITED'
        ? 'A little pause. Please wait a moment and try again.'
        : code === 'SESSION_REQUIRED'
          ? 'Let’s reconnect your visit, then try again.'
          : endpoint === 'tribute'
            ? 'We couldn’t confirm your tribute. Please try again; you won’t be counted twice.'
            : 'The shared farewell is temporarily unavailable. You can still explore the album.';
      throw new TributeRequestError(message, code);
    }
    if (!isStats(data) || (endpoint === 'tribute' && typeof (data as TributeStats & { added?: unknown }).added !== 'boolean')) {
      throw new TributeRequestError('The shared farewell is temporarily unavailable. Please try again.', 'INVALID_RESPONSE');
    }
    return data;
  } catch (error) {
    if (error instanceof TributeRequestError) throw error;
    throw new TributeRequestError(
      endpoint === 'tribute'
        ? 'We couldn’t confirm your tribute. Please try again; you won’t be counted twice.'
        : 'We couldn’t connect to the shared farewell. Please try again.',
      controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
