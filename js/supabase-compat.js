// =============================================================================
// Firebase -> Supabase Kompatibilitäts-Shim
// =============================================================================
// Diese Datei stellt eine kleine Nachbildung der Firebase-Client-API
// (firebase.auth(), firebase.database().ref(...), userDatabase, database)
// bereit, die intern Supabase (Auth + Postgres) benutzt.
//
// Dadurch musste js/script.js nicht an tausenden Stellen umgeschrieben werden -
// nur die Datenquelle dahinter hat sich geändert.
//
// Abgedeckte Pfade (entspricht 1:1 dem, was js/script.js benutzt):
//   users/{uid}                          -> Tabelle "profiles"
//   users/{uid}/settings                 -> profiles.settings (jsonb, komplett)
//   users/{uid}/settings/{category}      -> profiles.settings->category (jsonb)
//   users/{uid}/pinnedItems              -> Tabelle "pinned_items"
//   users/{uid}/reminders                -> Tabelle "reminders" (alle für den User)
//   users/{uid}/reminders/{auctionId}    -> Tabelle "reminders" (eine Zeile)
//   users/{uid}/isPartner                -> profiles.is_partner
//   users/{uid}/minecraftVerification    -> Tabelle "minecraft_verifications"
//   users (ganze Liste, nur für Admin-Suche)-> Tabelle "profiles"
//   ads, ads/{id}                        -> Tabelle "ads"
//   donations/list, donations/list/{id}  -> Tabelle "donations"
//   donations/goal                       -> Tabelle "donation_goal"
//   visits/count                         -> Tabelle "visits"
//
// reminders/{auctionId}/{uid} (der "globale" Pfad für einen serverseitigen
// Benachrichtigungs-Worker) wird bewusst als No-Op behandelt - dafür gibt es
// in dieser reinen Frontend-Version keinen Worker mehr.
// =============================================================================

const SERVER_TIMESTAMP = "__SUPABASE_SERVER_TIMESTAMP__";

function resolveTimestamps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === SERVER_TIMESTAMP) out[k] = new Date().toISOString();
  }
  return out;
}

// -----------------------------------------------------------------------
// Generischer Snapshot-Wrapper (ahmt Firebase's DataSnapshot nach)
// -----------------------------------------------------------------------
function makeSnapshot(value) {
  return { val: () => (value === undefined ? null : value) };
}

// -----------------------------------------------------------------------
// Low-Level: Lesen/Schreiben anhand des Pfades
// -----------------------------------------------------------------------
async function dbRead(parts) {
  try {
    // users/{uid}
    if (parts[0] === 'users' && parts.length === 2) {
      const uid = parts[1];
      const { data } = await supabaseClient
        .from('profiles')
        .select('email,last_login,is_admin,is_partner')
        .eq('id', uid)
        .maybeSingle();
      if (!data) return null;
      return {
        email: data.email,
        lastLogin: data.last_login,
        isAdmin: data.is_admin,
        isPartner: data.is_partner
      };
    }

    // users (komplette Liste, nur für Admin-Suche per E-Mail)
    if (parts[0] === 'users' && parts.length === 1) {
      const { data, error } = await supabaseClient.from('profiles').select('id,email');
      if (error) throw error;
      const out = {};
      (data || []).forEach(row => { out[row.id] = { email: row.email }; });
      return out;
    }

    // users/{uid}/settings  ODER  users/{uid}/settings/{category}
    if (parts[0] === 'users' && parts[2] === 'settings') {
      const uid = parts[1];
      const { data } = await supabaseClient
        .from('profiles')
        .select('settings')
        .eq('id', uid)
        .maybeSingle();
      const settings = (data && data.settings) || {};
      if (parts.length === 3) return settings;
      if (parts.length === 4) return settings[parts[3]] ?? null;
    }

    // users/{uid}/pinnedItems
    if (parts[0] === 'users' && parts[2] === 'pinnedItems') {
      const uid = parts[1];
      const { data, error } = await supabaseClient
        .from('pinned_items')
        .select('item_name')
        .eq('user_id', uid);
      if (error) throw error;
      return (data || []).map(r => r.item_name);
    }

    // users/{uid}/reminders  (alle) ODER  users/{uid}/reminders/{auctionId}
    if (parts[0] === 'users' && parts[2] === 'reminders') {
      const uid = parts[1];
      if (parts.length === 3) {
        const { data, error } = await supabaseClient
          .from('reminders')
          .select('auction_id,data')
          .eq('user_id', uid);
        if (error) throw error;
        const out = {};
        (data || []).forEach(r => { out[r.auction_id] = r.data; });
        return out;
      }
      if (parts.length === 4) {
        const { data } = await supabaseClient
          .from('reminders')
          .select('data')
          .eq('user_id', uid)
          .eq('auction_id', parts[3])
          .maybeSingle();
        return data ? data.data : null;
      }
    }

    // users/{uid}/minecraftVerification
    if (parts[0] === 'users' && parts[2] === 'minecraftVerification') {
      const uid = parts[1];
      const { data } = await supabaseClient
        .from('minecraft_verifications')
        .select('data')
        .eq('user_id', uid)
        .maybeSingle();
      return data ? data.data : null;
    }

    // ads
    if (parts[0] === 'ads' && parts.length === 1) {
      const { data, error } = await supabaseClient.from('ads').select('id,data');
      if (error) throw error;
      const out = {};
      (data || []).forEach(r => { out[r.id] = r.data; });
      return out;
    }

    // donations/list
    if (parts[0] === 'donations' && parts[1] === 'list' && parts.length === 2) {
      const { data, error } = await supabaseClient.from('donations').select('id,data');
      if (error) throw error;
      const out = {};
      (data || []).forEach(r => { out[r.id] = r.data; });
      return out;
    }

    // donations/goal
    if (parts[0] === 'donations' && parts[1] === 'goal') {
      const { data } = await supabaseClient.from('donation_goal').select('amount').eq('id', 1).maybeSingle();
      return data ? data.amount : 0;
    }

    // visits/count
    if (parts[0] === 'visits' && parts[1] === 'count') {
      const { data } = await supabaseClient.from('visits').select('count').eq('id', 1).maybeSingle();
      return data ? data.count : 0;
    }

    console.warn('[supabase-compat] Unbekannter Lese-Pfad:', parts.join('/'));
    return null;
  } catch (e) {
    console.error('[supabase-compat] dbRead Fehler für', parts.join('/'), e);
    return null;
  }
}

async function dbWrite(parts, mode, value) {
  // users/{uid}  (root profile)
  if (parts[0] === 'users' && parts.length === 2) {
    const uid = parts[1];
    if (mode === 'remove') {
      await supabaseClient.from('profiles').delete().eq('id', uid);
      await supabaseClient.from('pinned_items').delete().eq('user_id', uid);
      await supabaseClient.from('reminders').delete().eq('user_id', uid);
      await supabaseClient.from('minecraft_verifications').delete().eq('user_id', uid);
      return;
    }
    const v = resolveTimestamps(value);
    const row = { id: uid };
    if ('email' in v) row.email = v.email;
    if ('lastLogin' in v) row.last_login = v.lastLogin;
    if ('isAdmin' in v) row.is_admin = v.isAdmin;
    if ('isPartner' in v) row.is_partner = v.isPartner;
    const { error } = await supabaseClient.from('profiles').upsert(row);
    if (error) throw error;
    return;
  }

  // users/{uid}/isPartner
  if (parts[0] === 'users' && parts[2] === 'isPartner') {
    const uid = parts[1];
    const { error } = await supabaseClient.from('profiles').upsert({ id: uid, is_partner: value });
    if (error) throw error;
    return;
  }

  // users/{uid}/settings  (ganzes Objekt, shallow merge oder replace)
  if (parts[0] === 'users' && parts[2] === 'settings' && parts.length === 3) {
    const uid = parts[1];
    if (mode === 'set') {
      const { error } = await supabaseClient.from('profiles').upsert({ id: uid, settings: value });
      if (error) throw error;
      return;
    }
    // update = shallow merge
    const { data } = await supabaseClient.from('profiles').select('settings').eq('id', uid).maybeSingle();
    const merged = { ...(data?.settings || {}), ...value };
    const { error } = await supabaseClient.from('profiles').upsert({ id: uid, settings: merged });
    if (error) throw error;
    return;
  }

  // users/{uid}/settings/{category}
  if (parts[0] === 'users' && parts[2] === 'settings' && parts.length === 4) {
    const uid = parts[1];
    const category = parts[3];
    const { data } = await supabaseClient.from('profiles').select('settings').eq('id', uid).maybeSingle();
    const settings = { ...(data?.settings || {}) };
    if (mode === 'set') {
      settings[category] = value;
    } else {
      settings[category] = { ...(settings[category] || {}), ...value };
    }
    const { error } = await supabaseClient.from('profiles').upsert({ id: uid, settings });
    if (error) throw error;
    return;
  }

  // users/{uid}/pinnedItems  (immer komplett ersetzt, wie im Original)
  if (parts[0] === 'users' && parts[2] === 'pinnedItems') {
    const uid = parts[1];
    await supabaseClient.from('pinned_items').delete().eq('user_id', uid);
    const items = Array.isArray(value) ? value.filter(Boolean) : [];
    if (items.length > 0) {
      const rows = items.map(name => ({ user_id: uid, item_name: name }));
      const { error } = await supabaseClient.from('pinned_items').insert(rows);
      if (error) throw error;
    }
    return;
  }

  // users/{uid}/reminders/{auctionId}
  if (parts[0] === 'users' && parts[2] === 'reminders' && parts.length === 4) {
    const uid = parts[1];
    const auctionId = parts[3];
    if (mode === 'remove') {
      await supabaseClient.from('reminders').delete().eq('user_id', uid).eq('auction_id', auctionId);
      return;
    }
    const { error } = await supabaseClient
      .from('reminders')
      .upsert({ user_id: uid, auction_id: auctionId, data: value }, { onConflict: 'user_id,auction_id' });
    if (error) throw error;
    return;
  }

  // users/{uid}/minecraftVerification
  if (parts[0] === 'users' && parts[2] === 'minecraftVerification') {
    const uid = parts[1];
    if (mode === 'remove') {
      await supabaseClient.from('minecraft_verifications').delete().eq('user_id', uid);
      return;
    }
    const v = resolveTimestamps(value);
    const { error } = await supabaseClient
      .from('minecraft_verifications')
      .upsert({ user_id: uid, data: v, verified_at: new Date().toISOString() });
    if (error) throw error;
    return;
  }

  // reminders/{auctionId}/{uid}  -> globaler Worker-Pfad, bewusst No-Op
  if (parts[0] === 'reminders') {
    return;
  }

  // ads  (push = neue Zeile)
  if (parts[0] === 'ads' && parts.length === 1 && mode === 'set') {
    const { error } = await supabaseClient.from('ads').insert({ data: value });
    if (error) throw error;
    return;
  }
  // ads/{id}
  if (parts[0] === 'ads' && parts.length === 2) {
    const id = parts[1];
    if (mode === 'remove') {
      await supabaseClient.from('ads').delete().eq('id', id);
      return;
    }
    const { data } = await supabaseClient.from('ads').select('data').eq('id', id).maybeSingle();
    const merged = mode === 'set' ? value : { ...(data?.data || {}), ...value };
    const { error } = await supabaseClient.from('ads').update({ data: merged }).eq('id', id);
    if (error) throw error;
    return;
  }

  // donations/list  (push = neue Zeile)
  if (parts[0] === 'donations' && parts[1] === 'list' && parts.length === 2 && mode === 'set') {
    const { error } = await supabaseClient.from('donations').insert({ data: value });
    if (error) throw error;
    return;
  }
  // donations/list/{id}
  if (parts[0] === 'donations' && parts[1] === 'list' && parts.length === 3) {
    const id = parts[2];
    if (mode === 'remove') {
      await supabaseClient.from('donations').delete().eq('id', id);
      return;
    }
    const { data } = await supabaseClient.from('donations').select('data').eq('id', id).maybeSingle();
    const merged = mode === 'set' ? value : { ...(data?.data || {}), ...value };
    const { error } = await supabaseClient.from('donations').update({ data: merged }).eq('id', id);
    if (error) throw error;
    return;
  }

  // donations/goal
  if (parts[0] === 'donations' && parts[1] === 'goal') {
    const { error } = await supabaseClient.from('donation_goal').upsert({ id: 1, amount: value });
    if (error) throw error;
    return;
  }

  console.warn('[supabase-compat] Unbekannter Schreib-Pfad:', parts.join('/'));
}

// -----------------------------------------------------------------------
// DBRef - ahmt firebase.database().ref(path) nach
// -----------------------------------------------------------------------
class DBRef {
  constructor(path) {
    this.path = String(path).replace(/^\/+|\/+$/g, '');
    this.parts = this.path.split('/').filter(Boolean);
  }
  child(sub) {
    return new DBRef(this.path + '/' + sub);
  }
  async set(value) {
    return dbWrite(this.parts, 'set', value);
  }
  async update(value) {
    return dbWrite(this.parts, 'update', value);
  }
  async remove() {
    return dbWrite(this.parts, 'remove');
  }
  async push(value) {
    await dbWrite(this.parts, 'set', value);
    return { key: null };
  }
  async once(_eventType) {
    const value = await dbRead(this.parts);
    return makeSnapshot(value);
  }
  on(eventType, callback) {
    // Feuert sofort mit dem aktuellen Wert (kein echtes Firebase-artiges
    // Live-Streaming, aber für die Anwendungsfälle hier - initiales Laden
    // der Pins und des Besucherzählers - ausreichend).
    dbRead(this.parts).then(value => callback(makeSnapshot(value)));

    // Für pinnedItems und den Besucherzähler zusätzlich Live-Updates via
    // Supabase Realtime, damit sich z.B. der Zähler in anderen Tabs aktualisiert.
    if (this.parts[0] === 'users' && this.parts[2] === 'pinnedItems') {
      const uid = this.parts[1];
      supabaseClient
        .channel(`pinned_items_${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pinned_items', filter: `user_id=eq.${uid}` },
          () => dbRead(this.parts).then(value => callback(makeSnapshot(value))))
        .subscribe();
    }
    if (this.parts[0] === 'visits' && this.parts[1] === 'count') {
      supabaseClient
        .channel('visits_count')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' },
          () => dbRead(this.parts).then(value => callback(makeSnapshot(value))))
        .subscribe();
    }
    return callback;
  }
  off() { /* No-Op: unsere einfachen Listener müssen nicht explizit entfernt werden */ }
  transaction(updateFn) {
    // Wird aktuell nur für visits/count benutzt -> atomarer Increment per RPC.
    if (this.parts[0] === 'visits' && this.parts[1] === 'count') {
      return supabaseClient.rpc('increment_visits').then(({ error }) => {
        if (error) console.error('[supabase-compat] increment_visits Fehler:', error);
      });
    }
    // Generischer Fallback (nicht wirklich atomar, aber besser als nichts)
    return dbRead(this.parts).then(current => dbWrite(this.parts, 'set', updateFn(current)));
  }
}

function ref(path) {
  return new DBRef(path);
}

// -----------------------------------------------------------------------
// Auth-Shim - ahmt firebase.auth() nach
// -----------------------------------------------------------------------
function mapSupabaseUser(user) {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email,
    displayName: user.user_metadata?.full_name || user.user_metadata?.name || null,
    photoURL: user.user_metadata?.avatar_url || null,
    delete: async () => {
      throw new Error('Die vollständige Account-Löschung erfordert eine serverseitige Funktion (Supabase Edge Function). Deine Daten wurden bereits entfernt.');
    }
  };
}

let currentAuthUser = null;
const authStateCallbacks = [];

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentAuthUser = mapSupabaseUser(session?.user || null);
  authStateCallbacks.forEach(cb => cb(currentAuthUser));
});

const authShim = {
  get currentUser() {
    return currentAuthUser;
  },
  async createUserWithEmailAndPassword(email, password) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    return { user: mapSupabaseUser(data.user) };
  },
  async signInWithEmailAndPassword(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { user: mapSupabaseUser(data.user) };
  },
  onAuthStateChanged(callback) {
    authStateCallbacks.push(callback);
    // Sofort mit aktuellem Zustand (bzw. Session-Check) aufrufen
    supabaseClient.auth.getSession().then(({ data }) => {
      currentAuthUser = mapSupabaseUser(data?.session?.user || null);
      callback(currentAuthUser);
    });
    return () => {
      const i = authStateCallbacks.indexOf(callback);
      if (i > -1) authStateCallbacks.splice(i, 1);
    };
  },
  async signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  }
};

// -----------------------------------------------------------------------
// Globales `firebase`-Objekt (Namensgleich, damit script.js unverändert bleibt)
// -----------------------------------------------------------------------
const firebase = {
  auth: () => authShim,
  database: Object.assign(() => ({ ref }), { ServerValue: { TIMESTAMP: SERVER_TIMESTAMP } })
};


// userDatabase & database: im Original zwei getrennte Firebase-Projekte,
// jetzt beide dieselbe Supabase-Datenbank.
const userDatabase = { ref };
const database = { ref };
