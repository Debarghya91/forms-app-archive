// THE ONE SETTING: the deployed NoticeMitra server URL (no trailing slash).
// Change ONLY the line below once the server is live on Render, then rebuild
// the app. Example format: window.API_BASE = "https://YOUR-SERVER.onrender.com";
// Leave "" only when the server also serves this web folder (local testing).
window.API_BASE = "";

// SUPABASE (provisioned by the owner; empty until then).
// When these two lines are empty, the app shows the auth screen in
// pre-provisioning mode and offers an "on this device only" local mode.
// When they are filled in, sign-in is mandatory and local mode disappears.
// NEVER put a service-role key here. The anon key only.
window.SUPABASE_URL = "";
window.SUPABASE_ANON_KEY = "";
