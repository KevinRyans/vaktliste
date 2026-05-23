'use strict';

/* =====================================================================
   Vaktliste – Quality Hotel Tønsberg

   Henter vaktlisten direkte fra Google Sheets via Google-pålogging.
   Tilgang styres av delingen på selve arket: får brukeren lese arket
   med sin egen Google-konto, slipper hen inn. Ingen egen kodeliste.

   ADMIN: fyll inn CONFIG under. Se README for steg-for-steg.
   ===================================================================== */

(() => {
  // ===================================================================
  // ADMIN-KONFIGURASJON
  // ===================================================================
  const CONFIG = {
    // OAuth Client ID fra Google Cloud (type: Web application).
    // Eksempel: '1234567890-abcdefg.apps.googleusercontent.com'
    GOOGLE_CLIENT_ID: '1087119477001-la8tomucms7a5khvrd4pn7nb46jjpfap.apps.googleusercontent.com',

    // ID-en til Google-arket. Står i URL-en mellom /d/ og /edit.
    SPREADSHEET_ID: '1DG_437aHLnDJb7q22J9Bmp_31UoAx4-4yeMXoLvYlHw',

    // Hvor ofte appen sjekker arket for endringer (millisekunder).
    POLL_INTERVAL: 30 * 1000,

    // Valgfritt: URL til Quality-logoen (PNG/SVG). Tom = tekst-logo.
    LOGO_URL: '',
  };

  const SCOPES = 'openid email profile https://www.googleapis.com/auth/spreadsheets.readonly';
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

  const storageKeys = {
    user: 'vaktliste:user',
    data: 'vaktliste:data',
    selection: 'vaktliste:selection',
    futureOnly: 'vaktliste:showFutureOnly',
  };

  // ===================================================================
  // Konstantar for dato-/tidstolking
  // ===================================================================
  const MONTH_KEYWORDS = {
    januar: 1, jan: 1, january: 1,
    feb: 2, februar: 2, february: 2,
    mar: 3, mars: 3, march: 3,
    apr: 4, april: 4,
    mai: 5, may: 5,
    jun: 6, juni: 6, june: 6,
    jul: 7, juli: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    okt: 10, oktober: 10, oct: 10, october: 10,
    nov: 11, november: 11,
    des: 12, dec: 12, desember: 12, december: 12,
  };

  const MONTH_LABELS = [
    '', 'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ];

  const today = new Date();

  // ===================================================================
  // App-tilstand
  // ===================================================================
  const state = {
    data: [],
    dataHash: '',
    selectedDepartment: '',
    selectedPerson: '',
    showFutureOnly: false,
    loading: false,
    activeMonth: today.getMonth() + 1,
    activeYear: today.getFullYear(),
    sourceName: '',
    lastUpdated: null,
    user: null,
    pollTimer: null,
    refreshTimeout: null,
    refreshStartedAt: 0,
    // Roster ("hvem er på jobb")
    rosterMap: new Map(),
    rosterDates: [],
    rosterDepartments: [],
    selectedRosterDate: '',
    selectedRosterDepartment: '',
  };

  // Google-token
  let tokenClient = null;
  let accessToken = '';
  let tokenExpiry = 0;
  let pendingToken = null;

  const els = {
    authScreen: document.getElementById('authScreen'),
    deniedEmail: document.getElementById('deniedEmail'),
    authErrorMessage: document.getElementById('authErrorMessage'),
    signInButton: document.getElementById('signInButton'),
    retryButton: document.getElementById('retryButton'),
    switchAccountButton: document.getElementById('switchAccountButton'),
    errorRetryButton: document.getElementById('errorRetryButton'),
    app: document.querySelector('.app'),
    statusBar: document.getElementById('statusBar'),
    statusText: document.querySelector('#statusBar .statusbar__text'),
    refreshButtons: Array.from(document.querySelectorAll('[data-role="refresh"]')),
    userButton: document.getElementById('userButton'),
    userPopover: document.getElementById('userPopover'),
    userAvatar: document.getElementById('userAvatar'),
    userInitial: document.getElementById('userInitial'),
    userName: document.getElementById('userName'),
    userEmail: document.getElementById('userEmail'),
    signOutButton: document.getElementById('signOutButton'),
    department: document.getElementById('departmentSelect'),
    person: document.getElementById('personSelect'),
    futureToggle: document.getElementById('futureToggle'),
    info: document.getElementById('selectionInfo'),
    shiftList: document.getElementById('shiftList'),
    rosterDepartmentSelect: document.getElementById('rosterDepartmentSelect'),
    rosterDateSelect: document.getElementById('rosterDateSelect'),
    rosterList: document.getElementById('rosterList'),
    brandLogos: Array.from(document.querySelectorAll('[data-brand-logo]')),
  };

  const dateFormatter = new Intl.DateTimeFormat('no-NO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const dayRangeFormatter = new Intl.DateTimeFormat('no-NO', {
    day: 'numeric', month: 'short',
  });

  boot();

  // ===================================================================
  // Oppstart
  // ===================================================================
  function boot() {
    applyBranding();
    hydratePreferences();
    wireUi();

    if (!isConfigured()) {
      setAuthState('config');
      return;
    }

    const storedUser = safeParse(window.localStorage.getItem(storageKeys.user));
    if (storedUser?.email) state.user = storedUser;

    setAuthState('loading');
    initGoogle()
      .then(() => {
        if (state.user) {
          attemptSilentSignIn();
        } else {
          setAuthState('signin');
        }
      })
      .catch(() => showAuthError('Klarte ikke å laste Google-innlogging. Sjekk nettet og prøv igjen.'));
  }

  function isConfigured() {
    const id = CONFIG.GOOGLE_CLIENT_ID || '';
    return id.endsWith('.apps.googleusercontent.com') && !id.startsWith('DIN_');
  }

  function applyBranding() {
    if (!CONFIG.LOGO_URL) return;
    els.brandLogos.forEach((node) => {
      node.style.backgroundImage = `url("${CONFIG.LOGO_URL}")`;
      node.classList.add('has-logo');
    });
  }

  function hydratePreferences() {
    const storedFuture = window.localStorage.getItem(storageKeys.futureOnly);
    if (storedFuture !== null) {
      state.showFutureOnly = storedFuture === 'true';
      if (els.futureToggle) els.futureToggle.checked = state.showFutureOnly;
    }
    const storedSelection = safeParse(window.localStorage.getItem(storageKeys.selection));
    if (storedSelection) {
      state.selectedDepartment = storedSelection.department || '';
      state.selectedPerson = storedSelection.person || '';
    }
  }

  function wireUi() {
    els.signInButton?.addEventListener('click', () => signIn());
    els.switchAccountButton?.addEventListener('click', () => signIn('select_account', { allowSilent: false }));
    els.retryButton?.addEventListener('click', () => retryAfterDenied());
    els.errorRetryButton?.addEventListener('click', () => boot());

    els.department?.addEventListener('change', handleDepartmentChange);
    els.person?.addEventListener('change', handlePersonChange);
    els.futureToggle?.addEventListener('change', handleFutureToggle);
    els.rosterDateSelect?.addEventListener('change', handleRosterDateChange);
    els.rosterDepartmentSelect?.addEventListener('change', handleRosterDepartmentChange);

    els.refreshButtons.forEach((button) =>
      button.addEventListener('click', () => loadSchedule({ force: true })),
    );

    els.userButton?.addEventListener('click', toggleUserMenu);
    els.signOutButton?.addEventListener('click', signOut);
    document.addEventListener('click', (event) => {
      if (!els.userPopover || els.userPopover.hidden) return;
      if (els.userButton?.contains(event.target) || els.userPopover.contains(event.target)) return;
      closeUserMenu();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (state.user && !els.app.hidden) loadSchedule({ silent: true });
    });
    window.addEventListener('beforeunload', stopPolling);
  }

  // ===================================================================
  // Google Identity Services
  // ===================================================================
  function initGoogle() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function waitForGis() {
        if (window.google?.accounts?.oauth2) {
          tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse,
            error_callback: handleTokenError,
          });
          resolve();
        } else if (Date.now() - start > 10000) {
          reject(new Error('Google-biblioteket ble ikke lastet.'));
        } else {
          setTimeout(waitForGis, 80);
        }
      })();
    });
  }

  // Be om et access-token. prompt = '' gir stille fornying uten popup.
  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('Innlogging ikke klar.'));
        return;
      }
      pendingToken = { resolve, reject };
      try {
        tokenClient.requestAccessToken({ prompt });
      } catch (error) {
        pendingToken = null;
        reject(error);
      }
    });
  }

  function handleTokenResponse(response) {
    const pending = pendingToken;
    pendingToken = null;
    if (!pending) return;
    if (response?.error) {
      pending.reject(response);
      return;
    }
    accessToken = response.access_token;
    tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000;
    pending.resolve(response);
  }

  function handleTokenError(error) {
    const pending = pendingToken;
    pendingToken = null;
    if (pending) pending.reject(error);
  }

  async function getValidToken() {
    if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
    await requestToken(''); // stille fornying
    return accessToken;
  }

  async function signIn(prompt = 'consent', { allowSilent = true } = {}) {
    setAuthState('loading');
    closeUserMenu();
    try {
      // Prøv stille først (returnerende bruker), ellers vis Google-dialog.
      // Ved «bytt konto» hopper vi over det stille forsøket så brukeren
      // faktisk får velge en annen konto.
      if (allowSilent) {
        try {
          await requestToken('');
        } catch (_) {
          await requestToken(prompt);
        }
      } else {
        accessToken = '';
        await requestToken(prompt);
      }
      await onAuthenticated();
    } catch (error) {
      console.warn('Innlogging avbrutt', error);
      setAuthState('signin');
    }
  }

  async function attemptSilentSignIn() {
    setAuthState('loading');
    try {
      await getValidToken();
      await onAuthenticated({ fresh: false });
    } catch (error) {
      setAuthState('signin');
    }
  }

  async function onAuthenticated() {
    await fetchUserInfo();
    renderUser();

    // Vis lagret plan umiddelbart for rask oppstart, oppdater i bakgrunnen.
    const hadCache = loadCachedDataset();
    if (hadCache) revealApp();

    const ok = await loadSchedule({ initial: !hadCache });
    if (ok) {
      revealApp();
      startPolling();
    } else if (hadCache) {
      // Hadde cache, men nyeste forsøk feilet (f.eks. tilgang trukket).
      stopPolling();
    }
  }

  async function fetchUserInfo() {
    const token = await getValidToken();
    try {
      const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const info = await res.json();
        state.user = {
          email: info.email || state.user?.email || '',
          name: info.name || info.given_name || '',
          picture: info.picture || '',
        };
        window.localStorage.setItem(storageKeys.user, JSON.stringify(state.user));
      }
    } catch (error) {
      console.warn('Klarte ikke å hente brukerinfo', error);
    }
  }

  function retryAfterDenied() {
    setAuthState('loading');
    onAuthenticated().catch(() => setAuthState('signin'));
  }

  function signOut() {
    closeUserMenu();
    stopPolling();
    if (accessToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) { /* noop */ }
    }
    accessToken = '';
    tokenExpiry = 0;
    state.user = null;
    state.data = [];
    state.dataHash = '';
    window.localStorage.removeItem(storageKeys.user);
    window.localStorage.removeItem(storageKeys.data);
    els.app.hidden = true;
    setAuthState('signin');
  }

  function requireSignIn() {
    stopPolling();
    els.app.hidden = true;
    setAuthState('signin');
  }

  function handleNoAccess() {
    stopPolling();
    els.app.hidden = true;
    if (els.deniedEmail) els.deniedEmail.textContent = state.user?.email || 'kontoen din';
    setAuthState('denied');
  }

  // ===================================================================
  // Tilstand for auth-skjerm
  // ===================================================================
  function setAuthState(name) {
    if (!els.authScreen) return;
    els.authScreen.hidden = false;
    els.authScreen.dataset.state = name;
  }

  function showAuthError(message) {
    if (els.authErrorMessage) els.authErrorMessage.textContent = message;
    setAuthState('error');
  }

  function revealApp() {
    if (els.authScreen) els.authScreen.hidden = true;
    if (els.app) els.app.hidden = false;
  }

  // ===================================================================
  // Henting fra Google Sheets
  // ===================================================================
  async function sheetsApi(path) {
    const token = await getValidToken();
    let res = await fetch(`${SHEETS_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      accessToken = ''; // tving fornying
      const fresh = await getValidToken();
      res = await fetch(`${SHEETS_BASE}${path}`, { headers: { Authorization: `Bearer ${fresh}` } });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const error = new Error(body?.error?.message || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async function fetchSchedule() {
    const meta = await sheetsApi(
      `/${CONFIG.SPREADSHEET_ID}?fields=properties.title,sheets(properties(title,hidden,sheetType))`,
    );
    const title = meta.properties?.title || '';
    applyTitleMetadata(title);

    const tabs = (meta.sheets || [])
      .map((sheet) => sheet.properties)
      .filter((p) => p && !p.hidden && p.sheetType !== 'OBJECT')
      .map((p) => p.title);

    if (!tabs.length) return { title, sheets: [] };

    const ranges = tabs
      .map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`)
      .join('&');
    const values = await sheetsApi(
      `/${CONFIG.SPREADSHEET_ID}/values:batchGet?${ranges}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    );

    const sheets = (values.valueRanges || []).map((vr, index) => ({
      title: tabs[index],
      matrix: vr.values || [],
    }));
    return { title, sheets };
  }

  async function loadSchedule({ initial = false, silent = false, force = false } = {}) {
    if (state.loading) return false;
    state.loading = true;
    if (!silent) setRefreshState('loading');
    setStatus('loading', initial ? 'Henter vaktliste …' : 'Sjekker for endringer …');

    try {
      const result = await fetchSchedule();
      const dataset = extractSchedule(result.sheets);
      if (!dataset.length) {
        throw new Error('Fant ingen vakter i arket. Kontroller at strukturen er uendret.');
      }

      const hash = quickHash(JSON.stringify(dataset));
      const changed = force || hash !== state.dataHash;
      state.dataHash = hash;
      state.data = dataset;
      state.lastUpdated = Date.now();

      if (changed) {
        buildRosterData();
        enableSelectors();
        applySelectionFallbacks();
        renderSelections();
        persistData();
      }

      setStatus('live', `Oppdatert ${formatClock(state.lastUpdated)}${planSuffix()}`);
      if (!silent) setRefreshState('success');
      return true;
    } catch (error) {
      if (error.status === 403) { handleNoAccess(); return false; }
      if (error.status === 401) { requireSignIn(); return false; }
      console.error(error);
      if (initial && !state.data.length) {
        showAuthError(error.message || 'Kunne ikke hente vaktlisten.');
      } else {
        setStatus('error', 'Kunne ikke oppdatere. Prøver igjen automatisk.');
      }
      if (!silent) setRefreshState('idle');
      return false;
    } finally {
      state.loading = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      if (document.hidden || state.loading) return;
      loadSchedule({ silent: true });
    }, CONFIG.POLL_INTERVAL);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ===================================================================
  // Cache (rask oppstart)
  // ===================================================================
  function loadCachedDataset() {
    const cached = safeParse(window.localStorage.getItem(storageKeys.data));
    if (!cached?.data?.length || cached.meta?.spreadsheetId !== CONFIG.SPREADSHEET_ID) {
      return false;
    }
    state.data = cached.data;
    state.dataHash = cached.hash || '';
    state.activeMonth = cached.meta.month || state.activeMonth;
    state.activeYear = cached.meta.year || state.activeYear;
    state.sourceName = cached.meta.sourceName || '';
    state.lastUpdated = cached.createdAt || null;

    buildRosterData();
    enableSelectors();
    applySelectionFallbacks();
    renderSelections();
    setStatus('loading', 'Viser lagret plan – oppdaterer …');
    return true;
  }

  function persistData() {
    window.localStorage.setItem(
      storageKeys.data,
      JSON.stringify({
        createdAt: state.lastUpdated,
        hash: state.dataHash,
        data: state.data,
        meta: {
          spreadsheetId: CONFIG.SPREADSHEET_ID,
          month: state.activeMonth,
          year: state.activeYear,
          sourceName: state.sourceName,
        },
      }),
    );
  }

  // ===================================================================
  // Tolking av arket (matrise -> dataset)
  // ===================================================================
  function extractSchedule(sheets) {
    const dataset = [];

    sheets.forEach(({ title, matrix }) => {
      if (!Array.isArray(matrix) || !matrix.length) return;

      const dateRowIndex = matrix.findIndex((row) => {
        const label = cleanString(row?.[0]);
        return label && label.toLowerCase().startsWith('dato');
      });
      if (dateRowIndex === -1) return;

      const dateRow = matrix[dateRowIndex] ?? [];
      const columnDates = [];
      for (let c = 1; c < dateRow.length; c += 1) {
        columnDates[c] = buildDateFromHeader(dateRow[c]);
      }

      for (let r = dateRowIndex + 1; r < matrix.length; r += 1) {
        const row = matrix[r];
        const person = cleanString(row?.[0]);
        if (!person) continue;

        const shifts = [];
        for (let c = 1; c < columnDates.length; c += 1) {
          const date = columnDates[c];
          if (!date) continue;
          const detail = parseShiftDetail(row?.[c]);
          if (!detail) continue;
          shifts.push({ date, detail: detail.value, kind: detail.kind });
        }

        if (shifts.length) {
          dataset.push({
            department: (title || '').trim() || 'Uten navn',
            person,
            shifts,
          });
        }
      }
    });

    return dataset;
  }

  function buildDateFromHeader(value) {
    if (value === undefined || value === null || value === '') return null;
    const str = String(value).trim();

    // Full dato i header (f.eks. "01.11.2025" eller "1/11")
    const dmy = str.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
    if (dmy) {
      const day = Number.parseInt(dmy[1], 10);
      const month = Number.parseInt(dmy[2], 10);
      let year = dmy[3] ? Number.parseInt(dmy[3], 10) : state.activeYear;
      if (year < 100) year += 2000;
      const iso = toISODateComponents(year, month, day);
      if (iso) return iso;
    }

    // Bare dagnummer (1, 2, 3 …) – kombineres med måned/år fra arknavnet.
    const day = typeof value === 'number'
      ? Math.round(value)
      : Number.parseInt(str.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    if (!state.activeMonth || !state.activeYear) return null;
    return toISODateComponents(state.activeYear, state.activeMonth, day);
  }

  function parseShiftDetail(value) {
    if (value === undefined || value === null) return null;

    if (typeof value === 'number') {
      if (value > 0 && value < 1) {
        const totalMinutes = Math.round(value * 24 * 60);
        return { kind: 'time', value: formatTime(Math.floor(totalMinutes / 60), totalMinutes % 60) };
      }
      const formatted = formatDigitsAsTime(String(Math.round(value)));
      return formatted ? { kind: 'time', value: formatted } : null;
    }

    if (typeof value === 'string') {
      const trimmed = cleanString(value);
      if (!trimmed) return null;
      const normalized = trimmed.replace(',', '.');
      const colonMatch = normalized.match(/(\d{1,2})[:.](\d{2})/);
      if (colonMatch) {
        return {
          kind: 'time',
          value: formatTime(Number.parseInt(colonMatch[1], 10), Number.parseInt(colonMatch[2], 10)),
        };
      }
      const digits = normalized.replace(/[^\d]/g, '');
      if (/^\d{3,4}$/.test(digits)) {
        const formatted = formatDigitsAsTime(digits);
        if (formatted) return { kind: 'time', value: formatted };
      }
      return { kind: 'text', value: trimmed };
    }

    return null;
  }

  function formatDigitsAsTime(digits) {
    if (!digits) return null;
    if (digits.length <= 2) return formatTime(Number.parseInt(digits, 10), 0);
    if (digits.length === 3) {
      return formatTime(Number.parseInt(digits.slice(0, 1), 10), Number.parseInt(digits.slice(1), 10));
    }
    return formatTime(Number.parseInt(digits.slice(0, 2), 10), Number.parseInt(digits.slice(2, 4), 10));
  }

  function formatTime(hours, minutes) {
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function applyTitleMetadata(title) {
    const clean = cleanString(title);
    if (clean) state.sourceName = clean.replace(/\.(xlsx|xlsm?|csv)$/i, '');
    const info = extractMonthYearFromText(clean);
    if (info.month) state.activeMonth = info.month;
    if (info.year) state.activeYear = info.year;
  }

  // ===================================================================
  // Brukervalg: avdeling / navn / fremtid
  // ===================================================================
  function handleDepartmentChange(event) {
    state.selectedDepartment = event.target.value;
    persistSelection();
    populatePersonSelect();
    renderShifts();
  }

  function handlePersonChange(event) {
    state.selectedPerson = event.target.value;
    persistSelection();
    renderShifts();
  }

  function handleFutureToggle(event) {
    state.showFutureOnly = event.target.checked;
    window.localStorage.setItem(storageKeys.futureOnly, String(state.showFutureOnly));
    renderShifts();
    renderRosterControls();
    renderRosterList();
  }

  function renderSelections() {
    populateDepartmentSelect();
    populatePersonSelect();
    renderShifts();
    renderRosterControls();
    renderRosterList();
  }

  function populateDepartmentSelect() {
    const select = els.department;
    if (!select) return;
    select.innerHTML = '';
    const placeholder = createOption('', 'Velg avdeling');
    select.appendChild(placeholder);

    const departments = Array.from(new Set(state.data.map((entry) => entry.department)))
      .sort((a, b) => a.localeCompare(b, 'no'));
    departments.forEach((department) => {
      const option = createOption(department, department);
      if (department === state.selectedDepartment) option.selected = true;
      select.appendChild(option);
    });
  }

  function populatePersonSelect() {
    const select = els.person;
    if (!select) return;
    select.innerHTML = '';
    select.appendChild(createOption('', state.selectedDepartment ? 'Velg navn' : 'Velg avdeling først'));

    if (!state.selectedDepartment) {
      state.selectedPerson = '';
      persistSelection();
      return;
    }

    const names = state.data
      .filter((entry) => entry.department === state.selectedDepartment)
      .map((entry) => entry.person)
      .sort((a, b) => a.localeCompare(b, 'no'));
    names.forEach((name) => {
      const option = createOption(name, name);
      if (name === state.selectedPerson) option.selected = true;
      select.appendChild(option);
    });
  }

  function renderShifts() {
    const container = els.shiftList;
    if (!container) return;
    container.innerHTML = '';

    if (!state.selectedDepartment || !state.selectedPerson) {
      container.classList.add('empty');
      container.innerHTML = '<p class="placeholder">Velg avdeling og navn for å se vaktene.</p>';
      if (els.info) els.info.textContent = 'Velg hvem du vil se vakter for.';
      return;
    }

    const entry = state.data.find(
      (item) => item.department === state.selectedDepartment && item.person === state.selectedPerson,
    );
    if (!entry) {
      container.classList.add('empty');
      container.innerHTML = '<p class="placeholder">Fant ikke vakter for valget ditt.</p>';
      return;
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const list = entry.shifts
      .map((shift) => ({ ...shift, dateObj: new Date(`${shift.date}T00:00:00`) }))
      .sort((a, b) => a.dateObj - b.dateObj)
      .filter((shift) => !state.showFutureOnly || shift.dateObj >= todayDate);

    if (!list.length) {
      container.classList.add('empty');
      container.innerHTML = '<p class="placeholder">Ingen vakter i den valgte perioden.</p>';
      if (els.info) els.info.textContent = `Ingen kommende vakter for ${state.selectedPerson}.`;
      return;
    }

    container.classList.remove('empty');
    const fragment = document.createDocumentFragment();
    let lastWeekKey = '';

    list.forEach((shift) => {
      const weekKey = `${getISOWeek(shift.dateObj)}-${shift.dateObj.getUTCFullYear()}`;
      if (weekKey !== lastWeekKey) {
        lastWeekKey = weekKey;
        const weekLabel = document.createElement('div');
        weekLabel.className = 'week-label';
        weekLabel.textContent = buildWeekLabel(shift.dateObj);
        fragment.appendChild(weekLabel);
      }

      const article = document.createElement('article');
      article.className = 'shift-item';
      if (isSameDay(shift.dateObj, todayDate)) article.classList.add('today');

      const date = document.createElement('div');
      date.className = 'shift-item__date';
      date.textContent = capitalize(dateFormatter.format(shift.dateObj));

      const time = document.createElement('div');
      time.className = 'shift-item__time';
      const detailValue = shift.detail ?? '';
      const isTextDetail = shift.kind === 'text' || (detailValue && !/^\d{2}:\d{2}$/.test(detailValue));
      time.textContent = isTextDetail ? detailValue : `Oppstart ${detailValue}`;

      const meta = document.createElement('div');
      meta.className = 'shift-item__meta';
      meta.textContent = state.selectedDepartment;

      article.append(date, time, meta);
      fragment.appendChild(article);
    });

    container.appendChild(fragment);
    const scope = state.showFutureOnly ? ' (kun kommende)' : '';
    if (els.info) els.info.textContent = `Viser ${list.length} vakter for ${state.selectedPerson}${scope}.`;
  }

  // ===================================================================
  // "Hvem er på jobb"
  // ===================================================================
  function buildRosterData() {
    const previousDate = state.selectedRosterDate;
    const previousDepartment = state.selectedRosterDepartment;
    state.rosterMap = new Map();
    state.rosterDates = [];
    state.rosterDepartments = [];
    state.selectedRosterDate = '';
    state.selectedRosterDepartment = '';
    if (!state.data?.length) return;

    const departmentSet = new Set();
    state.data.forEach((entry) => {
      if (entry.department) departmentSet.add(entry.department);
      entry.shifts.forEach((shift) => {
        if (!shift?.date) return;
        const detailValue = shift.detail ?? '';
        const kind = shift.kind || (/^\d{2}:\d{2}$/.test(detailValue) ? 'time' : 'text');
        const existing = state.rosterMap.get(shift.date) || [];
        existing.push({ person: entry.person, department: entry.department, detail: detailValue, kind });
        state.rosterMap.set(shift.date, existing);
      });
    });

    state.rosterDepartments = Array.from(departmentSet).sort((a, b) => a.localeCompare(b, 'no'));
    state.rosterMap.forEach((rows) => rows.sort(compareRosterEntries));
    state.rosterDates = Array.from(state.rosterMap.keys()).sort();

    if (previousDepartment && state.rosterDepartments.includes(previousDepartment)) {
      state.selectedRosterDepartment = previousDepartment;
    }
    state.selectedRosterDate =
      previousDate && state.rosterDates.includes(previousDate) ? previousDate : pickDefaultRosterDate();
  }

  function compareRosterEntries(a, b) {
    const byTime = rosterTimeValue(a).localeCompare(rosterTimeValue(b));
    if (byTime !== 0) return byTime;
    const byDept = a.department.localeCompare(b.department, 'no');
    if (byDept !== 0) return byDept;
    return a.person.localeCompare(b.person, 'no');
  }

  function rosterTimeValue(entry) {
    if (!entry?.detail) return '99:99';
    if (entry.kind === 'time' || /^\d{2}:\d{2}$/.test(entry.detail)) return entry.detail;
    return '99:99';
  }

  function pickDefaultRosterDate() {
    if (!state.rosterDates?.length) return '';
    const todayISO = new Date().toISOString().slice(0, 10);
    return state.rosterDates.find((date) => date >= todayISO) || state.rosterDates[0];
  }

  function renderRosterControls() {
    const dateSelect = els.rosterDateSelect;
    const deptSelect = els.rosterDepartmentSelect;
    if (!dateSelect) return;

    if (deptSelect) {
      deptSelect.innerHTML = '';
      deptSelect.appendChild(createOption('', 'Alle avdelinger'));
      const departments = state.rosterDepartments || [];
      if (!departments.includes(state.selectedRosterDepartment)) state.selectedRosterDepartment = '';
      departments.forEach((dept) => {
        const option = createOption(dept, dept);
        if (dept === state.selectedRosterDepartment) option.selected = true;
        deptSelect.appendChild(option);
      });
      deptSelect.disabled = departments.length === 0;
    }

    dateSelect.innerHTML = '';
    const dates = state.rosterDates || [];
    if (!dates.length) {
      dateSelect.disabled = true;
      dateSelect.appendChild(createOption('', state.data.length ? 'Ingen datoer' : 'Ingen datoer tilgjengelig'));
      state.selectedRosterDate = '';
      return;
    }
    dateSelect.disabled = false;
    if (!dates.includes(state.selectedRosterDate)) state.selectedRosterDate = dates[0];
    dates.forEach((date) => {
      const option = createOption(date, capitalize(dateFormatter.format(new Date(`${date}T00:00:00`))));
      if (date === state.selectedRosterDate) option.selected = true;
      dateSelect.appendChild(option);
    });
  }

  function renderRosterList() {
    const container = els.rosterList;
    if (!container) return;
    container.innerHTML = '';

    if (!state.selectedRosterDate) {
      container.classList.add('empty');
      container.innerHTML = '<p class="placeholder">Ingen dato valgt ennå.</p>';
      return;
    }

    const entries = state.rosterMap.get(state.selectedRosterDate) || [];
    const filtered = entries.filter(
      (entry) => !state.selectedRosterDepartment || entry.department === state.selectedRosterDepartment,
    );

    if (!filtered.length) {
      container.classList.add('empty');
      container.innerHTML = '<p class="placeholder">Ingen registrerte vakter for valgene dine.</p>';
      return;
    }

    container.classList.remove('empty');
    const fragment = document.createDocumentFragment();
    filtered.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'roster-item';

      const left = document.createElement('div');
      const name = document.createElement('p');
      name.className = 'roster-item__name';
      name.textContent = entry.person;
      const dept = document.createElement('p');
      dept.className = 'roster-item__department';
      dept.textContent = entry.department;
      left.append(name, dept);

      const detail = document.createElement('span');
      detail.className = 'roster-item__detail';
      detail.textContent = entry.detail || '—';

      item.append(left, detail);
      fragment.appendChild(item);
    });
    container.appendChild(fragment);
  }

  function handleRosterDateChange(event) {
    state.selectedRosterDate = event.target.value;
    renderRosterList();
  }

  function handleRosterDepartmentChange(event) {
    state.selectedRosterDepartment = event.target.value;
    renderRosterControls();
    renderRosterList();
  }

  // ===================================================================
  // Selektorer + brukermeny + status + refresh-knapp
  // ===================================================================
  function enableSelectors() {
    if (els.department) els.department.disabled = false;
    if (els.person) els.person.disabled = false;
  }

  function applySelectionFallbacks() {
    if (!state.data.length) {
      state.selectedDepartment = '';
      state.selectedPerson = '';
      persistSelection();
      return;
    }
    if (!state.data.some((entry) => entry.department === state.selectedDepartment)) {
      state.selectedDepartment = '';
      state.selectedPerson = '';
    }
    if (
      state.selectedDepartment &&
      !state.data.some(
        (entry) => entry.department === state.selectedDepartment && entry.person === state.selectedPerson,
      )
    ) {
      state.selectedPerson = '';
    }
    persistSelection();
  }

  function persistSelection() {
    window.localStorage.setItem(
      storageKeys.selection,
      JSON.stringify({ department: state.selectedDepartment, person: state.selectedPerson }),
    );
  }

  function renderUser() {
    if (!state.user) return;
    const { email = '', name = '', picture = '' } = state.user;
    if (els.userName) els.userName.textContent = name || email;
    if (els.userEmail) els.userEmail.textContent = email;
    const initial = (name || email || '?').trim().charAt(0).toUpperCase();
    if (els.userInitial) els.userInitial.textContent = initial;
    if (picture && els.userAvatar && els.userButton) {
      els.userAvatar.src = picture;
      els.userAvatar.onload = () => els.userButton.classList.add('has-avatar');
      els.userAvatar.onerror = () => els.userButton.classList.remove('has-avatar');
    }
  }

  function toggleUserMenu() {
    if (!els.userPopover) return;
    const open = els.userPopover.hidden;
    els.userPopover.hidden = !open;
    els.userButton?.setAttribute('aria-expanded', String(open));
  }

  function closeUserMenu() {
    if (!els.userPopover) return;
    els.userPopover.hidden = true;
    els.userButton?.setAttribute('aria-expanded', 'false');
  }

  function setStatus(stateName, text) {
    if (els.statusBar) els.statusBar.dataset.state = stateName;
    if (els.statusText) els.statusText.textContent = text;
  }

  function setRefreshState(mode) {
    if (!els.refreshButtons.length) return;
    window.clearTimeout(state.refreshTimeout);

    if (mode === 'loading') state.refreshStartedAt = Date.now();

    // La spinneren snurre litt før vi viser haken.
    if (mode === 'success') {
      const elapsed = Date.now() - state.refreshStartedAt;
      const minimumSpin = 600;
      if (elapsed < minimumSpin) {
        state.refreshTimeout = window.setTimeout(() => setRefreshState('success'), minimumSpin - elapsed);
        return;
      }
    }

    els.refreshButtons.forEach((button) => {
      button.classList.remove('is-loading', 'is-success');
      button.disabled = mode === 'loading';
      button.setAttribute('aria-busy', mode === 'loading' ? 'true' : 'false');
      if (mode === 'loading') button.classList.add('is-loading');
      if (mode === 'success') button.classList.add('is-success');
    });

    if (mode === 'success') {
      state.refreshTimeout = window.setTimeout(() => setRefreshState('idle'), 1400);
    }
  }

  // ===================================================================
  // Hjelpere
  // ===================================================================
  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function buildWeekLabel(date) {
    const weekNumber = getISOWeek(date);
    const monday = startOfISOWeek(date);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return `Uke ${weekNumber} • ${dayRangeFormatter.format(monday)} – ${dayRangeFormatter.format(sunday)}`;
  }

  function getISOWeek(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((target - firstThursday) / 86400000 - 3) / 7);
  }

  function startOfISOWeek(date) {
    const clone = new Date(date);
    const day = clone.getDay() || 7;
    if (day !== 1) clone.setDate(clone.getDate() - day + 1);
    clone.setHours(0, 0, 0, 0);
    return clone;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function planSuffix() {
    if (!state.activeMonth || !state.activeYear) return '';
    const label = MONTH_LABELS[state.activeMonth] || `måned ${state.activeMonth}`;
    return ` • ${label} ${state.activeYear}`;
  }

  function formatClock(timestamp) {
    return new Intl.DateTimeFormat('no-NO', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
  }

  function extractMonthYearFromText(text) {
    if (!text) return {};
    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let month;
    for (const [keyword, value] of Object.entries(MONTH_KEYWORDS)) {
      if (normalized.includes(keyword)) { month = value; break; }
    }
    const yearMatch = normalized.match(/\b(20\d{2}|\d{2})\b/);
    let year = yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;
    if (year && year < 100) year += 2000;
    return { month, year };
  }

  function toISODateComponents(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  }

  function cleanString(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function quickHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
})();
