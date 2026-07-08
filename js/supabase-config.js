// --- Supabase Konfiguration ---
// Projekt: mppcnivyjiffnldsexhr
const SUPABASE_URL = "https://mppcnivyjiffnldsexhr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lNl0YIvtci2uXL2CwMVL-Q_ik2p1V6T";

// window.supabase kommt vom CDN-Script (@supabase/supabase-js), das vor dieser
// Datei eingebunden wird. Wir erzeugen daraus unseren Client und legen ihn
// unter einem eigenen Namen ab, damit er nicht mit dem CDN-Namespace kollidiert.
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  alert(
    "Supabase konnte nicht geladen werden.\n\n" +
    "Bitte die Seite über einen lokalen Server öffnen (nicht per Doppelklick " +
    "auf index.html) und die Internetverbindung prüfen."
  );
  throw new Error("Supabase JS SDK wurde nicht geladen (window.supabase fehlt).");
}
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
