import type { DataKitConfig } from '../src/main/resources/assets/js/lib/config';

import appProperties from '../src/main/resources/i18n/app.properties?raw';
import '../src/main/resources/assets/styles/main.css';

const CONFIG_ELEMENT_ID = 'datakit-config';
const API_NAMES = [
  'system',
  'repositories',
  'branches',
  'nodes',
  'search',
  'binary',
  'snapshots',
  'dumps',
  'exports',
  'tasks',
  'events',
  'audit',
  'versions',
  'logs',
] as const;

function parseProperties(content: string): Record<string, string> {
  const phrases: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    phrases[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return phrases;
}

function buildApiUris(): DataKitConfig['apiUris'] {
  const uris = {} as Record<(typeof API_NAMES)[number], string>;
  for (const name of API_NAMES) {
    uris[name] = `/dev-api/${name}`;
  }
  return uris;
}

const config: DataKitConfig = {
  appId: 'com.enonic.app.datakit',
  assetsUri: '/',
  toolUri: '/',
  apiUris: buildApiUris(),
  launcherUri: '#',
  user: { key: 'user:system:su', displayName: 'Dev' },
  locale: 'en',
  phrases: parseProperties(appProperties),
};

const element = document.getElementById(CONFIG_ELEMENT_ID);
if (element != null) {
  element.textContent = JSON.stringify(config);
}

// The real entry reads #datakit-config at module scope, so it may only load once it is filled.
await import('../src/main/resources/assets/js/app.tsx');
