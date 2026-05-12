import { fileURLToPath } from 'node:url';
import path from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function searchIndexPolicyPlugin(isDemo: boolean): Plugin {
  return {
    name: 'nodewarden-search-index-policy',
    transformIndexHtml(html: string) {
      if (isDemo) return html;
      return html.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />'
      );
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: isDemo
          ? 'User-agent: *\nAllow: /\n'
          : 'User-agent: *\nDisallow: /\n',
      });
    },
  };
}

function resourcePriorityPlugin(isDemo: boolean): Plugin {
  return {
    name: 'nodewarden-resource-priority',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      if (isDemo || !html.includes('/assets/app-suite-')) return html;

      const scriptMatch = html.match(/^\s*<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>\s*$/m);
      const appSuiteMatch = html.match(/^\s*<link rel="modulepreload" crossorigin href="\/assets\/app-suite-[^"]+\.js">\s*$/m);
      const stylesheetMatch = html.match(/^\s*<link rel="stylesheet" crossorigin href="\/assets\/index-[^"]+\.css">\s*$/m);

      if (!scriptMatch || !appSuiteMatch || !stylesheetMatch) return html;

      const prioritizedTags = [
        stylesheetMatch[0].replace('rel="stylesheet"', 'rel="stylesheet" fetchpriority="high"'),
        appSuiteMatch[0].replace('rel="modulepreload"', 'rel="modulepreload" fetchpriority="high"'),
        scriptMatch[0].replace('type="module"', 'type="module" fetchpriority="high"'),
      ].join('\n');

      return html
        .replace(scriptMatch[0], '')
        .replace(appSuiteMatch[0], '')
        .replace(stylesheetMatch[0], prioritizedTags);
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';

  return {
    root: rootDir,
    plugins: [preact(), searchIndexPolicyPlugin(isDemo), resourcePriorityPlugin(isDemo)],
    define: {
      __NODEWARDEN_DEMO__: JSON.stringify(isDemo),
    },
    resolve: {
      alias: {
        '@/lib/demo': path.resolve(rootDir, isDemo ? 'src/lib/demo.ts' : 'src/lib/demo.empty.ts'),
        '@/lib/demo-brand-icons': path.resolve(
          rootDir,
          isDemo ? 'src/lib/demo-brand-icons.ts' : 'src/lib/demo.empty.ts'
        ),
        '@': path.resolve(rootDir, 'src'),
        '@shared': path.resolve(rootDir, '../shared'),
      },
    },
    build: {
      outDir: path.resolve(rootDir, '../dist'),
      emptyOutDir: true,
      sourcemap: false,
      target: 'esnext',
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        treeshake: {
          preset: 'smallest',
        },
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');

            const localeMatch = normalized.match(/\/src\/lib\/i18n\/locales\/(.+)\.ts$/);
            if (localeMatch) {
              if (localeMatch[1] === 'en') return undefined;
              return `i18n-${localeMatch[1]}`;
            }

            if (
              !isDemo &&
              (
                normalized.includes('/src/components/VaultPage.tsx') ||
                normalized.includes('/src/components/ImportPage.tsx') ||
                normalized.includes('/src/lib/import-') ||
                normalized.includes('/src/lib/export-formats.ts') ||
                normalized.includes('/src/components/SendsPage.tsx') ||
                normalized.includes('/src/components/TotpCodesPage.tsx') ||
                normalized.includes('/src/components/DomainRulesPage.tsx') ||
                normalized.includes('/src/components/BackupCenterPage.tsx') ||
                normalized.includes('/src/components/backup-center/') ||
                normalized.includes('/src/components/SettingsPage.tsx') ||
                normalized.includes('/src/components/SecurityDevicesPage.tsx') ||
                normalized.includes('/src/components/AdminPage.tsx')
              )
            ) {
              return 'app-suite';
            }

            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      fs: {
        allow: [path.resolve(rootDir, '..')],
      },
      proxy: {
        '/api': 'http://127.0.0.1:8787',
        '/identity': 'http://127.0.0.1:8787',
        '/setup': 'http://127.0.0.1:8787',
        '/icons': 'http://127.0.0.1:8787',
        '/config': 'http://127.0.0.1:8787',
        '/notifications': 'http://127.0.0.1:8787',
        '/.well-known': 'http://127.0.0.1:8787',
      },
    },
  };
});
