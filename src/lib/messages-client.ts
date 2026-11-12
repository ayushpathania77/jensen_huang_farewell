export interface PublicMessage {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

export interface MessagesPage {
  messages: PublicMessage[];
  totalMessages: number;
}

export interface MessageSubmission {
  name: string;
  body: string;
  requestId: string;
}

export interface MessageAcknowledgement {
  message: PublicMessage;
  added: boolean;
  totalMessages: number;
}

export class MessageRequestError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MessageRequestError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const links = /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|dev|app|co|ai|xyz)(?:[^a-z]|$)/i;
const markup = /<\/?[a-z][^>]*>/i;
const bodyControls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const nameControls = /[\u0000-\u001f\u007f-\u009f]/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isPublicMessage(value: unknown): value is PublicMessage {
  if (!record(value)) return false;
  return typeof value.id === 'string' && uuid.test(value.id)
    && typeof value.name === 'string' && value.name.trim().length > 0 && Array.from(value.name).length <= 32
    && typeof value.body === 'string' && value.body.trim().length > 0 && Array.from(value.body).length <= 240
    && typeof value.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.createdAt)
    && Number.isFinite(Date.parse(value.createdAt));
}

export function isMessagesPage(value: unknown): value is MessagesPage {
  return record(value) && Array.isArray(value.messages) && value.messages.length <= 30
    && value.messages.every(isPublicMessage)
    && new Set(value.messages.map((message) => message.id)).size === value.messages.length
    && Number.isSafeInteger(value.totalMessages) && (value.totalMessages as number) >= value.messages.length;
}

export function isMessageAcknowledgement(value: unknown): value is MessageAcknowledgement {
  return record(value) && isPublicMessage(value.message) && typeof value.added === 'boolean'
    && Number.isSafeInteger(value.totalMessages) && (value.totalMessages as number) >= 1;
}

function normalizeDraft(name: string, body: string): { name: string; body: string } {
  const draft = { name: name.trim(), body: body.trim() };
  if (Array.from(draft.name).length > 32) {
    throw new MessageRequestError('Keep your display name to 32 characters.', 'INVALID_MESSAGE');
  }
  if (Array.from(draft.body).length < 1 || Array.from(draft.body).length > 240) {
    throw new MessageRequestError('Keep your farewell between 1 and 240 characters.', 'INVALID_MESSAGE');
  }
  if (nameControls.test(draft.name) || bodyControls.test(draft.body)
    || links.test(draft.name) || links.test(draft.body) || markup.test(draft.name) || markup.test(draft.body)) {
    throw new MessageRequestError('Please use plain text without links or HTML.', 'INVALID_MESSAGE');
  }
  return draft;
}

/** Retains uncertain requests for retries, including a draft revisited after editing. */
export class MessageDraftRequests {
  private readonly pending = new Map<string, MessageSubmission>();

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}

  forDraft(name: string, body: string): MessageSubmission {
    const draft = normalizeDraft(name, body);
    const key = JSON.stringify([draft.name, draft.body]);
    const existing = this.pending.get(key);
    if (existing) return { ...existing };
    const requestId = this.createId();
    if (!uuid.test(requestId)) throw new MessageRequestError('Please refresh the page and try again.', 'INVALID_REQUEST_ID');
    const submission = { ...draft, requestId };
    this.pending.set(key, submission);
    return { ...submission };
  }

  acknowledge(requestId: string): void {
    for (const [key, submission] of this.pending) {
      if (submission.requestId === requestId) this.pending.delete(key);
    }
  }
}

const uncertainMessage = 'We couldn’t confirm your message. Try again with the same text; it won’t be posted twice.';

function friendlyError(code: string, writing: boolean): MessageRequestError {
  const messages: Record<string, string> = {
    INVALID_MESSAGE: 'Keep your message to 240 characters and your name to 32. Please use plain text without links.',
    REQUEST_TOO_LARGE: 'Keep your message to 240 characters and your name to 32.',
    MESSAGE_REMOVED: 'This message was removed. Please write a new farewell.',
    RATE_LIMITED: 'Give other builders a moment. Please wait a little before posting again.',
    SESSION_REQUIRED: 'Your visit needs to reconnect. Please try again; your message stays here.',
    ORIGIN_NOT_ALLOWED: 'We couldn’t verify this visit. Refresh the page, then try again.',
    ABORTED: writing ? uncertainMessage : 'The message request was interrupted.',
    TIMEOUT: writing ? uncertainMessage : 'The message wall took too long to respond. Please try again.',
    NETWORK_ERROR: writing ? uncertainMessage : 'We couldn’t connect to the message wall. Please try again.',
    INVALID_RESPONSE: writing ? uncertainMessage : 'The message wall is temporarily unavailable. Please try again.',
    SERVICE_UNAVAILABLE: writing ? uncertainMessage : 'The message wall is temporarily unavailable. Please try again.',
  };
  const safeCode = Object.hasOwn(messages, code) ? code : 'SERVICE_UNAVAILABLE';
  return new MessageRequestError(messages[safeCode], safeCode);
}

async function requestMessages(method: 'GET' | 'POST', submission?: MessageSubmission, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    if (controller.signal.aborted) throw friendlyError('ABORTED', method === 'POST');
    const response = await fetch('/api/messages', {
      method,
      headers: method === 'POST'
        ? { 'Content-Type': 'application/json', Accept: 'application/json' }
        : { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      ...(submission ? { body: JSON.stringify(submission) } : {}),
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = response.status === 429 ? 'RATE_LIMITED'
        : record(data) && record(data.error) && typeof data.error.code === 'string'
          ? data.error.code : 'SERVICE_UNAVAILABLE';
      throw friendlyError(code, method === 'POST');
    }
    return data;
  } catch (cause) {
    if (cause instanceof MessageRequestError) throw cause;
    throw friendlyError(signal?.aborted ? 'ABORTED' : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', method === 'POST');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function readMessages(signal?: AbortSignal): Promise<MessagesPage> {
  const data = await requestMessages('GET', undefined, signal);
  if (!isMessagesPage(data)) throw friendlyError('INVALID_RESPONSE', false);
  return data;
}

export async function postMessage(submission: MessageSubmission, signal?: AbortSignal): Promise<MessageAcknowledgement> {
  const draft = normalizeDraft(submission.name, submission.body);
  if (!uuid.test(submission.requestId)) throw friendlyError('INVALID_MESSAGE', true);
  const data = await requestMessages('POST', { ...draft, requestId: submission.requestId }, signal);
  if (!isMessageAcknowledgement(data) || data.message.body !== draft.body
    || data.message.name !== (draft.name || 'A fellow builder')) {
    throw friendlyError('INVALID_RESPONSE', true);
  }
  return data;
}

/** Merge a confirmed post without duplicating a lost-response retry. */
export function mergeAcknowledgedMessage(current: PublicMessage[], acknowledgement: MessageAcknowledgement): PublicMessage[] {
  return [acknowledgement.message, ...current.filter((message) => message.id !== acknowledgement.message.id)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.min(30, acknowledgement.totalMessages));
}
