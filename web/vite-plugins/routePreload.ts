import type { Plugin } from 'vite';

/**
 * Takes the screen chunk off the critical path (#50). Without it the browser downloads `index.js`, runs it, and only
 * then discovers which screen it needs: a second round trip before anything renders. This plugin writes
 * `route-preload.js`, a tiny classic script that `index.html` loads first: it reads the address bar and the stored
 * language, and adds `<link rel="modulepreload">` for the chunks of that screen (with their static dependencies) and
 * of that language catalog, so they download in parallel with `index.js`.
 *
 * The route and language detection below mirror `parseRoute` (src/route/useRoute.ts) and `detectLanguage`
 * (src/i18n/i18n.ts); `routePreload.test.ts` keeps them in step. The file is not content-hashed (like
 * theme-init.js), the API revalidates it on every use (see SpaExtensions.cs).
 */

/** Entry module of each screen and each language catalog, as a path suffix of the module id. */
export const PRELOAD_ENTRIES: Record<string, string> = {
  library: 'src/library/Library.tsx',
  score: 'src/persistence/ScoreEditorRoute.tsx',
  editor: 'src/editor/EditorLayout.tsx',
  shared: 'src/sharing/Viewer.tsx',
  privacy: 'src/privacy/Privacy.tsx',
  contact: 'src/contact/Contact.tsx',
  en: 'src/i18n/en.ts',
  fr: 'src/i18n/fr.ts',
};

/** The screens that engrave a score also need the engraver (VexFlow) right after their first paint. */
const ENGRAVER = 'src/engraving/engraver.ts';
const ENGRAVING_ROUTES = ['score', 'editor', 'shared'];

export const SCRIPT_NAME = 'route-preload.js';

/** JSON that is safe inside generated JavaScript (and inside an HTML script): no `<`, `>`, `&`, U+2028 or U+2029. */
function safeJson(value: unknown): string {
  const unsafe = new RegExp(
    `[<>&${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
    'g',
  );
  return JSON.stringify(value).replace(
    unsafe,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export function preloadScript(map: Record<string, string[]>): string {
  return `(function(){var R=${safeJson(map)};
var h=location.hash.split('?')[0],k='library';
if(/^#\\/scores\\/[^/]+\\/?$/.test(h))k='score';
else if(/^#\\/s\\/[A-Za-z0-9_-]{1,128}\\/?$/.test(h))k='shared';
else if(h.indexOf('#/editor')===0)k='editor';
else if(/^#\\/privacy\\/?$/.test(h))k='privacy';
else if(/^#\\/contact\\/?$/.test(h))k='contact';
var l;try{l=localStorage.getItem('polymnia.lang')}catch(e){}
if(l!=='en'&&l!=='fr'){l='en';var a=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];
for(var i=0;i<a.length;i++){var b=String(a[i]||'').toLowerCase().split('-')[0];if(b==='en'||b==='fr'){l=b;break}}}
var f=(R[k]||[]).concat(R[l]||[]);
for(var j=0;j<f.length;j++){var e=document.createElement('link');e.rel='modulepreload';e.href='/'+f[j];document.head.appendChild(e)}
})();
`;
}

export function routePreload(): Plugin {
  return {
    name: 'polymnia-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'script', attrs: { src: `/${SCRIPT_NAME}` }, injectTo: 'head-prepend' as const },
      ],
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const initial = new Set<string>();
      const walk = (fileName: string, into: Set<string>) => {
        if (into.has(fileName)) return;
        into.add(fileName);
        for (const dep of byFile.get(fileName)?.imports ?? []) walk(dep, into);
      };
      for (const chunk of chunks) if (chunk.isEntry) walk(chunk.fileName, initial);

      const closureOf = (suffix: string): Set<string> => {
        const entry = chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith(suffix));
        if (!entry) this.error(`routePreload: no chunk for ${suffix}; update the plugin.`);
        const closure = new Set<string>();
        walk(entry.fileName, closure);
        return closure;
      };
      const engraver = closureOf(ENGRAVER);

      const map: Record<string, string[]> = {};
      for (const [name, suffix] of Object.entries(PRELOAD_ENTRIES)) {
        const closure = closureOf(suffix);
        if (ENGRAVING_ROUTES.includes(name)) for (const f of engraver) closure.add(f);
        // The first load already has the initial chunks: only what the screen adds.
        map[name] = [...closure].filter((f) => !initial.has(f));
      }
      this.emitFile({ type: 'asset', fileName: SCRIPT_NAME, source: preloadScript(map) });
    },
  };
}
