import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function localApi(): Plugin {
  return {
    name: 'tribute-local-api',
    apply: 'serve',
    async configureServer(server) {
      const { handlePresence, handleTribute, handleMessages } = await import('./server/handlers');
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        const handler = path === '/api/presence' ? handlePresence : path === '/api/tribute' ? handleTribute : path === '/api/messages' ? handleMessages : null;
        if (!handler) return next();
        Promise.resolve(handler(req, res)).catch((error: unknown) => {
          console.error('Local API failed:', error instanceof Error ? error.message : 'Unknown error');
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
          }
          res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The live tribute service is temporarily unavailable.' } }));
        });
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET', 'TRIBUTE_STORE']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  if (command === 'build' && process.env.VERCEL) {
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET']) {
      if (!process.env[key]) throw new Error(`Set the server-side ${key} environment variable before deploying.`);
    }
    if (process.env.TRIBUTE_STORE === 'memory') throw new Error('Vercel deployments require Supabase. The local memory store cannot be deployed.');
    if (process.env.SESSION_SECRET!.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
    if (new URL(process.env.SUPABASE_URL!).protocol !== 'https:') throw new Error('The deployed Supabase URL must use HTTPS.');
  }
  return {
    define: { __LOCAL_PREVIEW__: JSON.stringify(mode === 'development' && process.env.TRIBUTE_STORE === 'memory') },
    plugins: [react(), localApi(), {
      name: 'absolute-social-image',
      transformIndexHtml(html) {
        const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
        const candidate = env.SITE_URL || (host ? `https://${host}` : 'http://localhost:5173');
        const site = new URL(candidate);
        if (!['https:', 'http:'].includes(site.protocol)) throw new Error('SITE_URL must be HTTP or HTTPS.');
        return html.replaceAll('content="/social-preview.jpg"', `content="${site.origin}/social-preview.jpg"`);
      },
    }],
    build: { sourcemap: false },
    server: { port: 5173, strictPort: true },
  };
});
