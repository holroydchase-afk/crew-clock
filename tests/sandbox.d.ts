// TS-1: types for the unit tests. Type-only; nothing here runs.

/** A vm context the unit tests load the browser files into; each file hangs its module on it. */
interface TestSandbox {
  self?: TestSandbox;
  window?: TestSandbox;
  DemoBackend: DemoBackendApi;
  SupabaseApi: SupabaseApiShape;
  Store: StoreApi;
  Api: CrewApi;
  Device: DeviceApi;
  Report: typeof import('../js/report.js');
  Geo: typeof import('../js/geo.js');
  Chain: typeof import('../js/chain.js');
  CrewClock: CrewClockApi;
  APP_CONFIG: AppConfig;
  localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; [k: string]: unknown };
  fetch: (url: string, opts?: RequestInit) => Promise<unknown>;
  [global: string]: unknown;
}
