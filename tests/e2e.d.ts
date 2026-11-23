// Types for the browser click-throughs (tsconfig.e2e.json only). These files drive the demo with
// Playwright and run small functions inside the page, so they see a few test-only window hooks.

// Playwright is installed globally on the test machine, not in package.json: typed as untyped.
declare module 'playwright';

/** One fake location watch the harden tests can fire by hand. */
interface E2eWatch { ok: (p: GeolocationPosition) => void; err?: ((e: GeolocationPositionError) => void) | null; cleared: boolean }

/** The fake location source the tests install; harden uses mode/pos/watches, location uses reads/active/next. */
interface E2eGps {
  mode?: string;
  pos?: { lat: number; lng: number; acc: number };
  watches?: E2eWatch[];
  reads?: number;
  active?: Set<number>;
  next?: number;
}

declare var __gps: E2eGps;
declare var __reads: number;
declare var __gpsReads: number;
declare var __hintWrites: string[];
declare var __sent: string[];
declare var __busy: Set<string>;
declare var __skew: number;
declare var __fire: (i: number, p: { lat: number; lng: number; acc: number }) => boolean;
declare var __teamGate: Promise<unknown>;
declare var __openTeam: (v?: unknown) => void;
/** axe-core, added to the page by e2e-showcase. */
declare var axe: { run: (ctx: Document, opts?: object) => Promise<{ violations: { id: string; impact?: string; help: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> };

// querySelector hands back Element; in these pages every match is an HTMLElement.
interface Element {
  readonly innerText: string;
  readonly dataset: DOMStringMap;
  click(): void;
  readonly offsetParent: Element | null;
}
