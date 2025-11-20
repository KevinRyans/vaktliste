'use strict';

(() => {
  const ACCESS_CODES = ['3116', '120701'];
  const ACCESS_KEY = 'vaktliste:accessGranted';
  /**
   * Admin: oppdater lenken under hver måned. Gi filen et navn som
   * "Vaktliste november 25.xlsx" slik at appen kan tolke datoene.
   */
  const SHEET_SHARE_LINK =
    'https://docs.google.com/spreadsheets/d/1wS6kF6qygOIvgu-pPOGQdUCGjUyYwL2EkH9CH6xtMgU/edit?usp=sharing';

  const storageKeys = {
    data: 'vaktliste:data',
    selection: 'vaktliste:selection',
    futureOnly: 'vaktliste:showFutureOnly',
  };

  const MONTH_KEYWORDS = {
    januar: 1,
    jan: 1,
    january: 1,
    feb: 2,
    februar: 2,
    february: 2,
    mar: 3,
    mars: 3,
    march: 3,
    apr: 4,
    april: 4,
    mai: 5,
    may: 5,
    jun: 6,
    juni: 6,
    june: 6,
    jul: 7,
    juli: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    okt: 10,
    oktober: 10,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    desember: 12,
    december: 12,
  };

  const MONTH_LABELS = [
    '',
    'januar',
    'februar',
    'mars',
    'april',
    'mai',
    'juni',
    'juli',
    'august',
    'september',
    'oktober',
    'november',
    'desember',
  ];

  const today = new Date();
  const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

  const state = {
    data: [],
    selectedDepartment: '',
    selectedPerson: '',
    showFutureOnly: false,
    loading: false,
    activeMonth: today.getMonth() + 1,
    activeYear: today.getFullYear(),
    sourceName: '',
    timers: [],
    started: false,
    lastUpdated: null,
    exportUrl: '',
    rosterMap: new Map(),
    rosterDates: [],
    selectedRosterDate: '',
    rosterDepartments: [],
    selectedRosterDepartment: '',
  };

  const els = {
    gate: document.getElementById('accessGate'),
    accessInput: document.getElementById('accessCode'),
    accessButton: document.getElementById('accessEnter'),
    accessError: document.getElementById('accessError'),
    department: document.getElementById('departmentSelect'),
    person: document.getElementById('personSelect'),
    info: document.getElementById('selectionInfo'),
    futureToggle: document.getElementById('futureToggle'),
    shiftList: document.getElementById('shiftList'),
    refreshButtons: Array.from(document.querySelectorAll('[data-role="refresh"]')),
    rosterDateSelect: document.getElementById('rosterDateSelect'),
    rosterDepartmentSelect: document.getElementById('rosterDepartmentSelect'),
    rosterList: document.getElementById('rosterList'),
  };

  const dateFormatter = new Intl.DateTimeFormat('no-NO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const dayRangeFormatter = new Intl.DateTimeFormat('no-NO', {
    day: 'numeric',
    month: 'short',
  });

  setupAccessGate();

  function setupAccessGate() {
    if (!els.gate) {
      startApp();
      return;
    }

    const handleSubmit = () => {
      const code = els.accessInput?.value.trim();
      if (isValidCode(code)) {
        window.localStorage.setItem(ACCESS_KEY, 'true');
        els.accessError?.classList.add('hidden');
        els.gate?.classList.add('hidden');
        startApp();
      } else {
        els.accessError?.classList.remove('hidden');
      }
    };

    els.accessButton?.addEventListener('click', handleSubmit);
    els.accessInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        handleSubmit();
      }
    });
    els.accessInput?.addEventListener('input', () => {
      els.accessError?.classList.add('hidden');
    });

    if (window.localStorage.getItem(ACCESS_KEY) === 'true') {
      els.gate?.classList.add('hidden');
      startApp();
    } else {
      els.gate?.classList.remove('hidden');
      queueMicrotask(() => els.accessInput?.focus());
    }
  }

  function startApp() {
    if (state.started) return;
    state.started = true;
    init();
  }

  function isValidCode(code) {
    if (!code) return false;
    return ACCESS_CODES.some((token) => token.toLowerCase() === code.toLowerCase());
  }

  function init() {
    attachListeners();
    hydratePreferences();
    loadCachedDataset();
    refreshFromSheet(true);
    scheduleAutoRefresh();
  }

  function attachListeners() {
    els.department?.addEventListener('change', handleDepartmentChange);
    els.person?.addEventListener('change', handlePersonChange);
    els.futureToggle?.addEventListener('change', handleFutureToggle);
    els.refreshButtons.forEach((button) => button.addEventListener('click', () => refreshFromSheet(false)));
    els.rosterDateSelect?.addEventListener('change', handleRosterDateChange);
    els.rosterDepartmentSelect?.addEventListener('change', handleRosterDepartmentChange);
  }

  function hydratePreferences() {
    const storedFuture = window.localStorage.getItem(storageKeys.futureOnly);
    if (storedFuture !== null) {
      state.showFutureOnly = storedFuture === 'true';
      if (els.futureToggle) {
        els.futureToggle.checked = state.showFutureOnly;
      }
    }

    const storedSelection = safeParse(window.localStorage.getItem(storageKeys.selection));
    if (storedSelection) {
      state.selectedDepartment = storedSelection.department || '';
      state.selectedPerson = storedSelection.person || '';
    }
  }

  function loadCachedDataset() {
    const cachedData = safeParse(window.localStorage.getItem(storageKeys.data));
    const exportUrl = getExportUrl();

    const cachedSourceLink = cachedData?.meta?.sourceLink;
    const cacheMatchesSource = exportUrl && cachedSourceLink && cachedSourceLink === exportUrl;

    if (cachedData?.data?.length && cacheMatchesSource) {
      state.data = cachedData.data;
      if (cachedData.meta) {
        state.activeMonth = cachedData.meta.month || state.activeMonth;
        state.activeYear = cachedData.meta.year || state.activeYear;
        state.sourceName = cachedData.meta.sourceName || state.sourceName;
        state.lastUpdated = cachedData.createdAt || null;
      }
      buildRosterData();
      enableSelectors();
      updateSummary(state.data, cachedData.createdAt);
      applySelectionFallbacks();
      renderSelections();
      setStatus(
        cachedData.createdAt
          ? `Viser lagret plan fra ${formatTimestamp(cachedData.createdAt)}. Trykk "Oppdater nå" for ny versjon.`
          : 'Viser lagret plan. Trykk "Oppdater nå" for å hente siste versjon.',
      );
    } else {
      state.data = [];
      state.lastUpdated = null;
      buildRosterData();
      disableSelectors();
      setStatus('Ingen lagret plan ennå. Forsøker å hente fra Google Sheets ...');
      renderRosterControls();
      renderRosterList();
    }
  }

  async function refreshFromSheet(isInitial) {
    if (state.loading) return;
    const exportUrl = getExportUrl();
    if (!exportUrl) {
      setStatus('ADMIN: Oppdater SHEET_SHARE_LINK i script.js med en gyldig delingslenke.');
      return;
    }

    state.exportUrl = exportUrl;

    state.loading = true;
    setStatus(isInitial ? 'Henter vaktplan fra Google Sheets ...' : 'Oppdaterer vaktplan ...');

    try {
      const response = await fetch(exportUrl, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('Klarte ikke å laste ned fra Google Sheets. Sjekk delingsinnstillingene.');
      }
      applyFileMetadata(response);
      const buffer = await response.arrayBuffer();
      await ingestWorkbook(buffer);
      persistData();
      const label = formatPlanLabel();
      setStatus(
        `Vaktplanen er oppdatert${label ? ` (${label})` : ''}${state.sourceName ? ` – ${state.sourceName}` : ''}.`,
      );
    } catch (error) {
      handleError(error);
    } finally {
      state.loading = false;
    }
  }

  function scheduleAutoRefresh() {
    state.timers.forEach((timer) => clearInterval(timer));
    state.timers = [];
    const timerId = setInterval(() => refreshFromSheet(false), AUTO_REFRESH_INTERVAL);
    state.timers.push(timerId);
  }

  function applyFileMetadata(response) {
    const disposition =
      response.headers.get('Content-Disposition') || response.headers.get('content-disposition');
    if (!disposition) return;

    let fileName = '';
    const utfMatch = disposition.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    const plainMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
    if (utfMatch) {
      try {
        fileName = decodeURIComponent(utfMatch[1]);
      } catch (error) {
        fileName = utfMatch[1];
      }
    } else if (plainMatch) {
      fileName = plainMatch[1];
    }
    fileName = fileName?.trim();
    if (fileName) {
      state.sourceName = fileName.replace(/\.(xlsx|xlsm?|csv)$/i, '');
    }

    const info = extractMonthYearFromText(fileName);
    if (info.month) {
      state.activeMonth = info.month;
    }
    if (info.year) {
      state.activeYear = info.year;
    }
  }

  async function ingestWorkbook(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const dataset = extractSchedule(workbook);
    if (!dataset.length) {
      throw new Error('Fant ingen vakter i arket. Kontroller at strukturen er uendret.');
    }
    state.data = dataset;
    state.lastUpdated = Date.now();
    buildRosterData();
    updateSummary(dataset, Date.now());
    enableSelectors();
    applySelectionFallbacks();
    renderSelections();
  }

  function extractSchedule(workbook) {
    const dataset = [];

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) return;

      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
      if (!matrix.length) return;

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
            department: sheetName?.trim() || 'Uten navn',
            person,
            shifts,
          });
        }
      }
    });

    return dataset;
  }

  function buildDateFromHeader(value) {
    if (value === undefined || value === null) return null;
    const numericDay =
      typeof value === 'number'
        ? Math.round(value)
        : Number.parseInt(String(value).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(numericDay)) return null;
    if (!state.activeMonth || !state.activeYear) return null;
    const iso = toISODateComponents(state.activeYear, state.activeMonth, numericDay);
    return iso;
  }

  function parseShiftDetail(value) {
    if (value === undefined || value === null) return null;

    if (typeof value === 'number') {
      if (value > 0 && value < 1) {
        const totalMinutes = Math.round(value * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return { kind: 'time', value: formatTime(hours, minutes) };
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
        if (formatted) {
          return { kind: 'time', value: formatted };
        }
      }

      return { kind: 'text', value: trimmed };
    }

    return null;
  }

  function formatDigitsAsTime(digits) {
    if (!digits) return null;
    if (digits.length <= 2) {
      return formatTime(Number.parseInt(digits, 10), 0);
    }
    if (digits.length === 3) {
      return formatTime(Number.parseInt(digits.slice(0, 1), 10), Number.parseInt(digits.slice(1), 10));
    }
    return formatTime(
      Number.parseInt(digits.slice(0, 2), 10),
      Number.parseInt(digits.slice(2, 4), 10),
    );
  }

  function formatTime(hours, minutes) {
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23) return null;
    if (minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

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
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Velg avdeling';
    select.appendChild(placeholder);

    const departments = Array.from(new Set(state.data.map((entry) => entry.department))).sort((a, b) =>
      a.localeCompare(b, 'no'),
    );

    departments.forEach((department) => {
      const option = document.createElement('option');
      option.value = department;
      option.textContent = department;
      if (department === state.selectedDepartment) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  function populatePersonSelect() {
    const select = els.person;
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.selectedDepartment ? 'Velg navn' : 'Velg avdeling først';
    select.appendChild(placeholder);

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
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      if (name === state.selectedPerson) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  function renderShifts() {
    els.shiftList.innerHTML = '';

    if (!state.selectedDepartment || !state.selectedPerson) {
      els.shiftList.classList.add('empty');
      els.shiftList.innerHTML = '<p>Velg avdeling og navn for å se vaktene.</p>';
      els.info.textContent = 'Velg hvem du vil se vakter for.';
      return;
    }

    const entry = state.data.find(
      (item) => item.department === state.selectedDepartment && item.person === state.selectedPerson,
    );
    if (!entry) {
      els.shiftList.classList.add('empty');
      els.shiftList.innerHTML = '<p>Fant ikke vakter for valget ditt.</p>';
      return;
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const list = entry.shifts
      .map((shift) => ({ ...shift, dateObj: new Date(`${shift.date}T00:00:00`) }))
      .sort((a, b) => a.dateObj - b.dateObj)
      .filter((shift) => !state.showFutureOnly || shift.dateObj >= todayDate);

    if (!list.length) {
      els.shiftList.classList.add('empty');
      els.shiftList.innerHTML = '<p>Ingen vakter i den valgte perioden.</p>';
      return;
    }

    els.shiftList.classList.remove('empty');
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
      if (isSameDay(shift.dateObj, todayDate)) {
        article.classList.add('today');
      }

      const date = document.createElement('div');
      date.className = 'shift-item__date';
      date.textContent = capitalize(dateFormatter.format(shift.dateObj));

      const time = document.createElement('div');
      time.className = 'shift-item__time';
      const detailValue = shift.detail ?? shift.startTime ?? '';
      const isTextDetail =
        (shift.kind === 'text') || (detailValue && !/^\d{2}:\d{2}$/.test(detailValue));
      time.textContent = isTextDetail ? detailValue : `Oppstart: ${detailValue}`;

      const meta = document.createElement('div');
      meta.className = 'shift-item__meta';
      meta.textContent = state.selectedDepartment;

      article.append(date, time, meta);
      fragment.appendChild(article);
    });

    els.shiftList.appendChild(fragment);
    const scope = state.showFutureOnly ? ' (kun kommende)' : '';
    els.info.textContent = `Viser ${list.length} vakter for ${state.selectedPerson}${scope}.`;
  }

  function renderRosterControls() {
    const select = els.rosterDateSelect;
    const deptSelect = els.rosterDepartmentSelect;
    if (!select) return;
    select.innerHTML = '';
    if (deptSelect) {
      deptSelect.innerHTML = '';
      const deptOption = document.createElement('option');
      deptOption.value = '';
      deptOption.textContent = 'Alle avdelinger';
      deptSelect.appendChild(deptOption);
      const departments = getRosterDepartments();
      if (!departments.includes(state.selectedRosterDepartment)) {
        state.selectedRosterDepartment = '';
      }
      departments.forEach((dept) => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        if (dept === state.selectedRosterDepartment) {
          option.selected = true;
        }
        deptSelect.appendChild(option);
      });
      deptSelect.disabled = departments.length === 0;
    }
    const dates = getAvailableRosterDates();
    if (!dates.length) {
      select.disabled = true;
      const option = document.createElement('option');
      option.value = '';
      option.textContent = state.data.length ? 'Ingen datoer i filteret' : 'Ingen datoer tilgjengelig';
      select.appendChild(option);
      state.selectedRosterDate = '';
      return;
    }
    select.disabled = false;
    if (!dates.includes(state.selectedRosterDate)) {
      state.selectedRosterDate = dates[0];
    }
    dates.forEach((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = capitalize(dateFormatter.format(new Date(`${date}T00:00:00`)));
      if (date === state.selectedRosterDate) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  function renderRosterList() {
    const container = els.rosterList;
    if (!container) return;
    container.innerHTML = '';

    if (!state.selectedRosterDate) {
      container.classList.add('empty');
      container.innerHTML = '<p>Ingen dato valgt ennå.</p>';
      return;
    }

    const entries = state.rosterMap.get(state.selectedRosterDate) || [];
    const filtered = entries.filter((entry) => {
      if (!state.selectedRosterDepartment) return true;
      return entry.department === state.selectedRosterDepartment;
    });

    if (!filtered.length) {
      container.classList.add('empty');
      container.innerHTML = '<p>Ingen registrerte vakter for valgene dine.</p>';
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
    renderRosterList();
  }

  function buildRosterData() {
    state.rosterMap = new Map();
    state.rosterDates = [];
    state.rosterDepartments = [];
    state.selectedRosterDate = '';
    state.selectedRosterDepartment = '';
    if (!state.data?.length) return;

    const departmentSet = new Set();
    state.data.forEach((entry) => {
      if (entry.department) {
        departmentSet.add(entry.department);
      }
      entry.shifts.forEach((shift) => {
        if (!shift?.date) return;
        const detailValue = shift.detail ?? shift.startTime ?? '';
        const kind =
          shift.kind ||
          (detailValue && /^\d{2}:\d{2}$/.test(detailValue) ? 'time' : 'text');
        const existing = state.rosterMap.get(shift.date) || [];
        existing.push({
          person: entry.person,
          department: entry.department,
          detail: detailValue,
          kind,
        });
        state.rosterMap.set(shift.date, existing);
      });
    });

    state.rosterDepartments = Array.from(departmentSet).sort((a, b) => a.localeCompare(b, 'no'));
    state.rosterMap.forEach((list) => list.sort(compareRosterEntries));
    state.rosterDates = Array.from(state.rosterMap.keys()).sort();
    state.selectedRosterDate = pickDefaultRosterDate();
  }

  function compareRosterEntries(a, b) {
    const timeCompare = rosterTimeValue(a).localeCompare(rosterTimeValue(b));
    if (timeCompare !== 0) return timeCompare;
    const deptCompare = a.department.localeCompare(b.department, 'no');
    if (deptCompare !== 0) return deptCompare;
    return a.person.localeCompare(b.person, 'no');
  }

  function rosterTimeValue(entry) {
    if (!entry?.detail) return '99:99';
    if (entry.kind === 'time' || /^\d{2}:\d{2}$/.test(entry.detail)) {
      return entry.detail;
    }
    return '99:99';
  }

  function getAvailableRosterDates() {
    if (!state.rosterDates?.length) return [];
    const todayISO = new Date().toISOString().slice(0, 10);
    return state.rosterDates.filter((date) => !state.showFutureOnly || date >= todayISO);
  }

  function pickDefaultRosterDate() {
    if (!state.rosterDates?.length) return '';
    const todayISO = new Date().toISOString().slice(0, 10);
    return state.rosterDates.find((date) => date >= todayISO) || state.rosterDates[0];
  }

  function getRosterDepartments() {
    return state.rosterDepartments || [];
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
    if (day !== 1) {
      clone.setDate(clone.getDate() - day + 1);
    }
    clone.setHours(0, 0, 0, 0);
    return clone;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function applySelectionFallbacks() {
    if (!state.data.length) {
      state.selectedDepartment = '';
      state.selectedPerson = '';
      persistSelection();
      return;
    }
    if (!state.data.some((entry) => entry.department === state.selectedDepartment)) {
      state.selectedDepartment = state.data[0]?.department || '';
      state.selectedPerson = '';
    }
    if (
      state.selectedDepartment &&
      !state.data.some(
        (entry) => entry.department === state.selectedDepartment && entry.person === state.selectedPerson,
      )
    ) {
      state.selectedPerson =
        state.data.find((entry) => entry.department === state.selectedDepartment)?.person || '';
    }
    persistSelection();
  }

  function persistSelection() {
    window.localStorage.setItem(
      storageKeys.selection,
      JSON.stringify({
        department: state.selectedDepartment,
        person: state.selectedPerson,
      }),
    );
  }

  function persistData() {
    const exportUrl = getExportUrl();
    state.lastUpdated = Date.now();
    window.localStorage.setItem(
      storageKeys.data,
      JSON.stringify({
        createdAt: state.lastUpdated,
        data: state.data,
        meta: {
          month: state.activeMonth,
          year: state.activeYear,
          sourceName: state.sourceName,
          sourceLink: exportUrl,
        },
      }),
    );
  }

  function enableSelectors() {
    els.department.disabled = false;
    els.person.disabled = false;
  }

  function disableSelectors() {
    els.department.disabled = true;
    els.person.disabled = true;
  }

  function updateSummary(dataset, timestamp) {
    if (!dataset?.length) {
      return;
    }

    const departmentCount = new Set(dataset.map((entry) => entry.department)).size;
    const peopleCount = dataset.length;
    const shiftCount = dataset.reduce((total, entry) => total + entry.shifts.length, 0);
    const timestampText = timestamp ? ` • sist oppdatert ${formatTimestamp(timestamp)}` : '';
    const planLabel = formatPlanLabel();
    const source = state.sourceName ? `Kilde: ${state.sourceName}. ` : '';
    console.info(
      `${planLabel ? `Plan for ${planLabel}. ` : ''}${source}Fant ${departmentCount} avdelinger, ${peopleCount} personer og ${shiftCount} vakter${timestampText}.`,
    );
  }

  function formatPlanLabel() {
    if (!state.activeMonth || !state.activeYear) return '';
    const label = MONTH_LABELS[state.activeMonth] || `måned ${state.activeMonth}`;
    return `${label} ${state.activeYear}`;
  }

  function formatTimestamp(timestamp) {
    return new Intl.DateTimeFormat('no-NO', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  }

  function setStatus(message) {
    console.info(message);
  }

  function handleError(error) {
    console.error(error);
    setStatus(error?.message || 'Noe gikk galt. Prøv igjen.');
  }

  function cleanString(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('Kunne ikke parse lagret data', error);
      return null;
    }
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

  function extractMonthYearFromText(text) {
    if (!text) return {};
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // strip diacritics

    let month;
    for (const [keyword, value] of Object.entries(MONTH_KEYWORDS)) {
      if (normalized.includes(keyword)) {
        month = value;
        break;
      }
    }

    const yearMatch = normalized.match(/\b(20\d{2}|\d{2})\b/);
    let year = yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;
    if (year && year < 100) {
      year += 2000;
    }
    return { month, year };
  }

  function buildExportUrl(link) {
    if (!link) return '';
    if (link.includes('/export')) return link;
    const match = link.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return '';
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
  }

  function getExportUrl() {
    if (state.exportUrl) return state.exportUrl;
    state.exportUrl = buildExportUrl(SHEET_SHARE_LINK);
    return state.exportUrl;
  }

  function isCacheStale() {
    if (!state.lastUpdated) return true;
    return Date.now() - state.lastUpdated > AUTO_REFRESH_INTERVAL;
  }

  function capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    if (state.loading) return;

    if (isCacheStale()) {
      refreshFromSheet(false);
    } else if (state.data.length) {
      renderShifts();
    }
  });

  window.addEventListener('beforeunload', () => {
    state.timers.forEach((timer) => clearInterval(timer));
  });
})();



