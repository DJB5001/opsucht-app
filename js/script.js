const App = {
  auctionSortMode: "END",
  auctionCategoryFilter: "Alle",
  auctionItemFilter: "",
  historyItemFilter: "",
  auctionStarFilter: "Alle",
  dealsSortMode: "DISCOUNT_HIGH",
  dealsMinDiscount: 5,
  dealsDisplayCount: 50,
  marketPrices: {},
  marketItems: [],
  auctionsData: [],
  auctionHistory: {}, // Hält die geladene Auktions-Historie
  shardRates: [],
  shardHistory: {}, // Hält die geladene Shard-Historie
  currentItem: null,
  currentItemType: null,
  chart: null,
  uuidCache: JSON.parse(localStorage.getItem('opsucht_uuid_cache') || '{}'),
  skinCache: JSON.parse(localStorage.getItem('opsucht_skin_cache') || '{}'),
  matrixAnimationId: null,
  timerInterval: null,
  selectedPlayerUuid: null,
  previousState: null, // Merkt sich den Zustand vor dem Aufruf eines Spielerprofils
  scheduledNotifications: {}, // Speichert geplante Auktions-Benachrichtigungen
  settings: {
    auctions: { name: true, startBid: true, currentBid: true, bids: true, amount: true, timer: true, 'bid-amount': true },
    market: { name: true, buy: true, sell: true },
    shards: { name: true, rate: true },
    players: { name: true, auctions: true, bids: true, 'bid-amount': true },
    design: { itemRain: true, customBackground: false, customBackgroundImage: '', customCursor: false, cursorType: 'dot' },
    notifications: { overbid: true, email: false }
  },
  lastKnownOutbids: new Set(), // Track already notified outbids
  isAdmin: false,
  isPartner: false,
  ads: [],
  donations: [],
  donationGoal: 0,
  donationDisplayCount: 10,
  marketItemsMap: {}, // Cache für schnellen Zugriff auf Markt-Items
  playerStatsCache: {}, // Cache für Spieler-Statistiken
  profileRefreshInterval: null, // Interval für Profil-Aktualisierung
  userReminders: {}, // IDs der aktiven Erinnerungen
  profileFilter: "Alles", // Aktueller Filter im Profil
  pinnedItems: [], // Gepinnt Markt-Items
  historySortMode: "NEW",
  historyCategoryFilter: "Alle",
  historyStarFilter: "Alle",
  auctionDisplayCount: 50,
  auctionLastState: '',
  marketDisplayCount: 60,
  marketLastState: '',
  marketTrendFilter: 'none', // 'none', '3d', '7d', '30d'
  marketTrends: {}, // { material: { percentage: 0, trend: 'up'|'down' } }
  isMarketTrendsLoading: false,
  marketHistoryCache: {} // { material: { history: [], timestamp: num } }
};



// Firebase wurde durch Supabase ersetzt.
// `firebase`, `userDatabase` und `database` werden jetzt von js/supabase-compat.js
// bereitgestellt (Kompatibilitäts-Shim, damit der Rest dieser Datei unverändert bleibt).

// =====================================================================
// Basis-URL zu deinem GitHub-Repo, in dem der Auktions-/Shard-Verlauf liegt.
const HISTORY_REPO_BASE = "https://raw.githubusercontent.com/DJB5001/opsuchtinfo/main";
// =====================================================================


function showSection(id) {
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  // Performance-Check für Mobile/iOS
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    document.body.classList.add('perf-mode');
  }

  document.querySelectorAll('.tabs button').forEach(btn => btn.classList.remove('active'));
  const activeTabBtn = document.getElementById(`tab-${id}`);
  if (activeTabBtn) activeTabBtn.classList.add('active');

  if (id === 'profile') {
    renderMyProfile();
    // Start auto-refresh
    if (!App.profileRefreshInterval) {
      App.profileRefreshInterval = setInterval(() => renderMyProfile(true), 10000);
    }
  } else {
    // Clear auto-refresh if moving away
    if (App.profileRefreshInterval) {
      clearInterval(App.profileRefreshInterval);
      App.profileRefreshInterval = null;
    }
  }

  const rainContainer = document.getElementById('rain-container');
  const matrixCanvas = document.getElementById('matrix-canvas');

  stopMatrixAnimation();
  rainContainer.style.display = 'none';
  matrixCanvas.style.display = 'none';

  // Handle Ads Carousel Auto-Scroll
  if (id === 'about') {
    initPartnersCarousel();
  } else {
    stopPartnersAutoScroll();
  }

  document.querySelectorAll('.card.animated').forEach(card => {
    card.classList.remove('animated');
    card.style.animationDelay = '';
    card.style.animation = '';
    card.style.opacity = '';
    card.style.transform = '';
  });

  if (id === 'about') {
    matrixCanvas.style.display = 'block';
    startMatrixAnimation();
  } else {
    rainContainer.style.display = 'block';
    if (App.settings.design.itemRain) {
      createImageRain(id);
    }
    requestAnimationFrame(() => {
      animateCardsWave(document.getElementById(id));
    });
  }

  // Force re-render of dynamic content when entering a section
  if (id === 'about') {
    App.donationDisplayCount = 10;
    renderMarket(); // Ensure data is loaded if used elsewhere, but here we renderAbout
    renderDonations();
  }
  if (id === 'market') renderMarket();
  if (id === 'auctions') renderAuctions();
  if (id === 'deals') renderDeals();
  if (id === 'history') renderHistory();
  if (id === 'shards') renderShards();
  if (id === 'items') renderItemSearch();
}

// Tab-Wechsel über die obere Leiste: hebt einen aktiven Item-Filter auf,
// damit man dort wieder ALLE Auktionen/den ganzen Verlauf sieht.
function goToTab(id) {
  App.auctionItemFilter = '';
  App.historyItemFilter = '';
  App.selectedPlayerUuid = null;
  showSection(id);
}

function openModal() {
  const modal = document.getElementById("chartModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', handleEscKey);
}

function closeModal() {
  const modal = document.getElementById("chartModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');

  // Bugfix: Entferne den dynamisch erstellten "Zurück"-Button, damit er
  // nicht fälschlicherweise in anderen Ansichten (Markt/Shards) angezeigt wird.
  const backButton = modal.querySelector('#historyBackButton');
  if (backButton) backButton.remove();

  // Bugfix: Setze die Chart-Buttons auf den Standardzustand für den Markt zurück,
  // da sie für die Auktionshistorie überschrieben werden.
  const chartButtons = modal.querySelector('.chart-buttons');
  const buttons = chartButtons.querySelectorAll('button');
  buttons[0].textContent = 'Tag';
  buttons[0].onclick = () => loadHistory('DAILY', App.currentItem, App.currentItemType);
  buttons[1].textContent = 'Woche';
  buttons[1].onclick = () => loadHistory('WEEKLY', App.currentItem, App.currentItemType);
  buttons[2].textContent = 'Monat';
  buttons[2].onclick = () => loadHistory('MONTHLY', App.currentItem, App.currentItemType);
  buttons[3].style.display = 'none';

  setTimeout(() => {
    App.currentItem = null;
    if (App.chart) {
      App.chart.destroy();
      App.chart = null;
    }
  }, 300);
  window.removeEventListener('keydown', handleEscKey);
}

function handleEscKey(event) {
  if (event.key === 'Escape') closeModal();
}

function openImpressumModal() { /* Impressum entfernt */ }
function closeImpressumModal() { /* Impressum entfernt */ }
function handleImpressumEscKey(event) { /* Impressum entfernt */ }

function openPrivacyModal() {
  const modal = document.getElementById("privacyModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', handlePrivacyEscKey);
}

function closePrivacyModal() {
  const modal = document.getElementById("privacyModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', handlePrivacyEscKey);
}

function handlePrivacyEscKey(event) {
  if (event.key === 'Escape') closePrivacyModal();
}

function openAgbModal() {
  const modal = document.getElementById("agbModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', handleAgbEscKey);
}

function closeAgbModal() {
  const modal = document.getElementById("agbModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', handleAgbEscKey);
}

function handleAgbEscKey(event) {
  if (event.key === 'Escape') closeAgbModal();
}

function openLegalModal() {
  const modal = document.getElementById("legalModal");
  if (modal) {
    modal.classList.add("show");
    document.body.classList.add('modal-open');
    window.addEventListener('keydown', handleLegalEscKey);
  }
}

function closeLegalModal() {
  const modal = document.getElementById("legalModal");
  if (modal) {
    modal.classList.remove("show");
    document.body.classList.remove('modal-open');
    window.removeEventListener('keydown', handleLegalEscKey);
  }
}

function handleLegalEscKey(event) {
  if (event.key === 'Escape') closeLegalModal();
}

function openSettingsModal() {
  const modal = document.getElementById("settingsModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
  window.addEventListener('keydown', handleSettingsEscKey);

  // Lock Screen Logic
  const overlay = document.getElementById("settingsLockOverlay");
  const user = firebase.auth().currentUser;
  if (overlay) {
    if (user) {
      overlay.classList.remove("active");
    } else {
      overlay.classList.add("active");
    }
    // Sync toggles in Account tab
    if (document.getElementById('accountOverbidToggle')) {
      document.getElementById('accountOverbidToggle').checked = App.settings.notifications.overbid;
    }
    if (document.getElementById('accountEmailToggle')) {
      document.getElementById('accountEmailToggle').checked = App.settings.notifications.email;
    }
  }
}

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', handleSettingsEscKey);
}

function handleSettingsEscKey(event) {
  if (event.key === 'Escape') closeSettingsModal();
}

// --- SETTINGS LOGIC ---

function switchSettingsTab(tabName) {
  // Tabs active state
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.classList.remove('active');
    btn.style.color = 'var(--text-secondary)';
    btn.style.borderBottom = 'none';
  });
  const activeBtn = document.querySelector(`.settings-tab[onclick="switchSettingsTab('${tabName}')"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.color = 'var(--text-primary)';
    activeBtn.style.borderBottom = '2px solid var(--accent-color1)';
  }

  // Content visibility
  document.querySelectorAll('.settings-content-section').forEach(sec => sec.style.display = 'none');
  const activeSection = document.getElementById(`settings-${tabName}`);
  if (activeSection) activeSection.style.display = 'block';

  // Specific handles for tabs
  if (tabName === 'ads') {
    renderAdsSettings();
  } else if (tabName === 'donations') {
    renderDonationSettings();
  } else if (tabName === 'minecraft') {
    loadMinecraftVerificationStatus();
  }
}

async function handleDeleteAccount() {
  const user = firebase.auth().currentUser;
  if (!user) {
    showConfirmModal('Fehler', 'Du musst angemeldet sein, um deinen Account zu löschen.', 'Ok', false);
    return;
  }

  const confirmed = await showConfirmModal(
    'Account löschen',
    'Bist du sicher? Alle deine Daten werden unwiderruflich gelöscht. Wenn du dich lange nicht angemeldet hast, musst du dich ggf. erst neu einloggen.',
    'Löschen'
  );

  if (confirmed) {
    try {
      showPageLoader();
      // Datenbank-Einträge löschen
      await firebase.database().ref(`users/${user.uid}`).remove();

      // Hinweis: Das vollständige Löschen des Login-Accounts selbst (Supabase Auth)
      // kann aus Sicherheitsgründen nicht direkt vom Browser aus gemacht werden -
      // dafür wäre eine Supabase Edge Function mit Service-Role-Key nötig.
      // Wir melden den Nutzer ab, seine Daten sind bereits gelöscht.
      await firebase.auth().signOut();

      showConfirmModal('Erfolg', 'Deine Daten wurden gelöscht und du wurdest abgemeldet.', 'Ok', false).then(() => {
        location.reload();
      });
    } catch (error) {
      hidePageLoader();
      console.error('Fehler beim Löschen des Accounts:', error);
      showConfirmModal('Fehler', 'Fehler beim Löschen des Accounts: ' + error.message, 'Ok', false);
    }
  }
}

async function toggleCardInfo(category, settingKey, enabled) {
  // Update local state
  if (!App.settings[category]) App.settings[category] = {};
  App.settings[category][settingKey] = enabled;

  // Update DOM classes for fast toggling
  const className = `hide-${category}-${settingKey}`;
  if (enabled) {
    document.body.classList.remove(className);
  } else {
    document.body.classList.add(className);
  }

  // Persist to Firebase if logged in
  const user = firebase.auth().currentUser;
  if (user) {
    try {
      await firebase.database().ref(`users/${user.uid}/settings/${category}`).update({
        [settingKey]: enabled
      });
    } catch (e) {
      console.error(`Error saving ${category} setting:`, e);
    }
  }
}


function showConfirmModal(title, message, confirmText = 'Bestätigen', showCancel = true) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmBtnYes');
    const noBtn = document.getElementById('confirmBtnNo');

    if (!modal || !titleEl || !messageEl || !yesBtn || !noBtn) {
      resolve(confirm(message));
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    yesBtn.textContent = confirmText;
    noBtn.style.display = showCancel ? 'block' : 'none';

    const cleanup = () => {
      yesBtn.onclick = null;
      noBtn.onclick = null;
      modal.classList.remove('show');
      document.body.classList.remove('modal-open');
    };

    yesBtn.onclick = () => {
      cleanup();
      resolve(true);
    };

    noBtn.onclick = () => {
      cleanup();
      resolve(false);
    };

    modal.classList.add('show');
    document.body.classList.add('modal-open');
  });
}

async function resetSettings(category) {
  const defaults = {
    auctions: { name: true, startBid: true, currentBid: true, bids: true, amount: true, timer: true, 'bid-amount': true },
    market: { name: true, buy: true, sell: true },
    shards: { name: true, rate: true },
    players: { name: true, auctions: true, bids: true, 'bid-amount': true },
    design: { itemRain: true, customBackground: false, customBackgroundImage: '' }
  };

  if (!defaults[category]) return;

  const confirmReset = await showConfirmModal(
    'Einstellungen zurücksetzen?',
    `Möchtest du die Einstellungen für ${category.toUpperCase()} wirklich auf die Standardwerte zurücksetzen?`
  );
  if (!confirmReset) return;

  // Update App.settings
  App.settings[category] = { ...defaults[category] };

  if (category === 'design') {
    // Specialized reset for Design
    toggleItemRain(true);
    if (document.getElementById('itemRainToggle')) document.getElementById('itemRainToggle').checked = true;

    toggleCustomBackground(false);
    if (document.getElementById('customBackgroundToggle')) document.getElementById('customBackgroundToggle').checked = false;

    saveCustomBackground('');
    if (document.getElementById('customBackgroundUrl')) document.getElementById('customBackgroundUrl').value = '';

    toggleLightMode(false);
    if (document.getElementById('lightModeToggle')) document.getElementById('lightModeToggle').checked = false;

    toggleCustomMode(false);
    if (document.getElementById('customModeToggle')) document.getElementById('customModeToggle').checked = false;

    applyCustomColor('#00C9FF');
    saveCustomColor('#00C9FF');
    if (document.getElementById('customThemeColor')) document.getElementById('customThemeColor').value = '#00C9FF';
    if (document.getElementById('colorHexDisplay')) document.getElementById('colorHexDisplay').innerText = '#00C9FF';
  } else {
    // Boolean toggles for other categories
    for (const [key, val] of Object.entries(App.settings[category])) {
      const toggle = document.getElementById(`setting-${category}-${key}`);
      if (toggle) toggle.checked = val;

      const className = `hide-${category}-${key}`;
      if (val) {
        document.body.classList.remove(className);
      } else {
        document.body.classList.add(className);
      }
    }

    // Persist to Firebase
    const user = firebase.auth().currentUser;
    if (user) {
      try {
        await firebase.database().ref(`users/${user.uid}/settings/${category}`).set(App.settings[category]);
      } catch (e) {
        console.error(`Error resetting ${category} to Firebase:`, e);
      }
    }
  }

  // Save to LocalStorage
  if (category === 'design') {
    localStorage.setItem('itemRain', 'true');
    localStorage.setItem('customBackground', 'false');
    localStorage.setItem('customBackgroundImage', '');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('customColor', '#00C9FF');
  }
}


// --- GLITTER & REVEAL ANIMATION ---

class GlitterParticle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.size = Math.random() * 3 + 1;
    this.speedX = (Math.random() - 0.5) * 4;
    this.speedY = (Math.random() - 0.5) * 4;
    this.life = 1.0;
    this.decay = Math.random() * 0.02 + 0.01;
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life -= this.decay;
  }

  draw(ctx) {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

let glitterParticles = [];
let glitterAnimationId = null;

function animateGlitter() {
  const canvas = document.getElementById('glitter-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = glitterParticles.length - 1; i >= 0; i--) {
    const p = glitterParticles[i];
    p.update();
    if (p.life <= 0) {
      glitterParticles.splice(i, 1);
    } else {
      p.draw(ctx);
    }
  }

  if (glitterParticles.length > 0) {
    glitterAnimationId = requestAnimationFrame(animateGlitter);
  } else {
    glitterAnimationId = null;
  }
}

function spawnGlitter(x, y, count = 5) {
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color1').trim() || '#00C9FF';
  const canvas = document.getElementById('glitter-canvas');
  if (!canvas) return;

  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  for (let i = 0; i < count; i++) {
    glitterParticles.push(new GlitterParticle(x, y, accentColor));
  }

  if (!glitterAnimationId) {
    animateGlitter();
  }
}

function triggerBackgroundReveal(newUrl) {
  const overlay = document.getElementById('bg-reveal-overlay');
  if (!overlay) return;

  // Preload image
  const img = new Image();
  img.onload = () => {
    overlay.style.backgroundImage = `url('${newUrl}')`;
    overlay.style.height = '0';
    overlay.classList.add('active');

    const startTime = performance.now();
    const duration = 1000; // 1s transition (faster)

    function frame(time) {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Manually set height for perfect synchronization with glitter
      const y = window.innerHeight * progress;
      overlay.style.height = y + 'px';

      // Spawn glitter along the reveal line (top to bottom)
      for (let x = 0; x < window.innerWidth; x += 50) {
        spawnGlitter(x + Math.random() * 50, y);
      }

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        // End animation: sync body and reset overlay
        setTimeout(() => {
          document.body.style.backgroundImage = `url('${newUrl}')`;
          overlay.classList.remove('active');
          overlay.style.height = '0';
        }, 100);
      }
    }
    requestAnimationFrame(frame);
  };
  img.src = newUrl;
}

// Globale Variable, um Zirkelbezüge beim Laden zu vermeiden
let isLoadingTheme = false;

async function toggleItemRain(enabled) {
  App.settings.design.itemRain = enabled;
  const container = document.getElementById('rain-container');

  if (!enabled) {
    if (container) container.innerHTML = '';
  } else {
    const activeSection = document.querySelector('.section.active');
    if (activeSection && activeSection.id !== 'about') {
      createImageRain(activeSection.id);
    }
  }

  // Persist
  localStorage.setItem('itemRain', enabled);
  const user = firebase.auth().currentUser;
  if (user && !isLoadingTheme) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings/design').update({
        itemRain: enabled
      });
    } catch (e) {
      console.error("Error saving rain setting:", e);
    }
  }
}

async function toggleCustomBackground(enabled) {
  App.settings.design.customBackground = enabled;
  const urlContainer = document.getElementById('customBackgroundUrlContainer');

  if (enabled) {
    if (urlContainer) urlContainer.style.display = 'flex';
    applyCustomBackgroundImage(document.getElementById('customBackgroundUrl').value);
  } else {
    if (urlContainer) urlContainer.style.display = 'none';
    document.body.style.backgroundImage = '';
  }

  // Persist
  localStorage.setItem('customBackground', enabled);
  const user = firebase.auth().currentUser;
  if (user && !isLoadingTheme) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings/design').update({
        customBackground: enabled
      });
    } catch (e) {
      console.error("Error saving custom background setting:", e);
    }
  }
}

function toggleCustomCursor(enabled) {
  const isFinePointer = window.matchMedia("(pointer: fine)").matches;
  App.settings.design.customCursor = enabled;
  const cursor = document.getElementById('custom-cursor');

  if (enabled && isFinePointer) {
    document.body.classList.add('custom-cursor-active');
    if (cursor) cursor.style.display = 'block';
    document.addEventListener('mousemove', moveCustomCursor);
  } else {
    document.body.classList.remove('custom-cursor-active');
    if (cursor) cursor.style.display = 'none';
    document.removeEventListener('mousemove', moveCustomCursor);
  }

  // Persist
  localStorage.setItem('customCursor', enabled);
  const user = firebase.auth().currentUser;
  if (user && !isLoadingTheme) {
    try {
      firebase.database().ref('users/' + user.uid + '/settings/design').update({
        customCursor: enabled
      });
    } catch (e) {
      console.error("Error saving custom cursor setting:", e);
    }
  }

  const typeContainer = document.getElementById('customCursorTypeContainer');
  if (typeContainer) {
    typeContainer.style.display = enabled ? 'flex' : 'none';
  }

  // Ensure correct type is applied when enabling
  if (enabled) {
    setCursorType(App.settings.design.cursorType || 'dot', false);
    setCursorSize(App.settings.design.cursorSize || 1.0, false);
  }
}

function setCursorSize(size, save = true) {
  size = parseFloat(size);
  if (isNaN(size)) size = 1.0;

  App.settings.design.cursorSize = size;
  document.documentElement.style.setProperty('--cursor-scale', size);

  if (document.getElementById('cursorSizeSlider')) {
    document.getElementById('cursorSizeSlider').value = size;
  }

  if (save) {
    localStorage.setItem('cursorSize', size);
    const user = firebase.auth().currentUser;
    if (user && !isLoadingTheme) {
      try {
        firebase.database().ref('users/' + user.uid + '/settings/design').update({
          cursorSize: size
        });
      } catch (e) {
        console.error("Error saving cursor size:", e);
      }
    }
  }
}

function setCursorType(type, save = true) {
  const validTypes = ['dot', 'normal', 'crosshair'];
  if (!validTypes.includes(type)) type = 'dot';

  App.settings.design.cursorType = type;

  // Update UI
  document.querySelectorAll('.cursor-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.type === type);
  });

  // Update Cursor Element
  const cursor = document.getElementById('custom-cursor');
  if (cursor) {
    cursor.className = ''; // Reset classes
    cursor.classList.add(`cursor-${type}`);

    // Inject SVG Content for specific types
    if (type === 'normal') {
      cursor.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>';
    } else if (type === 'crosshair') {
      cursor.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>';
    } else {
      cursor.innerHTML = ''; // Dot uses CSS pseudo-element
    }
  }

  if (save) {
    localStorage.setItem('cursorType', type);
    const user = firebase.auth().currentUser;
    if (user && !isLoadingTheme) {
      try {
        firebase.database().ref('users/' + user.uid + '/settings/design').update({
          cursorType: type
        });
      } catch (e) {
        console.error("Error saving cursor type:", e);
      }
    }
  }
}

function moveCustomCursor(e) {
  const cursor = document.getElementById('custom-cursor');
  if (cursor) {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
  }
}

function applyCustomBackgroundImage(url, animate = false) {
  if (App.settings.design.customBackground && url) {
    if (animate) {
      triggerBackgroundReveal(url);
    } else {
      document.body.style.backgroundImage = `url('${url}')`;
    }
  } else if (!App.settings.design.customBackground) {
    document.body.style.backgroundImage = '';
  }
}

async function saveCustomBackground(url) {
  const oldUrl = App.settings.design.customBackgroundImage;
  App.settings.design.customBackgroundImage = url;
  localStorage.setItem('customBackgroundImage', url);

  // Trigger animation if URL changed
  if (url !== oldUrl) {
    applyCustomBackgroundImage(url, true);
  }

  const user = firebase.auth().currentUser;
  if (user && !isLoadingTheme) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings/design').update({
        customBackgroundImage: url
      });
    } catch (e) {
      console.error("Error saving custom background image:", e);
    }
  }
}

async function togglePin(material) {
  if (!material) return;
  const user = firebase.auth().currentUser;
  if (!user) {
    showConfirmModal('Anmeldung erforderlich', 'Bitte melde dich an, um Items zu pinnen.', 'Anmelden', true).then(confirmed => {
      if (confirmed) {
        closeModal();
        openAuthModal();
      }
    });
    return;
  }

  let pinned = [...(App.pinnedItems || [])];
  const index = pinned.indexOf(material);

  if (index > -1) {
    pinned.splice(index, 1);
  } else {
    pinned.push(material);
  }

  try {
    await userDatabase.ref(`users/${user.uid}/pinnedItems`).set(pinned);
    // Button UI im Modal aktualisieren
    const pinBtn = document.getElementById('marketPinBtn');
    if (pinBtn) {
      pinBtn.classList.toggle('pinned', pinned.includes(material));
    }
  } catch (e) {
    console.error("Error toggling pin:", e);
  }
}

function initThemeFromLocalStorage() {
  const theme = localStorage.getItem('theme');
  const customColor = localStorage.getItem('customColor') || '#00C9FF';
  const itemRain = localStorage.getItem('itemRain') !== 'false'; // Default to true
  const customBackground = localStorage.getItem('customBackground') === 'true';
  const customBackgroundImage = localStorage.getItem('customBackgroundImage') || '';
  const customCursor = localStorage.getItem('customCursor') === 'true';
  const icon = document.querySelector('.settings-icon');

  // Set rain setting in App and UI
  App.settings.design.itemRain = itemRain;
  if (document.getElementById('itemRainToggle')) {
    document.getElementById('itemRainToggle').checked = itemRain;
  }

  // Set custom background setting in App and UI
  App.settings.design.customBackground = customBackground;
  App.settings.design.customBackgroundImage = customBackgroundImage;
  if (document.getElementById('customBackgroundToggle')) {
    document.getElementById('customBackgroundToggle').checked = customBackground;
  }
  if (document.getElementById('customBackgroundUrl')) {
    document.getElementById('customBackgroundUrl').value = customBackgroundImage;
  }
  if (document.getElementById('customBackgroundUrlContainer')) {
    document.getElementById('customBackgroundUrlContainer').style.display = customBackground ? 'flex' : 'none';
  }
  applyCustomBackgroundImage(customBackgroundImage);

  // Set custom cursor setting
  App.settings.design.customCursor = customCursor;
  if (customCursor) {
    toggleCustomCursor(true);
  }
  if (document.getElementById('customCursorToggle')) {
    document.getElementById('customCursorToggle').checked = customCursor;
  }
  // Load initial Cursor Type from LocalStorage
  const savedCursorType = localStorage.getItem('cursorType') || 'dot';
  if (customCursor) {
    setCursorType(savedCursorType, false);
  }

  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (document.getElementById('lightModeToggle')) document.getElementById('lightModeToggle').checked = true;
    if (icon) icon.src = "https://i.postimg.cc/FzR9Xgdg/Zahnrad.png";
  } else if (theme === 'custom') {
    document.documentElement.setAttribute('data-theme', 'custom');
    if (document.getElementById('customModeToggle')) {
      document.getElementById('customModeToggle').checked = true;
      document.getElementById('customColorPickerContainer').style.display = 'flex';
      document.getElementById('customThemeColor').value = customColor;
    }
    if (icon) icon.src = "https://i.postimg.cc/gJcp3qDP/Zahnrad.png";
    applyCustomColor(customColor);
  } else if (icon) {
    icon.src = "https://i.postimg.cc/gJcp3qDP/Zahnrad.png";
  }
}

async function toggleLightMode(enabled) {
  const icon = document.querySelector('.settings-icon');
  const theme = enabled ? 'light' : 'dark';

  // Mutual exclusivity with Custom Mode
  if (enabled && document.getElementById('customModeToggle').checked) {
    document.getElementById('customModeToggle').checked = false;
    toggleCustomMode(false);
  }

  // UI Updates
  if (enabled) {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
    if (icon) icon.src = "https://i.postimg.cc/FzR9Xgdg/Zahnrad.png";
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'dark');
    if (icon) icon.src = "https://i.postimg.cc/gJcp3qDP/Zahnrad.png";
  }

  persistTheme(theme);
}

async function toggleCustomMode(enabled) {
  const pickerContainer = document.getElementById('customColorPickerContainer');
  const theme = enabled ? 'custom' : (document.getElementById('lightModeToggle').checked ? 'light' : 'dark');

  if (enabled) {
    // Mutual exclusivity with Light Mode
    if (document.getElementById('lightModeToggle').checked) {
      document.getElementById('lightModeToggle').checked = false;
      document.documentElement.removeAttribute('data-theme');
      const icon = document.querySelector('.settings-icon');
      if (icon) icon.src = "https://i.postimg.cc/gJcp3qDP/Zahnrad.png";
    }
    document.documentElement.setAttribute('data-theme', 'custom');
    localStorage.setItem('theme', 'custom');
    if (pickerContainer) pickerContainer.style.display = 'flex';
    applyCustomColor(document.getElementById('customThemeColor').value);
  } else {
    if (!document.getElementById('lightModeToggle').checked) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
    }
    if (pickerContainer) pickerContainer.style.display = 'none';
    const dynamicStyle = document.getElementById('custom-theme-styles');
    if (dynamicStyle) dynamicStyle.remove();
  }

  persistTheme(localStorage.getItem('theme'));
}

function applyCustomColor(hex) {
  document.getElementById('colorHexDisplay').textContent = hex.toUpperCase();
  const hsl = hexToHsl(hex);

  // Generiere dynamische Schattierungen
  const h = hsl.h;
  const s = hsl.s;
  const l = hsl.l;

  const styles = `
    [data-theme="custom"] {
      --accent-color1: ${hex};
      --accent-glow: hsla(${h}, ${s}%, ${l}%, 0.3);
      --accent-glow-weak: hsla(${h}, ${s}%, ${l}%, 0.1);
      --background: hsl(${h}, ${Math.max(0, s - 20)}%, 5%);
      --surface: hsl(${h}, ${Math.max(0, s - 15)}%, 12%);
      --surface-card: hsla(${h}, ${Math.max(0, s - 15)}%, 15%, 0.6);
      --border: hsl(${h}, ${Math.max(0, s - 10)}%, 25%);
      --text-primary: #ffffff;
      --text-secondary: hsl(${h}, 10%, 70%);
      --surface-modal: hsla(${h}, ${Math.max(0, s - 15)}%, 10%, 0.95);
    }
  `;

  let styleTag = document.getElementById('custom-theme-styles');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'custom-theme-styles';
    document.head.appendChild(styleTag);
  }
  styleTag.innerHTML = styles;
}

async function saveCustomColor(hex) {
  localStorage.setItem('customColor', hex);
  const user = firebase.auth().currentUser;
  if (user) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings').update({
        customColor: hex
      });
    } catch (e) { console.error("Error saving custom color:", e); }
  }
}

async function persistTheme(theme) {
  const user = firebase.auth().currentUser;
  if (user && !isLoadingTheme) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings').update({
        theme: theme
      });
    } catch (e) {
      console.error("Error saving theme settings:", e);
    }
  }
}

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;

  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

async function loadUserSettings(user) {
  if (!user) return;
  isLoadingTheme = true;
  try {
    const snapshot = await firebase.database().ref('users/' + user.uid + '/settings').once('value');
    const settings = snapshot.val();

    if (settings && settings.theme) {
      isLoadingTheme = true;
      const theme = settings.theme;
      const customColor = settings.customColor || '#00C9FF';

      if (theme === 'light') {
        document.getElementById('lightModeToggle').checked = true;
        toggleLightMode(true);
      } else if (theme === 'custom') {
        document.getElementById('customModeToggle').checked = true;
        document.getElementById('customThemeColor').value = customColor;
        toggleCustomMode(true);
      } else {
        document.getElementById('lightModeToggle').checked = false;
        document.getElementById('customModeToggle').checked = false;
        toggleLightMode(false);
      }
      isLoadingTheme = false;
    }

    if (settings && settings.design) {
      isLoadingTheme = true;
      if (settings.design.itemRain !== undefined) {
        toggleItemRain(settings.design.itemRain);
        if (document.getElementById('itemRainToggle')) {
          document.getElementById('itemRainToggle').checked = settings.design.itemRain;
        }
      }
      if (settings.design.customBackground !== undefined) {
        toggleCustomBackground(settings.design.customBackground);
        if (document.getElementById('customBackgroundToggle')) {
          document.getElementById('customBackgroundToggle').checked = settings.design.customBackground;
        }
      }
      if (settings.design.customBackgroundImage !== undefined) {
        saveCustomBackground(settings.design.customBackgroundImage);
        if (document.getElementById('customBackgroundUrl')) {
          document.getElementById('customBackgroundUrl').value = settings.design.customBackgroundImage;
        }
      }
      if (document.getElementById('customBackgroundUrlContainer')) {
        document.getElementById('customBackgroundUrlContainer').style.display = App.settings.design.customBackground ? 'flex' : 'none';
      }
      if (settings.design.customCursor !== undefined) {
        toggleCustomCursor(settings.design.customCursor);
        if (document.getElementById('customCursorToggle')) {
          document.getElementById('customCursorToggle').checked = settings.design.customCursor;
        }
        // Load Cursor Type
        if (settings.design.cursorType) {
          setCursorType(settings.design.cursorType, false); // false = don't save to DB again
        } else {
          // Fallback for existing users who enabled it but have no type set
          setCursorType('dot', false);
        }

        // Load Cursor Size
        if (settings.design.cursorSize) {
          setCursorSize(settings.design.cursorSize, false);
        } else {
          setCursorSize(1.0, false);
        }
      }
      isLoadingTheme = false;
    }

    // Load notification categories
    if (settings && settings.notifications) {
      App.settings.notifications = { ...App.settings.notifications, ...settings.notifications };
      if (document.getElementById('overbidNotificationToggle')) {
        document.getElementById('overbidNotificationToggle').checked = App.settings.notifications.overbid;
      }
      if (document.getElementById('emailNotificationToggle')) {
        document.getElementById('emailNotificationToggle').checked = App.settings.notifications.email || false;
      }
    }

    // Apply to UI
    applyVisibilitySettings();

    // 2. Pinned Items
    const pinnedRef = userDatabase.ref(`users/${user.uid}/pinnedItems`);
    pinnedRef.on('value', (snapshot) => {
      App.pinnedItems = snapshot.val() || [];
      // Falls wir gerade im Markt sind, aktualisieren wir die Ansicht
      const activeSection = document.querySelector('.section.active');
      if (activeSection && activeSection.id === 'market') {
        renderMarket();
      }
    });
  } catch (e) {
    console.error("Error loading user settings:", e);
  } finally {
    isLoadingTheme = false;
  }
}

function applyVisibilitySettings() {
  const categories = ['auctions', 'market', 'shards', 'players'];
  categories.forEach(cat => {
    if (!App.settings[cat]) return;
    Object.entries(App.settings[cat]).forEach(([key, enabled]) => {
      const className = `hide-${cat}-${key}`;
      if (enabled) {
        document.body.classList.remove(className);
      } else {
        document.body.classList.add(className);
      }
      // Update checkbox state in settings modal
      const toggle = document.getElementById(`setting-${cat}-${key}`);
      if (toggle) toggle.checked = !!enabled;
    });
  });
}

function resetVisibilitySettings() {
  // Reset App.settings to defaults
  App.settings.auctions = { name: true, startBid: true, currentBid: true, bids: true, amount: true, timer: true, 'bid-amount': true };
  App.settings.market = { name: true, buy: true, sell: true };
  App.settings.shards = { name: true, rate: true };
  App.settings.players = { name: true, auctions: true, bids: true, 'bid-amount': true };
  App.settings.design = { itemRain: true, customBackground: false, customBackgroundImage: '', customCursor: false, cursorType: 'dot', cursorSize: 1.0 };

  // Remove all hide classes from body
  const categories = ['auctions', 'market', 'shards', 'players'];
  categories.forEach(cat => {
    Object.keys(App.settings[cat] || {}).forEach(key => {
      document.body.classList.remove(`hide-${cat}-${key}`);
    });
  });

  // Update all visibility checkboxes
  document.querySelectorAll('#settingsModal input[type="checkbox"]').forEach(cb => {
    if (cb.id.startsWith('setting-')) cb.checked = true;
  });

  // Reset Design UI & State
  toggleItemRain(true);
  if (document.getElementById('itemRainToggle')) document.getElementById('itemRainToggle').checked = true;

  toggleCustomBackground(false);
  if (document.getElementById('customBackgroundToggle')) document.getElementById('customBackgroundToggle').checked = false;

  saveCustomBackground('');
  if (document.getElementById('customBackgroundUrl')) document.getElementById('customBackgroundUrl').value = '';

  toggleCustomMode(false);
  if (document.getElementById('customModeToggle')) document.getElementById('customModeToggle').checked = false;

  // Clear background on body
  document.body.style.backgroundImage = '';

  toggleCustomCursor(false);
  if (document.getElementById('customCursorToggle')) document.getElementById('customCursorToggle').checked = false;
  setCursorType('dot', false);
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light');
  // Checkbox wird beim Laden des Modals gesetzt (da es static HTML ist, muss man das beim Öffnen machen oder hier einmalig versuchen)
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('lightModeToggle');
    if (toggle) toggle.checked = true;
    const icon = document.querySelector('.settings-icon');
    if (icon) icon.src = "https://i.postimg.cc/FzR9Xgdg/Zahnrad.png";
  });
}

// --- AUTHENTICATION LOGIC ---

let currentAuthMode = 'login'; // 'login' or 'register'

function openAuthModal() {
  const modal = document.getElementById("authModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
  // Reset form
  document.getElementById('authForm').reset();
  document.getElementById('authError').style.display = 'none';
  switchAuthMode('login'); // Immer mit Login starten
  window.addEventListener('keydown', handleAuthEscKey);
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');
  window.removeEventListener('keydown', handleAuthEscKey);
}

function handleAuthEscKey(event) {
  if (event.key === 'Escape') closeAuthModal();
}

function switchAuthMode(mode) {
  currentAuthMode = mode;
  const title = document.getElementById('authModalTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const switchText = document.getElementById('authSwitchText');
  const confirmPass = document.getElementById('authPasswordConfirm');

  document.getElementById('authError').style.display = 'none';

  if (mode === 'register') {
    title.textContent = 'Registrieren';
    submitBtn.textContent = 'Konto erstellen';
    confirmPass.style.display = 'block';
    confirmPass.required = true;
    switchText.innerHTML = 'Bereits ein Konto? <a onclick="switchAuthMode(\'login\')">Anmelden</a>';
  } else {
    title.textContent = 'Anmelden';
    submitBtn.textContent = 'Anmelden';
    confirmPass.style.display = 'none';
    confirmPass.required = false;
    switchText.innerHTML = 'Noch kein Konto? <a onclick="switchAuthMode(\'register\')">Registrieren</a>';
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const errorDiv = document.getElementById('authError');

  errorDiv.style.display = 'none';
  errorDiv.textContent = '';

  try {
    if (currentAuthMode === 'register') {
      const confirmPassword = document.getElementById('authPasswordConfirm').value;
      if (password !== confirmPassword) {
        throw new Error("Passwörter stimmen nicht überein.");
      }
      // Registrierung
      await firebase.auth().createUserWithEmailAndPassword(email, password);
      // Nach Registrierung ist man automatisch eingeloggt
    } else {
      // Login
      await firebase.auth().signInWithEmailAndPassword(email, password);
    }
    closeAuthModal();
  } catch (error) {
    console.error("Auth Error:", error);
    errorDiv.style.display = 'block';

    // Lesbaren Text aus dem Fehler holen (Supabase-Fehler haben je nach Fall
    // .message, .error_description, .msg oder nur einen Status-Code).
    let rawMsg =
      (error && (error.message || error.error_description || error.msg || error.error)) || '';
    if (typeof rawMsg !== 'string') {
      try { rawMsg = JSON.stringify(rawMsg); } catch (e) { rawMsg = String(rawMsg); }
    }
    if (!rawMsg || rawMsg === '{}' || rawMsg === '[object Object]') {
      rawMsg = 'Anmeldung fehlgeschlagen. Prüfe E-Mail/Passwort und ob der E-Mail-Login in Supabase aktiviert ist.';
    }

    let msg = rawMsg;
    const raw = rawMsg.toLowerCase();
    if (raw.includes('already registered') || raw.includes('already been registered')) msg = "Diese E-Mail wird bereits verwendet.";
    else if (raw.includes('invalid email') || raw.includes('unable to validate email')) msg = "Die E-Mail Adresse ist ungültig.";
    else if (raw.includes('password') && (raw.includes('short') || raw.includes('at least') || raw.includes('6 char'))) msg = "Das Passwort muss mindestens 6 Zeichen lang sein.";
    else if (raw.includes('invalid login credentials')) msg = "Kein Nutzer mit dieser E-Mail und diesem Passwort gefunden.";
    else if (raw.includes('email not confirmed')) msg = "Deine E-Mail wurde noch nicht bestätigt. Prüfe dein Postfach oder deaktiviere 'Confirm email' in Supabase.";
    else if (raw.includes('signups not allowed') || raw.includes('signup is disabled')) msg = "Registrierung ist in Supabase aktuell deaktiviert.";
    else if (raw.includes('email logins are disabled') || raw.includes('provider is not enabled')) msg = "Der E-Mail-Login ist in Supabase nicht aktiviert (Authentication → Providers → Email).";

    errorDiv.textContent = msg;
  }
}

function signOutUser() {
  firebase.auth().signOut().then(() => {
    console.log("Benutzer abgemeldet");
    // Seite neu laden oder UI updaten passiert durch onAuthStateChanged
  }).catch((error) => {
    console.error("Fehler beim Abmelden", error);
  });
}

function updateHeaderUser(user) {
  const userArea = document.getElementById('userArea');
  if (!userArea) return;

  if (user) {
    const displayName = user.displayName || user.email.split('@')[0];
    const initial = (displayName.match(/[a-zA-Z]/) || ['?'])[0].toUpperCase();

    let avatarHTML;
    if (user.photoURL) {
      avatarHTML = `<img src="${user.photoURL}" class="user-header-avatar" alt="User" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="user-header-avatar-initial" style="display:none;">${initial}</div>`;
    } else {
      avatarHTML = `<div class="user-header-avatar-initial">${initial}</div>`;
    }

    userArea.innerHTML = `
      <div class="user-header-profile" onclick="openProfileSettings()">
        <span class="user-header-name">${displayName}</span>
        ${avatarHTML}
      </div>
    `;
  } else {
    userArea.innerHTML = `<button id="loginBtn" class="auth-header-btn" onclick="openAuthModal()">Anmelden</button>`;
  }
}

// --- Auth State Observer ---
firebase.auth().onAuthStateChanged(async (user) => {
  // Initial Theme load from localStorage before user settings are fetched
  initThemeFromLocalStorage();
  if (user) {
    console.log("User Logged In:", user.email);

    // Dynamic Header
    updateHeaderUser(user);

    // Sync User Info & Fetch Roles
    const userRef = userDatabase.ref('users/' + user.uid);
    const userDataSnapshot = await userRef.once('value');
    const userData = userDataSnapshot.val() || {};

    const updates = {
      email: user.email,
      lastLogin: firebase.database.ServerValue.TIMESTAMP
    };

    // Automatically add these fields if they don't exist yet
    if (userData.isAdmin === undefined) updates.isAdmin = false;
    if (userData.isPartner === undefined) updates.isPartner = false;

    await userRef.update(updates);

    // Update local app state
    App.isAdmin = (userData.isAdmin === true) || (updates.isAdmin === true);
    App.isPartner = (userData.isPartner === true) || (updates.isPartner === true);

    console.log("Roles - Admin:", App.isAdmin, "Partner:", App.isPartner);

    // Show/Hide Ads Tab based on roles
    const adsTab = document.getElementById('settings-tab-ads');
    if (adsTab) {
      adsTab.style.display = (App.isAdmin || App.isPartner) ? 'block' : 'none';
    }

    // Show/Hide Donations Settings Tab based on roles
    const donationsTab = document.getElementById('settings-tab-donations');
    if (donationsTab) {
      donationsTab.style.display = App.isAdmin ? 'block' : 'none';
    }

    // Show/Hide User Codes Settings Tab based on roles
    const userCodesTab = document.getElementById('settings-tab-user-codes');
    if (userCodesTab) {
      userCodesTab.style.display = App.isAdmin ? 'block' : 'none';
    }

    // Load persisted settings
    loadUserSettings(user);

    // Load Reminders for UI
    await loadUserReminders(user);

    // Load Ads
    loadAds();

    // Load Minecraft Verification (to show/hide Profil tab)
    loadMinecraftVerificationStatus();
  } else {
    console.log("User Logged Out via AuthStateChanged");
    App.isAdmin = false;
    App.isPartner = false;
    const adsTab = document.getElementById('settings-tab-ads');
    if (adsTab) adsTab.style.display = 'none';

    const donationsTab = document.getElementById('settings-tab-donations');
    if (donationsTab) donationsTab.style.display = 'none';

    const userCodesTab = document.getElementById('settings-tab-user-codes');
    if (userCodesTab) userCodesTab.style.display = 'none';

    updateHeaderUser(null);
    toggleLightMode(false);
    resetVisibilitySettings();
    App.pinnedItems = []; // Reset pins on logout
    loadAds(); // Reload default/empty ads
  }
});

function openProfileSettings() {
  const modal = document.getElementById("logoutModal");
  modal.classList.add("show");
  document.body.classList.add('modal-open');
}

function closeLogoutModal() {
  const modal = document.getElementById("logoutModal");
  modal.classList.remove("show");
  document.body.classList.remove('modal-open');
}

function confirmLogout() {
  closeLogoutModal();
  signOutUser();
}

function showPageLoader() {
  document.getElementById('page-loader').style.display = 'flex';
}

function hidePageLoader() {
  document.getElementById('page-loader').style.display = 'none';
}

function setAuctionSort(mode) {
  App.auctionSortMode = mode;
  renderAuctions();
}

// --- Reminder Helper ---
async function loadUserReminders(user) {
  if (!user) {
    App.userReminders = {};
    return;
  }
  try {
    const snapshot = await userDatabase.ref(`users/${user.uid}/reminders`).once('value');
    App.userReminders = snapshot.val() || {};
  } catch (e) {
    console.error("Error loading reminders:", e);
    App.userReminders = {};
  }
}

async function uuidToUsername(uuid) {
  if (!uuid) return "-";
  // Check cache first
  if (App.uuidCache[uuid] && App.uuidCache[uuid] !== 'Unbekannt') {
    return App.uuidCache[uuid];
  }

  // --- 1. Versuch: playerdb.co (für Java-UUIDs) ---
  try {
    const res = await fetch(`https://playerdb.co/api/player/minecraft/${uuid}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.data.player.username) {
        const username = data.data.player.username;
        App.uuidCache[uuid] = username;
        localStorage.setItem('opsucht_uuid_cache', JSON.stringify(App.uuidCache));
        return username;
      }
    }
  } catch (e) {
    console.warn(`playerdb.co lookup für ${uuid} fehlgeschlagen`, e);
  }

  // --- 2. Versuch: ashcon.app (als Fallback für Java-UUIDs) ---
  try {
    const res = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.username) {
        const username = data.username;
        App.uuidCache[uuid] = username;
        localStorage.setItem('opsucht_uuid_cache', JSON.stringify(App.uuidCache));
        return username;
      }
    }
  } catch (e) {
    console.warn(`ashcon.app lookup für ${uuid} fehlgeschlagen`, e);
  }

  // --- 3. Versuch: GeyserMC API (für Bedrock-UUIDs) ---
  if (uuid.startsWith('00000000-0000-0000-')) {
    try {
      const hexPart = uuid.substring(19).replace(/-/g, '');
      const xuid = BigInt('0x' + hexPart).toString();
      const gamertagRes = await fetch(`https://api.geysermc.org/v2/xbox/gamertag/${xuid}`);
      if (gamertagRes.ok) {
        const gamertagData = await gamertagRes.json();
        if (gamertagData.gamertag) {
          const username = `.${gamertagData.gamertag}`;
          App.uuidCache[uuid] = username;
          localStorage.setItem('opsucht_uuid_cache', JSON.stringify(App.uuidCache));
          return username;
        }
      }
    } catch (e) {
      console.warn(`GeyserMC lookup für ${uuid} fehlgeschlagen`, e);
    }
  }

  // --- Finaler Fallback ---
  App.uuidCache[uuid] = "Unbekannt";
  localStorage.setItem('opsucht_uuid_cache', JSON.stringify(App.uuidCache));
  return "Unbekannt";
}

async function loadMarket() {
  try {
    const [prices, items] = await Promise.all([
      fetch("https://api.opsucht.net/market/prices").then(res => res.json()),
      fetch("https://api.opsucht.net/market/items").then(res => res.json())
    ]);
    App.marketPrices = prices;
    App.marketItems = items;
    // Index erstellen für O(1) Zugriff
    App.marketItemsMap = {};
    items.forEach(item => {
      if (item.material) {
        App.marketItemsMap[item.material.toLowerCase()] = item;
      }
    });

    // Preis-Index für O(1) Zugriff erstellen (Turbo)
    App.marketPricesMap = {};
    for (const cat in prices) {
      for (const mat in prices[cat]) {
        const orders = prices[cat][mat];
        const sellOrder = orders.find(o => o.orderSide === "SELL");
        App.marketPricesMap[mat.toLowerCase()] = sellOrder ? sellOrder.price : 0.8;
      }
    }

    // Falls ein Filter aktiv ist, Trends neu laden (optional, falls Daten veraltet)
    if (App.marketTrendFilter !== 'none') {
      fetchMarketTrends(App.marketTrendFilter);
    }
  } catch (error) {
    console.error("Fehler beim Laden der Marktdaten:", error);
  }
  document.querySelector('#tab-market .loading-spinner')?.remove();
}

async function fetchMarketTrends(period) {
  const progressBar = document.getElementById('trendProgressBar');
  const progressPercent = document.getElementById('trendStatusPercent');
  const progressContainer = document.getElementById('trendProgressBarContainer');
  const statusLabel = document.getElementById('trendStatusLabel');

  if (period === 'none') {
    App.marketTrendFilter = 'none';
    App.marketTrends = {};
    if (progressContainer) progressContainer.style.display = 'none';
    renderMarket();
    return;
  }

  // Turbo-Mode: Prüfen ob wir Daten bereits im Cache haben
  App.marketTrendFilter = period;
  App.isMarketTrendsLoading = true;
  
  const daysMap = { '3d': 3, '7d': 7, '30d': 30 };
  const targetDays = daysMap[period] || 3;
  const materials = [];

  for (const cat in App.marketPrices) {
    for (const mat in App.marketPrices[cat]) {
      materials.push(mat);
    }
  }

  // Materialien identifizieren, die wir WIRKLICH laden müssen
  // Wir laden neu, wenn kein Cache da ist oder er älter als 6 Stunden ist
  const now = Date.now();
  const cacheExpiry = 6 * 60 * 60 * 1000; // 6 Stunden
  const toFetch = materials.filter(mat => {
    const cached = App.marketHistoryCache[mat];
    return !cached || (now - cached.timestamp > cacheExpiry);
  });

  // Falls alles im Cache ist -> Sofort berechnen und anzeigen
  if (toFetch.length === 0) {
    calculateTrendsFromCache(targetDays);
    App.isMarketTrendsLoading = false;
    if (progressContainer) progressContainer.style.display = 'none';
    renderMarket();
    return;
  }

  // Progress UI zeigen
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    statusLabel.textContent = `Turbo-Analyse (${period}): ${toFetch.length} Items werden aktualisiert...`;
  }

  renderMarket(); 

  const batchSize = 40; // Aggressives Fetching (Turbo)
  let processed = 0;

  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    await Promise.all(batch.map(async (mat) => {
      try {
        const response = await fetch(`https://api.opsucht.net/market/history/${encodeURIComponent(mat)}`);
        const data = await response.json();
        const history = data.DAILY || [];
        
        if (history.length > 0) {
          // Nur die relevanten Daten speichern (die letzten 31 Tage reichen für alle Filter)
          App.marketHistoryCache[mat] = {
            history: history.slice(-31), // Speicher sparen
            timestamp: now
          };
        }
      } catch (e) {
        console.error(`Trend-Fehler für ${mat}:`, e);
      } finally {
        processed++;
      }
    }));

    if (progressContainer) {
      const progress = Math.round((processed / toFetch.length) * 100);
      progressBar.style.width = `${progress}%`;
      progressPercent.textContent = `${progress}%`;
    }
  }

  // Finale Berechnung für alle Items
  calculateTrendsFromCache(targetDays);
  
  // Cache persistieren
  saveTrendsCache();

  App.isMarketTrendsLoading = false;
  if (progressContainer) {
    statusLabel.textContent = 'Turbo-Analyse abgeschlossen!';
    setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
  }
  renderMarket();
}

function calculateTrendsFromCache(targetDays) {
  for (const cat in App.marketPrices) {
    for (const mat in App.marketPrices[cat]) {
      const cached = App.marketHistoryCache[mat];
      if (!cached || !cached.history || cached.history.length === 0) continue;

      const currentPrice = parseFloat(getMarketSellPrice(mat));
      if (!currentPrice || isNaN(currentPrice)) continue;

      // Robustheit: Wenn der Preis der Fallback (0.8) ist, aber die Historie höher war, 
      // ist es wahrscheinlich ein Datenfehler -> Trend ignorieren.
      const history = cached.history;
      const lastHistoryEntry = history[history.length - 1];
      if (currentPrice === 0.8 && lastHistoryEntry && lastHistoryEntry.avgPrice > 1.0) continue;

      // Index finden für den Vergleichszeitraum
      const targetIndex = Math.max(0, history.length - targetDays);
      
      // Glättung (Smoothing): Durchschnitt um den Zielpunkt bilden (Moving Average)
      // Wir nehmen den Zielpunkt und den Tag davor für den "alten" Preis.
      const oldPrice1 = history[targetIndex]?.avgPrice || 0;
      const oldPrice2 = history[Math.max(0, targetIndex - 1)]?.avgPrice || oldPrice1;
      const smoothedOldPrice = (oldPrice1 + oldPrice2) / 2;

      // Aktueller geglätteter Preis: Durchschnitt aus Jetzt und Gestern (aus Historie)
      const smoothedCurrentPrice = (currentPrice + (lastHistoryEntry?.avgPrice || currentPrice)) / 2;

      if (smoothedOldPrice > 0) {
        const percentage = ((smoothedCurrentPrice - smoothedOldPrice) / smoothedOldPrice) * 100;
        
        // Minimale Relevanz-Schwelle (z.B. 0.1% Änderung ignorieren)
        if (Math.abs(percentage) < 0.1) {
          App.marketTrends[mat] = { percentage: 0, trend: 'neutral' };
        } else {
          App.marketTrends[mat] = {
            percentage: percentage,
            trend: percentage >= 0 ? 'up' : 'down'
          };
        }
      }
    }
  }
}

function saveTrendsCache() {
  try {
    localStorage.setItem('marketTrendsCache', JSON.stringify(App.marketHistoryCache));
  } catch (e) {
    console.error("Fehler beim Speichern des Caches:", e);
    // Falls localStorage voll ist, ggf. leeren
    if (e.name === 'QuotaExceededError') localStorage.removeItem('marketTrendsCache');
  }
}

function loadTrendsCache() {
  try {
    const saved = localStorage.getItem('marketTrendsCache');
    if (saved) App.marketHistoryCache = JSON.parse(saved);
  } catch (e) {
    console.error("Fehler beim Laden des Caches:", e);
  }
}

async function renderMarket(isPagination = false) {
  const container = document.getElementById("marketContainer");
  const searchInput = document.getElementById("searchMarket");
  const search = searchInput.value.toLowerCase();
  
  // Update Filter UI states
  document.querySelectorAll('#marketTrendMenu .filter-menu-item').forEach(el => {
    el.classList.toggle('active', el.dataset.period === App.marketTrendFilter);
  });
  const filterBtn = document.getElementById('marketTrendBtn');
  if (filterBtn) filterBtn.classList.toggle('active', App.marketTrendFilter !== 'none');

  // Pagination State Reset
  const currentStateStr = `${search}|${App.marketTrendFilter}`;
  if (App.marketLastState !== currentStateStr && !isPagination) {
    App.marketDisplayCount = 60;
    App.marketLastState = currentStateStr;
  }

  // Initial loading state if container is completely empty
  if (!isPagination && container.innerHTML === "") {
    container.innerHTML = `<div class="content-loader"><span class="loading-spinner"></span><span>Lade Markt...</span></div>`;
  }

  // Build content in a temporary fragment to prevent flicker (lag)
  const fragment = document.createDocumentFragment();
  let globalCounter = 0;
  let hasMore = false;

  // Alle Items flach sammeln für Filterung und Sortierung
  let flatItems = [];
  for (const category in App.marketPrices) {
    for (const material in App.marketPrices[category]) {
      if (material.toLowerCase().includes(search) || category.toLowerCase().includes(search)) {
        const item = App.marketItemsMap[material.toLowerCase()];
        if (item) {
          flatItems.push({ 
            material, 
            category, 
            item, 
            orders: App.marketPrices[category][material] 
          });
        }
      }
    }
  }

  // Trend-Sortierung falls aktiv
  if (App.marketTrendFilter !== 'none') {
    flatItems.sort((a, b) => {
      const trendA = App.marketTrends[a.material]?.percentage || -999999;
      const trendB = App.marketTrends[b.material]?.percentage || -999999;
      return trendB - trendA; // Absteigend (höchster Anstieg oben)
    });
  }

  // 1. Pinned Category (nur wenn kein Trend-Filter aktiv ist)
  const user = firebase.auth().currentUser;
  if (user && App.pinnedItems && App.pinnedItems.length > 0 && App.marketTrendFilter === 'none') {
    const pinnedMaterials = App.pinnedItems.filter(p => p.toLowerCase().includes(search));

    if (pinnedMaterials.length > 0) {
      const filteredPinned = [];
      for (const material of pinnedMaterials) {
        const item = App.marketItemsMap[material.toLowerCase()];
        if (!item) continue;
        let orders = null;
        for (const cat in App.marketPrices) {
          if (App.marketPrices[cat][material]) { orders = App.marketPrices[cat][material]; break; }
        }
        if (orders) filteredPinned.push({ material, item, orders });
      }

      if (filteredPinned.length > 0) {
        const h2 = document.createElement("h2");
        h2.className = "pinned-category-header";
        h2.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Gepinnt`;
        fragment.appendChild(h2);

        const grid = document.createElement("div");
        grid.className = "grid";
        fragment.appendChild(grid);

        for (const p of filteredPinned) {
          if (globalCounter >= App.marketDisplayCount) { hasMore = true; break; }
          grid.appendChild(createMarketCard(p.material, p.item, p.orders));
          globalCounter++;
        }
      }
    }
  }

  // 2. Normale Kategorien oder flache Liste bei Trend
  if (App.marketTrendFilter !== 'none') {
    const grid = document.createElement("div");
    grid.className = "grid";
    fragment.appendChild(grid);

    flatItems.forEach(entry => {
      if (globalCounter < App.marketDisplayCount) {
        grid.appendChild(createMarketCard(entry.material, entry.item, entry.orders));
        globalCounter++;
      } else {
        hasMore = true;
      }
    });
  } else {
    for (const category in App.marketPrices) {
      if (globalCounter >= App.marketDisplayCount) { hasMore = true; break; }
      
      const itemsInCategory = Object.keys(App.marketPrices[category]).filter(material => 
        material.toLowerCase().includes(search) || category.toLowerCase().includes(search));
      
      if (itemsInCategory.length === 0) continue;

      const h2 = document.createElement("h2");
      h2.textContent = category;
      fragment.appendChild(h2);

      const grid = document.createElement("div");
      grid.className = "grid";
      fragment.appendChild(grid);

      itemsInCategory.forEach(material => {
        if (globalCounter < App.marketDisplayCount) {
          const item = App.marketItemsMap[material.toLowerCase()];
          if (item) {
            grid.appendChild(createMarketCard(material, item, App.marketPrices[category][material]));
            globalCounter++;
          }
        } else {
          hasMore = true;
        }
      });
    }
  }

  // Calculate total items for accurate "X more" count
  const totalMatchingItems = flatItems.length;

  if (hasMore) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "auth-submit-btn";
    loadMoreBtn.style.width = "auto";
    loadMoreBtn.style.padding = "0.75rem 2rem";
    loadMoreBtn.innerHTML = `Mehr anzeigen (${totalMatchingItems - App.marketDisplayCount} weitere)`;
    loadMoreBtn.onclick = (e) => {
      e.stopPropagation();
      App.marketDisplayCount += 60;
      renderMarket(true);
    };
    const loadMoreContainer = document.createElement("div");
    loadMoreContainer.className = "load-more-container";
    loadMoreContainer.style.textAlign = "center";
    loadMoreContainer.style.width = "100%";
    loadMoreContainer.style.marginTop = "2rem";
    loadMoreContainer.appendChild(loadMoreBtn);
    fragment.appendChild(loadMoreContainer);
  }

  // Replace content in one go to eliminate flickering
  container.innerHTML = "";
  container.appendChild(fragment);

  animateCardsWave(document.getElementById('market'));
}

function createMarketCard(material, itemInfo, orders) {
  const card = document.createElement("div");
  card.className = "card";
  card.onclick = () => openChart(material, 'market');
  card.style.position = 'relative';

  // Trend Badge
  if (App.marketTrendFilter !== 'none') {
    const trend = App.marketTrends[material];
    if (trend) {
      let sign = trend.percentage > 0 ? '+' : '';
      let trendClass = 'trend-neutral';
      let arrow = '→';

      if (trend.percentage > 0.1) {
        trendClass = 'trend-up';
        arrow = '↑';
      } else if (trend.percentage < -0.1) {
        trendClass = 'trend-down';
        arrow = '↓';
        sign = ''; // Minus ist schon im Wert
      }

      card.innerHTML += `<div class="card-trend-badge ${trendClass}">${arrow} ${sign}${trend.percentage.toFixed(1)}%</div>`;
    } else if (App.isMarketTrendsLoading) {
      card.innerHTML += `<div class="card-trend-badge trend-loading"><span class="loading-spinner" style="width:10px; height:10px; border-width:2px;"></span></div>`;
    } else {
      // Fallback für Items ohne Historie oder bei Datenfehlern -> 0% anzeigen
      card.innerHTML += `<div class="card-trend-badge trend-neutral">→ 0.0%</div>`;
    }
  }

  const icon = itemInfo.icon;
  let buyPrice = "0,8";
  let sellPrice = "0,8";
  orders.forEach(o => {
    if (o.orderSide === "BUY") buyPrice = o.price.toLocaleString('de-DE');
    if (o.orderSide === "SELL") sellPrice = o.price.toLocaleString('de-DE');
  });

  const nameHtml = App.settings.market.name ? `<h3>${itemInfo.name}</h3>` : '';
  const buyHtml = App.settings.market.buy ? `<div class="price-info">Kaufen: <span class="buy">${buyPrice}</span></div>` : '';
  const sellHtml = App.settings.market.sell ? `<div class="price-info">Verkaufen: <span class="sell">${sellPrice}</span></div>` : '';

  card.innerHTML += `
    <img src="${icon}" alt="${itemInfo.name}">
    ${nameHtml}
    ${buyHtml}
    ${sellHtml}
  `;
  return card;
}

function toggleMarketFilterMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('marketTrendMenu');
  if (menu) menu.classList.toggle('show');
}

function selectMarketTrend(period) {
  fetchMarketTrends(period);
  const menu = document.getElementById('marketTrendMenu');
  if (menu) menu.classList.remove('show');
}

// Global click listener to close dropdown
document.addEventListener('click', (e) => {
  const menu = document.getElementById('marketTrendMenu');
  if (menu && !menu.contains(e.target) && !e.target.closest('#marketTrendBtn')) {
    menu.classList.remove('show');
  }
});

async function loadAuctions() {
  // Aktive Auktionen und Verlauf UNABHÄNGIG laden: Ist die Verlaufsdatei
  // kaputt (z.B. ungültiges JSON), sollen die aktiven Auktionen trotzdem
  // angezeigt werden.

  // 1) Aktive Auktionen
  try {
    const res = await fetch("https://api.opsucht.net/auctions/active");
    App.auctionsData = await res.json();
  } catch (error) {
    console.error("Fehler beim Laden der aktiven Auktionen:", error);
    App.auctionsData = [];
  }

  // 2) Auktions-Verlauf (Fehler hier darf die Auktionen nicht beeinflussen)
  try {
    const res = await fetch(`${HISTORY_REPO_BASE}/auction-history.json?t=${Date.now()}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const history = await res.json();
    App.auctionHistory = history || {};
  } catch (error) {
    console.error("Fehler beim Laden des Auktions-Verlaufs (Verlauf wird leer angezeigt, Auktionen bleiben sichtbar):", error);
    App.auctionHistory = {};
  }

  App.playerStatsCache = {}; // Cache leeren wenn neue Daten geladen werden
  setupAuctionFilters();
  setupHistoryFilters();

  document.querySelector('#tab-auctions .loading-spinner')?.remove();
  document.querySelector('#tab-history .loading-spinner')?.remove();
}

function getAuctionItemIcon(item) {
  const displayName = item.displayName ?? item.material;
  const material = item.material;
  let iconUrl = item.icon;

  if (!iconUrl || iconUrl.includes("NONE")) {
    // 1. Check customAuctionIcons (Config) FIRST
    let customIconEntry = customAuctionIcons[displayName];

    // Fallback: Case-Insensitive Lookup (e.g. "Diamond Card" -> "DIAMOND CARD")
    if (!customIconEntry) {
      customIconEntry = customAuctionIcons[displayName.toUpperCase()];
    }

    if (typeof customIconEntry === 'object' && customIconEntry !== null) {
      // Material Fallback for Object-Entry
      iconUrl = customIconEntry[material];
    } else {
      // Simple String Match
      iconUrl = customIconEntry;
    }

    // if found in config, return it immediately
    if (iconUrl) return iconUrl;

    // 2. Trading Card / Booster Check (Fallback for generic items)
    if (item.lore && Array.isArray(item.lore)) {
      const isCardOrBooster = item.lore.some(line =>
        line.includes("Dieses Boosterpack enthält") ||
        line.includes("Sammle diese Sammelkarte")
      );

      if (isCardOrBooster) {
        return "https://i.postimg.cc/v8gy5LQM/Booster.png";
      }
    }
  }
  return iconUrl || 'https://mcdf.wiki.gg/images/Barrier.png?ff8ff1';
}

function getAuctionCategoryKey(auction) {
  let key = auction?.category || auction?.item?.category || "Unkategorisiert";
  if (key.toUpperCase().startsWith("SUB_")) {
    key = key.substring(4);
  } else if (key.toUpperCase().startsWith("SUB ")) {
    key = key.substring(4);
  }
  return key;
}

function getAuctionCategoryLabel(categoryKey) {
  return categoryKey.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

async function setAuctionFilter(category) {
  App.auctionCategoryFilter = category;
  const sortSelect = document.getElementById('auctionSortSelect');
  const starSelect = document.getElementById('auctionStarSelect');

  if (category === 'Karten & Booster') {
    starSelect.style.display = 'block';
  } else {
    starSelect.style.display = 'none';
    App.auctionStarFilter = 'Alle';
    starSelect.value = 'Alle';
  }

  if (category === 'Spieler') {
    sortSelect.innerHTML = `<option value="MOST_AUCTIONS">Meiste Auktionen</option><option value="MOST_BIDS">Meiste Gebote</option>`;
    App.auctionSortMode = 'MOST_AUCTIONS';
  } else {
    sortSelect.innerHTML = `<option value="END">Bald endend</option><option value="NEW">Neueste</option><option value="PRICE_HIGH">Höchster Preis</option><option value="PRICE_LOW">Niedrigster Preis</option><option value="BIDS_HIGH">Meiste Gebote</option>`;
    if (['MOST_AUCTIONS', 'MOST_BIDS'].includes(App.auctionSortMode)) App.auctionSortMode = 'END';
  }
  sortSelect.value = App.auctionSortMode;
  renderAuctions();
}

function setStarFilter(star) {
  App.auctionStarFilter = star;
  renderAuctions();
}

function setupAuctionFilters() {
  const filterContainer = document.getElementById('auction-filters');
  filterContainer.innerHTML = '';
  const categories = ["Alle"];
  if (firebase.auth().currentUser) {
    categories.push("Erinnerungen");
  }
  categories.push("Spieler");
  const apiCategoryKeys = new Set(App.auctionsData.map(getAuctionCategoryKey));

  let hasSammelkarten = false;
  let hasToolsArmorMerged = false;
  const otherCategories = [];

  apiCategoryKeys.forEach(key => {
    const upperKey = key.toUpperCase().replace(/ /g, "_");
    if (upperKey === "UNKATEGORISIERT") return;

    // Detektiere Sammelkarten (BOOSTER_PACK_CARD oder SAMMELKARTE mit Sternen ODER BOOSTER_PACKS)
    if (((upperKey.startsWith("SAMMELKARTE") || upperKey.startsWith("BOOSTER_PACK_CARD")) && (upperKey.includes("STERN") || upperKey.includes("STARS"))) || upperKey === "BOOSTER_PACKS") {
      hasSammelkarten = true;
    } else if (upperKey === "TOOLS_ARMOR") {
      hasToolsArmorMerged = true;
    } else {
      otherCategories.push(key);
    }
  });

  if (hasSammelkarten) categories.push("Karten & Booster");
  if (hasToolsArmorMerged) {
    categories.push("Tools");
    categories.push("Armor");
  }

  const sortedApiCategories = otherCategories.sort((a, b) => getAuctionCategoryLabel(a).localeCompare(getAuctionCategoryLabel(b), 'de-DE'));
  categories.push(...sortedApiCategories);

  categories.forEach(catKey => {
    const label = (catKey === "Alle" || catKey === "Spieler" || catKey === "Karten & Booster" || catKey === "Tools" || catKey === "Armor") ? catKey : getAuctionCategoryLabel(catKey);
    const option = document.createElement('option');
    option.value = catKey;
    option.textContent = label;
    if (catKey === App.auctionCategoryFilter) option.selected = true;
    filterContainer.appendChild(option);
  });
}

function animateCardsWave(sectionElement, immediate = false) {
  let grids = sectionElement.classList.contains('grid') ? [sectionElement] : sectionElement.querySelectorAll('.grid');
  grids.forEach(grid => {
    const allCards = Array.from(grid.querySelectorAll('.card'));
    const newCards = allCards.filter(c => !c.classList.contains('animated'));
    if (newCards.length === 0) return;
    
    const numCols = window.getComputedStyle(grid).getPropertyValue('grid-template-columns').split(' ').length || 1;
    
    // Find the row index of the first new card to make delays relative
    const firstNewCardIndex = allCards.indexOf(newCards[0]);
    const firstNewCardRow = Math.floor(firstNewCardIndex / numCols);

    newCards.forEach((card) => {
      // Clear any previous state to ensure animation triggers
      card.style.animation = '';
      card.style.opacity = '';
      card.style.transform = '';

      if (immediate) {
        card.style.animation = 'none';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0) scale(1)';
        card.classList.add('animated');
      } else {
        const actualIndex = allCards.indexOf(card);
        const col = actualIndex % numCols;
        const row = Math.floor(actualIndex / numCols);
        const relativeRow = row - firstNewCardRow;
        
        // Delay: Column-offset (to continue the wave) + Row-offset (relative to start of new batch) 
        const delay = (col * 0.1) + (relativeRow * 0.05);
        card.style.animationDelay = `${delay}s`;
        card.classList.add('animated');
      }
    });
  });
}



function createPlayerCard(uuid, username) {
  const card = document.createElement("div");
  card.className = "card";
  const ownedAuctions = App.auctionsData.filter(a => a.seller === uuid).length;
  const bids = App.auctionsData.filter(a => a.bids && uuid in a.bids).length;
  const initial = (username.match(/[a-zA-Z]/) || ['?'])[0].toUpperCase();
  card.innerHTML = `<div class="player-initial-avatar">${initial}</div><h3 class="players-name">${username}</h3><div class="price-info players-auctions"><span>Auktionen:</span> ${ownedAuctions}</div><div class="price-info players-bids"><span>Gebote:</span> ${bids}</div>`;
  card.onclick = () => {
    App.selectedPlayerUuid = uuid;
    const searchInput = document.getElementById("searchAuctions");
    const activeSection = document.querySelector('.section.active')?.id || 'auctions';
    App.previousState = {
      type: 'player_list',
      section: activeSection,
      category: App.auctionCategoryFilter,
      search: searchInput ? searchInput.value : ''
    };
    if (searchInput) searchInput.value = ''; // Leert das Suchfeld (falls vorhanden)
    App.auctionItemFilter = '';
    renderAuctions();
  };
  return card;
}

function sortAuctionsByMode(a, b) {
  switch (App.auctionSortMode) {
    case 'NEW': return new Date(b.startTime) - new Date(a.startTime);
    case 'PRICE_HIGH': return (b.currentBid ?? b.startBid) - (a.currentBid ?? a.startBid);
    case 'PRICE_LOW': return (a.currentBid ?? a.startBid) - (b.currentBid ?? b.startBid);
    case 'BIDS_HIGH': return (b.bids ? Object.keys(b.bids).length : 0) - (a.bids ? Object.keys(a.bids).length : 0);
    default: return new Date(a.endTime) - new Date(b.endTime);
  }
}

async function renderAuctions(isPagination = false) {
  const container = document.getElementById("auctionContainer");
  const search = (App.auctionItemFilter || "").toLowerCase();

  const currentStateStr = `${search}-${App.auctionCategoryFilter}-${App.auctionStarFilter}-${App.auctionSortMode}`;
  if (App.auctionLastState !== currentStateStr && !isPagination) {
    App.auctionDisplayCount = 50;
    App.auctionLastState = currentStateStr;
  }

  if (!isPagination) {
    container.innerHTML = `<div class="content-loader"><span class="loading-spinner"></span><span>Lade ${App.auctionCategoryFilter === 'Spieler' ? 'Spieler' : 'Auktionen'}...</span></div>`;
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  if (App.selectedPlayerUuid) {
    await renderPlayerProfile(App.selectedPlayerUuid, 'auctionContainer', search, 'auctions');
    return;
  }

  document.body.classList.remove('player-profile-view');
  if (App.auctionCategoryFilter === 'Spieler') {
    // Sammle Spieler
    const activePlayerUuids = App.auctionsData.flatMap(a => [a.seller, ...Object.keys(a.bids || {})]);
    const historicalPlayerUuids = [];
    for (const itemName in App.auctionHistory) {
      const sales = App.auctionHistory[itemName];
      if (Array.isArray(sales)) {
        for (const sale of sales) {
          if (sale.seller) historicalPlayerUuids.push(sale.seller);
          if (sale.highestBidder) historicalPlayerUuids.push(sale.highestBidder);
        }
      }
    }
    const playerUuids = new Set([...activePlayerUuids, ...historicalPlayerUuids].filter(Boolean));
    Promise.all(Array.from(playerUuids).map(async (uuid) => ({ uuid, username: await uuidToUsername(uuid), ownedAuctions: App.auctionsData.filter(a => a.seller === uuid).length, bids: App.auctionsData.filter(a => a.bids && uuid in a.bids).length }))).then(players => {
      if (!isPagination) container.innerHTML = "";
      let grid = container.querySelector(".grid");
      if (!grid) {
        grid = document.createElement("div");
        grid.className = "grid";
        container.appendChild(grid);
      }

      const filteredPlayers = players.filter(p => p.username.toLowerCase().replace(/^\./, '').includes(search.replace(/^\./, '')));
      filteredPlayers.sort((a, b) => App.auctionSortMode === 'MOST_BIDS' ? b.bids - a.bids : b.ownedAuctions - a.ownedAuctions);

      const itemsToDisplay = filteredPlayers.slice(isPagination ? App.auctionDisplayCount - 50 : 0, App.auctionDisplayCount);
      itemsToDisplay.forEach(p => grid.appendChild(createPlayerCard(p.uuid, p.username)));

      // Load More logic for Players
      const oldLoadMore = container.querySelector('.load-more-container');
      if (oldLoadMore) oldLoadMore.remove();

      if (filteredPlayers.length > App.auctionDisplayCount) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.className = "auth-submit-btn";
        loadMoreBtn.style.width = "auto";
        loadMoreBtn.style.padding = "0.75rem 2rem";
        loadMoreBtn.innerHTML = `Mehr Spieler anzeigen (${filteredPlayers.length - App.auctionDisplayCount} weitere)`;
        loadMoreBtn.onclick = () => {
          App.auctionDisplayCount += 50;
          renderAuctions(true);
        };
        const loadMoreContainer = document.createElement("div");
        loadMoreContainer.className = "load-more-container";
        loadMoreContainer.style.textAlign = "center";
        loadMoreContainer.style.width = "100%";
        loadMoreContainer.appendChild(loadMoreBtn);
        container.appendChild(loadMoreContainer);
      }



      animateCardsWave(document.getElementById('auctions'));
    });
    return;
  }

  const filteredAuctions = App.auctionsData.filter(a => {
    const origCatKey = getAuctionCategoryKey(a);
    const catKey = origCatKey.toUpperCase().replace(/ /g, "_");
    const matchesSearch = (a.item.displayName?.toLowerCase().includes(search) || a.item.material?.toLowerCase().includes(search) || getAuctionCategoryLabel(origCatKey).toLowerCase().includes(search));
    if (!matchesSearch) return false;
    if (App.auctionCategoryFilter === 'Alle') return true;
    if (App.auctionCategoryFilter === 'Erinnerungen') {
      const id = a.id || (a.seller + "_" + (a.item.material || "") + "_" + a.endTime).replace(/[.#$[\]]/g, '-');
      return !!App.userReminders[id];
    }
    if (App.auctionCategoryFilter === 'Karten & Booster') {
      const isSammelkarteKey = ((catKey.startsWith("SAMMELKARTE") || catKey.startsWith("BOOSTER_PACK_CARD")) && (catKey.includes("STERN") || catKey.includes("STARS"))) || catKey === "BOOSTER_PACKS";
      if (!isSammelkarteKey) return false;
      if (App.auctionStarFilter !== 'Alle') {
        if (App.auctionStarFilter === 'Booster') return catKey === "BOOSTER_PACKS";
        if (App.auctionStarFilter === '4/5') return catKey.match(/_([4-5])_STERN/) || catKey.match(/_([4-5])_STARS/);
        const starMatch = catKey.match(/_([1-5])_STERN/) || catKey.match(/_([1-5])_STARS/);
        if (!starMatch || starMatch[1] !== App.auctionStarFilter) return false;
      }
      return true;
    }
    if (App.auctionCategoryFilter === 'Tools' || App.auctionCategoryFilter === 'Armor') {
      if (catKey !== 'TOOLS_ARMOR') return origCatKey === App.auctionCategoryFilter;
      const material = a.item.material?.toLowerCase() || "";
      const isTool = material.includes("pickaxe") || material.includes("axe") || material.includes("shovel") || material.includes("hoe") || material.includes("shears");
      const isArmor = material.includes("helmet") || material.includes("chestplate") || material.includes("leggings") || material.includes("boots");
      return App.auctionCategoryFilter === 'Tools' ? isTool : isArmor;
    }
    return origCatKey === App.auctionCategoryFilter;
  });

  filteredAuctions.sort(sortAuctionsByMode);

  if (!isPagination) container.innerHTML = "";
  let grid = container.querySelector(".grid");
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "grid";
    container.appendChild(grid);
  }

  const itemsToDisplay = filteredAuctions.slice(isPagination ? App.auctionDisplayCount - 50 : 0, App.auctionDisplayCount);
  itemsToDisplay.forEach(auction => grid.appendChild(createAuctionCard(auction)));

  const oldLoadMore = container.querySelector('.load-more-container');
  if (oldLoadMore) oldLoadMore.remove();

  if (filteredAuctions.length > App.auctionDisplayCount) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "auth-submit-btn";
    loadMoreBtn.style.width = "auto";
    loadMoreBtn.style.padding = "0.75rem 2rem";
    loadMoreBtn.innerHTML = `Mehr anzeigen (${filteredAuctions.length - App.auctionDisplayCount} weitere)`;
    loadMoreBtn.onclick = () => {
      App.auctionDisplayCount += 50;
      renderAuctions(true);
    };
    const loadMoreContainer = document.createElement("div");
    loadMoreContainer.className = "load-more-container";
    loadMoreContainer.style.textAlign = "center";
    loadMoreContainer.style.width = "100%";
    loadMoreContainer.appendChild(loadMoreBtn);
    container.appendChild(loadMoreContainer);
  }



  animateCardsWave(document.getElementById('auctions'));
  renderFilterChip('auctionContainer', App.auctionItemFilter, () => {
    App.auctionItemFilter = '';
    renderAuctions();
  });
}


// =====================================================================
// SCHNÄPPCHEN-TAB: Auktionen, die aktuell unter dem 30-Tage-Durchschnitt liegen
// =====================================================================

function setDealsSort(mode) {
  App.dealsSortMode = mode;
  renderDeals();
}

function setDealsMinDiscount(pct) {
  App.dealsMinDiscount = parseFloat(pct) || 5;
  renderDeals();
}

// 30-Tage-Durchschnittspreis PRO STÜCK für eine Auktion aus dem Verlauf.
// Gleiche Item-Unterscheidung wie im Chart (material + lore).
// Verkaufspreis pro Stück für einen Verlaufseintrag.
// finalPrice = echter Endpreis (bei Sofortkauf der Sofortkaufpreis),
// currentBid/startBid als Fallback für ältere Einträge ohne finalPrice.
function salePricePerUnit(sale) {
  const price = sale.finalPrice ?? sale.currentBid ?? sale.startBid ?? 0;
  return price / (sale.item?.amount || 1);
}

function getMonthlyAveragePerUnit(auction) {
  const itemName = auction.item.displayName ?? auction.item.material;
  const fullHistory = App.auctionHistory[itemName] || [];
  const monthCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const relevant = fullHistory.filter(sale => {
    if (!sale.item) return false;
    if (sale.item.material !== auction.item.material) return false;
    if (auction.item.lore && sale.item.lore) {
      const cur = Array.isArray(auction.item.lore) ? auction.item.lore.join('\n') : auction.item.lore;
      const tgt = Array.isArray(sale.item.lore) ? sale.item.lore.join('\n') : sale.item.lore;
      if (cur !== tgt) return false;
    } else if (auction.item.lore || sale.item.lore) {
      return false;
    }
    const t = new Date(sale.soldAt || sale.endTime).getTime();
    return !isNaN(t) && t >= monthCutoff;
  });

  if (relevant.length === 0) return null;
  // Verkaufspreis: finalPrice ist der echte Endpreis (bei Sofortkauf der
  // Sofortkaufpreis), currentBid als Fallback für ältere Einträge.
  const sum = relevant.reduce((acc, sale) => acc + salePricePerUnit(sale), 0);
  return sum / relevant.length;
}

// Rabatt in Prozent gegenüber dem 30-Tage-Durchschnitt (pro Stück).
// Positiv = günstiger als der Durchschnitt. null = kein Durchschnitt vorhanden.
function getAuctionDiscount(auction) {
  const avg = getMonthlyAveragePerUnit(auction);
  if (!avg || avg <= 0) return null;
  const pricePerUnit = (auction.currentBid ?? auction.startBid) / (auction.item?.amount || 1);
  return ((avg - pricePerUnit) / avg) * 100;
}

function sortDealsByMode(a, b) {
  switch (App.dealsSortMode) {
    case 'DISCOUNT_HIGH': return (b._discount ?? -Infinity) - (a._discount ?? -Infinity);
    case 'NEW': return new Date(b.startTime) - new Date(a.startTime);
    case 'PRICE_HIGH': return (b.currentBid ?? b.startBid) - (a.currentBid ?? a.startBid);
    case 'PRICE_LOW': return (a.currentBid ?? a.startBid) - (b.currentBid ?? b.startBid);
    case 'BIDS_HIGH': return (b.bids ? Object.keys(b.bids).length : 0) - (a.bids ? Object.keys(a.bids).length : 0);
    default: return new Date(a.endTime) - new Date(b.endTime); // END
  }
}

function renderDeals(isPagination = false) {
  const container = document.getElementById("dealsContainer");
  if (!container) return;
  const search = "";

  const stateStr = `${search}-${App.dealsMinDiscount}-${App.dealsSortMode}`;
  if (App.dealsLastState !== stateStr && !isPagination) {
    App.dealsDisplayCount = 50;
    App.dealsLastState = stateStr;
  }

  // Nur nicht-abgelaufene Auktionen, die mind. X% unter dem 30-Tage-Schnitt liegen
  const now = Date.now();
  const deals = [];
  for (const a of App.auctionsData) {
    if (new Date(a.endTime).getTime() <= now) continue; // schon vorbei
    const discount = getAuctionDiscount(a);
    if (discount === null) continue;              // kein Verlaufswert -> kein Vergleich möglich
    if (discount < App.dealsMinDiscount) continue; // nicht günstig genug

    // Suche
    const matchesSearch =
      a.item.displayName?.toLowerCase().includes(search) ||
      a.item.material?.toLowerCase().includes(search) ||
      getAuctionCategoryLabel(getAuctionCategoryKey(a)).toLowerCase().includes(search);
    if (!matchesSearch) continue;

    a._discount = discount; // für Sortierung + Anzeige zwischenspeichern
    deals.push(a);
  }

  deals.sort(sortDealsByMode);

  if (!isPagination) container.innerHTML = "";

  if (deals.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding: 2rem;">Aktuell keine Schnäppchen gefunden. Der Verlauf muss dafür genug Daten der letzten 30 Tage enthalten.</p>';
    return;
  }

  let grid = container.querySelector(".grid");
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "grid";
    container.appendChild(grid);
  }

  const itemsToDisplay = deals.slice(isPagination ? App.dealsDisplayCount - 50 : 0, App.dealsDisplayCount);
  itemsToDisplay.forEach(auction => {
    const card = createAuctionCard(auction); // Rabatt-Badge wird darin gesetzt
    grid.appendChild(card);
  });

  const oldLoadMore = container.querySelector('.load-more-container');
  if (oldLoadMore) oldLoadMore.remove();

  if (deals.length > App.dealsDisplayCount) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "auth-submit-btn";
    loadMoreBtn.style.width = "auto";
    loadMoreBtn.style.padding = "0.75rem 2rem";
    loadMoreBtn.innerHTML = `Mehr anzeigen (${deals.length - App.dealsDisplayCount} weitere)`;
    loadMoreBtn.onclick = () => {
      App.dealsDisplayCount += 50;
      renderDeals(true);
    };
    const loadMoreContainer = document.createElement("div");
    loadMoreContainer.className = "load-more-container";
    loadMoreContainer.style.textAlign = "center";
    loadMoreContainer.style.width = "100%";
    loadMoreContainer.appendChild(loadMoreBtn);
    container.appendChild(loadMoreContainer);
  }

  animateCardsWave(document.getElementById('deals'));
}

async function renderPlayerProfile(playerUuid, containerId, search, sectionId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  document.body.classList.add('player-profile-view');

  // Im Profil-Modus brauchen wir die Standard-Sortierung vom Auktionshaus, 
  // falls wir im Haupt-Tab sind (Verlauf hat keine eigene Sortierung die wir hier überschreiben müssen)
  if (sectionId === 'auctions') {
    const sortSelect = document.getElementById('auctionSortSelect');
    if (sortSelect && !sortSelect.querySelector('option[value="END"]')) {
      sortSelect.innerHTML = `<option value="END">Bald endend</option><option value="NEW">Neueste</option><option value="PRICE_HIGH">Höchster Preis</option><option value="PRICE_LOW">Niedrigster Preis</option>`;
      App.auctionSortMode = 'END';
      sortSelect.value = 'END';
    }
  }

  const backButton = document.createElement('button');
  backButton.textContent = 'Zurück';
  backButton.className = 'back-btn';
  backButton.style.marginBottom = '1.5rem';
  backButton.onclick = () => {
    const state = App.previousState;
    document.body.classList.remove('player-profile-view');
    App.selectedPlayerUuid = null;

    if (state?.type === 'auction_modal') {
      const prevAuction = state.auction;
      const prevOrigin = state.origin;
      App.previousState = prevOrigin || null;
      if (prevOrigin?.section) showSection(prevOrigin.section);
      if (prevOrigin?.section === 'history') {
        renderHistory();
      } else {
        renderAuctions();
      }
      setTimeout(() => openAuctionChart(prevAuction), 10);
    } else {
      App.previousState = null;
      if (state?.section) showSection(state.section);
      const isHistory = (state?.section === 'history');
      const searchInput = document.getElementById(isHistory ? "searchHistory" : "searchAuctions");
      if (searchInput) searchInput.value = state?.search || '';
      if (isHistory) {
        setHistoryFilter(state?.category || 'Alle');
      } else {
        setAuctionFilter(state?.category || 'Alle');
      }
    }
  };
  container.appendChild(backButton);

  const username = await uuidToUsername(playerUuid);
  const title = document.createElement('h2');
  title.textContent = username;
  title.style.textAlign = 'center';
  title.style.fontSize = '2rem';
  title.style.fontWeight = '900';
  title.style.marginBottom = '1.5rem';
  container.appendChild(title);

  let totalEarned = 0, totalSpent = 0, auctionsSold = 0, auctionsWon = 0;
  if (App.playerStatsCache[playerUuid]) {
    const s = App.playerStatsCache[playerUuid];
    totalEarned = s.earned; totalSpent = s.spent; auctionsSold = s.sold; auctionsWon = s.won;
  } else {
    for (const itemName in App.auctionHistory) {
      const sales = App.auctionHistory[itemName];
      if (Array.isArray(sales)) {
        sales.forEach(sale => {
          if (sale.seller === playerUuid) { totalEarned += sale.currentBid || 0; auctionsSold++; }
          if (sale.highestBidder === playerUuid) { totalSpent += sale.currentBid || 0; auctionsWon++; }
        });
      }
    }
    App.playerStatsCache[playerUuid] = { earned: totalEarned, spent: totalSpent, sold: auctionsSold, won: auctionsWon };
  }

  const statsBox = document.createElement('div');
  statsBox.className = 'auction-info-box';
  statsBox.style.marginBottom = '1.5rem';
  statsBox.innerHTML = `
    <div class="info-item"><strong>Erfolgreich verkauft</strong><span>${auctionsSold}</span></div>
    <div class="info-item"><strong>Auktionen gewonnen</strong><span>${auctionsWon}</span></div>
    <div class="info-item"><strong>Gesamt eingenommen</strong><span class="sell">${totalEarned.toLocaleString('de-DE')}</span></div>
    <div class="info-item"><strong>Gesamt ausgegeben</strong><span class="buy">${totalSpent.toLocaleString('de-DE')}</span></div>
    <div class="info-item"><strong>UUID</strong><span style="font-size: 0.8rem; word-break: break-all;">${playerUuid}</span></div>
  `;
  container.appendChild(statsBox);

  const activeAuctions = App.auctionsData.filter(a => (a.seller === playerUuid || (a.bids && playerUuid in a.bids)) && (a.item.displayName?.toLowerCase().includes(search) || a.item.material?.toLowerCase().includes(search)));
  const owned = activeAuctions.filter(a => a.seller === playerUuid);
  const bidded = activeAuctions.filter(a => a.bids && playerUuid in a.bids);

  const historicalSold = [], historicalBought = [];
  for (const itemName in App.auctionHistory) {
    (App.auctionHistory[itemName] || []).forEach(sale => {
      const matchesSearch = (sale.item?.displayName?.toLowerCase().includes(search) || sale.item?.material?.toLowerCase().includes(search) || itemName.toLowerCase().includes(search));
      if (!matchesSearch) return;
      if (sale.seller === playerUuid) historicalSold.push(sale);
      else if (sale.highestBidder === playerUuid) historicalBought.push(sale);
    });
  }

  if (owned.length > 0) {
    const h2 = document.createElement("h2"); h2.textContent = "Eigene Auktionen"; container.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid";
    owned.sort(sortAuctionsByMode).forEach(a => grid.appendChild(createAuctionCard(a)));
    container.appendChild(grid);
  }
  if (bidded.length > 0) {
    const h2 = document.createElement("h2"); h2.textContent = "Gebote auf"; container.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid";
    bidded.sort(sortAuctionsByMode).forEach(a => {
      const card = createAuctionCard(a);
      card.appendChild(Object.assign(document.createElement('div'), { className: 'price-info auction-bid-amount', innerHTML: `<span style="color: var(--accent-color1);">Gebot:</span> ${a.bids[playerUuid]}` }));
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }
  if (historicalSold.length > 0) {
    const h2 = document.createElement("h2"); h2.textContent = "Verkaufte Items (Historie)"; container.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid";
    historicalSold.sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).forEach(a => grid.appendChild(createAuctionCard(a, 'sold')));
    container.appendChild(grid);
  }
  if (historicalBought.length > 0) {
    const h2 = document.createElement("h2"); h2.textContent = "Gekaufte Items (Historie)"; container.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid";
    historicalBought.sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).forEach(a => grid.appendChild(createAuctionCard(a, 'bought')));
    container.appendChild(grid);
  }

  animateCardsWave(document.getElementById(sectionId));
}

async function setHistoryFilter(category) {
  App.historyCategoryFilter = category;
  const starSelect = document.getElementById('historyStarSelect');
  if (category === 'Karten & Booster') {
    starSelect.style.display = 'block';
  } else {
    starSelect.style.display = 'none';
    App.historyStarFilter = 'Alle';
    starSelect.value = 'Alle';
  }
  renderHistory();
}

function setHistorySort(mode) {
  App.historySortMode = mode;
  renderHistory();
}

function setHistoryStarFilter(star) {
  App.historyStarFilter = star;
  renderHistory();
}

function setupHistoryFilters() {
  const filterContainer = document.getElementById('history-filters');
  if (!filterContainer) return;

  filterContainer.innerHTML = '';

  const categories = ["Alle"];

  // Use both history and active auctions to ensure consistent category buttons
  const allHistoryFlat = Object.values(App.auctionHistory).flat();
  const allActiveAuctions = App.auctionsData || [];
  const combinedItems = [...allHistoryFlat, ...allActiveAuctions];

  const apiCategoryKeys = new Set(combinedItems.map(getAuctionCategoryKey));

  let hasSammelkarten = false;
  let hasToolsArmorMerged = false;
  const otherCategories = [];

  apiCategoryKeys.forEach(key => {
    const upperKey = key.toUpperCase().replace(/ /g, "_");
    if (upperKey === "UNKATEGORISIERT") return;

    if (((upperKey.startsWith("SAMMELKARTE") || upperKey.startsWith("BOOSTER_PACK_CARD")) && (upperKey.includes("STERN") || upperKey.includes("STARS"))) || upperKey === "BOOSTER_PACKS") {
      hasSammelkarten = true;
    } else if (upperKey === "TOOLS_ARMOR" || upperKey === "TOOLS" || upperKey === "ARMOR") {
      hasToolsArmorMerged = true;
    } else {
      otherCategories.push(key);
    }
  });

  if (hasSammelkarten) categories.push("Karten & Booster");
  if (hasToolsArmorMerged) {
    categories.push("Tools");
    categories.push("Armor");
  }

  const sortedApiCategories = otherCategories.sort((a, b) => getAuctionCategoryLabel(a).localeCompare(getAuctionCategoryLabel(b), 'de-DE'));
  categories.push(...sortedApiCategories);

  categories.forEach(catKey => {
    const label = (catKey === "Alle" || catKey === "Karten & Booster" || catKey === "Tools" || catKey === "Armor") ? catKey : getAuctionCategoryLabel(catKey);
    const option = document.createElement('option');
    option.value = catKey;
    option.textContent = label;
    if (catKey === App.historyCategoryFilter) option.selected = true;
    filterContainer.appendChild(option);
  });
}

async function renderHistory(isPagination = false) {
  const container = document.getElementById("historyContainer");
  if (!container) return;

  const search = (App.historyItemFilter || "").toLowerCase();

  if (!isPagination) {
    container.innerHTML = `<div class="content-loader"><span class="loading-spinner"></span><span>Lade Verlauf...</span></div>`;
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  if (App.selectedPlayerUuid) {
    await renderPlayerProfile(App.selectedPlayerUuid, 'historyContainer', search, 'history');
    return;
  }

  if (!isPagination) {
    document.body.classList.remove('player-profile-view');
  }

  // Historie flachklopfen
  let allHistory = [];
  for (const itemName in App.auctionHistory) {
    const sales = App.auctionHistory[itemName];
    if (Array.isArray(sales)) {
      sales.forEach(sale => {
        if (!sale.item) sale.item = { material: itemName };
        allHistory.push(sale);
      });
    }
  }

  const filtered = allHistory.filter(a => {
    const origCatKey = getAuctionCategoryKey(a);
    const catKey = origCatKey.toUpperCase().replace(/ /g, "_");
    const itemName = a.item?.displayName || a.item?.material || "";
    const matchesSearch = itemName.toLowerCase().includes(search) || getAuctionCategoryLabel(origCatKey).toLowerCase().includes(search);
    if (!matchesSearch) return false;

    if (App.historyCategoryFilter === 'Alle') return true;

    if (App.historyCategoryFilter === 'Karten & Booster') {
      const isSammelkarteKey = ((catKey.startsWith("SAMMELKARTE") || catKey.startsWith("BOOSTER_PACK_CARD")) && (catKey.includes("STERN") || catKey.includes("STARS"))) || catKey === "BOOSTER_PACKS";
      if (!isSammelkarteKey) return false;

      if (App.historyStarFilter !== 'Alle') {
        if (App.historyStarFilter === 'Booster') return catKey === "BOOSTER_PACKS";
        if (App.historyStarFilter === '4/5') {
          return catKey.match(/_([4-5])_STERN/) || catKey.match(/_([4-5])_STARS/);
        }
        const starMatch = catKey.match(/_([1-5])_STERN/) || catKey.match(/_([1-5])_STARS/);
        if (!starMatch || starMatch[1] !== App.historyStarFilter) return false;
      }
      return true;
    }

    if (App.historyCategoryFilter === 'Tools' || App.historyCategoryFilter === 'Armor') {
      if (catKey !== 'TOOLS_ARMOR') return origCatKey === App.historyCategoryFilter;
      const material = a.item.material?.toLowerCase() || "";
      const isTool = material.includes("pickaxe") || material.includes("axe") || material.includes("shovel") || material.includes("hoe") || material.includes("shears");
      const isArmor = material.includes("helmet") || material.includes("chestplate") || material.includes("leggings") || material.includes("boots");
      return App.historyCategoryFilter === 'Tools' ? isTool : isArmor;
    }

    return origCatKey === App.historyCategoryFilter;
  });

  // Sortierung
  filtered.sort((a, b) => {
    if (App.historySortMode === 'PRICE_HIGH') return (b.currentBid ?? b.startBid) - (a.currentBid ?? a.startBid);
    if (App.historySortMode === 'PRICE_LOW') return (a.currentBid ?? a.startBid) - (b.currentBid ?? b.startBid);
    return new Date(b.endTime) - new Date(a.endTime); // NEW: Standardmäßig neueste zuerst
  });

  // State Management für Pagination
  const currentStateStr = `${search}-${App.historyCategoryFilter}-${App.historyStarFilter}-${App.historySortMode}`;
  if (App.historyLastState !== currentStateStr) {
    App.historyDisplayCount = 100;
    App.historyLastState = currentStateStr;
    isPagination = false; // Zurücksetzen falls durch anderen Aufruf getriggert
  }

  if (!isPagination) {
    container.innerHTML = "";
    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Keine historischen Daten gefunden.</div>`;
      return;
    }
  }

  const itemsToDisplay = filtered.slice(isPagination ? App.historyDisplayCount - 100 : 0, App.historyDisplayCount);

  let grid = container.querySelector(".grid");
  if (!grid) {
    grid = document.createElement("div");
    grid.className = "grid";
    container.appendChild(grid);
  }

  itemsToDisplay.forEach(auction => grid.appendChild(createAuctionCard(auction, 'sold')));

  // alten "Mehr laden" Button entfernen
  const oldLoadMore = container.querySelector('.load-more-container');
  if (oldLoadMore) oldLoadMore.remove();

  if (filtered.length > App.historyDisplayCount) {
    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "auth-submit-btn";
    loadMoreBtn.style.marginTop = "2rem";
    loadMoreBtn.style.width = "auto";
    loadMoreBtn.style.padding = "0.75rem 2rem";
    loadMoreBtn.innerHTML = `Mehr anzeigen (${filtered.length - App.historyDisplayCount} weitere)`;
    loadMoreBtn.onclick = () => {
      App.historyDisplayCount += 100;
      renderHistory(true);
    };

    const loadMoreContainer = document.createElement("div");
    loadMoreContainer.className = "load-more-container";
    loadMoreContainer.style.textAlign = "center";
    loadMoreContainer.style.width = "100%";
    loadMoreContainer.appendChild(loadMoreBtn);
    container.appendChild(loadMoreContainer);
  }

  animateCardsWave(document.getElementById('history'));
  renderFilterChip('historyContainer', App.historyItemFilter, () => {
    App.historyItemFilter = '';
    renderHistory();
  });
}

function calculateAuctionPriceTrend(auction) {
  // Mindestanzahl an Verkäufen der letzten 30 Tage, damit ein Trend sinnvoll ist
  const MIN_SALES = 5;
  // Anzeige-Deckelung, damit einzelne Ausreißer keine absurden Prozente ergeben
  const CAP = 500;

  const itemName = auction.item?.displayName ?? auction.item?.material;
  const fullHistory = App.auctionHistory[itemName] || [];
  const monthCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Gleiche Item-Unterscheidung (material + lore) wie beim 30-Tage-Durchschnitt
  const relevant = fullHistory.filter(sale => {
    if (!sale.item) return false;
    if (sale.item.material !== auction.item.material) return false;
    if (auction.item.lore && sale.item.lore) {
      const cur = Array.isArray(auction.item.lore) ? auction.item.lore.join('\n') : auction.item.lore;
      const tgt = Array.isArray(sale.item.lore) ? sale.item.lore.join('\n') : sale.item.lore;
      if (cur !== tgt) return false;
    } else if (auction.item.lore || sale.item.lore) {
      return false;
    }
    const t = new Date(sale.soldAt || sale.endTime).getTime();
    return !isNaN(t) && t >= monthCutoff;
  });

  // Zu wenig Daten -> keinen Trend anzeigen
  if (relevant.length < MIN_SALES) return null;

  // 30-Tage-Durchschnitt (pro Stück)
  const avg = relevant.reduce((acc, sale) => acc + salePricePerUnit(sale), 0) / relevant.length;
  if (avg <= 0) return null;

  // Aktueller Preis pro Stück der laufenden Auktion
  const currentPrice = (auction.currentBid ?? auction.startBid ?? 0) / (auction.item?.amount || 1);
  if (currentPrice <= 0) return null;

  let percentage = ((currentPrice - avg) / avg) * 100;
  // Deckeln
  let capped = false;
  if (percentage > CAP) { percentage = CAP; capped = true; }
  else if (percentage < -CAP) { percentage = -CAP; capped = true; }

  return {
    percentage,
    capped,
    trend: percentage > 0.1 ? 'up' : (percentage < -0.1 ? 'down' : 'neutral')
  };
}

function formatCardPrice(price) {
  if (price >= 1000000) return `${Math.round(price / 1000000)}M`;
  return Math.floor(price).toLocaleString('de-DE');
}

function createAuctionCard(auction, historyType = null, personalData = null) {
  const displayName = auction.item.displayName ?? auction.item.material;
  const iconUrl = getAuctionItemIcon(auction.item);
  const bidCount = auction.bids ? Object.keys(auction.bids).length : 0;
  const card = document.createElement("div");
  card.className = "card";
  const auctionId = auction.id || (auction.seller + "_" + (auction.item.material || "") + "_" + auction.endTime);
  card.dataset.auctionId = auctionId;
  if (historyType) card.classList.add('historical');

  let badgeHtml = '';
  if (!historyType && personalData && personalData.outbidBy) {
    badgeHtml = `<div class="auction-badge outbid" title="Überboten von ${personalData.outbidBy}">Überboten</div>`;
  }

  let personalBidHtml = '';
  if (personalData && personalData.myBid) {
    personalBidHtml = `<div class="price-info auction-bid-amount"><span style="color: var(--accent-color1);">Gebot:</span> ${formatCardPrice(personalData.myBid)}</div>`;
  }

  // Trend-Badge entfernt: misst dasselbe wie das Rabatt-Badge (Preis vs.
  // 30-Tage-Durchschnitt) und wäre daher doppelt.
  let trendHtml = '';

  // Preis-Badge: vergleicht den aktuellen Preis mit dem 30-Tage-Durchschnitt.
  // Grün (-X%) = günstiger als üblich, Rot (+X%) = teurer als üblich.
  // Nur für aktive Auktionen; nahe am Durchschnitt (< 5% Abweichung) kein Badge.
  let discountHtml = '';
  if (!historyType) {
    const discount = getAuctionDiscount(auction); // positiv = günstiger, negativ = teurer
    if (discount !== null) {
      if (discount >= 5) {
        discountHtml = `<div class="deal-badge deal-cheaper" title="Günstiger als der 30-Tage-Durchschnitt">-${Math.round(discount)}%</div>`;
      } else if (discount <= -5) {
        discountHtml = `<div class="deal-badge deal-pricier" title="Teurer als der 30-Tage-Durchschnitt">+${Math.round(-discount)}%</div>`;
      }
    }
  }

  // 30-Tage-Durchschnitt (pro Stück) für aktive Auktionen
  let monthAvgHtml = '';
  if (!historyType) {
    const monthAvg = getMonthlyAveragePerUnit(auction);
    if (monthAvg !== null) {
      monthAvgHtml = `<div class="price-info auction-monthAvg"><span style="color: var(--text-secondary)">Ø 30 Tage:</span> ${formatCardPrice(Math.round(monthAvg))}</div>`;
    }
  }

  card.innerHTML = `
    ${badgeHtml}
    ${trendHtml}
    ${discountHtml}
    <img src="${iconUrl}" alt="${displayName}" loading="lazy" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
    <h3 class="auction-name">${displayName}</h3>
    <div class="price-info auction-startBid"><span class="buy">Start:</span> ${formatCardPrice(auction.startBid)}</div>
    <div class="price-info auction-currentBid"><span class="sell">${historyType ? 'Verkauft für:' : 'Aktuell:'}</span> ${formatCardPrice(auction.currentBid ?? auction.startBid)}</div>
    ${auction.instantBuyPrice ? `<div class="price-info auction-instantBuy"><span style="color: var(--accent-color1);">Sofortkauf:</span> ${formatCardPrice(auction.instantBuyPrice)}</div>` : ''}
    ${monthAvgHtml}
    ${personalBidHtml}
    <div class="price-info auction-bids"><span style="color: var(--text-secondary)">Gebote:</span> ${bidCount}</div>
    <div class="price-info auction-amount"><span style="color: var(--text-secondary)">Menge:</span> ${auction.item.amount}</div>
    ${historyType ? '' : `<div class="price-info auction-timer" data-end-time="${auction.endTime}">Lädt...</div>`}
  `;
  card.onclick = () => {
    showPageLoader();
    setTimeout(() => {
      openAuctionChart(auction);
    }, 10);
  };
  return card;
}

async function loadShards() {
  try {
    const ratesPromise = fetch("https://api.opsucht.net/merchant/rates").then(res => res.json());
    const rates = await ratesPromise;
    // Pre-parse Shard-Informationen für schnellere Filterung/Anzeige
    App.shardRates = (rates || []).map(rate => ({
      ...rate,
      parsed: parseShardItem(rate.source)
    }));
  } catch (error) {
    console.error("Fehler beim Laden der Shard-Daten:", error);
    App.shardRates = [];
  }
  document.querySelector('#tab-shards .loading-spinner')?.remove();
}

// Aktualisiert die Daten des jeweiligen Tabs neu, ohne die Seite neu zu laden.
async function refreshTab(tabId, btn) {
  // Button in Lade-Zustand versetzen
  let originalText;
  if (btn) {
    originalText = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('refreshing');
    btn.innerHTML = '⟳ Lädt…';
  }

  try {
    switch (tabId) {
      case 'market':
        await loadMarket();
        renderMarket();
        break;
      case 'auctions':
        await loadAuctions();
        renderAuctions();
        break;
      case 'deals':
        await loadAuctions(); // Schnäppchen basieren auf denselben Auktions-/Verlaufsdaten
        renderDeals();
        break;
      case 'history':
        await loadAuctions(); // Verlauf kommt aus denselben Daten
        renderHistory();
        break;
      case 'shards':
        await loadShards();
        renderShards();
        break;
      case 'items':
        await loadAuctions(); // Item-Liste basiert auf Verlauf + aktiven Auktionen
        renderItemSearch();
        break;
    }
  } catch (e) {
    console.error('Fehler beim Aktualisieren:', e);
  }

  if (btn) {
    btn.disabled = false;
    btn.classList.remove('refreshing');
    btn.innerHTML = originalText;
    // kurze visuelle Bestätigung
    btn.classList.add('refresh-done');
    setTimeout(() => btn.classList.remove('refresh-done'), 1000);
  }
}

// =====================================================================
// ITEMS-TAB: Datenbank aller je gesehenen Items (aus Verlauf + aktiven Auktionen)
// Jedes Item genau EINMAL, durchsuchbar. Klick -> Durchschnitt + Kurve + Aktionen.
// =====================================================================

// Baut eine Map aller eindeutigen Items: Schlüssel = Item-Name.
// Wert = ein repräsentatives Item-Objekt + Zähler für aktive/verkaufte Vorkommen.
function buildItemIndex() {
  const index = {};

  const add = (itemObj, source) => {
    if (!itemObj) return;
    const name = itemObj.displayName ?? itemObj.material;
    if (!name) return;
    if (!index[name]) {
      index[name] = { name, item: itemObj, activeCount: 0, soldCount: 0 };
    }
    if (source === 'active') index[name].activeCount++;
    if (source === 'history') index[name].soldCount++;
    // Ein Item mit Icon/Lore bevorzugt als repräsentatives Objekt behalten
    if (!index[name].item.icon && itemObj.icon) index[name].item = itemObj;
  };

  // Aus aktiven Auktionen
  (App.auctionsData || []).forEach(a => add(a.item, 'active'));

  // Aus dem Verlauf
  for (const itemName in App.auctionHistory) {
    const sales = App.auctionHistory[itemName];
    if (Array.isArray(sales)) {
      sales.forEach(sale => add(sale.item || { material: itemName, displayName: itemName }, 'history'));
    }
  }

  return index;
}

function renderItemSearch() {
  const container = document.getElementById('itemsContainer');
  if (!container) return;
  const search = (document.getElementById('searchItems')?.value || '').toLowerCase();

  const index = buildItemIndex();
  let items = Object.values(index);

  // Suche nach Name oder Material
  if (search) {
    items = items.filter(entry => {
      const name = (entry.name || '').toLowerCase();
      const mat = (entry.item?.material || '').toLowerCase();
      return name.includes(search) || mat.includes(search);
    });
  }

  // Alphabetisch sortieren
  items.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding:2rem;">Keine Items gefunden. Die Liste füllt sich aus aktiven Auktionen und dem Verlauf.</p>';
    return;
  }

  // Zähler oben
  const countInfo = document.createElement('p');
  countInfo.style.cssText = 'color:var(--text-secondary); margin:0.5rem 0 1rem; font-size:0.9rem;';
  countInfo.textContent = `${items.length} ${items.length === 1 ? 'Item' : 'Items'} gefunden`;
  container.appendChild(countInfo);

  const grid = document.createElement('div');
  grid.className = 'grid';
  container.appendChild(grid);

  // Aus Performance-Gründen erstmal maximal 120 anzeigen
  const MAX = 120;
  items.slice(0, MAX).forEach(entry => {
    const card = document.createElement('div');
    card.className = 'card animated';
    const iconUrl = getAuctionItemIcon(entry.item);
    const avg = getMonthlyAveragePerUnit({ item: entry.item });
    card.innerHTML = `
      <img src="${iconUrl}" alt="${entry.name}" loading="lazy" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
      <h3 class="auction-name">${entry.name}</h3>
      <div class="price-info"><span style="color:var(--text-secondary)">Ø 30 Tage:</span> ${avg !== null ? formatCardPrice(Math.round(avg)) : 'Keine Daten'}</div>
      <div class="price-info" style="font-size:0.8rem; color:var(--text-secondary)">${entry.activeCount} aktiv · ${entry.soldCount} verkauft</div>
    `;
    card.onclick = () => openItemDetail(entry.name);
    grid.appendChild(card);
  });

  if (items.length > MAX) {
    const more = document.createElement('p');
    more.style.cssText = 'text-align:center; color:var(--text-secondary); padding:1rem;';
    more.textContent = `… und ${items.length - MAX} weitere. Nutze die Suche, um einzugrenzen.`;
    container.appendChild(more);
  }
}

// Öffnet die Detailansicht für ein Item (Durchschnitt + Kurve + Aktionen)
async function openItemDetail(itemName) {
  const modal = document.getElementById('itemDetailModal');
  const body = document.getElementById('itemDetailBody');
  if (!modal || !body) return;

  // Repräsentatives Item-Objekt finden (aus aktiven Auktionen bevorzugt, sonst Verlauf)
  let repItem = null;
  const active = (App.auctionsData || []).find(a => (a.item?.displayName ?? a.item?.material) === itemName);
  if (active) repItem = active.item;
  if (!repItem) {
    const sales = App.auctionHistory[itemName];
    if (Array.isArray(sales) && sales.length) repItem = sales[sales.length - 1].item || { material: itemName, displayName: itemName };
  }
  if (!repItem) repItem = { material: itemName, displayName: itemName };

  const pseudoAuction = { item: repItem };
  const avgAll = (() => {
    const sales = App.auctionHistory[itemName] || [];
    if (!sales.length) return null;
    const sum = sales.reduce((acc, s) => acc + salePricePerUnit(s), 0);
    return Math.round(sum / sales.length);
  })();
  const avgMonth = getMonthlyAveragePerUnit(pseudoAuction);

  const activeCount = (App.auctionsData || []).filter(a => (a.item?.displayName ?? a.item?.material) === itemName).length;
  const soldCount = (App.auctionHistory[itemName] || []).length;

  const iconUrl = getAuctionItemIcon(repItem);

  body.innerHTML = `
    <h2 style="padding-right:3rem;">${itemName}</h2>
    <div class="auction-info-box">
      <div class="info-item" style="text-align:center;">
        <img src="${iconUrl}" alt="${itemName}" style="width:64px;height:64px;image-rendering:pixelated;" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
      </div>
      <div class="info-item"><strong>Durchschnitt</strong>${avgAll !== null ? `<span class="sell">${avgAll.toLocaleString('de-DE')}</span>` : '<span>Keine Daten</span>'}</div>
      <div class="info-item"><strong>Durchschnitt (30 Tage)</strong>${avgMonth !== null ? `<span class="sell">${Math.round(avgMonth).toLocaleString('de-DE')}</span>` : '<span>Keine Daten</span>'}</div>
      <div class="info-item"><strong>Aktive Auktionen</strong><span>${activeCount}</span></div>
      <div class="info-item"><strong>Verkäufe im Verlauf</strong><span>${soldCount}</span></div>
    </div>
    <div id="itemDetailChart" style="margin:1rem 0;"></div>
    <div class="item-detail-actions">
      <button class="item-action-btn" id="itemGotoActive">Aktive Auktionen</button>
      <button class="item-action-btn" id="itemGotoHistory">Auktionsverlauf</button>
      <button class="item-action-btn item-remind-btn" id="itemRemindBtn" title="Bald verfügbar">🔔 Erinnerung</button>
    </div>
  `;

  // Aktionen verdrahten
  document.getElementById('itemGotoActive').onclick = () => {
    closeItemDetail();
    App.auctionItemFilter = itemName;
    App.selectedPlayerUuid = null;
    showSection('auctions');
    renderAuctions();
  };
  document.getElementById('itemGotoHistory').onclick = () => {
    closeItemDetail();
    App.historyItemFilter = itemName;
    App.selectedPlayerUuid = null;
    showSection('history');
    renderHistory();
  };
  // Erinnerungs-Button: noch ohne Funktion (kommt später)
  document.getElementById('itemRemindBtn').onclick = () => {
    showConfirmModal('Bald verfügbar', 'Die Erinnerungs-Funktion kommt in einem späteren Update.', 'Ok', false);
  };

  // Chart rendern (nutzt dieselbe Kurve wie im Verlauf, falls Daten vorhanden)
  modal.classList.add('show');
  document.body.classList.add('modal-open');

  const sales = App.auctionHistory[itemName] || [];
  if (sales.length >= 2) {
    renderItemMiniChart(itemName, 'itemDetailChart');
  } else {
    const chartDiv = document.getElementById('itemDetailChart');
    if (chartDiv) chartDiv.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">Noch nicht genug Verkäufe für eine Kurve.</p>';
  }
}

// Kleine Preis-Kurve für ein Item (Verkaufspreis pro Stück über Zeit)
function renderItemMiniChart(itemName, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sales = (App.auctionHistory[itemName] || [])
    .slice()
    .sort((a, b) => new Date(a.soldAt || a.endTime) - new Date(b.soldAt || b.endTime));
  if (sales.length < 2) return;

  const points = sales.map(s => ({
    t: new Date(s.soldAt || s.endTime).getTime(),
    v: salePricePerUnit(s)
  }));

  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 320;
  canvas.height = 160;
  container.innerHTML = '';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const vals = points.map(p => p.v);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const minT = points[0].t, maxT = points[points.length - 1].t;
  const pad = 30;
  const W = canvas.width, H = canvas.height;
  const x = t => pad + ((t - minT) / (maxT - minT || 1)) * (W - pad * 1.5);
  const y = v => H - pad - ((v - minV) / (maxV - minV || 1)) * (H - pad * 1.5);

  // Linie
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(p.t), py = y(p.v);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Punkte
  ctx.fillStyle = '#22d3ee';
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(x(p.t), y(p.v), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Min/Max Labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.fillText(Math.round(maxV).toLocaleString('de-DE'), 2, y(maxV) + 4);
  ctx.fillText(Math.round(minV).toLocaleString('de-DE'), 2, y(minV) + 4);
}

function closeItemDetail() {
  const modal = document.getElementById('itemDetailModal');
  if (modal) modal.classList.remove('show');
  document.body.classList.remove('modal-open');
}

// Zeigt oben im Container einen "Filter: [Item] ✕"-Hinweis, wenn ein
// Item-Filter aktiv ist (gesetzt über den Items-Tab). Klick auf ✕ hebt ihn auf.
function renderFilterChip(containerId, filterValue, clearFn) {
  const container = document.getElementById(containerId);
  if (!container || !filterValue) return;
  const chip = document.createElement('div');
  chip.className = 'item-filter-chip';
  chip.innerHTML = `Filter: <strong>${filterValue}</strong> <span class="chip-x" title="Filter entfernen">✕</span>`;
  chip.querySelector('.chip-x').onclick = clearFn;
  container.prepend(chip);
}

function parseShardItem(source) {
  if (!source) return { name: "Unbekannt", isCustom: false, material: null };

  // 1. NEU: Komplexes Format (z.B. minecraft:paper[custom_name='...', ...])
  // Wir suchen nach dem ersten text: "..." Feld, das nicht leer ist.
  if (source.includes("[") && source.includes("]")) {
    // Regex für text: gefolgt von beliebigen Anführungszeichen (auch escaped)
    // Wir finden alle Vorkommen und nehmen das erste, das einen echten Namen enthält.
    const textRegex = /text:\s*[\\"]*([^\\",\]\}]+)[\\"]*/g;
    let match;
    while ((match = textRegex.exec(source)) !== null) {
      const val = match[1].trim();
      // "true" oder "false" oder "0b" sind oft Teil von NBT, wir wollen den echten Namen
      if (val && val !== "" && val !== "true" && val !== "false" && !val.match(/^\d+[bsfL]$/)) {
        return { name: val, isCustom: true, material: source.split("[")[0] };
      }
    }
    // Fallback: Materialname vor der Klammer
    const baseMaterial = source.split("[")[0].replace("minecraft:", "").replace(/_/g, " ");
    return { name: baseMaterial.charAt(0).toUpperCase() + baseMaterial.slice(1), isCustom: true, material: source.split("[")[0] };
  }

  // 2. ALT: item_name='...' Format (Backup für ältere API-Versionen)
  if (source.includes("item_name")) {
    try {
      const itemNameMatch = source.match(/item_name='([^']*)'/);
      if (itemNameMatch && itemNameMatch[1]) {
        const itemDetails = JSON.parse(itemNameMatch[1]);
        if (itemDetails.extra && itemDetails.extra[0] && itemDetails.extra[0].text) {
          return { name: itemDetails.extra[0].text, isCustom: true, material: null };
        }
      }
    } catch (e) {
      console.warn("Parser: Fehler beim Parsen von item_name:", e);
    }
  }

  // 3. STANDARD: Einfacher Name (diamond_block -> Diamond Block)
  const name = source.replace("minecraft:", "").replace(/_/g, " ");
  return {
    name: name.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" "),
    isCustom: false,
    material: source
  };
}


async function renderShards() {
  const container = document.getElementById("shardsContainer");
  const search = "";
  container.innerHTML = `<div class="content-loader"><span class="loading-spinner"></span><span>Lade Shards...</span></div>`;
  await new Promise(resolve => requestAnimationFrame(resolve));
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";
  const filteredRates = App.shardRates.filter(rate => rate.parsed.name.toLowerCase().includes(search));

  const fragment = document.createDocumentFragment();
  for (const rate of filteredRates) {
    const itemInfo = rate.parsed;
    let icon = 'https://mcdf.wiki.gg/images/Barrier.png?ff8ff1';
    if (itemInfo.isCustom) {
      icon = customAuctionIcons[itemInfo.name] || icon;
    } else {
      const materialKey = itemInfo.material ? itemInfo.material.toLowerCase() : '';
      const marketItem = App.marketItemsMap[materialKey];
      if (marketItem) icon = marketItem.icon;
    }
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.innerHTML = `<img src="${icon}" alt="${itemInfo.name}"><h3 class="shards-name">${itemInfo.name}</h3><div class="price-info shards-rate">Wert: <span style="color: #34D399; font-weight: bold;">${parseFloat(rate.exchangeRate).toFixed(2)}</span> Shards</div>`;
    card.onclick = () => openChart(itemInfo.name, 'shards');
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
  container.appendChild(grid);

  // Shard Rechner initialisieren/aktualisieren
  renderShardCalculator();

  animateCardsWave(document.getElementById('shards'));
}

function renderShardCalculator() {
  const container = document.getElementById("shardCalculatorContainer");
  if (!container) return;

  // Wenn er noch nicht existiert, Grundstruktur erstellen
  if (!container.innerHTML) {
    container.innerHTML = `
      <div class="calculator-card">
        <div class="calculator-header">
          <div class="calculator-icon-wrapper">
             <img id="calcMainIcon" src="https://mcdf.wiki.gg/images/Barrier.png?ff8ff1" alt="Item">
          </div>
          <div class="calculator-title-group">
            <h2>Shard Rechner</h2>
            <div class="calc-subtitle">Konvertiere Items in Shards und zurück</div>
          </div>
        </div>
        
        <div class="calc-group" style="margin-bottom: 2.5rem;">
          <label class="calc-label">Item auswählen</label>
          <select id="calcItemSelect" class="calc-item-select" onchange="updateShardCalculator('item')"></select>
        </div>

        <div class="calculator-grid">
          <div class="calc-group">
            <label class="calc-label">Anzahl Items</label>
            <div class="calc-input-wrapper">
              <input type="text" id="calcItemInput" class="calc-input" value="1" oninput="updateShardCalculator('items')" onkeydown="if(!/[0-9]/.test(event.key) && !['.', ',', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(event.key)) event.preventDefault();">


              <span class="calc-input-unit">Stk.</span>
            </div>
          </div>

          <div class="calc-divider-new">
             <div class="calc-equal-symbol">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>
                </svg>
             </div>
          </div>

          <div class="calc-group">
            <label class="calc-label">Gesamtwert (Shards)</label>
            <div class="calc-input-wrapper">
              <input type="text" id="calcShardInput" class="calc-input" value="0" oninput="updateShardCalculator('shards')" onkeydown="if(!/[0-9]/.test(event.key) && !['.', ',', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(event.key)) event.preventDefault();">


              <span class="calc-input-unit">Shards</span>
            </div>
          </div>
        </div>

        <!-- Geldwert Anzeige -->
        <div class="calc-money-row">
          <div class="calc-group">
            <label class="calc-label" id="calcMoneyLabel">Ø Auktionswert (Geld)</label>
            <div class="calc-input-wrapper">
               <input type="text" id="calcMoneyInput" class="calc-input calc-money-input" value="0" oninput="updateShardCalculator('money')" onkeydown="if(!/[0-9]/.test(event.key) && !['.', ',', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(event.key)) event.preventDefault();">


               <span class="calc-input-unit">$</span>
            </div>
          </div>
        </div>


        <div class="calc-footer">

          <div class="calc-rate-info">Wechselkurs: <span id="calcRateDisplay">0.00</span> Shards pro Item</div>
          <div class="calc-status">Stand: Live API</div>
        </div>
      </div>
    `;
  }

  populateShardCalculatorDropdown();
}


function populateShardCalculatorDropdown() {
  const select = document.getElementById("calcItemSelect");
  if (!select) return;

  const currentSelection = select.value;
  select.innerHTML = "";

  App.shardRates.forEach(rate => {
    const opt = document.createElement("option");
    opt.value = rate.source;
    opt.textContent = rate.parsed.name;
    opt.dataset.rate = rate.exchangeRate;
    select.appendChild(opt);
  });

  if (currentSelection && [...select.options].some(o => o.value === currentSelection)) {
    select.value = currentSelection;
  }

  updateShardCalculator('item');
}

function updateShardCalculator(trigger) {
  const select = document.getElementById("calcItemSelect");
  const itemInput = document.getElementById("calcItemInput");
  const shardInput = document.getElementById("calcShardInput");
  const moneyInput = document.getElementById("calcMoneyInput");
  const moneyLabel = document.getElementById("calcMoneyLabel");
  const rateDisplay = document.getElementById("calcRateDisplay");
  const mainIcon = document.getElementById("calcMainIcon");

  if (!select || !itemInput || !shardInput || !moneyInput) return;

  const selectedOpt = select.options[select.selectedIndex];
  if (!selectedOpt) return;

  const rate = parseFloat(selectedOpt.dataset.rate);
  const itemName = selectedOpt.textContent;

  // Update Icon
  const shardRate = App.shardRates.find(r => r.source === select.value);
  if (shardRate) {
    let icon = 'https://mcdf.wiki.gg/images/Barrier.png?ff8ff1';
    if (shardRate.parsed.isCustom) {
      icon = customAuctionIcons[shardRate.parsed.name] || icon;
    } else {
      const materialKey = shardRate.parsed.material ? shardRate.parsed.material.toLowerCase() : '';
      const marketItem = App.marketItemsMap[materialKey];
      if (marketItem) icon = marketItem.icon;
    }
    if (mainIcon) mainIcon.src = icon;
  }

  const formatCalcValue = (val) => {
    if (val === null || val === undefined || isNaN(val)) return "";
    return Math.round(val).toLocaleString('de-DE');
  };
  const parseCalcValue = (val) => {
    if (!val) return 0;
    return parseFloat(val.toString().replace(/\./g, '').replace(',', '.')) || 0;
  };

  rateDisplay.textContent = rate.toFixed(2);

  // Preis aus Markt oder Auktion bestimmen
  let avgPrice = null;
  if (shardRate.parsed.isCustom) {
    avgPrice = calculateAverageAuctionPrice(shardRate.parsed.name);
    if (moneyLabel) moneyLabel.textContent = "Ø Auktionswert (Geld)";
  } else {
    avgPrice = getMarketSellPrice(shardRate.parsed.material);
    if (moneyLabel) moneyLabel.textContent = "Marktwert (Geld)";
  }

  if (trigger === 'item') {
    // Wenn Item gewechselt wird: Reset auf 1 Item
    itemInput.value = "1";
    const items = 1;
    shardInput.value = formatCalcValue(items * rate);
    if (avgPrice) moneyInput.value = formatCalcValue(items * avgPrice);
    else moneyInput.value = "";
  } else if (trigger === 'items') {
    const items = parseCalcValue(itemInput.value);
    shardInput.value = formatCalcValue(items * rate);
    if (avgPrice) moneyInput.value = formatCalcValue(items * avgPrice);
    else moneyInput.value = "";
  } else if (trigger === 'shards') {
    const shards = parseCalcValue(shardInput.value);
    const items = shards / rate;
    itemInput.value = formatCalcValue(items);
    if (avgPrice) moneyInput.value = formatCalcValue(items * avgPrice);
    else moneyInput.value = "";
  } else if (trigger === 'money') {
    const money = parseCalcValue(moneyInput.value);
    if (avgPrice && avgPrice > 0) {
      const items = money / avgPrice;
      itemInput.value = formatCalcValue(items);
      shardInput.value = formatCalcValue(items * rate);
    }
  }


  // Platzhalter zeigen wenn keine Daten da sind
  moneyInput.placeholder = avgPrice ? "" : "Keine Daten";
  if (!avgPrice) moneyInput.value = "";
}


function getMarketSellPrice(material) {
  if (!App.marketPrices || !material) return null;

  // Material-Key bereinigen (Präfix weg und kleinschreiben)
  const matClean = material.replace("minecraft:", "").toLowerCase();

  // Turbo-Lookup via Map
  if (App.marketPricesMap && App.marketPricesMap[matClean] !== undefined) {
    return App.marketPricesMap[matClean];
  }

  // Fallback: Suche in allen Kategorien (falls Map noch nicht bereit)
  for (const category in App.marketPrices) {
    const items = App.marketPrices[category];
    const matchingKey = Object.keys(items).find(k => k.toLowerCase() === matClean);

    if (matchingKey) {
      const orders = items[matchingKey];
      const sellOrder = orders.find(o => o.orderSide === "SELL");
      const price = sellOrder ? sellOrder.price : 0.8;
      // In Map cachen für nächstes Mal
      if (!App.marketPricesMap) App.marketPricesMap = {};
      App.marketPricesMap[matClean] = price;
      return price;
    }
  }
  return 0.8;
}



function calculateAverageAuctionPrice(itemName) {
  if (!App.auctionHistory) return 0.8;
  const history = App.auctionHistory[itemName];
  if (!history || !Array.isArray(history) || history.length === 0) return 0.8;

  const sum = history.reduce((acc, sale) => acc + salePricePerUnit(sale), 0);
  return Math.round(sum / history.length) || 0.8;
}




async function loadHistory(period, material, type) {
  let historyData;
  const chartModal = document.getElementById('chartModal');
  let avgDisplay = chartModal.querySelector('#average-price-display');

  if (avgDisplay) {
    avgDisplay.style.display = 'none';
  }

  const loader = document.getElementById('chartLoadingOverlay');
  if (loader) loader.style.display = 'flex';

  // Update Button active state
  const chartButtons = chartModal.querySelectorAll('.chart-buttons button');
  const periodMap = { 'DAILY': 0, 'WEEKLY': 1, 'MONTHLY': 2 };
  chartButtons.forEach((btn, idx) => {
    btn.classList.toggle('active', idx === periodMap[period]);
  });

  if (type === 'market') {
    const data = await (await fetch(`https://api.opsucht.net/market/history/${material}`)).json();
    historyData = data[period];
    if (historyData) {
      historyData = historyData.slice(-30);
    }

    if (historyData && historyData.length > 0) {
      const sum = historyData.reduce((acc, h) => acc + h.avgPrice, 0);
      const avg = Math.round(sum / historyData.length);

      if (!avgDisplay) {
        avgDisplay = document.createElement('div');
        avgDisplay.id = 'average-price-display';
        const chartContainer = chartModal.querySelector('.chart-container');
        chartContainer.parentNode.insertBefore(avgDisplay, chartContainer);

        // Styles für Position und Aussehen
        avgDisplay.style.fontWeight = 'bold';
        avgDisplay.style.textAlign = 'center';
        avgDisplay.style.marginTop = '1rem';
        avgDisplay.style.marginBottom = '1rem';
      }
      const periodLabels = { 'HOURLY': 'Stunde', 'DAILY': 'Tag', 'WEEKLY': 'Woche', 'MONTHLY': 'Monat' };
      const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color1').trim();
      avgDisplay.innerHTML = `Durchschnitt (${periodLabels[period]}): <span style="color: ${accentColor};">${avg.toLocaleString('de-DE')}</span>`;
      avgDisplay.style.display = 'block';
    }
  } else if (type === 'shards') {
    // Lazy Load der Shard Datenbank, falls noch nicht geladen
    if (Object.keys(App.shardHistory).length === 0) {
      document.getElementById("modalTitle").textContent = "Lade Preisverlauf...";
      const ctx = document.getElementById("priceChart").getContext("2d");
      if (App.chart) App.chart.destroy();

      try {
        const history = await fetch(`${HISTORY_REPO_BASE}/shard-history.json?t=${Date.now()}`).then(res => res.json());
        App.shardHistory = history || {};
        document.getElementById("modalTitle").textContent = `Preisentwicklung: ${material}`;
      } catch (error) {
        console.error("Fehler beim Laden der Shard-Historie:", error);
        showConfirmModal('Fehler', 'Fehler beim Laden des Preisverlaufs.', 'Ok', false);
        if (loader) loader.style.display = 'none';
        return;
      }
    }

    const allHistory = App.shardHistory;
    let fullHistoryData = Object.entries(allHistory).map(([timestamp, rates]) => {
      const rate = rates.find(r => parseShardItem(r.source).name === material);
      return { timestamp: parseInt(timestamp), avgPrice: rate ? rate.exchangeRate : null };
    }).filter(h => h.avgPrice !== null);
    if (fullHistoryData.length > 2) {
      let filteredHistory = [fullHistoryData[0]];
      for (let i = 1; i < fullHistoryData.length - 1; i++) {
        if (fullHistoryData[i].avgPrice !== filteredHistory[filteredHistory.length - 1].avgPrice) {
          filteredHistory.push(fullHistoryData[i]);
        }
      }
      filteredHistory.push(fullHistoryData[fullHistoryData.length - 1]);
      historyData = filteredHistory;
    } else {
      historyData = fullHistoryData;
    }
    const currentRate = App.shardRates.find(r => parseShardItem(r.source).name === material);
    if (currentRate && (historyData.length === 0 || historyData[historyData.length - 1].avgPrice !== currentRate.exchangeRate)) {
      historyData.push({ timestamp: Date.now(), avgPrice: currentRate.exchangeRate });
    }
  }

  if (!historyData || historyData.length === 0) {
    const ctx = document.getElementById("priceChart").getContext("2d");
    if (App.chart) App.chart.destroy();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = "16px Arial";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText("Keine historischen Daten für dieses Item verfügbar.", ctx.canvas.width / 2, ctx.canvas.height / 2);
    if (loader) loader.style.display = 'none';
    showConfirmModal('Keine Daten', 'Für dieses Item ist aktuell kein Preisverlauf verfügbar.', 'Ok', false);
    return;
  }

  const labels = historyData.map(h => {
    const d = new Date(h.timestamp);
    if (type === 'shards') {
      return d.toLocaleString("de-DE", { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    if (period === "HOURLY") return d.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });
    if (period === "DAILY") return d.toLocaleDateString("de-DE");
    if (period === "WEEKLY") return "KW " + Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
    return (d.getMonth() + 1).toString().padStart(2, "0") + "." + d.getFullYear();
  });
  const pricesData = historyData.map(h => h.avgPrice);
  const ctx = document.getElementById("priceChart").getContext("2d");
  if (App.chart) App.chart.destroy();
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color1').trim();
  App.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: pricesData,
        borderColor: accentColor,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: "#fff",
        pointBorderColor: accentColor,
        pointBorderWidth: 2,
        pointHoverBackgroundColor: accentColor,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
        tension: 0.4,
        fill: true,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return null;
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, accentColor + "66"); // Semi-transparent accent
          gradient.addColorStop(1, "transparent");
          return gradient;
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(13, 17, 28, 0.95)',
          titleColor: '#8a8a8a',
          bodyColor: '#fff',
          titleFont: { size: 12, weight: '500' },
          bodyFont: { size: 16, weight: 'bold' },
          padding: 12,
          cornerRadius: 10,
          displayColors: false,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: (context) => {
              let label = context.parsed.y.toLocaleString('de-DE');
              return label;
            },
            footer: () => 'Klicke für Details'
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#8a8a8a', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#8a8a8a',
            font: { size: 10 },
            callback: value => {
              if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
              if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
              return value;
            }
          }
        }
      }
    }
  });

  if (loader) loader.style.display = 'none';
}

function openChart(material, type) {
  App.currentItem = material;
  App.currentItemType = type;
  const titlePrefix = type === 'market' ? 'MARKTVERLAUF' : 'SHARDVERLAUF';
  document.getElementById("modalTitle").innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px; color: var(--accent-color1);"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg> <span style="font-size: 0.8rem; letter-spacing: 0.1em; color: var(--text-secondary); vertical-align: middle;">${titlePrefix}</span> <span style="vertical-align: middle;">${material}</span>`;

  // Pin Button Logik
  const pinBtn = document.getElementById('marketPinBtn');
  if (pinBtn) {
    if (type === 'market') {
      pinBtn.style.display = 'flex';
      pinBtn.classList.toggle('pinned', (App.pinnedItems || []).includes(material));
    } else {
      pinBtn.style.display = 'none';
      pinBtn.classList.remove('pinned');
    }
  }

  const chartButtons = document.querySelector(".chart-buttons");
  chartButtons.style.display = type === 'shards' ? 'none' : 'block';
  const chartModal = document.getElementById('chartModal');
  ['.auction-info-box', '.auction-lore-box', '.auction-enchantments-box', '#bidders-header', '#bidders-grid', '#notificationBtn', '#average-price-display'].forEach(sel => {
    const el = chartModal.querySelector(sel);
    if (el) el.style.display = 'none';
  });
  chartModal.querySelector('.chart-container').style.display = 'block';
  const loader = document.getElementById('chartLoadingOverlay');
  if (loader) loader.style.display = 'flex';
  const placeholder = chartModal.querySelector('.no-bids-placeholder');
  if (placeholder) placeholder.remove();
  openModal();
  loadHistory(type === 'shards' ? '' : 'DAILY', material, type);
}

async function openAuctionChart(auction) {
  if (!App.selectedPlayerUuid) {
    App.previousState = { type: 'auction_modal', auction: auction };
  }
  App.currentItem = null;
  const itemName = auction.item.displayName ?? auction.item.material;
  document.getElementById("modalTitle").textContent = itemName;
  document.querySelector(".chart-buttons").style.display = "none";

  // Hide pin button for auction items
  const pinBtn = document.getElementById('marketPinBtn');
  if (pinBtn) pinBtn.style.display = 'none';
  const chartModal = document.getElementById('chartModal');
  ['.no-bids-placeholder', '#average-price-display', '#historyBackButton'].forEach(sel => {
    const el = chartModal.querySelector(sel);
    if (el) el.remove();
  });
  chartModal.querySelector('.chart-container').style.display = 'block';
  const loader = document.getElementById('chartLoadingOverlay');
  if (loader) loader.style.display = 'flex';
  chartModal.querySelector('.auction-info-box')?.remove();
  chartModal.querySelector('.auction-lore-box')?.remove();
  chartModal.querySelector('.auction-enchantments-box')?.remove();

  const modalContent = chartModal.querySelector(".modal-content");
  const infoBox = document.createElement("div");
  infoBox.className = "auction-info-box";
  modalContent.insertBefore(infoBox, modalContent.querySelector('.chart-container'));

  const sellerName = auction.seller ? await uuidToUsername(auction.seller) : "-";
  const sellerInitial = (sellerName.match(/[a-zA-Z]/) || ['?'])[0].toUpperCase();

  // Durchschnittspreis für die Box berechnen
  // Filter history by material and lore to distinguish items with the same name
  const fullHistory = App.auctionHistory[itemName] || [];
  const filteredHistory = fullHistory.filter(sale => {
    if (!sale.item) return true; // Legacy data
    if (sale.item.material !== auction.item.material) return false;
    if (auction.item.lore && sale.item.lore) {
      const currentLore = Array.isArray(auction.item.lore) ? auction.item.lore.join('\n') : auction.item.lore;
      const targetLore = Array.isArray(sale.item.lore) ? sale.item.lore.join('\n') : sale.item.lore;
      if (currentLore !== targetLore) return false;
    } else if (auction.item.lore || sale.item.lore) {
      return false;
    }
    return true;
  });

  let avgPrice = null;
  if (filteredHistory.length > 0) {
    const sum = filteredHistory.reduce((acc, sale) => acc + salePricePerUnit(sale), 0);
    avgPrice = Math.round(sum / filteredHistory.length);
  }

  // Durchschnitt der letzten 30 Tage
  const monthCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const lastMonthSales = filteredHistory.filter(sale => {
    const t = new Date(sale.soldAt || sale.endTime).getTime();
    return !isNaN(t) && t >= monthCutoff;
  });
  let avgPriceMonth = null;
  if (lastMonthSales.length > 0) {
    const sumM = lastMonthSales.reduce((acc, sale) => acc + salePricePerUnit(sale), 0);
    avgPriceMonth = Math.round(sumM / lastMonthSales.length);
  }

  const isExpired = new Date(auction.endTime) <= new Date();

  const fmtDate = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE');
  };

  infoBox.innerHTML = `
      <div class="info-item"><strong>Verkäufer</strong><span class="seller-profile"><div class="player-initial-avatar" style="width: 24px; height: 24px; font-size: 1rem; margin: 0;">${sellerInitial}</div>${sellerName}</span></div>
      <div class="info-item"><strong>Startzeit</strong><span>${fmtDate(auction.startTime)}</span></div>
      <div class="info-item"><strong>Endzeit</strong><span>${fmtDate(auction.endTime)}</span></div>
      <div class="info-item"><strong>${isExpired ? 'Verkauft für' : 'Aktuelles Gebot'}</strong><span class="sell">${(auction.currentBid ?? auction.startBid).toLocaleString('de-DE')}</span></div>
      ${auction.instantBuyPrice ? `<div class="info-item"><strong>Sofortkauf</strong><span style="color: var(--accent-color1);">${auction.instantBuyPrice.toLocaleString('de-DE')}</span></div>` : ''}
      <div class="info-item"><strong>Durchschnitt</strong>${avgPrice !== null ? `<span class="sell">${avgPrice.toLocaleString('de-DE')}</span>` : `<span>Keine Daten</span>`}</div>
      <div class="info-item"><strong>Durchschnitt (30 Tage)</strong>${avgPriceMonth !== null ? `<span class="sell">${avgPriceMonth.toLocaleString('de-DE')}</span>` : `<span>Keine Daten</span>`}</div>
      <div class="info-item-full-width"><button id="historyBtn">Verlauf</button></div>
    `;

  const sellerProfileEl = infoBox.querySelector('.seller-profile');
  if (sellerProfileEl && auction.seller) {
    sellerProfileEl.onclick = () => {
      if (document.getElementById('chartModal').classList.contains('show')) closeModal();
      if (document.getElementById('impressumModal')?.classList.contains('show')) closeImpressumModal();
      if (document.getElementById('privacyModal').classList.contains('show')) closePrivacyModal();

      const activeSection = document.querySelector('.section.active')?.id || 'auctions';
      const isHistory = activeSection === 'history';
      const currentState = {
        type: 'tab_navigation',
        section: activeSection,
        category: isHistory ? App.historyCategoryFilter : App.auctionCategoryFilter,
        search: document.getElementById(isHistory ? "searchHistory" : "searchAuctions")?.value || ''
      };

      if (!App.selectedPlayerUuid) {
        // We are entering from a list or another tab
        App.previousState = { type: 'auction_modal', auction: auction, origin: currentState };
      } else {
        // We are already in a profile, stack the current profile state
        App.previousState = { type: 'auction_modal', auction: auction, origin: App.previousState };
      }

      App.selectedPlayerUuid = auction.seller;
      if (isHistory) {
        renderHistory();
      } else {
        renderAuctions();
      }
    };
  }

  document.getElementById('historyBtn').onclick = () => showAuctionItemHistory(auction);

  let notificationBtn = modalContent.querySelector('#notificationBtn');
  if (notificationBtn) notificationBtn.remove();

  // const isExpired check moved up
  if (!isExpired) {
    notificationBtn = document.createElement('button');
    notificationBtn.id = 'notificationBtn';
    notificationBtn.textContent = 'Auktions Erinnerung';
    notificationBtn.style.width = '100%';
    notificationBtn.style.marginBottom = '1rem';
    notificationBtn.style.display = 'block';
    infoBox.insertAdjacentElement('afterend', notificationBtn);
    setupNotificationButton(auction);
  }

  // --- NEU: Lore & Enchantments ---
  const item = auction.item;
  if (item) {
    let lastAnchor = notificationBtn || infoBox;

    // Lore Box
    if (item.lore && Array.isArray(item.lore) && item.lore.length > 0) {
      const loreBox = document.createElement("div");
      loreBox.className = "auction-lore-box";
      const loreTitle = document.createElement("div");
      loreTitle.className = "box-title";
      loreTitle.innerHTML = `<strong>Item Lore</strong>`;
      loreBox.appendChild(loreTitle);

      const loreLines = document.createElement("div");
      loreLines.className = "lore-content";
      item.lore.forEach(line => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "lore-line";
        lineDiv.textContent = line || ' ';
        loreLines.appendChild(lineDiv);
      });
      loreBox.appendChild(loreLines);
      lastAnchor.insertAdjacentElement('afterend', loreBox);
      lastAnchor = loreBox;
    }

    // Enchantments Box
    if (item.enchantments && Object.keys(item.enchantments).length > 0) {
      const enchantBox = document.createElement("div");
      enchantBox.className = "auction-enchantments-box";
      const enchantTitle = document.createElement("div");
      enchantTitle.className = "box-title";
      enchantTitle.innerHTML = `<strong>Verzauberungen</strong>`;
      enchantBox.appendChild(enchantTitle);

      const enchantList = document.createElement("div");
      enchantList.className = "enchant-list";
      for (const [key, level] of Object.entries(item.enchantments)) {
        const badge = document.createElement("span");
        badge.className = "enchant-badge";
        const formattedKey = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        badge.textContent = `${formattedKey} ${level}`;
        enchantList.appendChild(badge);
      }
      enchantBox.appendChild(enchantList);
      lastAnchor.insertAdjacentElement('afterend', enchantBox);
      lastAnchor = enchantBox;
    }

    // --- NEU: Item ID Matcher ---
    const rawIdsText = `Schatzsucher picke: IronPickaxe#17f5
OPSUCHT Bannhammer (OpPass): NetherPicka#15pq
Oldies Kiste: NetherPicka#1lAT
Kohleklopper: WoodenPicka#1lAU
Der Anfang: DiamoPickax#1e1h
Exoskelett Spitzhacke: DiamoPickax#1duS
OP Starter Hacke: DiamoPickax#1pgs
Loot Picke: DiamoPickax#14ng
Loot Picke v2: DiamonPickax#1lL5
UPDATE Spitzhacke: DiamoPickax#1mkO
Gold Picke: GoldenPicka#1k4Y
Oneclick Spitzhacke (Eisen): IronPickaxe#1bzc
Kobold Spitzhacke: NetherPicka#1edV
Glücks Spitzhacke: NetherPicka#1911
LuckyBlock: NetherPicka#1hPV
VORSICHT! Heiß! Adminhacke: DiamoPickax#1nxI
Quarz Dropper: GoldenPicka#16sD
BUNNY Picke: DiamonPickax#1lAz
AChterbahn Eventspitzhacke: NetherPicka#15Go
Devins´s Thumbnail Picke: StonePickax#1fr6
Streamboss Eventpicke v1: DiamonPickax#1lyu
Devins Adminhacke Customanfertigung: DiamoPickax#1jWG
Devins coole Adminhacke: DiamoPickax#1jVt
SUMMERKISTE DRPPEVENT: DiamonPickax#1lpe
CipherHunt Event Picke: DiamoPickax#1k2Y
SUCHT PICKE: DiamoPickax#1k6t
SUCHT PICKE v2: DiamonPickax#15i5
Tornados Modpicke: DiamoPickax#1pLu
Frühlings Hacke: GoldenPicka#167Z
Santas Eispicke v3: NetherPicka#1lOh
Santas Eispicke v2: DiamoPickax#1kRv
Santas Eispicke: DiamoPickax#144M 
Phils Infinityspitzhacke: DiamoPickax#1fDk
Phils Infinityspitzhacke: DiamoPickax#1tOU
Devin´s Infinity Hacke V3: DiamoPickax#12Yd
Devin´s Infinity Hacke V2: DiamonPickax#1si6
Infinity Hacke (Effi. 5): DiamoPickax#18en
Smaragd Spitzhacke: NetherPicka#1mOv
Redstone Spitzhacke: NetherPicka#1k8K
Lapis Spitzhacke: NetherÜicka#1hsd
Obsidian Spitzhacke: NetherPicka#1lh0
Mios Modpicke: DiamoPickax#1oza
Erbeeren Picke: NetherPicka#1k1s
Lucky-Block Spitzhacke (+ 20% Speed): DiamoPickax#1qYK
Op-LuckyBlock Spitzhacke: GoldenPicka#1kLm
Ultra-Lucky-Block Spitzhacke: DiamoPickax#1qaf
Osterhasen Spitzhacke (2024): NetherPicka#1jeg
Samurai Spitzhacke: NetherPicka#1tUc
Eis Klopper: NetherPicka#1f1G
Drachen Spitzhacke: NetherPicka#1g3H
Warden Spitzhacke: NetherPicka#1kuT
Nils Spitzhacke (Kosten: 7500 Kristalle): NetherPicka#1lra
Marcels Picke: NetherPicka#1jVl
Ghost Pickaxe: NetherPicka#16ui
Ghost Pickaxe: DiamoPickax#14sW
Devins HARDCORE Picke: DiamonPickax#1lrd
EVENT PICKE v1: NetherPicka#15Rs
EVENT PICKE v1: DiamonPickax#1lAx
Modhacke v1: NetherPicka#11Uh
LuckyBlock: NetherPicka#1kHb
Winter Spitzhacke: NetherPicka#1eXo
Elfenschwinger: NetherPicka#1oyi
Eisenspitzhacke mit Halt. 255: IronPickaxe#1rNs
Elfenbein Spitzhacke Effi. 6: NetherPicka#1oeI
Diamantspitzhacke Effi. 6 : DiamoPickax#15F8
Frohe Weihnachten Team: DiamonPickax#1lzP
Mystische Spitzhacke: DiamoPickax#1sbh
Abbau Event Spitzhacke (6 Malig): DiamoPickax#1ryJ
OpSucht Miner Op-Spitzhacke: DiamonPickax#1kIJ
Galaxy Spitzhacke (★★★★): DiamonPickax#1nso
Wichtel Spitzhacke (Adventskalender 2022): GoldenPicka#15gf
Kohle Klopper: WoodePicka#164J
Steinklopper: WoodenPicka#1bst
Steinklopper: WoodePicka#14U8
LuckyBlock: WoodenPicka#1kFF
leDevins Mystery Picke: DiamoPickax#17or
Devins Adminhacke: DiamoPickax#1jWF
Devins Geburtstags Picke: DiamoPickax#1n5f
leDevins Adminhacke: DiamonPickax#3Yh
NAVEX EXPOSED HACKE: NetherPicka#1nnG
Effi. 9 Spitzhacke: NetherPicka#1rz8
Oster Spitzhacke: NetherPicka#1e1j
Bedrock Spitzhacke: NetherPicka#1pxe
OPSucht Profihacke: DiamoPickax#1uuj
Phorx Winterpicke: DiamonPickax#17iQ
Devins Flockenpicke V2: NetherPicka#1qWn
Devins Flockenpicke: DiamoPickax#17uu
Santas Flockenpicke: NetherPicka#1f8V
BLACK BLOCK BREAKER: NetherPicka#11Yy
SOMMER Picke: DiamoPickax#1bRF
Phils Gletscher Picke: DiamonPickax#1isN
Schmelzpicke V3: NetherPicka#17og
Schmelzpicke V2: DiamoPickax#1r28
Schmelzpcike: GoldenPicka#10BT
Killer Hacke: DiamoPickax#12HR
Community Spitzhacke: DiamoPickax#12uC
Königliche Spitzhacke: DiamoPickax#14V8
Herbst Spitzhacke: NetherPicka#1nUy
Spitzhacke des Pharaos: NetherPicka#1mHz
JonCarrs Admin Spitzhacke: NetherPicka#1oyf
Sommer Spitzhacke: NetherPicka#1ma9
OP Spitzhacke (★★★★★): NetherPicka#14Uv
Schattenpicke: NetherPicka#1e81
Black Spitzhacke: NetherPicka#1eS2
Santas Lebkuchen Spitzhacke: NetherPicka#1pfY 
OpBirth #6: NetherPicka#1ocB
OpBirth #5: DiamoPickax#1dAm
OpBirth #4: NetherPicka#12zD
OpBirth #2: DiamonPickax#1iNo
OpBirth #1: DiamoPickax#1uXe
Phil´s Bauhacke v1: NetherPicka#1jSU
Phorx Bauhacke V6: DiamoPickax#15B4
Phorx Bauhacke V5: DiamoPickax#1fSM
Phorx Bauhacke V4: DiamoPickax#1jYT
Phorx Bauhacke V3: DiamoPickax#1how
Phorx Bauhacke v2: DiamoPickax#1fr4
Phorx Bauhacke Variante 1: DiamoPickax#1d2n
Phorx Bauhacke Variante 2: DiamoPickax#1jVw
Phorx Bauhacke Variante 3: DiamoPickax#1kJA
Op Plotspitzhacke: DiamoPickax#1jmu
Plotspitzhacke V6: NetherPicka#16mP
Phorx Plotspitzhacke V5: DiamoPickax#16S6
Phorx Plotspitzhacke v4: NetherPicka#1h7P
Plotspitzhacke v2: DiamoPickax#14Vv
OP OWNER HACKE V2: NetherPicka#1brQ
OP OWNER HACKE: NetherPicka#16av
OPSucht Spitzhacke: DiamoPickax#16zO
Phorx Prime Hacke V2: DiamoPickax#1337
Unzerstörbar leDevins Holzspitzhacke: WoodenPicka#ZxX
Phorx Obsihacke: DiamonPickax#15iT
Bohrer ★★: NetherPicka#1iTd
Bohrer ★: NetherPicka#1lR3
Bohrer V2 ★: NetherPicka#1qGs 
Bohrer V2 ★★: NetherPicka#1nQR
Bohrer V2 ★★★: NetherPicka#1pJC
Bohrer V3 ★: NetherPicka#1pMC
Bohrer V3 ★★: NetherPicka#1qDD
Phil´s Bauhacke ★: NetherPicka#1b06
Phil´s Bauhacke ★★: NetherPicka#1qY7
Phil´s Bauhacke ★★★: NetherPicka#1bLL
Will´s Bauhacke ★: NetherPicka#1bTN 
Will´s Bauhacke ★★: NetherPicka#1bHt
Will´s Bauhacke ★★★: NetherPicka#1bEN
Nils Manager Spitzhacke ★★★ : NetherPicka#1eqh
Nils Manager Spitzhacke ★: NetherPicka#1muy
Nils Manager Spitzhacke ★★: NetherPicka#1lOA
Emmys Bauhacke ★: NetherPicka#1k9d
Emmys Bauhacke ★★: NetherPicka#1f7c
Emmys Bauhacke ★★★: NetherPicka#1dqK
Nils Admin Spitzhacke ★★: NetherPicka#1dxR
Multitool ★: NetherPicka#1hbJ
Multitool ★★: NetherPicka#1ldY
Multitool ★★★: NetherPicka#1ix0
Multitool V2 ★: NetherPicka#1qXW
Multitool V2 ★★★: NetherPicka#1nKK
Phil´s Bauhacke mit Custom Textur: NetherPicka#1pkX
SELTENE Oster Hacke: DiamoPickax#15Bf
SELTENE Hacke v1: DiamonPickax#4K5
SELTENE Hacke v2: DiamonPickax#6e3
SELTENE B-DAY Hacke: DiamonPickax#v0n
SELTENE Winter Hacke: DiamonPickax#z1x
EPISCHE Oster Hacke: DiamonPickax#gsr
EPISCHE Hacke v2: DiamonPickax#6e6
EPISCHE B-DAY Hacke: DiamonPickax#uYA
EPISCHE Winter Hacke: DiamonPickax#yUS
UNBEZAHLBARE Oster Hacke: DiamonPickax#gtv
UNBEZAHLBARE Hacke v1: DiamonPickax#4Iq
UNBEZAHLBARE HACKE v2: DiamonPickax#6e9
UNBEZAHLBARE B-DAY Hacke: DiamonPickax#v3o
UNBEZAHLBARE Winter Hacke: DiamonPickax#z0I
LEGENDÄRE Hacke v1: DiamonPickax#4Hd
Plotaushüller: WoodenPicka#3WB
Diamantspitzhacke: DiamonPickaxe#5H
Obsidian Event Spitzhacke: DiamonPickax#41E
Steinzerstörer: DiamonPickax#5Km
The Miner: DiamoPickax#1de3
Spezial Dia Picke: DiamonPickax#5Ss
Spezial Emerald Picke: DiamonPickax#5JT
Spezial Gold Picke: GoldenPickax#88v
NicePixieTV´s Wunder Spitzhacke: WoodenPicka#snu
Titanhacke: DiamonPickax#MU7
Stein Zerstörer: Diamonpickax#XzD
Der Vorschlaghammer: DiamonPickax#yxf
Felsenbeißer: DiamonPickax#yAZ
Mauerbrecher: DiamonPickax#ut4
Ore Miner: DiamonPickax#MUw
SkyGuy´s Cobble Killer: StonePickaxe#XLb
STONE REAPER v1: WoodenPicka#18fN
SkyGuy´s Oster Hacke: DiamonPickax#hsO
OpSucht Oldies Kiste: DiamonPickax#1lC8
DURA Ultrahacke: DiamonPickax#6dQ
Oster Profi Hacke: DiamoPickax#1jbY
Profi Hacke: DiamonPickax#1iHn
SkyGuys Sommerpicke: DiamoPickax#10WL
Dura Superhacke: DiamonPickax#6dP
Dura Oster Superhacke: DiamonPickax#gsv
SkyGuy´s Op Spitzhacke: DiamonPickaxe#blp
SkyGuy´s Op Spitzhacle: DiamonPickax#ySV
SkyGuy´s Superhacke: DiamonPickax#1LT
SkyGuyTV´s Glückspicke: DiamonPickax#14U2
SkyGuyTVßs Superhacke v3: DiamonPickax#5J5
NurZenox´s Weihnachts Hacke: DiamonPickax#7Iw
Cabbi´s Weltenzerstörer: DiamonPickax#8aJ
Cabbi´s Diaklopper: DiamonPickaxe#bly
ThunderNRW´s Glückspicke: DiamonPickax#hB3
NurZenox´s Tunnelgräber: Diamonpickax#5hz
NurZenox´s Tunnelgräber V2: DiamonPickaxe#5Cl
Obsidian RIPPER: DiamonPickax#1pnk
OWNER HACKE: DiamoPickax#ss5
XTREME B-Day Hacke: DiamonPickax#ZrV
OWNER Hacke v2.1: DiamoPickax#115D
Verbuggte Jobspitzhacke: IronPickaxe#1e73`;

    const itemMapping = {};
    rawIdsText.split('\n').forEach(line => {
      line = line.trim().replace(/^->\s*/, '');
      if (line.includes(':')) {
        let [name, idPart] = line.split(':');
        name = name.replace(/✅/g, '').replace(/★/g, '').replace(/ EINMALIG /g, '').trim();
        name = name.replace(/\([^)]*Jackpot[^)]*\)/gi, '').trim();
        name = name.replace(/\([^)]*Selten[^)]*\)/gi, '').trim();
        name = name.replace(/\([^)]*OpSucht[^)]*\)/gi, '').trim();
        name = name.replace(/\([^)]*oppass[^)]*\)/gi, '').trim();
        name = name.replace(/\([^)]*OpPass[^)]*\)/gi, '').trim();
        if (name.includes('- Monumental Selten-')) name = name.split('-')[0].trim();
        
        idPart = idPart.split('|')[0].trim().split('->')[0].trim().replace(/✅/g, '').trim();
        if (idPart !== 'X' && !idPart.includes('Exist') && !idPart.includes('Unbekannt') && idPart.includes('#')) {
          const cleanedId = idPart.split(' ')[0].trim();
          if (cleanedId) {
            itemMapping[name.toLowerCase().replace(/\s+/g, ' ')] = cleanedId;
          }
        }
      }
    });

    const itemNameRaw = item.displayName || item.name || '';
    const itemNameLower = itemNameRaw.replace(/§[0-9a-fk-or]/gi, '').toLowerCase().replace(/✅/g, '').replace(/★/g, '').replace(/ EINMALIG /g, '').replace(/\([^)]*Jackpot[^)]*\)/gi, '').replace(/\([^)]*Selten[^)]*\)/gi, '').replace(/\([^)]*OpSucht[^)]*\)/gi, '').replace(/\([^)]*oppass[^)]*\)/gi, '').trim().replace(/\s+/g, ' ');
    
    if (itemMapping[itemNameLower]) {
      const matchedId = itemMapping[itemNameLower];
      const idBox = document.createElement("div");
      idBox.className = "auction-id-box";
      idBox.style.marginTop = "1rem";
      idBox.style.padding = "10px";
      idBox.style.background = "linear-gradient(135deg, rgba(0, 201, 255, 0.1), rgba(146, 254, 157, 0.1))";
      idBox.style.border = "1px solid var(--accent-color1)";
      idBox.style.borderRadius = "8px";
      idBox.style.color = "var(--text-primary)";
      idBox.style.fontSize = "0.95rem";
      
      const idTitle = document.createElement("div");
      idTitle.innerHTML = `<strong>Item ID</strong>`;
      idTitle.style.marginBottom = "5px";
      idTitle.style.color = "var(--accent-color1)";
      idBox.appendChild(idTitle);
      
      const idValue = document.createElement("div");
      idValue.style.fontFamily = "monospace";
      idValue.style.wordBreak = "break-all";
      idValue.textContent = matchedId;
      idBox.appendChild(idValue);
      
      lastAnchor.insertAdjacentElement('afterend', idBox);
      lastAnchor = idBox;
    }
  }

  const bids = auction.bids || {};
  if (App.chart) App.chart.destroy();
  chartModal.querySelector('.chart-container').style.display = 'none';

  let biddersGrid = modalContent.querySelector('#bidders-grid');
  if (biddersGrid) biddersGrid.remove();
  const oldBiddersHeader = modalContent.querySelector('#bidders-header');
  if (oldBiddersHeader) oldBiddersHeader.remove();

  if (Object.keys(bids).length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'no-bids-placeholder';
    placeholder.innerHTML = `<img src="https://i.postimg.cc/7hsNsds9/asdasdasdnannt.png" alt="Keine Gebote" style="max-width: 150px; margin-bottom: 1rem; opacity: 0.5;"><p>Noch keine Gebote vorhanden</p>`;
    modalContent.insertBefore(placeholder, chartModal.querySelector('.chart-container').nextSibling);
  } else {
    const biddersHeader = document.createElement('h2');
    biddersHeader.id = 'bidders-header';
    biddersHeader.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px; color: var(--accent-color1);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg> Gebotshistorie`;
    biddersHeader.style.marginTop = '2rem';
    modalContent.appendChild(biddersHeader);

    biddersGrid = document.createElement('div');
    biddersGrid.className = 'grid bidders-list';
    biddersGrid.id = 'bidders-grid';
    
    // Sort bidders: Highest bid (latest) at top
    const biddersToShow = Object.entries(bids).sort((a, b) => b[1] - a[1]);
    
    for (let i = 0; i < biddersToShow.length; i++) {
      const [uuid, amount] = biddersToShow[i];
      const username = await uuidToUsername(uuid);
      const card = createPlayerCard(uuid, username);
      
      // Highlight current (highest) bidder
      if (i === 0) {
        const badge = document.createElement('div');
        badge.className = 'current-bidder-badge';
        badge.textContent = 'Aktueller Bieter';
        card.appendChild(badge);
        card.classList.add('highest-bidder');
      }

      card.onclick = () => {
        closeModal();
        const activeSection = document.querySelector('.section.active')?.id || 'auctions';
        const isHistory = activeSection === 'history';
        const currentState = {
          type: 'tab_navigation',
          section: activeSection,
          category: isHistory ? App.historyCategoryFilter : App.auctionCategoryFilter,
          search: document.getElementById(isHistory ? "searchHistory" : "searchAuctions")?.value || ''
        };

        if (!App.selectedPlayerUuid) {
          App.previousState = { type: 'auction_modal', auction: auction, origin: currentState };
        } else {
          App.previousState = { type: 'auction_modal', auction: auction, origin: App.previousState };
        }
        App.selectedPlayerUuid = uuid;

        if (isHistory) {
          renderHistory();
        } else {
          showSection('auctions');
          renderAuctions();
        }
      };
      
      const bidInfo = document.createElement('div');
      bidInfo.className = 'price-info players-bid-amount';
      bidInfo.innerHTML = `Gebot: <span class="sell">${amount.toLocaleString('de-DE')}</span>`;
      card.appendChild(bidInfo);
      biddersGrid.appendChild(card);
    }
    modalContent.appendChild(biddersGrid);
    animateCardsWave(biddersGrid);
  }
  hidePageLoader();
  if (loader) loader.style.display = 'none';
  openModal();
}

async function loadAuctionHistory(period, auction) {
  const itemName = auction.item.displayName ?? auction.item.material;
  const loader = document.getElementById('chartLoadingOverlay');
  if (loader) loader.style.display = 'flex';
  const fullHistory = App.auctionHistory[itemName];
  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue('--text-primary').trim();
  const textSecondary = styles.getPropertyValue('--text-secondary').trim();
  const gridColor = styles.getPropertyValue('--border').trim();

  if (!fullHistory || fullHistory.length === 0) {
    const ctx = document.getElementById("priceChart").getContext("2d");
    if (App.chart) App.chart.destroy();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = "16px Arial";
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.fillText("Keine historischen Daten für dieses Item verfügbar.", ctx.canvas.width / 2, ctx.canvas.height / 2);
    if (loader) loader.style.display = 'none';
    showConfirmModal('Keine Daten', 'Für diesen Spieler/Auktion ist aktuell kein Preisverlauf verfügbar.', 'Ok', false);
    return;
  }

  const chartButtons = document.querySelector('.chart-buttons');
  const periodMap = { 'DAILY': 0, 'MONTHLY': 1, 'YEARLY': 2 };
  chartButtons.querySelectorAll('button').forEach((btn, index) => {
    btn.classList.toggle('active', index === periodMap[period]);
  });

  let now = Date.now();
  let historyData = [];
  const aggregatedData = new Map();

  // Filter history by material and lore to distinguish items with the same name
  const filteredHistory = fullHistory.filter(sale => {
    // If we don't have item info in the history entry, we include it as a fallback (legacy data)
    if (!sale.item) return true;

    // Material must match
    if (sale.item.material !== auction.item.material) return false;

    // Lore must match (if exists)
    if (auction.item.lore && sale.item.lore) {
      const currentLore = Array.isArray(auction.item.lore) ? auction.item.lore.join('\n') : auction.item.lore;
      const targetLore = Array.isArray(sale.item.lore) ? sale.item.lore.join('\n') : sale.item.lore;
      if (currentLore !== targetLore) return false;
    } else if (auction.item.lore || sale.item.lore) {
      // One has lore, the other doesn't
      return false;
    }

    return true;
  });

  const dataToProcess = filteredHistory.map(sale => ({ ...sale, endTime: new Date(sale.endTime).getTime() })).sort((a, b) => a.endTime - b.endTime);

  // User Request: Always show last 30 sales without aggregation
  historyData = dataToProcess.slice(-30).map(sale => ({
    timestamp: sale.soldAt || sale.endTime,
    avgPrice: salePricePerUnit(sale)
  }));

  if (historyData.length === 0) {
    const ctx = document.getElementById("priceChart").getContext("2d");
    if (App.chart) App.chart.destroy();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = "16px Arial";
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.fillText(`Keine Daten für dieses Item verfügbar.`, ctx.canvas.width / 2, ctx.canvas.height / 2);
    if (loader) loader.style.display = 'none';
    return;
  }

  const labels = historyData.map(h => {
    const d = new Date(h.timestamp);
    return d.toLocaleDateString("de-DE", { day: '2-digit', month: '2-digit' }) + " " + d.toLocaleTimeString("de-DE", { hour: '2-digit', minute: '2-digit' });
  });

  const pricesData = historyData.map(h => h.avgPrice);
  const ctx = document.getElementById("priceChart").getContext("2d");
  if (App.chart) App.chart.destroy();
  const accentColor = styles.getPropertyValue('--accent-color1').trim();

  Chart.defaults.color = textSecondary;
  Chart.defaults.borderColor = gridColor;

  App.chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ data: pricesData, borderColor: accentColor, backgroundColor: accentColor + "33", fill: true, tension: 0.3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            color: textSecondary,
            display: window.innerWidth > 768, // Nur auf Desktop anzeigen
            callback: value => new Intl.NumberFormat('de-DE').format(value)
          },
          grid: { color: gridColor }
        },
        x: {
          ticks: { color: textSecondary },
          grid: { color: gridColor }
        }
      }
    }
  });

  if (loader) loader.style.display = 'none';
}

function showAuctionItemHistory(auction) {
  const itemName = auction.item.displayName ?? auction.item.material;
  const itemHistory = App.auctionHistory[itemName];
  if (!itemHistory || itemHistory.length === 0) {
    showConfirmModal('Keine Daten', 'Für dieses Item sind keine Verlaufsdaten verfügbar.', 'Ok', false);
    return;
  }
  const chartModal = document.getElementById('chartModal');
  ['.auction-info-box', '.auction-lore-box', '.auction-enchantments-box', '.no-bids-placeholder', '#bidders-header', '#bidders-grid', '#notificationBtn'].forEach(sel => {
    chartModal.querySelectorAll(sel).forEach(el => {
      if (el) el.style.display = 'none';
    });
  });
  const chartButtons = chartModal.querySelector('.chart-buttons');
  chartButtons.style.display = 'none'; // Buttons verstecken da nur noch letzte 30 Verkäufe angezeigt werden
  if (!chartModal.querySelector('#historyBackButton')) {
    const backButton = document.createElement('button');
    backButton.id = 'historyBackButton';
    backButton.innerHTML = `&larr; Zurück`;
    backButton.style.width = '100%';
    backButton.style.marginBottom = '1rem';
    backButton.onclick = () => openAuctionChart(auction);
    chartButtons.insertAdjacentElement('afterend', backButton);
  }
  document.querySelector('.chart-container').style.display = 'block';
  loadAuctionHistory(null, auction);
}

async function toggleEmailNotification(enabled) {
  App.settings.notifications.email = enabled;
  const user = firebase.auth().currentUser;
  if (user) {
    try {
      await userDatabase.ref('users/' + user.uid + '/settings/notifications').update({
        email: enabled
      });
    } catch (e) {
      console.error("Error saving notification settings:", e);
    }
  }
  // Sync UI toggles
  document.querySelectorAll('#emailNotificationToggle, #accountEmailToggle').forEach(t => t.checked = enabled);
}

function setupNotificationButton(auction) {
  const notificationBtn = document.getElementById('notificationBtn');
  const auctionId = (auction.id || (auction.seller + "_" + (auction.item.material || "") + "_" + auction.endTime)).replace(/[.#$[\]]/g, '-');
  if (App.scheduledNotifications[auctionId]) {
    notificationBtn.classList.add('active');
  } else {
    notificationBtn.classList.remove('active');
  }
  notificationBtn.onclick = async () => {
    if (notificationBtn.classList.contains('active')) {
      clearTimeout(App.scheduledNotifications[auctionId]);
      delete App.scheduledNotifications[auctionId];
      notificationBtn.classList.remove('active');

      // Remove from Firebase
      const user = firebase.auth().currentUser;
      if (user) {
        // Path for Worker
        userDatabase.ref(`reminders/${auctionId}/${user.uid}`).remove().catch(e => console.error("Error removing reminder from global path:", e));
        // Path for User Profil
        userDatabase.ref(`users/${user.uid}/reminders/${auctionId}`).remove().catch(e => console.error("Error removing reminder from user path:", e));

        // Update local state
        delete App.userReminders[auctionId];
      }
    } else {
      await scheduleNotification(auction, notificationBtn);
    }
  };
}

async function scheduleNotification(auction, btn) {
  const auctionId = (auction.id || (auction.seller + "_" + (auction.item.material || "") + "_" + auction.endTime)).replace(/[.#$[\]]/g, '-');
  const endTime = new Date(auction.endTime);
  const notificationTime = endTime.getTime() - (5 * 60 * 1000);
  const now = Date.now();
  if (notificationTime > now) {
    const timeoutId = setTimeout(() => {
      showAuctionNotification(auction);
      delete App.scheduledNotifications[auctionId];
      const currentBtn = document.getElementById('notificationBtn');
      if (currentBtn) currentBtn.classList.remove('active');
    }, notificationTime - now);
    App.scheduledNotifications[auctionId] = timeoutId;
    btn.classList.add('active');

    // Persist to Firebase if user is logged in
    const user = firebase.auth().currentUser;
    if (user) {
      const reminderData = {
        endTime: auction.endTime,
        itemName: auction.item?.displayName || auction.item?.material || "Unbekanntes Item",
        seller: auction.seller || "Unbekannt",
        currentBid: auction.currentBid || 0,
        highestBidder: auction.highestBidder || "Noch kein Gebot",
        amount: auction.item?.amount || 1,
        uid: auctionId
      };

      // Path for User Profil (Always save here for the UI)
      userDatabase.ref(`users/${user.uid}/reminders/${auctionId}`).set(reminderData)
        .catch(e => console.error("Error saving reminder to user path:", e));

      // Update local state
      App.userReminders[auctionId] = reminderData;

      // Path for Worker (Only if email enabled)
      if (App.settings.notifications.email) {
        userDatabase.ref(`reminders/${auctionId}/${user.uid}`).set({
          ...reminderData,
          email: user.email
        }).catch(e => console.error("Error saving reminder to global path:", e));
      }
    }
  } else {
    showConfirmModal(
      'Zeit zu knapp!',
      'Die Auktion endet in weniger als 5 Minuten. Eine Erinnerung kann nicht mehr gesetzt werden.',
      'Verstanden',
      false
    );
  }
}

function showAuctionNotification(auction) {
  openAuctionChart(auction);
  new Audio('auction.ogg').play().catch(e => console.error("Fehler beim Abspielen des Sounds:", e));
}

function createImageRain(section = 'market') {
  const container = document.getElementById('rain-container');
  container.innerHTML = '';
  let imageUrls = [];
  if (section === 'market') {
    imageUrls = App.marketItems.map(item => item.icon).filter(Boolean);
  } else if (section === 'auctions') {
    Object.values(customAuctionIcons).forEach(value => {
      if (typeof value === 'string') {
        if (value) imageUrls.push(value);
      } else if (typeof value === 'object' && value !== null) {
        imageUrls.push(...Object.values(value).filter(Boolean));
      }
    });
  } else if (section === 'shards' && App.shardRates) {
    const uniqueShardIcons = new Set();
    for (const rate of App.shardRates) {
      const itemInfo = parseShardItem(rate.source);
      let icon = 'https://mcdf.wiki.gg/images/Barrier.png?ff8ff1';
      if (itemInfo.isCustom) {
        icon = customAuctionIcons[itemInfo.name] || icon;
      } else {
        const marketItem = App.marketItems.find(item => item.material.toLowerCase() === itemInfo.material.toLowerCase());
        if (marketItem) icon = marketItem.icon;
      }
      uniqueShardIcons.add(icon);
    }
    imageUrls = Array.from(uniqueShardIcons);
  } else if (section === 'history' && App.auctionHistory) {
    const uniqueIcons = new Set();
    for (const itemName in App.auctionHistory) {
      const sales = App.auctionHistory[itemName];
      if (Array.isArray(sales)) {
        sales.forEach(sale => {
          if (sale.item && sale.item.icon) uniqueIcons.add(sale.item.icon);
        });
      }
    }
    imageUrls = Array.from(uniqueIcons);
  }

  const excludedUrl = 'https://i.postimg.cc/d1K5xLLB/1-edition-boosterpack.png';
  imageUrls = imageUrls.filter(url => url !== excludedUrl);
  if (imageUrls.length === 0) return;
  const rainAmount = window.innerWidth < 768 ? 20 : 50;
  for (let i = 0; i < rainAmount; i++) {
    const drop = document.createElement('img');
    drop.src = imageUrls[Math.floor(Math.random() * imageUrls.length)];
    drop.className = 'rain-drop';
    const size = Math.random() * 20 + 20;
    drop.style.width = `${size}px`;
    drop.style.height = `${size}px`;
    drop.style.left = `${Math.random() * 100}vw`;
    drop.style.animationDuration = `${Math.random() * 5 + 5}s`;
    drop.style.animationDelay = `${Math.random() * 10}s`;
    container.appendChild(drop);
  }
}

function setupProfileCardInteractions() {
  document.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
      card.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
    });
  });
}

function startMatrixAnimation() {
  const canvas = document.getElementById('matrix-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789@#$%^&*()*&^%'.split('');
  const fontSize = 10;
  const columns = canvas.width / fontSize;
  const drops = Array(Math.floor(columns)).fill(1);
  function draw() {
    ctx.fillStyle = 'rgba(1, 5, 20, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-color1').trim();
    ctx.font = fontSize + 'px arial';
    for (let i = 0; i < drops.length; i++) {
      const text = letters[Math.floor(Math.random() * letters.length)];
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }
  App.matrixAnimationId = setInterval(draw, 33);
}

function stopMatrixAnimation() {
  if (App.matrixAnimationId) {
    clearInterval(App.matrixAnimationId);
    App.matrixAnimationId = null;
  }
}

function updateAuctionTimers() {
  const now = new Date();
  document.querySelectorAll('.auction-timer').forEach(timerEl => {
    const endTime = new Date(timerEl.dataset.endTime);
    const diff = endTime - now;
    if (diff <= 0) {
      timerEl.textContent = 'Abgelaufen';
      return;
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    let timeLeftString;
    if (days > 0) timeLeftString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    else if (hours > 0) timeLeftString = `${hours}h ${minutes}m ${seconds}s`;
    else if (minutes > 0) timeLeftString = `${minutes}m ${seconds}s`;
    else timeLeftString = `${seconds}s`;
    timerEl.innerHTML = `⏰ <span style="color: #F87171;">${timeLeftString}</span>`;
  });
}

function animateHeadline() {
  const headline = document.querySelector('h1');
  if (!headline) return;
  const emojiSpan = headline.querySelector('span');
  const text = headline.textContent.substring(emojiSpan.textContent.length).trim();
  headline.innerHTML = '';
  headline.appendChild(emojiSpan);
  headline.append(document.createTextNode('\u00A0'));
  text.split('').forEach((char, index) => {
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = char === ' ' ? '\u00A0' : char;
    span.style.animationDelay = `${index * 0.03}s`;
    headline.appendChild(span);
  });
}

function updateVisitorCounter() {
  const counterRef = database.ref('visits/count');
  const hasCounted = sessionStorage.getItem('hasCountedVisit');

  if (!hasCounted) {
    counterRef.transaction(function (currentCount) {
      return (currentCount || 0) + 1;
    });
    sessionStorage.setItem('hasCountedVisit', 'true');
  }

  counterRef.on('value', (snapshot) => {
    const count = snapshot.val();
    const el = document.getElementById('visitor-counter');
    if (el) el.textContent = `Besucher gesamt: ${count}`;
  });
}

async function init() {
  loadTrendsCache();
  await Promise.all([loadMarket(), loadAuctions(), loadShards()]);
  setupAuctionFilters();
  setupProfileCardInteractions();
  updateVisitorCounter();
  await renderMarket();
  await renderAuctions();
  await renderShards();
  if (App.timerInterval) clearInterval(App.timerInterval);
  App.timerInterval = setInterval(updateAuctionTimers, 1000);
  showSection('auctions');
  checkDisclaimer();
}

function checkDisclaimer() {
  const hasSeenDisclaimer = sessionStorage.getItem('hasSeenDisclaimer');
  if (!hasSeenDisclaimer) {
    const modal = document.getElementById('disclaimerModal');
    if (modal) {
      modal.style.display = 'flex'; // Override inline display:none
      // Small delay to allow display:flex to apply before adding class for transition
      setTimeout(() => {
        modal.classList.add('show');
      }, 10);
      document.body.style.overflow = 'hidden'; // Prevent scrolling
    }
  } else {
    // If disclaimer was already seen, check if cookie consent needs to be shown
    checkCookieConsent();
  }
}


function closeDisclaimerModal() {
  const modal = document.getElementById('disclaimerModal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none'; // Hide after transition
      document.body.style.overflow = '';
      sessionStorage.setItem('hasSeenDisclaimer', 'true');

      // Trigger cookie consent check after disclaimer is closed
      checkCookieConsent();
    }, 300);
  }
}

function checkCookieConsent() {
  const cookieConsent = document.getElementById('cookieConsentModal');
  if (!sessionStorage.getItem('cookiesAccepted') && !sessionStorage.getItem('cookiesDeclined') && cookieConsent) {
    setTimeout(() => {
      cookieConsent.style.display = 'flex';
    }, 500); // Small delay before showing
  }
}

document.addEventListener('DOMContentLoaded', () => { animateHeadline(); init(); });
// --- PARTNERS CAROUSEL LOGIC ---

let partnerIndex = 0;
let partnerInterval;
const partnerDelay = 6000;

async function loadAds() {
  const track = document.getElementById('partnersTrack');
  const dotsContainer = document.getElementById('carouselDots');
  if (!track) return;

  try {
    const snapshot = await userDatabase.ref('ads').once('value');
    const adsData = snapshot.val() || {};
    App.ads = Object.entries(adsData).map(([id, data]) => ({ id, ...data }));

    if (App.ads.length === 0) {
      track.innerHTML = `
        <div class="partner-card">
          <div class="partner-image-container">
            <img src="https://cdn.boldomatic.com/content/post/6mmNFQ/Hier-konnte-Ihre-Werbung-stehen?size=800" alt="Werbung" class="partner-image">
          </div>
          <div class="partner-content">
            <h3 class="partner-name">Platz für deine Werbung</h3>
            <p class="partner-text">Melde dich beim Admin, um hier dein Projekt zu präsentieren!</p>
          </div>
        </div>`;
      if (dotsContainer) dotsContainer.innerHTML = '';
      return;
    }

    // Render Track
    track.innerHTML = App.ads.map(ad => {
      const discordBtn = ad.discordEnabled ? `
        <a href="${ad.discordLink}" target="_blank" class="ad-card-btn discord-btn" title="Discord" style="--hover-color: ${ad.discordColor || '#5865F2'}">
          <img src="https://www.svgrepo.com/show/447163/discord-outline.svg" alt="Discord">
        </a>
      ` : '';

      const customBtns = (ad.customButtons || []).map(btn => `
        <a href="${btn.link}" target="_blank" class="ad-card-btn custom-btn" title="Link besuchen" style="--hover-color: ${btn.color || 'var(--accent-color1)'}">
          <img src="${btn.icon}" alt="Icon" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
        </a>
      `).join('');

      return `
        <div class="partner-card">
          <div class="partner-image-container">
            <img src="${ad.imageUrl}" alt="${ad.title}" class="partner-image" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
          </div>
          <div class="partner-content">
            <h3 class="partner-name">${ad.title}</h3>
            <p class="partner-text">${ad.text}</p>
          </div>
          <div class="ad-card-buttons">
            ${discordBtn}
            ${customBtns}
          </div>
        </div>
      `;
    }).join('');

    // Render Dots
    if (dotsContainer) {
      dotsContainer.innerHTML = App.ads.map((_, idx) => `
        <span class="dot ${idx === 0 ? 'active' : ''}" onclick="currentPartner(${idx})"></span>
      `).join('');
    }

    // Adjust Track Width
    track.style.width = `${App.ads.length * 100}%`;
    document.querySelectorAll('.partner-card').forEach(card => {
      card.style.flex = `0 0 ${100 / App.ads.length}%`;
    });

    partnerIndex = 0;
    updateCarouselUI();
    startPartnersAutoScroll();

  } catch (error) {
    console.error("Error loading ads:", error);
  }
}

function initPartnersCarousel() {
  startPartnersAutoScroll();
}

function startPartnersAutoScroll() {
  stopPartnersAutoScroll();
  if (App.ads.length <= 1) return;
  partnerInterval = setInterval(() => {
    moveCarousel(1, true);
  }, partnerDelay);
}

function stopPartnersAutoScroll() {
  if (partnerInterval) {
    clearInterval(partnerInterval);
    partnerInterval = null;
  }
}

function moveCarousel(n, isAuto = false) {
  const slides = document.querySelectorAll('.partner-card');
  if (slides.length === 0) return;

  partnerIndex += n;

  if (partnerIndex >= slides.length) partnerIndex = 0;
  if (partnerIndex < 0) partnerIndex = slides.length - 1;

  updateCarouselUI();

  if (!isAuto) startPartnersAutoScroll();
}

function currentPartner(n) {
  partnerIndex = n;
  updateCarouselUI();
  startPartnersAutoScroll();
}

function updateCarouselUI() {
  const track = document.getElementById('partnersTrack');
  const dots = document.querySelectorAll('.dot');
  if (!track || App.ads.length === 0) return;

  track.style.transform = `translateX(-${partnerIndex * (100 / App.ads.length)}%)`;

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === partnerIndex);
  });
}

// --- ADS MANAGEMENT LOGIC ---

async function renderAdsSettings() {
  const container = document.getElementById('adsManagementList');
  const addBtn = document.getElementById('addAdBtn');
  if (!container) return;

  const user = firebase.auth().currentUser;
  if (!user) return;

  addBtn.style.display = App.isAdmin ? 'flex' : 'none';
  container.innerHTML = '<div class="content-loader"><span class="loading-spinner"></span><span>Lade deine Tafeln...</span></div>';

  let myAds = [];
  if (App.isAdmin) {
    myAds = App.ads;
  } else {
    myAds = App.ads.filter(ad => ad.ownerUid === user.uid);
  }

  if (myAds.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding: 2rem;">Du hast aktuell keine zugewiesenen Werbe-Tafeln.</p>';
    return;
  }

  container.innerHTML = myAds.map(ad => `
    <div class="ad-manage-card">
      <img src="${ad.imageUrl}" class="ad-manage-img" onerror="this.src='https://mcdf.wiki.gg/images/Barrier.png?ff8ff1'">
      <div class="ad-manage-info">
        <div class="ad-manage-title">${ad.title}</div>
        <div class="ad-manage-owner">${ad.ownerUid ? 'Besitzer: ' + ad.ownerUid : 'Kein Besitzer'}</div>
      </div>
      <div class="ad-manage-actions">
        <button class="ad-action-btn" onclick="openAdForm('${ad.id}')" title="Bearbeiten">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"></path></svg>
        </button>
        ${App.isAdmin ? `
          <button class="ad-action-btn delete" onclick="deleteAd('${ad.id}')" title="Löschen">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function openAdForm(adId = null) {
  const form = document.getElementById('adEditForm');
  const list = document.getElementById('adsManagementList');
  const title = document.getElementById('adFormTitle');
  const adminFields = document.getElementById('adminAdFields');

  document.getElementById('editAdId').value = adId || '';
  adminFields.style.display = App.isAdmin ? 'block' : 'none';

  if (adId) {
    const ad = App.ads.find(a => a.id === adId);
    if (ad) {
      title.textContent = 'Tafel bearbeiten';
      document.getElementById('adImageUrl').value = ad.imageUrl;
      document.getElementById('adTitle').value = ad.title;
      document.getElementById('adDescription').value = ad.text;
      document.getElementById('adOwnerUid').value = ad.ownerUid || '';
      document.getElementById('adDiscordEnabled').checked = ad.discordEnabled || false;
      document.getElementById('adDiscordLink').value = ad.discordLink || '';
      document.getElementById('adDiscordColor').value = ad.discordColor || '#5865F2';
      App.tempCustomButtons = JSON.parse(JSON.stringify(ad.customButtons || []));
    }
  } else {
    title.textContent = 'Neue Tafel hinzufügen';
    document.getElementById('adImageUrl').value = '';
    document.getElementById('adTitle').value = '';
    document.getElementById('adDescription').value = '';
    document.getElementById('adOwnerUid').value = '';
    document.getElementById('adDiscordEnabled').checked = false;
    document.getElementById('adDiscordLink').value = '';
    document.getElementById('adDiscordColor').value = '#5865F2';
    App.tempCustomButtons = [];
  }
  renderCustomButtonInputs();

  list.style.display = 'none';
  form.style.display = 'block';
}

function closeAdForm() {
  document.getElementById('adEditForm').style.display = 'none';
  document.getElementById('adsManagementList').style.display = 'flex';
}

async function handleAdSubmit() {
  const adId = document.getElementById('editAdId').value;
  const imageUrl = document.getElementById('adImageUrl').value;
  const title = document.getElementById('adTitle').value;
  const text = document.getElementById('adDescription').value;
  const ownerUid = document.getElementById('adOwnerUid').value;

  const discordEnabled = document.getElementById('adDiscordEnabled').checked;
  const discordLink = document.getElementById('adDiscordLink').value;
  const discordColor = document.getElementById('adDiscordColor').value;
  const customButtons = App.tempCustomButtons.filter(b => b.icon && b.link);

  if (!imageUrl || !title || !text) {
    showConfirmModal('Hinweis', 'Bitte fülle alle Pflichtfelder aus.', 'Verstanden', false);
    return;
  }

  const adData = {
    imageUrl,
    title,
    text,
    discordEnabled,
    discordLink,
    discordColor,
    customButtons
  };

  if (App.isAdmin) {
    adData.ownerUid = ownerUid;
  } else {
    const existing = App.ads.find(a => a.id === adId);
    if (existing) {
      adData.ownerUid = existing.ownerUid;
    } else {
      // If creating new ad as partner, assign self as owner
      const currentUser = firebase.auth().currentUser;
      if (currentUser) adData.ownerUid = currentUser.uid;
    }
  }

  try {
    const ref = userDatabase.ref('ads');
    if (adId) {
      await ref.child(adId).update(adData);
    } else {
      await ref.push(adData);
    }

    // Role assignment logic
    if (ownerUid && App.isAdmin) {
      await userDatabase.ref(`users/${ownerUid}/isPartner`).set(true);
    }

    closeAdForm();
    await loadAds();
    renderAdsSettings();
  } catch (e) {
    console.error("Error saving ad:", e);
    showConfirmModal('Fehler', 'Fehler beim Speichern.', 'Ok', false);
  }
}

async function deleteAd(adId) {
  const confirmed = await showConfirmModal('Löschen?', 'Möchtest du diese Werbe-Tafel wirklich löschen?');
  if (!confirmed) return;
  try {
    await userDatabase.ref(`ads/${adId}`).remove();
    await loadAds();
    renderAdsSettings();
  } catch (e) {
    console.error("Error deleting ad:", e);
  }
}

// Pause/Resume on hover
document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('.partners-carousel');
  if (carousel) {
    carousel.addEventListener('mouseenter', stopPartnersAutoScroll);
    carousel.addEventListener('mouseleave', () => {
      const aboutSec = document.getElementById('about');
      if (aboutSec && aboutSec.classList.contains('active')) {
        startPartnersAutoScroll();
      }
    });
  }
});


function renderCustomButtonInputs() {
  const container = document.getElementById('customButtonsContainer');
  if (!container) return;

  container.innerHTML = App.tempCustomButtons.map((btn, idx) => `
    <div class="custom-button-input-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center;">
      <input type="text" placeholder="Icon" value="${btn.icon}" oninput="updateCustomButton(${idx}, 'icon', this.value)" style="flex: 1.5;">
      <input type="text" placeholder="Link" value="${btn.link}" oninput="updateCustomButton(${idx}, 'link', this.value)" style="flex: 2;">
      <input type="color" value="${btn.color || '#00C9FF'}" oninput="updateCustomButton(${idx}, 'color', this.value)" style="width: 40px; height: 38px; padding: 2px; cursor: pointer; border: 1px solid var(--border); border-radius: 8px;" title="Hover Farbe">
      <button class="ad-action-btn delete" onclick="removeCustomButtonInput(${idx})" title="Löschen" style="height: 38px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>
  `).join('');

  if (App.tempCustomButtons.length === 0) {
    container.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-secondary); text-align: center;">Noch keine zusätzlichen Buttons hinzugefügt.</p>';
  }
}

function addCustomButtonInput() {
  if (App.tempCustomButtons.length >= 5) {
    showConfirmModal('Limit erreicht', 'Maximal 5 zusätzliche Buttons erlaubt.', 'Verstanden', false);
    return;
  }
  App.tempCustomButtons.push({ icon: '', link: '', color: '#00C9FF' });
  renderCustomButtonInputs();
}

function removeCustomButtonInput(idx) {
  App.tempCustomButtons.splice(idx, 1);
  renderCustomButtonInputs();
}

function updateCustomButton(idx, field, value) {
  App.tempCustomButtons[idx][field] = value;
}

// --- MINECRAFT VERIFICATION LOGIC ---

let minecraftVerificationInterval = null;
let minecraftVerificationStartTime = null;

function generateVerificationCode() {
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${randomSuffix}`;
}

function prepareMinecraftVerification() {
  const ign = document.getElementById('minecraft-ign-input').value.trim();
  if (!ign) {
    showConfirmModal('Eingabe fehlt', 'Bitte gib einen Minecraft-Namen ein.', 'OK', false);
    return;
  }

  const code = generateVerificationCode();
  const codeValueEl = document.getElementById('minecraft-generated-code');
  const codeInstructionEl = document.getElementById('instruction-code');

  if (codeValueEl) codeValueEl.textContent = code;
  if (codeInstructionEl) codeInstructionEl.textContent = code;

  const ignInput = document.getElementById('minecraft-ign-input');
  const generateBtn = document.getElementById('generate-code-btn');
  const verificationStep = document.getElementById('minecraft-verification-step');

  if (ignInput) ignInput.disabled = true;
  if (generateBtn) generateBtn.style.display = 'none';
  if (verificationStep) verificationStep.style.display = 'block';
}

function copyVerificationCode() {
  const code = document.getElementById('minecraft-generated-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showConfirmModal('Kopiert', 'Code wurde in die Zwischenablage kopiert!', 'OK', false);
  });
}

async function startMinecraftVerification() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  const ignInput = document.getElementById('minecraft-ign-input').value.trim();
  const code = document.getElementById('minecraft-generated-code').textContent;

  const startBtn = document.getElementById('start-verification-btn');
  const spinner = document.getElementById('verification-spinner-container');

  if (startBtn) startBtn.style.display = 'none';
  if (spinner) spinner.style.display = 'block';

  minecraftVerificationStartTime = Date.now();
  minecraftVerificationInterval = setInterval(() => checkMinecraftAuction(user, ignInput, code), 30000); // Check every 30s

  // Initial check
  checkMinecraftAuction(user, ignInput, code);
}

async function checkMinecraftAuction(user, ignInput, code) {
  const now = Date.now();
  const elapsed = now - minecraftVerificationStartTime;
  const maxTime = 10 * 60 * 1000; // 10 minutes

  if (elapsed > maxTime) {
    stopMinecraftVerification();
    showConfirmModal('Zeit abgelaufen', 'Die Verifizierung ist zeitlich abgelaufen. Bitte versuche es erneut.', 'OK', false);
    return;
  }

  const remainingMinutes = Math.ceil((maxTime - elapsed) / 60000);
  const timerText = document.getElementById('verification-timer-text');
  if (timerText) timerText.textContent = `Suche im Auktionshaus... (Noch ca. ${remainingMinutes} Min.)`;

  try {
    const response = await fetch("https://api.opsucht.net/auctions/active");
    const auctions = await response.json();

    const match = auctions.find(a => a.item.displayName === code);

    if (match) {
      const sellerUuid = match.seller;
      const sellerName = await uuidToUsername(sellerUuid);

      // Normalize names: remove dots and lowercase
      const normalizedInput = ignInput.toLowerCase().replace(/\./g, '');
      const normalizedSeller = sellerName.toLowerCase().replace(/\./g, '');

      if (normalizedInput === normalizedSeller) {
        // SUCCESS!
        stopMinecraftVerification();
        await finalizeMinecraftVerification(user, sellerName, sellerUuid, code);
      }
    }
  } catch (e) {
    console.error("Error during AH verification check:", e);
  }
}

function stopMinecraftVerification() {
  if (minecraftVerificationInterval) {
    clearInterval(minecraftVerificationInterval);
    minecraftVerificationInterval = null;
  }
  const startBtn = document.getElementById('start-verification-btn');
  const spinner = document.getElementById('verification-spinner-container');
  const timerText = document.getElementById('verification-timer-text');

  if (startBtn) startBtn.style.display = 'inline-block';
  if (spinner) spinner.style.display = 'none';
  if (timerText) timerText.textContent = "";
}

async function finalizeMinecraftVerification(user, mcName, mcUuid, code) {
  const verificationData = {
    minecraftName: mcName,
    minecraftUuid: mcUuid,
    verificationCode: code,
    verifiedAt: firebase.database.ServerValue.TIMESTAMP,
    isVerified: true
  };

  try {
    await firebase.database().ref(`users/${user.uid}/minecraftVerification`).set(verificationData);
    showConfirmModal('Erfolg!', `Dein Account ist jetzt erfolgreich mit ${mcName} verknüpft.`, 'Super!', false);
    loadMinecraftVerificationStatus();
  } catch (e) {
    console.error("Error saving verification data:", e);
    showConfirmModal('Fehler', 'Fehler beim Speichern der Verifizierung. Bitte versuche es später erneut.', 'Verstanden', false);
  }
}

async function handleUserCodeSearch() {
  if (!App.isAdmin) return;

  const emailInput = document.getElementById('searchUserEmail').value.trim();
  const resultDiv = document.getElementById('userCodeResult');
  
  if (!emailInput) {
    resultDiv.innerHTML = '<span style="color: #ef4444;">Bitte eine E-Mail-Adresse eingeben.</span>';
    return;
  }

  resultDiv.innerHTML = '<span class="loading-spinner" style="width: 20px; height: 20px; border-width: 2px;"></span> Suche...';

  try {
    const usersSnapshot = await firebase.database().ref('users').once('value');
    const usersData = usersSnapshot.val() || {};
    
    let foundUid = null;

    for (const [uid, userData] of Object.entries(usersData)) {
      if (userData.email && userData.email.toLowerCase() === emailInput.toLowerCase()) {
        foundUid = uid;
        break;
      }
    }

    if (foundUid) {
      resultDiv.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 1.2rem; font-weight: bold; color: var(--text-primary); margin-bottom: 0.5rem; user-select: all;">${foundUid}</div>
          <div style="font-size: 0.9rem; color: #34D399;">Nutzer gefunden</div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = '<span style="color: #ef4444;">Nutzer mit dieser E-Mail nicht gefunden.</span>';
    }
  } catch (error) {
    console.error("Error searching user UID:", error);
    resultDiv.innerHTML = '<span style="color: #ef4444;">Fehler bei der Suche (Mangelnde Berechtigung?).</span>';
  }
}

async function loadMinecraftVerificationStatus() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  try {
    const snapshot = await firebase.database().ref(`users/${user.uid}/minecraftVerification`).once('value');
    const data = snapshot.val();

    const unverifiedUI = document.getElementById('minecraft-unverified-ui');
    const verifiedUI = document.getElementById('minecraft-verified-ui');
    const instructionHeader = document.getElementById('minecraft-instruction-header');
    const profileTab = document.getElementById('tab-profile');

    if (data && data.isVerified) {
      if (unverifiedUI) unverifiedUI.style.display = 'none';
      if (verifiedUI) verifiedUI.style.display = 'block';
      if (instructionHeader) instructionHeader.style.display = 'none';
      const nameEl = document.getElementById('verified-mc-name');
      const uuidEl = document.getElementById('verified-mc-uuid');
      if (nameEl) nameEl.textContent = data.minecraftName;
      if (uuidEl) uuidEl.textContent = data.minecraftUuid;
    } else {
      if (unverifiedUI) unverifiedUI.style.display = 'block';
      if (verifiedUI) verifiedUI.style.display = 'none';
      if (instructionHeader) instructionHeader.style.display = 'block';
      // Reset fields
      const ignInput = document.getElementById('minecraft-ign-input');
      const generateBtn = document.getElementById('generate-code-btn');
      const verificationStep = document.getElementById('minecraft-verification-step');
      if (ignInput) ignInput.disabled = false;
      if (generateBtn) generateBtn.style.display = 'block';
      if (verificationStep) verificationStep.style.display = 'none';
    }
  } catch (e) {
    console.error("Error loading verification status:", e);
  }
}

async function unlinkMinecraftAccount() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  const confirmUnlink = await showConfirmModal(
    'Verknüpfung aufheben?',
    'Möchtest du die Verknüpfung mit deinem Minecraft-Account wirklich aufheben?'
  );

  if (confirmUnlink) {
    try {
      await firebase.database().ref(`users/${user.uid}/minecraftVerification`).remove();
      loadMinecraftVerificationStatus();
    } catch (e) {
      console.error("Error unlinking account:", e);
    }
  }
}

async function syncAuctionGrid(grid, auctions, mcUuid, historyType = null) {
  const existingIds = new Set();
  const auctionPromises = auctions.map(async (a) => {
    let personalData = null;
    // Check if it's an active auction (active auctions have seller property and item object)
    if (a.bids && mcUuid in a.bids && a.seller !== mcUuid) {
      const myBid = a.bids[mcUuid];
      let outbidBy = null;
      if (a.highestBidder !== mcUuid) {
        outbidBy = await uuidToUsername(a.highestBidder);
      }
      personalData = { myBid, outbidBy };
    }
    return { auction: a, personalData };
  });

  const auctionDetails = await Promise.all(auctionPromises);

  auctionDetails.forEach(({ auction, personalData }) => {
    const id = auction.id || (auction.seller + "_" + (auction.item.material || "") + "_" + auction.endTime);
    existingIds.add(id);
    let existingCard = grid.querySelector(`[data-auction-id="${id}"]`);
    const newCard = createAuctionCard(auction, historyType, personalData);

    if (existingCard) {
      // Update only if innerHTML changed to avoid unnecessary DOM thrashing
      if (existingCard.innerHTML !== newCard.innerHTML) {
        existingCard.innerHTML = newCard.innerHTML;
      }
    } else {
      grid.appendChild(newCard);
    }
  });

  // Remove old cards
  Array.from(grid.querySelectorAll('.card')).forEach(card => {
    if (!existingIds.has(card.dataset.auctionId)) {
      card.remove();
    }
  });
}

async function renderMyProfile(silent = false) {
  const container = document.getElementById("profileContainer");
  if (!container) return;

  const user = firebase.auth().currentUser;
  if (!user) {
    renderProfileLock('auth');
    return;
  }

  if (!silent) {
    const activityGrid = document.getElementById('profile-activity-container');
    if (activityGrid) {
      activityGrid.innerHTML = '<div class="content-loader"><span class="loading-spinner"></span><span>Lade Daten...</span></div>';
    } else {
      container.innerHTML = '<div class="content-loader"><span class="loading-spinner"></span><span>Lade Profil-Daten...</span></div>';
    }
  }

  try {
    const snapshot = await firebase.database().ref(`users/${user.uid}/minecraftVerification`).once('value');
    const data = snapshot.val();

    if (!data || !data.isVerified) {
      renderProfileLock('verify');
      return;
    }

    const mcUuid = data.minecraftUuid;
    const mcName = data.minecraftName;

    await loadAuctions();

    let totalEarned = 0, totalSpent = 0, auctionsSold = 0, auctionsWon = 0;
    if (App.playerStatsCache[mcUuid]) {
      const stats = App.playerStatsCache[mcUuid];
      totalEarned = stats.earned; totalSpent = stats.spent; auctionsSold = stats.sold; auctionsWon = stats.won;
    } else {
      for (const itemName in App.auctionHistory) {
        const sales = App.auctionHistory[itemName];
        if (Array.isArray(sales)) {
          for (const sale of sales) {
            if (sale.seller === mcUuid) { totalEarned += sale.currentBid || 0; auctionsSold++; }
            if (sale.highestBidder === mcUuid) { totalSpent += sale.currentBid || 0; auctionsWon++; }
          }
        }
      }
      App.playerStatsCache[mcUuid] = { earned: totalEarned, spent: totalSpent, sold: auctionsSold, won: auctionsWon };
    }

    // Ensure basic layout exists
    let activityGrid = document.getElementById('profile-activity-container');
    if (!activityGrid || !silent) {
      container.innerHTML = `
        <div style="position: relative; text-align: center; margin-bottom: 2rem;">
          <h2 style="font-size: 2.5rem; font-weight: 900; margin-bottom: 0.5rem; background: linear-gradient(45deg, var(--accent-color1), var(--accent-color2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${mcName}</h2>
          <p style="font-family: monospace; color: var(--text-secondary); opacity: 0.6;">${mcUuid}</p>
          <img src="https://i.postimg.cc/gJcp3qDP/Zahnrad.png" alt="Profil Einstellungen" onclick="openProfileSettingsModal()" 
               class="settings-icon profile-settings-icon" 
               style="position: absolute; top: 0; right: 0; width: 28px; height: 28px; cursor: pointer; filter: drop-shadow(0 0 8px var(--accent-glow)); transition: all 0.2s ease; opacity: 0.8;">
        </div>
        <div class="auction-info-box" style="margin-bottom: 2rem;">
          <div class="info-item"><strong>Erfolgreich verkauft</strong><span id="stat-sold">${auctionsSold}</span></div>
          <div class="info-item"><strong>Auktionen gewonnen</strong><span id="stat-won">${auctionsWon}</span></div>
          <div class="info-item"><strong>Gesamt eingenommen</strong><span id="stat-earned" class="sell">${totalEarned.toLocaleString('de-DE')}</span></div>
          <div class="info-item"><strong>Gesamt ausgegeben</strong><span id="stat-spent" class="buy">${totalSpent.toLocaleString('de-DE')}</span></div>
        </div>
        <div id="profile-filters" class="auction-filters" style="margin-bottom: 2rem; justify-content: center;"></div>
        <div id="profile-activity-container"></div>
      `;
      activityGrid = document.getElementById('profile-activity-container');
      renderProfileFilters();
    } else {
      // Just update stats numbers
      document.getElementById('stat-sold').textContent = auctionsSold;
      document.getElementById('stat-won').textContent = auctionsWon;
      document.getElementById('stat-earned').textContent = totalEarned.toLocaleString('de-DE');
      document.getElementById('stat-spent').textContent = totalSpent.toLocaleString('de-DE');
    }

    let newOutbids = [];

    // 1. Data Collection
    const activeBids = App.auctionsData.filter(a => a.bids && mcUuid in a.bids && a.seller !== mcUuid);
    const activeSales = App.auctionsData.filter(a => a.seller === mcUuid);
    const historySold = [], historyBought = [];
    for (const itemName in App.auctionHistory) {
      const sales = App.auctionHistory[itemName];
      if (Array.isArray(sales)) {
        sales.forEach(s => {
          const baseItem = s.item || {};
          const enrichedItem = {
            ...s,
            item: {
              ...baseItem,
              displayName: itemName,
              material: baseItem.material || itemName,
              amount: s.amount || baseItem.amount || 1
            }
          };
          if (s.seller === mcUuid) historySold.push(enrichedItem);
          if (s.highestBidder === mcUuid) historyBought.push(enrichedItem);
        });
      }
    }

    const reminders = App.auctionsData.filter(a => {
      const id = a.id || (a.seller + "_" + (a.item.material || "") + "_" + a.endTime).replace(/[.#$[\]]/g, '-');
      return !!App.userReminders[id];
    });

    // 2. Notification Logic (Outbids)
    for (const a of activeBids) {
      const auctionId = a.id || (a.seller + "_" + (a.item.material || "") + "_" + a.endTime);
      if (a.highestBidder !== mcUuid) {
        if (!App.lastKnownOutbids.has(auctionId)) {
          newOutbids.push(a);
          App.lastKnownOutbids.add(auctionId);
        }
      } else {
        App.lastKnownOutbids.delete(auctionId);
      }
    }

    if (newOutbids.length > 0 && App.settings.notifications.overbid && silent) {
      const audio = new Audio('overbid.ogg');
      audio.play().catch(e => console.log("Audio playback failed:", e));
      openAuctionChart(newOutbids[newOutbids.length - 1]);
    }

    // 3. Rendering based on Filter
    activityGrid.innerHTML = '';
    const filter = App.profileFilter;

    if (filter === 'Alles') {
      if (reminders.length > 0) await renderProfileSection('Erinnerungen', 'var(--accent-color2)', 'reminders', reminders, mcUuid);
      if (activeBids.length > 0) await renderProfileSection('Deine Gebote', 'var(--accent-glow)', 'active-bids', activeBids, mcUuid);
      if (activeSales.length > 0) await renderProfileSection('Deine aktiven Auktionen', 'var(--accent-color1)', 'active-sales', activeSales, mcUuid);
      if (historyBought.length > 0) await renderProfileSection('Ersteigerte Auktionen', '#2196F3', 'history-bought', historyBought.slice(-20).reverse(), mcUuid, 'bought');
      if (historySold.length > 0) await renderProfileSection('Verkaufte Auktionen', '#4CAF50', 'history-sold', historySold.slice(-20).reverse(), mcUuid, 'sold');
    } else {
      let data = [], title = '', color = '', type = null;
      switch (filter) {
        case 'Erinnerungen': data = reminders; title = 'Erinnerungen'; color = 'var(--accent-color2)'; break;
        case 'Gebote': data = activeBids; title = 'Aktive Gebote'; color = 'var(--accent-glow)'; break;
        case 'Auktionen': data = activeSales; title = 'Deine Auktionen'; color = 'var(--accent-color1)'; break;
        case 'Gekauft': data = historyBought.slice().reverse(); title = 'Gekaufte Items'; color = '#2196F3'; type = 'bought'; break;
        case 'Verkauft': data = historySold.slice().reverse(); title = 'Verkaufte Items'; color = '#4CAF50'; type = 'sold'; break;
      }
      if (data.length > 0) {
        await renderProfileSection(title, color, filter.toLowerCase(), data, mcUuid, type);
      }
    }

    if (activityGrid.children.length === 0) {
      let emptyMsg = "Keine Daten vorhanden";
      if (filter !== 'Alles') {
        const labels = {
          'Erinnerungen': 'Keine Erinnerungen gefunden',
          'Gebote': 'Keine aktiven Gebote gefunden',
          'Auktionen': 'Keine aktiven Auktionen gefunden',
          'Gekauft': 'Bisher keine Käufe getätigt',
          'Verkauft': 'Bisher keine Verkäufe getätigt'
        };
        emptyMsg = labels[filter] || `Keine Einträge für ${filter} gefunden`;
      }
      activityGrid.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 3rem; background: var(--surface-card); border-radius: 12px; margin-top: 2rem;">${emptyMsg}</p>`;
    }

    // Trigger animation after content is placed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        animateCardsWave(document.getElementById('profile'), silent);
      });
    });

  } catch (e) {
    console.error("Error loading profile stats:", e);
    if (!silent) container.innerHTML = '<p style="text-align:center; padding:2rem; color:#ff4444;">Fehler beim Laden der Profil-Daten.</p>';
  }
}

function renderProfileFilters() {
  const container = document.getElementById('profile-filters');
  if (!container) return;
  const filters = ["Alles", "Erinnerungen", "Gebote", "Gekauft", "Verkauft", "Auktionen"];
  container.innerHTML = filters.map(f => `
    <button class="${App.profileFilter === f ? 'active' : ''}" onclick="setProfileFilter('${f}')">${f}</button>
  `).join('');
}

function setProfileFilter(filter) {
  App.profileFilter = filter;
  renderProfileFilters(); // Update button active state immediately
  renderMyProfile(); // Re-render with loader
}

async function renderProfileSection(title, color, id, data, mcUuid, type = null) {
  const activityGrid = document.getElementById('profile-activity-container');
  const section = document.createElement('div');
  section.id = `profile-section-${id}`;
  section.innerHTML = `<h3 style="margin: 2rem 0 1rem; border-left: 4px solid ${color}; padding-left: 1rem;">${title}</h3><div class="grid"></div>`;
  activityGrid.appendChild(section);
  const grid = section.querySelector('.grid');
  await syncAuctionGrid(grid, data, mcUuid, type);
}

function openProfileSettingsModal() {
  const modal = document.getElementById("profileSettingsModal");
  if (modal) {
    modal.classList.add("show");
    document.body.classList.add('modal-open');
    if (document.getElementById('overbidNotificationToggle')) {
      document.getElementById('overbidNotificationToggle').checked = App.settings.notifications.overbid;
    }
    if (document.getElementById('emailNotificationToggle')) {
      document.getElementById('emailNotificationToggle').checked = App.settings.notifications.email;
    }
  }
}

function closeProfileSettingsModal() {
  const modal = document.getElementById("profileSettingsModal");
  if (modal) {
    modal.classList.remove("show");
    document.body.classList.remove('modal-open');
  }
}

async function toggleOverbidNotification(enabled) {
  App.settings.notifications.overbid = enabled;
  const user = firebase.auth().currentUser;
  if (user) {
    try {
      await firebase.database().ref('users/' + user.uid + '/settings/notifications').update({
        overbid: enabled
      });
    } catch (e) {
      console.error("Error saving notification settings:", e);
    }
  }
  // Sync UI toggles
  document.querySelectorAll('#overbidNotificationToggle, #accountOverbidToggle').forEach(t => t.checked = enabled);
}

function renderProfileLock(type) {
  const container = document.getElementById("profileContainer");
  if (!container) return;

  const content = `
    <div style="position: relative; border-radius: 24px; overflow: hidden; background: var(--surface-card); border: 1px solid var(--border);">
      <!-- Dummy Content behind Blur -->
      <div style="padding: 2.5rem; filter: blur(10px); opacity: 0.3; pointer-events: none; user-select: none;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="width: 80px; height: 80px; background: var(--border); border-radius: 50%; margin: 0 auto 1rem;"></div>
          <div style="width: 200px; height: 30px; background: var(--border); border-radius: 8px; margin: 0 auto 0.5rem;"></div>
          <div style="width: 150px; height: 20px; background: var(--border); border-radius: 6px; margin: 0 auto;"></div>
        </div>
        <div class="auction-info-box" style="margin-bottom: 2rem; opacity: 0.5;">
          <div class="info-item"><div style="width: 60px; height: 20px; background: var(--border); border-radius: 4px;"></div></div>
          <div class="info-item"><div style="width: 60px; height: 20px; background: var(--border); border-radius: 4px;"></div></div>
          <div class="info-item"><div style="width: 100px; height: 20px; background: var(--border); border-radius: 4px;"></div></div>
        </div>
        <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 1.5rem;">
          <div style="height: 300px; background: var(--border); border-radius: 12px;"></div>
          <div style="height: 300px; background: var(--border); border-radius: 12px;"></div>
          <div style="height: 300px; background: var(--border); border-radius: 12px;"></div>
        </div>
      </div>

      <!-- Actual Overlay -->
      <div class="lock-screen-overlay active">
        <svg xmlns="http://www.w3.org/2000/svg" class="lock-screen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h3 class="lock-screen-title">${type === 'auth' ? 'Anmeldung erforderlich' : 'Verifizierung erforderlich'}</h3>
        <p class="lock-screen-text">
          ${type === 'auth'
      ? 'Bitte melde dich an und verknüpfe deinen Minecraft Account, um dein Profil zu sehen.'
      : 'Bitte verknüpfe deinen Minecraft Account in den Einstellungen, um dein Profil zu sehen.'}
        </p>
        <button class="auth-submit-btn" style="width: auto; padding: 1rem 3rem;" 
                onclick="${type === 'auth' ? 'openAuthModal()' : 'openSettingsTab(\'minecraft\')'}">
          ${type === 'auth' ? 'Anmelden' : 'Jetzt verknüpfen'}
        </button>
      </div>
    </div>
  `;
  container.innerHTML = content;
}

function openSettingsTab(tabName) {
  openSettingsModal();
  switchSettingsTab(tabName);
}

// Initial Load of Custom Cursor from LocalStorage (to prevent flicker)
document.addEventListener('DOMContentLoaded', () => {
  const savedCustomCursor = localStorage.getItem('customCursor') === 'true';
  const savedCursorType = localStorage.getItem('cursorType') || 'dot';
  const savedCursorSize = localStorage.getItem('cursorSize') || 1.0;

  if (savedCustomCursor) {
    toggleCustomCursor(true);
    setCursorType(savedCursorType, false);
    setCursorSize(savedCursorSize, false);
  } else {
    // Ensure UI is hidden if disabled
    const typeContainer = document.getElementById('customCursorTypeContainer');
    if (typeContainer) typeContainer.style.display = 'none';
  }
});


// --- Cookie Consent Logic ---
// Initialization moved to checkCookieConsent() directly after disclaimer or during init if already seen

function toggleCookieDetails() {
  const shortText = document.getElementById('cookieShortText');
  const fullText = document.getElementById('cookieFullText');

  if (fullText.style.display === 'none' || fullText.style.display === '') {
    shortText.style.display = 'none';
    fullText.style.display = 'block';
  } else {
    shortText.style.display = 'block';
    fullText.style.display = 'none';
  }
}

function acceptCookies() {
  sessionStorage.setItem('cookiesAccepted', 'true');
  const cookieConsent = document.getElementById('cookieConsentModal');
  if (cookieConsent) {
    cookieConsent.style.animation = 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    setTimeout(() => {
      cookieConsent.style.display = 'none';
      cookieConsent.style.animation = ''; // reset
    }, 400);
  }
}

// --- DONATIONS LOGIC ---

async function loadDonations() {
  try {
    const donationsSnapshot = await userDatabase.ref('donations/list').once('value');
    const goalSnapshot = await userDatabase.ref('donations/goal').once('value');
    
    const donationsData = donationsSnapshot.val() || {};
    App.donations = Object.entries(donationsData).map(([id, data]) => ({ id, ...data }));
    App.donationGoal = goalSnapshot.val() || 0;
    
    // Sort donations by amount descending
    App.donations.sort((a, b) => b.amount - a.amount);
  } catch (error) {
    console.error("Error loading donations:", error);
  }
}

function renderDonations() {
  const leaderboardList = document.getElementById('donationLeaderboardList');
  const goalContainer = document.getElementById('donationGoalContainer');
  if (!leaderboardList || !goalContainer) return;

  loadDonations().then(() => {
    // Render Goal / Progress Bar
    const totalDonated = App.donations.reduce((sum, d) => sum + d.amount, 0);
    const percentage = App.donationGoal > 0 ? Math.min((totalDonated / App.donationGoal) * 100, 100) : 0;
    
    // Calculate color based on percentage (0% = red, 50% = yellow, 100% = green)
    let hue = (percentage * 1.2); // 0 -> 120 (Red to Green)
    const color = `hsl(${hue}, 80%, 50%)`;

    goalContainer.innerHTML = `
      <div class="donation-goal-wrapper">
        <div class="donation-goal-info">
          <span>Ziel: ${totalDonated.toLocaleString('de-DE', { maximumFractionDigits: 0 })}€ / ${App.donationGoal.toLocaleString('de-DE', { maximumFractionDigits: 0 })}€</span>
          <span>${percentage.toFixed(1)}%</span>
        </div>
        <div class="donation-progress-bg">
          <div class="donation-progress-bar" style="width: ${percentage}%; background: ${color}; box-shadow: 0 0 15px ${color}88;"></div>
        </div>
      </div>
    `;

    // Render Leaderboard
    if (App.donations.length === 0) {
      leaderboardList.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding: 2rem;">Noch keine Spenden vorhanden. Sei der Erste!</p>';
      return;
    }

    const visibleDonations = App.donations.slice(0, App.donationDisplayCount);
    leaderboardList.innerHTML = visibleDonations.map((donation, index) => {
      let rankClass = '';
      if (index === 0) rankClass = 'rank-gold';
      else if (index === 1) rankClass = 'rank-silver';
      else if (index === 2) rankClass = 'rank-bronze';
      else rankClass = 'rank-white';

      return `
        <div class="donation-item ${rankClass}">
          <div class="donation-rank">#${index + 1}</div>
          <div class="donation-name">${donation.name}</div>
          <div class="donation-amount">${donation.amount.toLocaleString('de-DE', { maximumFractionDigits: 0 })}€</div>
        </div>
      `;
    }).join('');

    // Load More Button
    if (App.donations.length > App.donationDisplayCount) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.className = "auth-submit-btn";
      loadMoreBtn.style.width = "auto";
      loadMoreBtn.style.margin = "2rem auto 0 auto";
      loadMoreBtn.style.display = "block";
      loadMoreBtn.style.padding = "0.75rem 2rem";
      loadMoreBtn.innerHTML = `Mehr anzeigen (${App.donations.length - App.donationDisplayCount} weitere)`;
      loadMoreBtn.onclick = () => {
        App.donationDisplayCount += 10;
        renderDonations();
      };
      leaderboardList.appendChild(loadMoreBtn);
    }
  });
}

async function renderDonationSettings() {
  const container = document.getElementById('donationsManagementList');
  const goalInput = document.getElementById('donationGoalAmount');
  if (!container) return;

  await loadDonations();
  if (goalInput) goalInput.value = App.donationGoal;

  if (App.donations.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); padding: 2rem;">Noch keine Spenden eingetragen.</p>';
    return;
  }

  container.innerHTML = App.donations.map(donation => `
    <div class="ad-manage-card">
      <div class="ad-manage-info">
        <div class="ad-manage-title">${donation.name}</div>
        <div class="ad-manage-owner">${donation.amount.toLocaleString('de-DE', { maximumFractionDigits: 0 })}€</div>
      </div>
      <div class="ad-manage-actions">
        <button class="ad-action-btn delete" onclick="deleteDonation('${donation.id}')" title="Löschen">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
  `).join('');
}

async function handleAddDonation() {
  const nameInput = document.getElementById('donationPlayerName');
  const amountInput = document.getElementById('donationAmount');
  const name = nameInput.value.trim();
  const amount = parseFloat(amountInput.value);

  if (!name || isNaN(amount) || amount <= 0) {
    showConfirmModal('Ungültige Eingabe', 'Bitte gib einen gültigen Namen und Betrag ein.', 'Ok', false);
    return;
  }

  try {
    // Check if player already donated
    const existing = App.donations.find(d => d.name.toLowerCase() === name.toLowerCase());
    const ref = userDatabase.ref('donations/list');

    if (existing) {
      const newAmount = existing.amount + amount;
      await ref.child(existing.id).update({ amount: newAmount });
    } else {
      await ref.push({ name, amount });
    }

    nameInput.value = '';
    amountInput.value = '';
    showConfirmModal('Erfolg', 'Spende wurde erfolgreich gespeichert.', 'Super', false);
    renderDonationSettings();
  } catch (error) {
    console.error("Error adding donation:", error);
    showConfirmModal('Fehler', 'Fehler beim Speichern der Spende.', 'Ok', false);
  }
}

async function handleSetDonationGoal() {
  const goalInput = document.getElementById('donationGoalAmount');
  const amount = parseFloat(goalInput.value);

  if (isNaN(amount) || amount < 0) {
    showConfirmModal('Ungültige Eingabe', 'Bitte gib einen gültigen Zielbetrag ein.', 'Ok', false);
    return;
  }

  try {
    await userDatabase.ref('donations/goal').set(amount);
    showConfirmModal('Erfolg', 'Spenden-Ziel wurde aktualisiert.', 'Ok', false);
    renderDonationSettings();
  } catch (error) {
    console.error("Error setting goal:", error);
    showConfirmModal('Fehler', 'Fehler beim Speichern des Ziels.', 'Ok', false);
  }
}

async function deleteDonation(id) {
  const confirmed = await showConfirmModal('Löschen?', 'Möchtest du diesen Spendeneintrag wirklich löschen?');
  if (!confirmed) return;

  try {
    await userDatabase.ref(`donations/list/${id}`).remove();
    renderDonationSettings();
  } catch (error) {
    console.error("Error deleting donation:", error);
  }
}
function declineCookies() {
  sessionStorage.setItem('cookiesDeclined', 'true');
  const cookieConsent = document.getElementById('cookieConsentModal');
  if (cookieConsent) {
    cookieConsent.style.animation = 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    setTimeout(() => {
      cookieConsent.style.display = 'none';
      cookieConsent.style.animation = ''; // reset
    }, 400);
  }
}
