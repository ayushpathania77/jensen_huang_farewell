import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
  throw new Error('The memory demo is for local development only.');
}
process.env.TRIBUTE_STORE = 'memory';
process.env.SESSION_SECRET = randomBytes(48).toString('hex');
console.info('\nLOCAL TEST SERVICE — counters reset when this process stops.\n');
const server = await createServer({ server: { host: '127.0.0.1' } });
await server.listen();
server.printUrls();
