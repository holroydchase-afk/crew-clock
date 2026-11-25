// Fill these in during setup (see docs/SETUP.md).
// With nothing filled in, the app runs in demo mode with data kept on this phone.
window.APP_CONFIG = {
  // 'supabase' (the crew app) or 'demo'. The old 'sheets' value is ignored outside the demo:
  // a crew build without a supabaseUrl talks to no server (EF-CK-11).
  backend: 'demo',

  // Supabase: Project Settings > API
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Company code crews use; a link with ?org=CODE also sets it on a phone
  orgCode: '',
  // Web push: the VAPID public key (docs/SETUP.md shows how to make one)
  vapidPublicKey: '',

  // Old Sheets MVP backend URL: ignored outside the demo (the crew app runs Supabase only), and a
  // crew build refuses SHEETS_BACKEND_URL. Leave it empty.
  backendUrl: '',
  // The Google Sheet link, shown to the boss as "Open the Google Sheet"
  sheetUrl: '',

  // Demo mode only: ask for the 4-number PIN at sign-in. Off, anyone trying the demo
  // signs in by tapping a name. The real app always asks for the PIN.
  demoPin: false,

  // How long to wait for GPS before offering a photo
  gpsTimeoutMs: 20000,

  // On-phone AI models: shelved by Chase 2026-11-23 (no model download); true restores tiers 1 and 2
  onPhoneAi: false,
};
