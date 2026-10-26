import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Replaces the %SITE_URL% token in index.html with the VITE_SITE_URL value
 * (no trailing slash). Social crawlers do not run JavaScript, so absolute
 * Open Graph URLs must be present in the static HTML.
 */
function siteUrlPlugin(siteUrl: string): Plugin {
  return {
    name: 'soulcitytech-site-url',
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_URL%', siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const siteUrl = (env.VITE_SITE_URL ?? '').replace(/\/+$/, '');

  return {
    plugins: [react(), tailwindcss(), siteUrlPlugin(siteUrl)],
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
