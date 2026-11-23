// TS-1 (issue #36): types for the globals the plain-JS files share through window/self.
// Type-only: nothing here runs or ships. The shared modules (ai, geo, report, chain, risk) take
// their types straight from the code; the browser-only ones are described here.

// ---------- data the app passes around ----------
type FenceStatus = 'onsite' | 'near' | 'offsite' | 'weak' | 'nogps';
type PunchType = 'in' | 'out' | 'void';

interface AppConfig {
  backend?: 'supabase' | 'sheets' | 'demo' | string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  orgCode?: string;
  vapidPublicKey?: string;
  backendUrl?: string;
  sheetUrl?: string;
  demoPin?: boolean;
  gpsTimeoutMs?: number;
  /** How often an open chat checks for new messages (tests shorten it). */
  chatPollMs?: number;
  /** On-phone AI models (tiers 1 and 2). Shelved 2026-11-23: false in every build. */
  onPhoneAi?: boolean;
}

/** What Geo.bestFix needs from navigator.geolocation (tests pass a fake with just these). */
interface GeoReading { coords: { latitude: number; longitude: number; accuracy: number }; timestamp?: number }
interface GeoSource {
  watchPosition(ok: (pos: GeoReading) => void, err?: ((e: { code: number }) => void) | null, opts?: PositionOptions): number;
  clearWatch(id: number): void;
}

/** A GPS reading from Geo.bestFix. */
interface Fix { lat: number; lng: number; accuracy: number; at: number }

interface Job {
  id: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusFt?: number;
  active?: boolean;
  [extra: string]: unknown;
}

interface CrewMember {
  id: string;
  name: string;
  role?: string;
  active?: boolean;
  [extra: string]: unknown;
}

/** A punch's fields; `type` is required on a Punch, optional where the risk rules take one. */
interface PunchFields {
  id: string;
  crewId: string;
  byCrewId?: string | null;
  jobId?: string | null;
  type?: PunchType | string;
  at: number;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  status?: FenceStatus | string | null;
  distanceFt?: number | null;
  address?: string | null;
  voidsId?: string | null;
  photo?: string | null;
  photoKey?: string | null;
  hasPhoto?: boolean;
  photoSha256?: string | null;
  deviceId?: string | null;
  seq?: number;
  prevHash?: string;
  hash?: string;
  signature?: string;
  /** When the server got it (a late one means the phone had no signal). */
  receivedAt?: number;
  /** Risk flags the server worked out, when it sent them. */
  risk?: { code: string; level?: string }[];
  sigOk?: boolean | null;
  /** Demo: synced after the boss turned this person off (PS-4). */
  crewInactive?: boolean;
  [extra: string]: unknown;
}
/** A punch as the phone, the demo backend and the server pass it around. */
interface Punch extends PunchFields { type: PunchType | string }

/** An "in" matched to the next "out" (Report.pairShifts). */
interface Shift {
  crewId: string;
  jobId?: string | null;
  inAt: number | null;
  outAt: number | null;
  hours: number | null;
  status?: string | null;
  open: boolean;
  inId: string | null;
  outId: string | null;
  missingOut?: boolean;
  missingIn?: boolean;
  duplicateOuts?: string[];
}

/** Signed-in session the app keeps (never the PIN on the crew app). */
interface Auth { crewId: string; pin?: string; token?: string; [extra: string]: unknown }

/** Errors the backends throw carry these flags. */
interface AppError extends Error { server?: boolean; offline?: boolean; status?: number; signIn?: boolean }

/** Whatever a backend call returns: the fields depend on the call. */
interface ApiResult {
  ok?: boolean;
  error?: string;
  [field: string]: any; // JSON from the server or the demo backend; each screen reads its own fields
}

interface CrewApi {
  isDemo?: boolean;
  listCrew(): Promise<ApiResult>;
  login(crewId: string, pin: string): Promise<ApiResult>;
  demoLogin?: (crewId: string) => Promise<ApiResult>;
  refresh(auth: Auth | null): Promise<ApiResult>;
  sync(auth: Auth | null, items: OutboxItem[]): Promise<ApiResult>;
  team(auth: Auth | null, since?: number | null): Promise<ApiResult>;
  geocode(auth: Auth | null, address: string): Promise<ApiResult>;
  photo(auth: Auth | null, punchId: string): Promise<ApiResult>;
  sendReport(auth: Auth | null): Promise<ApiResult>;
  signOut?: () => Promise<void>;
  [method: string]: unknown;
}

/** A row from PostgREST, a function's JSON, or the demo backend's JSON (untyped at the boundary). */
interface Row { [column: string]: any }

/** Something waiting in the outbox: a punch, a consent record, a job or crew edit. */
interface OutboxItem { id: string; kind?: string; queuedAt?: number; [field: string]: unknown }

interface StoreApi {
  outbox: {
    add<T extends OutboxItem>(item: T): Promise<T>;
    all(): Promise<OutboxItem[]>;
    remove(ids: string[]): Promise<void>;
    get(id: string): Promise<OutboxItem | undefined>;
  };
  local: {
    /** Parsed JSON saved by set(); the caller says what it saved there. */
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };
  uid(): string;
  isVolatile(): boolean;
}

interface DeviceRecord { id: string; privateKey: CryptoKey; publicJwk: JsonWebKey; seq: number; hash: string }
interface DeviceApi {
  get(): Promise<DeviceRecord | null>;
  sign<P extends Punch>(punch: P): Promise<P>;
  publicInfo(): Promise<{ deviceId: string; publicKey: JsonWebKey } | null>;
  supported(): boolean;
}

interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  crewId: string;
  me: CrewMember;
  deviceId?: string;
}

interface SupabaseApiShape extends CrewApi {
  signOut(): Promise<void>;
  authed<T>(auth: Auth | null | undefined, run: (token: string) => Promise<T>): Promise<T>;
  fn(name: string, body?: unknown, token?: string): Promise<Row>;
  rest(path: string, token?: string): Promise<any>; // JSON rows or an object, per PostgREST path
  insert(path: string, row: unknown, token?: string): Promise<Row>;
  session(): SupabaseSession | null;
}

/** The demo's whole "server", kept in this browser (js/demo-backend.js). */
interface DemoCrew extends CrewMember { pin: string; deactivatedAt?: number | null }
interface DemoConsent { id: string; crewId: string; action: string; textVersion: string; at: number; deviceId: string | null; receivedAt: number }
interface DemoDb {
  jobs: Job[];
  crew: DemoCrew[];
  punches: Punch[];
  earlier: Punch[];
  photos: Record<string, string>;
  consents: DemoConsent[];
  devices: { id: string; crewId: string; publicKey: JsonWebKey }[];
  sampleDay?: number | null;
  tampered?: { id: string; at: number };
}

interface DemoBackendApi {
  handle(action: string, req: Row): Promise<ApiResult>;
  forgetCrewApp(): void;
  sampleDay(now: number): { day: number; base: number; done: boolean };
  setOffline(on: boolean): void;
  isOffline(): boolean;
  tamper(id?: string): { id: string } | null;
  untamper(): void;
  isTampered(): boolean;
  reset(): void;
}

interface PushApi {
  status(): Promise<'ready' | 'on' | 'blocked' | 'install-first' | 'unsupported'>;
  enable(auth: Auth | null): Promise<'on' | 'blocked'>;
  installed(): boolean;
  isIos(): boolean;
}

// ---------- crew chat (js/messenger.js, MLS from js/vendor/crew-mls.js built from messenger/src/mls.js) ----------
/** This person's MLS identity on this phone; privatePackage never leaves it. */
interface MlsIdentity { publicB64: string; privatePackage: unknown; published?: boolean }
interface CrewMlsApi {
  newKeyPackage(crewId: string): Promise<MlsIdentity>;
  startGroup(groupId: string, mine: MlsIdentity): Promise<string>;
  addMembers(stateB64: string, keyPackagesB64: string[]): Promise<{ stateB64: string; commitB64: string; welcomeB64: string | null; epoch: number }>;
  join(welcomeB64: string, mine: MlsIdentity): Promise<string>;
  encrypt(stateB64: string, text: string): Promise<{ stateB64: string; cipherB64: string }>;
  decrypt(stateB64: string, cipherB64: string): Promise<{ stateB64: string; kind: string; text: string | null }>;
  epochOf(stateB64: string): number;
  members(stateB64: string): string[];
  SUITE_NAME: string;
}
interface ChatGroup { id: string; name: string; createdBy?: string; created_by?: string; members: string[] }
/** A relayed MLS message: only ciphertext, never the words. */
interface ChatWire {
  id: number;
  groupId: string;
  kind: string;
  ciphertext: string;
  sender?: string;
  recipient?: string | null;
  epoch?: number;
  at?: number;
}
/** One phone's readable copy of its chats, per person. */
interface LocalChat {
  states: Record<string, string>;
  messages: Record<string, { from: string; text: string; at: number }[]>;
  lastId: number;
  read: Record<string, number>;
}
interface ChatTransport {
  publishKeyPackage(b64: string): Promise<unknown>;
  keyPackages(ids: string[]): Promise<Record<string, string>>;
  createGroup(g: ChatGroup): Promise<unknown>;
  groups(): Promise<ChatGroup[]>;
  post(m: Omit<ChatWire, 'id'>): Promise<unknown>;
  since(afterId: number): Promise<ChatWire[]>;
}
/** The demo's shared chat relay, in this browser (ciphertext only). */
interface DemoChatStore { keyPackages: Record<string, string>; groups: ChatGroup[]; messages: ChatWire[]; seq: number; seeded?: boolean }
interface MessengerApi {
  listHtml(): string;
  afterRender(): void;
  sync(): Promise<LocalChat | undefined>;
  send(groupId: string, text: string): Promise<void>;
  createGroup(name: string, memberIds: string[]): Promise<{ id: string; notReady: string[] }>;
  refresh(): Promise<void>;
  stop(): void;
}

// ---------- js/app.js ----------
interface ConsentRecord { id?: string; crewId?: string; action: string; textVersion: string; at?: number }
/** The person's last punch, as Home shows it. */
interface LastPunch { id: string; jobId?: string | null; type: string; at: number; status?: string | null }
interface Team {
  punches: Punch[];
  crew: CrewMember[];
  jobs: Job[];
  consents: ConsentRecord[] | null;
  devices: { id: string; publicKey: JsonWebKey }[] | null;
  sampleDay: number | null;
  at: number;
}
/** The punch being built, from the Clock in tap to the done screen. */
interface Flow {
  type: string;
  crewId: string;
  forTeammate: boolean;
  fixing: Punch | null;
  noLocation: boolean;
  jobId?: string | null;
  inAt?: number;
  roughFix?: { lat: number; lng: number; accuracy: number };
  picked?: boolean;
  fix?: { lat: number; lng: number; accuracy: number; at?: number } | null;
  at?: number;
  photo?: string | null;
  liveAccuracy?: number | null;
  check?: { status: FenceStatus; distanceFt: number | null };
  finishing?: boolean;
  saved?: Punch;
  savedAt?: number;
  photoChecked?: boolean;
  photoProblem?: string | null;
  pendingFile?: File;
}
interface EditJob extends Job { isNew?: boolean }
interface EditCrew extends CrewMember { isNew?: boolean; newPin?: string }
interface AppState {
  auth: Auth | null;
  me: CrewMember | null;
  jobs: Job[];
  crew: CrewMember[];
  last: LastPunch | null;
  team: Team | null;
  pending: number;
  syncing: boolean;
  lastSyncAt: number | null;
  screen: string | null;
  flow: Flow | null;
  bossTab: string;
  todayView: string;
  weekBack: boolean;
  stuck?: OutboxItem[];
  syncAgain?: boolean;
  sendFailed?: boolean;
  teamWaitUntil?: number;
  matePunches?: Punch[];
  consentNext?: { type: string } | null;
  consentAsked?: boolean;
  names?: CrewMember[] | null;
  pinFor?: string;
  pinEntry?: string;
  pinError?: string | null;
  verify?: { team: Team; res: Record<string, string> };
  verifying?: Team;
  aiSummary?: string;
  summaryFacts?: string;
  editJob?: EditJob;
  jobMode?: string;
  geoResults?: { label: string; lat: number; lng: number }[] | null;
  addressQuery?: string | null;
  editCrew?: EditCrew;
  placeJobPin?: (lat: number, lng: number, zoom?: number) => void;
}
/** A [data-action] element: the button, link or input that was tapped. */
type ActionEl = Omit<HTMLElement, 'dataset'> & {
  dataset: Record<string, string>;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
};
type ActionHandler = (el: ActionEl, e?: Event) => unknown;
/** What js/app.js shares with add-on screens (js/messenger.js). */
interface CrewClockApi {
  state: AppState;
  syncNow(): Promise<void>;
  render(): void;
  screens: Record<string, () => string>;
  handlers: Record<string, ActionHandler>;
  setScreen(name: string, data?: Partial<AppState>): void;
  esc(s: unknown): string;
  toast(msg: string): void;
  fieldError(target: Element | null, msg: string): void;
  time(ms: number | null | undefined): string;
  initials(name: string | null | undefined): string;
  isBoss(): boolean;
  isLead(): boolean;
  crewById(id: string | null | undefined): CrewMember | null | undefined;
  goHome(): void;
}

// ---------- Leaflet (vendor/leaflet, loaded by index.html): just what the boss map uses ----------
declare namespace L {
  type LatLngTuple = [number, number];
  interface Evented { on(type: string, fn: (e: any) => void): this } // event shapes differ per type
  interface Layer extends Evented { addTo(map: Map): this; bindPopup(html: string): this }
  interface Map extends Evented {
    remove(): void;
    fitBounds(pts: LatLngTuple[], opts?: object): this;
    setView(center: LatLngTuple, zoom: number): this;
  }
  interface Marker extends Layer { getLatLng(): { lat: number; lng: number }; setLatLng(ll: LatLngTuple): this }
  interface Circle extends Layer { setLatLng(ll: LatLngTuple): this }
  interface DivIcon {}
  function map(el: HTMLElement, opts?: object): Map;
  function marker(ll: LatLngTuple, opts?: object): Marker;
  function circle(ll: LatLngTuple, opts?: object): Circle;
  function divIcon(opts: object): DivIcon;
  function tileLayer(url: string, opts?: object): Layer;
  namespace control { function layers(base: Record<string, Layer>, overlays: null, opts?: object): Layer }
}

// Browser extras the DOM lib doesn't list.
interface Navigator {
  /** iOS Safari: true when opened from the Home Screen. */
  standalone?: boolean;
}

// ---------- the shared modules (Node exports them; the browser hangs them on self) ----------
declare var AI: typeof import('./ai.js');
declare var Geo: typeof import('./geo.js');
declare var Report: typeof import('./report.js');
declare var Chain: typeof import('./chain.js');
declare var Risk: typeof import('./risk.js');

declare var APP_CONFIG: AppConfig | undefined;
/** The demo's store when this tab can't write localStorage (HRD-13). */
declare var __demoDb: DemoDb | null | undefined;

// ---------- browser-only modules (each file hangs its object on self) ----------
declare var Store: StoreApi;
declare var Api: CrewApi;
declare var SupabaseApi: SupabaseApiShape;
declare var DemoBackend: DemoBackendApi;
declare var Device: DeviceApi;
declare var Push: PushApi;
declare var Icons: Record<string, string>;
declare var Messenger: MessengerApi;
declare var CrewClock: CrewClockApi | undefined;
declare var CrewMLS: CrewMlsApi | undefined;

