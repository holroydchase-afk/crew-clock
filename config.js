// Fill these in during setup (see docs/SETUP.md).
// With nothing filled in, the app runs in demo mode with data kept on this phone.
window.APP_CONFIG = {
  // 'supabase' (v2), 'sheets' (the Google Apps Script MVP) or 'demo'
  backend: 'demo',

  // Supabase: Project Settings > API
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Company code crews use; a link with ?org=CODE also sets it on a phone
  orgCode: '',
  // Web push: the VAPID public key (docs/SETUP.md shows how to make one)
  vapidPublicKey: '',

  // Sheets MVP backend: the Apps Script "Web app URL", ends in /exec
  backendUrl: '',
  // The Google Sheet link, shown to the boss as "Open the Google Sheet"
  sheetUrl: '',

  // Demo mode only: ask for the 4-number PIN at sign-in. Off, anyone trying the demo
  // signs in by tapping a name. The real app always asks for the PIN.
  demoPin: false,

  // How long to wait for GPS before offering a photo
  gpsTimeoutMs: 20000,
};
