// Keeps the app and recently seen map tiles on the phone so it opens with no signal.
// Bump VERSION whenever any app file changes so phones pick up the new files.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const MAX_TILES = 1500;

const SHELL_FILES = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/app.css',
  'js/geo.js', 'js/report.js', 'js/store.js', 'js/chain.js', 'js/device.js', 'js/icons.js', 'js/demo-backend.js', 'js/api.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

function isTile(url) {
  return url.hostname.endsWith('tile.openstreetmap.org') || url.hostname === 'basemap.nationalmap.gov';
}

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // punches go straight to the network
  const url = new URL(req.url);

  if (isTile(url)) {
    // Tiles: use the saved copy if there is one, refresh in the background.
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    // App files: open instantly from the saved copy (one bar of signal can take
    // many seconds), fetch a fresh copy in the background for next time.
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      });
      if (hit) { net.catch(() => {}); return hit; }
      return net.catch(() => caches.match('index.html'));
    }));
  }
});
