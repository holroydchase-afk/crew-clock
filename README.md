# Crew Clock

GPS clock-in and clock-out for construction crews working rural job sites.
Crew tap their job and clock in; the phone records GPS even with no signal and
sends it when it can. The boss sees a team map, a Today list and a Google Sheet report.

## Try it

    npm run serve        # then open http://localhost:8123

With no backend configured the app runs in **demo mode** with sample data kept in the browser.
Demo PINs: Dad (boss) 1234, Ray T. (foreman) 3333, Jake R. 1111, Cody M. 2222.

## Tests

    npm test             # geofence, GPS and shift logic
    npm run test:e2e     # browser click-through of demo mode (needs `npm run serve` running)

## Layout

| Path | What |
| --- | --- |
| `index.html`, `css/`, `js/` | The phone web app (no build step) |
| `js/geo.js` | Geofence rule and best-GPS-fix logic |
| `js/report.js` | Pairs clock-ins with clock-outs into shifts |
| `js/store.js` | Offline outbox (IndexedDB) |
| `sw.js` | Service worker: app opens with no signal, caches map tiles |
| `backend/` | MVP backend: Google Apps Script bound to a Google Sheet |
