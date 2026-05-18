import { build } from 'esbuild';
import { readdirSync } from 'node:fs';

const isProduction = process.env.NODE_ENV === 'production';

const SRC = 'src/main/resources';
const OUT = 'build/resources/main';

const entryPoints = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.d.ts'))
  .map((d) => `${d.parentPath}/${d.name}`)
  .filter((f) => !(f.includes('/assets/') || f.includes('/lib/') || f.includes('/types/')));

await build({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  bundle: true,
  format: 'cjs',
  target: 'es2023',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  external: ['/lib/xp/*', '/lib/mustache', '/lib/http-client'],
  sourcemap: !isProduction,
  minify: false, // intentional: keep server code readable for debugging errors in XP logs
  ...(isProduction && {
    legalComments: 'none',
    drop: ['debugger'],
  }),
});
