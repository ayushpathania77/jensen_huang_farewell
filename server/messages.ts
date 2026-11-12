import type { IncomingMessage } from 'node:http';

export interface PublicMessage {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

export interface MessageSubmission {
  name: string;
  body: string;
  requestId: string;
}

export interface MessageList {
  messages: PublicMessage[];
  totalMessages: number;
}

export interface MessageResult {
  message: PublicMessage;
  added: boolean;
  totalMessages: number;
}

export class MessageInputError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'INVALID_MESSAGE') {
    super(message);
    this.name = 'MessageInputError';
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const links = /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|dev|app|co|ai|xyz)(?:[^a-z]|$)/i;
const markup = /<\/?[a-z][^>]*>/i;
const bodyControls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const nameControls = /[\u0000-\u001f\u007f-\u009f]/;

export function validateMessage(value: unknown): MessageSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MessageInputError('Enter a short farewell message.');
  const input = value as Record<string, unknown>;
  if (typeof input.body !== 'string') throw new MessageInputError('Enter a short farewell message.');
  if (input.name !== undefined && typeof input.name !== 'string') throw new MessageInputError('Your display name must be text.');
  const body = input.body.trim();
  const name = (typeof input.name === 'string' ? input.name.trim() : '') || 'A fellow builder';
  if (Array.from(body).length < 1 || Array.from(body).length > 240) throw new MessageInputError('Keep your farewell between 1 and 240 characters.');
  if (Array.from(name).length > 32) throw new MessageInputError('Keep your display name to 32 characters.');
  if (bodyControls.test(body) || nameControls.test(name)) throw new MessageInputError('Use plain text in your farewell and name.');
  if (links.test(body) || links.test(name) || markup.test(body) || markup.test(name)) {
    throw new MessageInputError('Please share a farewell without links or HTML.');
  }
  if (typeof input.requestId !== 'string' || !uuid.test(input.requestId)) throw new MessageInputError('Please retry with a new message request.');
  return { name, body, requestId: input.requestId.toLowerCase() };
}

const MAX_BODY_BYTES = 4096;

/** Handles both Node's raw stream and Vercel's pre-parsed request body. */
export async function readMessageBody(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    throw new MessageInputError('This message request is too large.', 413, 'REQUEST_TOO_LARGE');
  }
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MessageInputError('Send this message as JSON.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const serialized = typeof parsed === 'string' ? parsed : Buffer.isBuffer(parsed) ? parsed.toString('utf8') : JSON.stringify(parsed);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) throw new MessageInputError('This message request is too large.', 413, 'REQUEST_TOO_LARGE');
    if (typeof parsed !== 'string' && !Buffer.isBuffer(parsed)) return parsed;
    try { return JSON.parse(serialized); } catch { throw new MessageInputError('This message request is not valid JSON.'); }
  }
  const raw = await new Promise<string>((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(new MessageInputError('This message request is too large.', 413, 'REQUEST_TOO_LARGE'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const onError = () => { cleanup(); reject(new MessageInputError('The message could not be read. Please try again.')); };
    const onAborted = () => { cleanup(); reject(new MessageInputError('The message request was interrupted.')); };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
    if (request.readableEnded) onEnd();
  });
  try { return JSON.parse(raw); } catch { throw new MessageInputError('This message request is not valid JSON.'); }
}

export function isPublicMessage(value: unknown): value is PublicMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string' && uuid.test(message.id)
    && typeof message.name === 'string' && Array.from(message.name).length <= 32
    && typeof message.body === 'string' && Array.from(message.body).length >= 1 && Array.from(message.body).length <= 240
    && typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt));
}
