const STORAGE_KEY = 'ad_dashboard_normalized_v18';
const IMPORTS_KEY = 'ad_dashboard_import_batches_v18';
const DB_NAME = 'ad_dashboard_storage_v18';
const DB_STORE = 'kv';

const state = {
  rows: [],
  imports: [],
  filteredRows: [],
  pending: null,
  charts: {},
  tableSorts: {},
  weeklySorts: {},
  fileQueue: [],
  isReadingFile: false,
  editingImportId: null
};


function indexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDashboardDb() {
  if (!indexedDbAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function idbGet(key) {
  const db = await openDashboardDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : null);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await openDashboardDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ key, value });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB write failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction aborted')); };
  });
}

async function idbClear() {
  const db = await openDashboardDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB clear failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB clear aborted')); };
  });
}

const synonymMap = {
  brand: ['브랜드', 'brand', 'shop', '스토어', 'store'],
  platform: ['플랫폼', '매체', '채널', 'source', 'media', 'platform'],
  date: ['일자', '날짜', 'date', 'day', 'report date'],
  startDate: ['시작일', '시작일자', '보고 시작', '기간 시작', 'start date', 'date start', 'from'],
  endDate: ['종료일', '종료일자', '보고 종료', '기간 종료', 'end date', 'date stop', 'to'],
  cost: ['총비용', '비용', '광고비', '소진액', '사용금액', 'spend', 'cost', 'amount spent'],
  revenue: ['구매완료전환매출액', '구매완료 매출액', '구매완료매출액', '구매완료전환매출액원', '전환매출', '매출', 'purchase revenue', 'conversion value', 'revenue', 'purchase value', 'total conversion value'],
  impressions: ['노출수', '노출', 'impressions', 'impression'],
  clicks: ['클릭수', '클릭', 'link clicks', 'clicks', 'click'],
  conversions: ['구매완료전환수', '구매완료 수', '구매완료수', '전환수', '구매수', 'purchase', 'conversions', 'conversion'],
  campaignType: ['캠페인유형', '캠페인 유형', '광고유형', 'campaign type', 'ad type', 'objective'],
  campaign: ['캠페인명', '캠페인', 'campaign name', 'campaign'],
  adgroup: ['광고그룹', '광고세트', 'ad group', 'adgroup', 'ad set', 'adset'],
  keyword: ['검색어', '키워드', '소재', 'creative', 'keyword', 'search term', 'asset']
};

function normalizeHeader(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]{}.,/%\-_:~]/g, '');
}

function safeText(value, fallback = '-') {
  const text = normalizeUnicodeNfc(value).trim();
  return text ? text : fallback;
}

function normalizeSalesPlatformName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  if (normalized.includes('cafe24') || normalized.includes('카페24')) return 'Cafe24';
  if (normalized.includes('smartstore') || normalized.includes('스마트스토어') || normalized.includes('naversmartstore')) return 'Smartstore';
  if (normalized.includes("today'shouse") || normalized.includes('todayshouse') || normalized.includes('오늘의집') || normalized.includes('ohouse')) return "Today's house";
  if (normalized.includes('coupang') || normalized.includes('쿠팡')) return 'Coupang';
  if (normalized.includes('google') || normalized.includes('구글')) return 'Google';
  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram') || normalized.includes('페이스북') || normalized.includes('인스타')) return 'Meta';
  if (normalized.includes('naver') || normalized.includes('네이버')) return 'Naver';
  return text;
}

function normalizeAdPlatformName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  if (normalized.includes('gfa') || normalized.includes('display') || normalized.includes('naver(da)') || normalized.includes('네이버da') || normalized === 'da') return 'DA';
  if (normalized.includes('naver(sa)') || normalized.includes('파워링크') || normalized.includes('쇼핑검색') || normalized.includes('searchad') || normalized.includes('네이버sa') || normalized === 'naver' || normalized === '네이버' || normalized === 'sa') return 'SA';
  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram') || normalized.includes('페이스북') || normalized.includes('인스타') || normalized.includes('fb_')) return 'Meta';
  if (normalized.includes('coupang') || normalized.includes('쿠팡')) return 'Coupang';
  if (normalized.includes("today'shouse") || normalized.includes('todayshouse') || normalized.includes('오늘의집') || normalized.includes('ohouse')) return "Today's house";
  if (normalized.includes('google') || normalized.includes('구글')) return 'Google';
  return text;
}

function normalizeBrandName(value) {
  const text = String(value || '').trim();
  return text || '미지정';
}

const PRESET_BRANDS = ['퍼니츠', '풀오브빈스', '뽀뽀백번'];
const PRESET_SALES_PLATFORMS = ['Cafe24', 'Smartstore', "Today's house", 'Coupang', 'Google', 'Meta', 'Naver'];
const PRESET_AD_PLATFORMS = ['SA', 'DA', 'Meta', 'Coupang', "Today\'s house", 'Google'];
const CUSTOM_OPTION_VALUE = '__custom__';
const RESET_PASSWORD = 'ue250830~!@';
const DEPLOYMENT_JSON_PATH = 'data.json';
const DEPLOYMENT_MANIFEST_PATH = 'dashboard-data/index.json';
const DEPLOYMENT_FLAT_MANIFEST_PATH = 'dashboard-data__index.json';
const DEPLOYMENT_CHUNK_DIR = 'dashboard-data';

function uniquePaths(paths) {
  return Array.from(new Set(paths.filter(Boolean)));
}

function getDeploymentPathCandidates(fileName) {
  const clean = String(fileName || '').replace(/^\.\//, '').replace(/^\//, '');
  const segments = window.location.pathname.split('/').filter(Boolean);
  const repoBase = segments.length ? `/${segments[0]}/` : '/';
  const currentDir = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);

  return uniquePaths([
    clean,
    `./${clean}`,
    `${currentDir}${clean}`,
    `${repoBase}${clean}`,
    `../${clean}`
  ]);
}

function normalizeUnicodeNfc(value) {
  return String(value ?? '').normalize('NFC');
}


function normalizeRowRecord(row) {
  const normalizedSalesPlatform = normalizeSalesPlatformName(row.salesPlatform || row.storePlatform || '미지정');
  const normalizedAdPlatform = normalizeAdPlatformName(row.adPlatform || row.platform || normalizedSalesPlatform || '미지정');
  return {
    brand: normalizeBrandName(row.brand || row.importBrand || '미지정'),
    salesPlatform: normalizedSalesPlatform,
    adPlatform: normalizedAdPlatform,
    periodStart: row.periodStart || '',
    periodEnd: row.periodEnd || row.periodStart || '',
    campaignType: safeText(row.campaignType || '-'),
    campaign: safeText(row.campaign || '-'),
    adgroup: safeText(row.adgroup || '-'),
    keyword: safeText(row.keyword || '-'),
    cost: Number(row.cost || 0),
    revenue: Number(row.revenue || 0),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    conversions: Number(row.conversions || 0),
    importId: row.importId || '',
    importFileName: normalizeUnicodeNfc(row.importFileName || ''),
    importMemo: normalizeUnicodeNfc(row.importMemo || ''),
    createdAt: row.createdAt || ''
  };
}

function normalizeImportRecord(item) {
  const normalizedSalesPlatform = normalizeSalesPlatformName(item.salesPlatform || '미지정');
  const normalizedAdPlatform = normalizeAdPlatformName(item.adPlatform || normalizedSalesPlatform || '미지정');
  return {
    id: item.id || simpleHash(JSON.stringify([item.fileName || '', item.sheetName || '', item.createdAt || ''])),
    createdAt: item.createdAt || '',
    fileName: normalizeUnicodeNfc(item.fileName || ''),
    sheetName: normalizeUnicodeNfc(item.sheetName || ''),
    memo: normalizeUnicodeNfc(item.memo || ''),
    brand: normalizeBrandName(item.brand || '미지정'),
    salesPlatform: normalizedSalesPlatform,
    adPlatform: normalizedAdPlatform,
    rowCount: Number(item.rowCount || 0),
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    signature: item.signature || ''
  };
}

function getRowPlatformValue(row) {
  return normalizeAdPlatformName(
    row?.adPlatform ||
    row?.platform ||
    row?.salesPlatform ||
    row?.storePlatform ||
    ''
  );
}

function getImportPlatformValue(item) {
  return normalizeAdPlatformName(
    item?.adPlatform ||
    item?.platform ||
    item?.salesPlatform ||
    ''
  );
}

function getImportMetaById(importId) {
  if (!importId) return null;
  return state.imports.find(item => item.id === importId) || null;
}

function getResolvedRowMeta(row) {
  const importMeta = getImportMetaById(row?.importId);
  const brand = normalizeBrandName(row?.brand || importMeta?.brand || '미지정');
  const salesPlatform = normalizeSalesPlatformName(row?.salesPlatform || row?.storePlatform || importMeta?.salesPlatform || '미지정');
  const adPlatform = normalizeAdPlatformName(
    row?.adPlatform ||
    row?.platform ||
    importMeta?.adPlatform ||
    salesPlatform ||
    importMeta?.salesPlatform ||
    ''
  );
  const dateRange = getRowEffectiveDateRange(row || {});
  return {
    brand,
    salesPlatform,
    adPlatform,
    startDate: dateRange.start || '',
    endDate: dateRange.end || dateRange.start || ''
  };
}

function buildResolvedRow(row) {
  const normalized = normalizeRowRecord(row || {});
  const meta = getResolvedRowMeta(normalized);
  return {
    ...normalized,
    brand: meta.brand,
    salesPlatform: meta.salesPlatform,
    adPlatform: meta.adPlatform,
    platform: meta.adPlatform,
    periodStart: meta.startDate || normalized.periodStart || '',
    periodEnd: meta.endDate || meta.startDate || normalized.periodEnd || normalized.periodStart || ''
  };
}

function getResolvedRows(rows) {
  return hydrateRowsFromImports(Array.isArray(rows) ? rows : [], state.imports).map(buildResolvedRow);
}

function rowMatchesBrand(row, selectedBrand) {
  if (!selectedBrand || selectedBrand === '__ALL__') return true;
  return safeText(getResolvedRowMeta(row).brand) === selectedBrand;
}

function rowMatchesPlatform(row, selectedPlatform) {
  if (!selectedPlatform || selectedPlatform === '__ALL__') return true;
  const meta = getResolvedRowMeta(row);
  return [
    safeText(meta.adPlatform, ''),
    safeText(meta.salesPlatform, ''),
    safeText(row?.adPlatform, ''),
    safeText(row?.platform, ''),
    safeText(row?.salesPlatform, ''),
    safeText(row?.storePlatform, '')
  ].includes(selectedPlatform);
}

function hydrateRowsFromImports(rows, imports) {
  const importMap = new Map((imports || []).map(item => {
    const normalized = normalizeImportRecord(item);
    return [normalized.id, normalized];
  }));
  return (rows || []).map(row => {
    const normalized = normalizeRowRecord(row);
    const importMeta = importMap.get(normalized.importId);
    if (importMeta) {
      if (!normalized.periodStart) normalized.periodStart = importMeta.startDate || '';
      if (!normalized.periodEnd) normalized.periodEnd = importMeta.endDate || normalized.periodStart || '';
      if ((!normalized.salesPlatform || normalized.salesPlatform === '미지정') && importMeta.salesPlatform) {
        normalized.salesPlatform = importMeta.salesPlatform;
      }
      if ((!normalized.adPlatform || normalized.adPlatform === '미지정') && importMeta.adPlatform) {
        normalized.adPlatform = importMeta.adPlatform;
      }
      if ((!normalized.brand || normalized.brand === '미지정') && importMeta.brand) {
        normalized.brand = importMeta.brand;
      }
    }
    return normalized;
  });
}

function getRowEffectiveDateRange(row) {
  const importMeta = getImportMetaById(row?.importId);
  const start = row?.periodStart || importMeta?.startDate || '';
  const end = row?.periodEnd || row?.periodStart || importMeta?.endDate || importMeta?.startDate || '';
  return { start, end };
}

function getRowUniqueKey(row) {
  const normalized = normalizeRowRecord(row);
  return JSON.stringify([
    normalized.brand,
    normalized.salesPlatform,
    normalized.adPlatform,
    normalized.periodStart,
    normalized.periodEnd,
    normalized.campaignType,
    normalized.campaign,
    normalized.adgroup,
    normalized.keyword,
    normalized.cost,
    normalized.revenue,
    normalized.impressions,
    normalized.clicks,
    normalized.conversions,
    normalized.importFileName,
    normalized.importMemo
  ]);
}

function mergeUniqueRows(...lists) {
  const map = new Map();
  lists.flat().forEach(row => {
    if (!row) return;
    const normalized = normalizeRowRecord(row);
    const key = getRowUniqueKey(normalized);
    if (!map.has(key)) map.set(key, normalized);
  });
  return Array.from(map.values());
}

function getImportUniqueKey(item) {
  const normalized = normalizeImportRecord(item);
  return JSON.stringify([
    normalized.fileName,
    normalized.sheetName,
    normalized.brand,
    normalized.salesPlatform,
    normalized.adPlatform,
    normalized.startDate,
    normalized.endDate,
    normalized.signature,
    normalized.rowCount
  ]);
}

function mergeUniqueImports(...lists) {
  const map = new Map();
  lists.flat().forEach(item => {
    if (!item) return;
    const normalized = normalizeImportRecord(item);
    const key = getImportUniqueKey(normalized);
    if (!map.has(key)) map.set(key, normalized);
  });
  return Array.from(map.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}


async function loadRemoteDeploymentJson() {
  const manifestFiles = [DEPLOYMENT_MANIFEST_PATH, DEPLOYMENT_FLAT_MANIFEST_PATH];

  for (const manifestFile of manifestFiles) {
    const manifestCandidates = getDeploymentPathCandidates(manifestFile);

    for (const manifestPath of manifestCandidates) {
      try {
        const manifest = await fetchJsonSafe(manifestPath);
        if (!(manifest && Array.isArray(manifest.chunks))) continue;

        const chunkPayloads = [];
        for (const chunk of manifest.chunks) {
          const chunkFiles = [
            `${DEPLOYMENT_CHUNK_DIR}/${chunk.file}`,
            `dashboard-data__${chunk.file}`,
            chunk.file
          ];

          let loadedPayload = { rows: [] };
          let loaded = false;

          for (const chunkFile of chunkFiles) {
            const chunkCandidates = getDeploymentPathCandidates(chunkFile);
            for (const candidate of chunkCandidates) {
              try {
                loadedPayload = await fetchJsonSafe(candidate);
                loaded = true;
                break;
              } catch (error) {
                // try next candidate path
              }
            }
            if (loaded) break;
          }

          chunkPayloads.push(loadedPayload);
        }

        const rows = chunkPayloads.flatMap(payload => Array.isArray(payload.rows) ? payload.rows : []);
        const imports = Array.isArray(manifest.imports) ? manifest.imports : [];
        if (rows.length || imports.length) {
          return {
            rows: rows.map(normalizeRowRecord),
            imports: imports.map(normalizeImportRecord)
          };
        }
      } catch (error) {
        // try next manifest path
      }
    }
  }

  const fallbackFiles = [DEPLOYMENT_JSON_PATH, 'dashboard-data-package.json'];
  for (const fallbackFile of fallbackFiles) {
    const fallbackCandidates = getDeploymentPathCandidates(fallbackFile);
    for (const candidate of fallbackCandidates) {
      try {
        const payload = await fetchJsonSafe(candidate);
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload.rows) ? payload.rows : [];
        const imports = payload && !Array.isArray(payload) && Array.isArray(payload.imports) ? payload.imports : [];
        if (rows.length || imports.length) {
          return {
            rows: rows.map(normalizeRowRecord),
            imports: imports.map(normalizeImportRecord)
          };
        }
      } catch (error) {
        // try next fallback path
      }
    }
  }

  return { rows: [], imports: [] };
}


function buildDeploymentJsonPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    rows: mergeUniqueRows(state.rows),
    imports: mergeUniqueImports(state.imports)
  };
}

function getDeploymentMonthKey(row) {
  const end = parseMaybeDate(row.periodEnd);
  const start = parseMaybeDate(row.periodStart);
  const base = end || start;
  if (!base) return 'undated';
  const iso = formatLocalIso(base);
  const [year, month] = iso.split('-');
  return `${year}_${month}`;
}

function compareMonthKeysAsc(a, b) {
  if (a === 'undated' && b === 'undated') return 0;
  if (a === 'undated') return 1;
  if (b === 'undated') return -1;
  return a.localeCompare(b);
}


function buildDeploymentDownloadPlan() {
  const rows = mergeUniqueRows(state.rows || []).map(normalizeRowRecord);
  const imports = mergeUniqueImports(state.imports || []).map(normalizeImportRecord);
  const grouped = new Map();

  rows.forEach(row => {
    const key = getDeploymentMonthKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const chunkKeys = Array.from(grouped.keys()).sort(compareMonthKeysAsc);
  const chunks = chunkKeys.map(key => {
    const chunkRows = grouped.get(key) || [];
    return {
      fileName: `dashboard-data__rows_${key}.json`,
      payload: {
        version: 1,
        month: key,
        rowCount: chunkRows.length,
        rows: chunkRows
      }
    };
  });

  const manifest = {
    version: 2,
    exportedAt: new Date().toISOString(),
    totalRows: rows.length,
    totalImports: imports.length,
    imports,
    chunks: chunks.map(chunk => ({
      file: chunk.fileName.replace('dashboard-data__', ''),
      month: chunk.payload.month,
      rowCount: chunk.payload.rowCount
    }))
  };

  return {
    manifest,
    downloads: [
      { fileName: 'dashboard-data__index.json', payload: manifest },
      ...chunks,
      {
        fileName: 'data.json',
        payload: {
          version: 1,
          exportedAt: manifest.exportedAt,
          rows: [],
          imports: manifest.imports
        }
      }
    ]
  };
}

function startDirectJsonDownloads(plan) {
  const downloads = Array.isArray(plan?.downloads) ? plan.downloads : [];
  downloads.forEach((item, index) => {
    const payloadText = JSON.stringify(item.payload);
    const blob = new Blob([payloadText], { type: 'application/json;charset=utf-8' });
    setTimeout(() => {
      triggerDownload(blob, item.fileName);
    }, index * 350);
  });
  return downloads.length;
}

async function fetchJsonSafe(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function getBaseFileName(fileName) {
  return String(fileName || '').normalize('NFC').replace(/\.[^.]+$/, '');
}

function inferBrandFromFileName(fileName) {
  const base = getBaseFileName(fileName);
  for (const brand of PRESET_BRANDS) {
    if (base.includes(brand)) return brand;
  }
  const tokens = base.split(/[_\s]+/).map(token => token.trim()).filter(Boolean);
  const adPlatform = inferAdPlatformFromFileName(fileName);
  for (const token of tokens) {
    if (/^v\d/i.test(token)) continue;
    if (/^\d{6,8}$/.test(token)) continue;
    if (/\d+주차/.test(token)) continue;
    if (/^\d{4}년?\d{1,2}월/.test(token)) continue;
    if (adPlatform && normalizeAdPlatformName(token) === adPlatform) continue;
    if (normalizeSalesPlatformName(token) !== token && ['Naver','Meta','Google',"Today's house",'Coupang','Cafe24','Smartstore'].includes(normalizeSalesPlatformName(token))) continue;
    if (token.length >= 2) return token;
  }
  return '';
}

function inferAdPlatformFromFileName(fileName) {
  const base = getBaseFileName(fileName);
  for (const platform of PRESET_AD_PLATFORMS) {
    if (base.toLowerCase().includes(platform.toLowerCase())) return platform;
  }
  const normalized = normalizeAdPlatformName(base);
  return PRESET_AD_PLATFORMS.includes(normalized) ? normalized : '';
}

function inferSalesPlatformFromAdPlatform(adPlatform) {
  switch (normalizeAdPlatformName(adPlatform)) {
    case 'SA':
    case 'DA':
      return 'Naver';
    case 'Meta':
      return 'Meta';
    default:
      return '';
  }
}

function inferSalesPlatformFromFileName(fileName, adPlatform) {
  const base = getBaseFileName(fileName);
  const explicit = normalizeSalesPlatformName(base);
  if (explicit && explicit !== base && ['Cafe24', 'Smartstore', 'Naver', 'Meta', "Today's house", 'Coupang', 'Google'].includes(explicit)) {
    return explicit;
  }
  return inferSalesPlatformFromAdPlatform(adPlatform);
}

function inferImportMetaFromFileName(fileName) {
  const adPlatform = inferAdPlatformFromFileName(fileName);
  return {
    brand: inferBrandFromFileName(fileName),
    adPlatform,
    salesPlatform: inferSalesPlatformFromFileName(fileName, adPlatform)
  };
}


function getFixedFieldListId(inputId) {
  return inputId + 'Options';
}

function setFixedFieldOptions(inputId, presets, guessedValue, placeholder) {
  const select = document.getElementById(inputId);
  if (!select) return;
  const uniquePresets = Array.from(new Set((presets || []).filter(Boolean)));
  const normalizedGuess = String(guessedValue || '').trim();
  const values = uniquePresets.slice();
  if (normalizedGuess && !values.includes(normalizedGuess)) {
    values.unshift(normalizedGuess);
  }
  const options = [`<option value="">${escapeHtml(placeholder || 'Not selected')}</option>`]
    .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
  select.innerHTML = options.join('');
  select.value = normalizedGuess || '';
}

function getFixedFieldValue(inputId) {
  const field = document.getElementById(inputId);
  return String(field?.value || '').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  if (!text) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/원|₩|krw|,|%|\s/g, '').replace(/[^\d.-]/g, '');
  const num = parseFloat(text);
  if (!Number.isFinite(num)) return 0;
  return negative ? -num : num;
}

function excelDateToIso(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const fractionalDay = serial - Math.floor(serial) + 0.0000001;
  let totalSeconds = Math.floor(86400 * fractionalDay);
  const seconds = totalSeconds % 60;
  totalSeconds -= seconds;
  const hours = Math.floor(totalSeconds / (60 * 60));
  const minutes = Math.floor(totalSeconds / 60) % 60;
  dateInfo.setUTCHours(hours, minutes, seconds, 0);
  return dateInfo.toISOString().slice(0, 10);
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && value > 20000 && value < 70000) return excelDateToIso(value);
  const text = String(value).trim();
  if (!text) return null;
  const compact = text.replace(/\s/g, '');
  if (/^\d{8}$/.test(compact)) return compact.slice(0,4) + '-' + compact.slice(4,6) + '-' + compact.slice(6,8);
  const cleaned = compact.replace(/[.\/]/g, '-').replace(/년/g, '-').replace(/월/g, '-').replace(/일/g, '');
  const match = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function extractDateRangeFromMeta(text) {
  const source = String(text || '');
  const patterns = [
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}).{0,10}(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
    /(\d{4})(\d{2})(\d{2}).{0,10}(\d{4})(\d{2})(\d{2})/
  ];
  for (const pattern of patterns) {
    const found = source.match(pattern);
    if (found) {
      const start = [found[1], found[2].padStart(2, '0'), found[3].padStart(2, '0')].join('-');
      const end = [found[4], found[5].padStart(2, '0'), found[6].padStart(2, '0')].join('-');
      return { start, end };
    }
  }
  const single = source.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (single) {
    const one = [single[1], single[2].padStart(2, '0'), single[3].padStart(2, '0')].join('-');
    return { start: one, end: one };
  }
  return { start: '', end: '' };
}

function detectHeaderRow(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  const maxCheck = Math.min(rows.length, 12);
  for (let i = 0; i < maxCheck; i++) {
    const row = rows[i] || [];
    const score = row.reduce((sum, cell) => {
      const header = normalizeHeader(cell);
      if (!header) return sum;
      let add = 0;
      Object.values(synonymMap).forEach(list => {
        list.forEach(word => {
          const target = normalizeHeader(word);
          if (header === target) add += 6;
          else if (header.includes(target) || target.includes(header)) add += 3;
        });
      });
      return sum + add;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function dedupeHeaders(headers) {
  const seen = {};
  return headers.map((header, index) => {
    const base = safeText(header, 'column_' + (index + 1));
    if (seen[base] === undefined) {
      seen[base] = 0;
      return base;
    }
    seen[base] += 1;
    return base + '_' + (seen[base] + 1);
  });
}

function autoDetectField(headers, fieldKey) {
  const candidates = headers.map((header) => {
    const h = normalizeHeader(header);
    let score = 0;
    const groupMap = {
      brandColumn: 'brand',
      platformColumn: 'platform',
      dateColumn: 'date',
      startDateColumn: 'startDate',
      endDateColumn: 'endDate',
      campaignType: 'campaignType'
    };
    const group = groupMap[fieldKey] || fieldKey;
    (synonymMap[group] || []).forEach(keyword => {
      const k = normalizeHeader(keyword);
      if (h === k) score += 10;
      else if (h.includes(k) || k.includes(h)) score += 6;
    });
    if (fieldKey === 'campaign' && h === normalizeHeader('캠페인유형')) score += 2;
    return { header, score };
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] && candidates[0].score > 0 ? candidates[0].header : '';
}

function buildObjectsFromRows(rows, headerIndex) {
  const headers = dedupeHeaders(rows[headerIndex] || []);
  const dataRows = rows.slice(headerIndex + 1)
    .filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx] ?? '';
      });
      return obj;
    });
  return { headers, dataRows };
}

function looksLikeMojibake(text) {
  const source = String(text || '');
  if (!source) return false;
  const weirdMatches = source.match(/[ÃÂÌÍÐÒÙÚÝÞãð]/g) || [];
  const replacementMatches = source.match(/�/g) || [];
  return weirdMatches.length + replacementMatches.length >= 3;
}

function scoreDecodedText(text) {
  const source = String(text || '');
  if (!source) return -999999;
  let score = 0;
  const hangulSyllables = source.match(/[가-힣]/g) || [];
  const hangulJamo = source.match(/[\u1100-\u11FF\u3130-\u318F]/g) || [];
  const asciiWords = source.match(/[A-Za-z]{2,}/g) || [];
  const replacements = source.match(/�/g) || [];
  const weird = source.match(/[ÃÂÌÍÐÒÙÚÝÞãð]/g) || [];
  score += hangulSyllables.length * 4;
  score += asciiWords.length;
  score -= hangulJamo.length * 3;
  score -= replacements.length * 10;
  score -= weird.length * 5;
  if (looksLikeMojibake(source)) score -= 30;
  return score;
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function decodeCsvBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  if (hasUtf8Bom) {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    return { text: stripBom(text), encoding: 'utf-8-bom' };
  }

  const decoders = ['utf-8', 'euc-kr'];
  let best = null;
  decoders.forEach(encoding => {
    try {
      const text = new TextDecoder(encoding, encoding === 'utf-8' ? { fatal: true } : undefined).decode(bytes);
      const score = scoreDecodedText(text.slice(0, 4000));
      const candidate = { text: stripBom(text), encoding, score };
      if (!best || candidate.score > best.score) best = candidate;
    } catch (error) {
      // ignore
    }
  });
  if (!best) {
    const text = new TextDecoder('utf-8').decode(bytes);
    return { text: stripBom(text), encoding: 'utf-8' };
  }
  return { text: best.text, encoding: best.encoding };
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char === '\r') continue;
    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || String(row[0] || '').trim() !== '') rows.push(row);
  return rows;
}

async function readWorkbook(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('파일 객체를 읽을 수 없습니다.');
  const buffer = await file.arrayBuffer();
  const lowerName = String(file.name || '').toLowerCase();
  let firstSheetName = 'Sheet1';
  let rows;
  let extraMeta = '';

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
    const decoded = decodeCsvBuffer(buffer);
    rows = parseCsvText(decoded.text);
    firstSheetName = 'CSV';
    extraMeta = ' | encoding=' + decoded.encoding;
  } else {
    if (typeof XLSX === 'undefined') throw new Error('엑셀 라이브러리를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: true });
    firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  }

  const headerIndex = detectHeaderRow(rows);
  const metaText = rows.slice(0, headerIndex + 1).map(r => r.join(' ')).join(' | ') + ' | ' + file.name + extraMeta;
  const built = buildObjectsFromRows(rows, headerIndex);
  return {
    fileName: normalizeUnicodeNfc(file.name),
    sheetName: firstSheetName,
    headerIndex,
    rows,
    headers: built.headers,
    dataRows: built.dataRows,
    metaText
  };
}

function formatNumber(num) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(num || 0));
}

function formatCurrency(num) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(num || 0)) + '원';
}

function formatPercent(num) {
  return ((num || 0).toFixed(1)) + '%';
}

function formatGrowth(value) {
  if (value === null) return '신규';
  return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
}

function formatSignedNumber(num) {
  const value = Number(num || 0);
  if (value === 0) return '0';
  return (value > 0 ? '+' : '') + new Intl.NumberFormat('ko-KR').format(Math.round(value));
}

function formatSignedCurrency(num) {
  const value = Number(num || 0);
  if (value === 0) return '0원';
  return (value > 0 ? '+' : '') + new Intl.NumberFormat('ko-KR').format(Math.round(value)) + '원';
}

function formatSignedPercent(num) {
  const value = Number(num || 0);
  if (value === 0) return '0.0%';
  return (value > 0 ? '+' : '') + value.toFixed(1) + '%';
}

function parseMaybeDate(dateText) {
  if (!dateText) return null;
  const d = new Date(dateText + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalIso(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcMetrics(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.cost += Number(row.cost || 0);
    acc.revenue += Number(row.revenue || 0);
    acc.impressions += Number(row.impressions || 0);
    acc.clicks += Number(row.clicks || 0);
    acc.conversions += Number(row.conversions || 0);
    return acc;
  }, { cost: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 });
  totals.roas = totals.cost ? (totals.revenue / totals.cost) * 100 : 0;
  totals.ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cvr = totals.clicks ? (totals.conversions / totals.clicks) * 100 : 0;
  totals.cpc = totals.clicks ? totals.cost / totals.clicks : 0;
  return totals;
}

function createKpis(metrics) {
  const hasMetrics = !!metrics;
  const defs = [
    ['Cost', hasMetrics ? formatCurrency(metrics.cost) : '-', 'Total spend'],
    ['Revenue', hasMetrics ? formatCurrency(metrics.revenue) : '-', 'Purchase revenue'],
    ['ROAS', hasMetrics ? formatPercent(metrics.roas) : '-', 'Revenue ÷ cost'],
    ['Impressions', hasMetrics ? formatNumber(metrics.impressions) : '-', 'Impression volume'],
    ['Clicks', hasMetrics ? formatNumber(metrics.clicks) : '-', 'Click volume'],
    ['Conversions', hasMetrics ? formatNumber(metrics.conversions) : '-', 'Purchase conversions'],
    ['CTR', hasMetrics ? formatPercent(metrics.ctr) : '-', 'Clicks ÷ impressions'],
    ['CVR', hasMetrics ? formatPercent(metrics.cvr) : '-', 'Conversions ÷ clicks'],
    ['CPC', hasMetrics ? formatCurrency(metrics.cpc) : '-', 'Cost ÷ clicks']
  ];
  document.getElementById('kpiContainer').innerHTML = defs.map(([label, value, sub]) => `
    <div class="kpi">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </div>
  `).join('');
}

function groupBy(rows, keyGetter) {
  const map = new Map();
  rows.forEach(row => {
    const key = safeText(keyGetter(row));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function summarizeGroupRows(rows, labelGetter) {
  const grouped = groupBy(rows, labelGetter);
  return Array.from(grouped.entries()).map(([name, items]) => {
    const m = calcMetrics(items);
    return {
      name,
      cost: m.cost,
      revenue: m.revenue,
      roas: m.roas,
      impressions: m.impressions,
      clicks: m.clicks,
      conversions: m.conversions,
      ctr: m.ctr,
      cvr: m.cvr,
      cpc: m.cpc
    };
  }).sort((a, b) => b.cost - a.cost);
}


function getSortIndicator(sortState, key) {
  if (!sortState || sortState.key !== key) return '<span class="sort-indicator">↕</span>';
  return `<span class="sort-indicator active">${sortState.dir === 'asc' ? '↑' : '↓'}</span>`;
}

function buildHeaderCell(tableId, col, sortState) {
  const sortable = col.sortable !== false;
  const sortButton = sortable
    ? `<button type="button" class="sort-btn" data-sort-table="${escapeHtml(tableId)}" data-sort-key="${escapeHtml(col.key)}" aria-label="Sort by ${escapeHtml(col.label)}">${getSortIndicator(sortState, col.key)}</button>`
    : '';
  return `<th class="${sortable ? 'sortable' : ''}"><div class="th-inner"><span class="th-label">${escapeHtml(col.label)}</span>${sortButton}</div></th>`;
}

function compareValues(a, b, numeric = false) {
  if (numeric) {
    const av = Number(a || 0);
    const bv = Number(b || 0);
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  }
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  return av.localeCompare(bv, 'ko', { numeric: true, sensitivity: 'base' });
}

function getColumnSortValue(row, column) {
  if (typeof column.sortValue === 'function') return column.sortValue(row[column.key], row);
  return row[column.key];
}

function sortSimpleRows(rows, columns, sortState) {
  if (!sortState || !sortState.key) return rows.slice();
  const column = columns.find(col => col.key === sortState.key);
  if (!column) return rows.slice();
  const direction = sortState.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const compared = compareValues(getColumnSortValue(a, column), getColumnSortValue(b, column), !!column.num);
    if (compared !== 0) return compared * direction;
    return 0;
  });
}

function tableHtml(tableId, rows, columns, emptyText, options = {}) {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  const sortState = state.tableSorts[tableId] || options.defaultSort || null;
  const sortedRows = sortSimpleRows(rows, columns, sortState);
  const head = `<tr>${columns.map(col => buildHeaderCell(tableId, col, sortState)).join('')}</tr>`;
  const body = sortedRows.map(row => `
    <tr>
      ${columns.map(col => {
        const rawValue = typeof col.render === 'function' ? col.render(row[col.key], row) : row[col.key];
        const value = col.html ? rawValue : escapeHtml(rawValue);
        const className = col.num ? 'num' : '';
        return `<td class="${className}">${value}</td>`;
      }).join('')}
    </tr>
  `).join('');
  return `<table data-table-id="${escapeHtml(tableId)}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderSimpleTable(targetId, rows, columns, emptyText, options = {}) {
  document.getElementById(targetId).innerHTML = tableHtml(targetId, rows, columns, emptyText, options);
  scheduleTableEnhancement();
}

let tableEnhancementQueued = false;

function ensureTableColgroup(table) {
  if (!table) return [];
  let colgroup = table.querySelector('colgroup');
  const headerCount = table.querySelectorAll('thead th').length;
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < headerCount) {
    colgroup.appendChild(document.createElement('col'));
  }
  while (colgroup.children.length > headerCount) {
    colgroup.lastElementChild.remove();
  }
  return Array.from(colgroup.children);
}

function setTableColumnWidth(table, columnIndex, width) {
  const targetWidth = Math.max(96, Math.round(width));
  const cols = ensureTableColgroup(table);
  const col = cols[columnIndex];
  if (col) col.style.width = `${targetWidth}px`;

  const header = table.querySelector(`thead th:nth-child(${columnIndex + 1})`);
  if (header) {
    header.style.width = `${targetWidth}px`;
    header.style.minWidth = `${targetWidth}px`;
    header.style.maxWidth = `${targetWidth}px`;
  }

  table.querySelectorAll(`tbody tr`).forEach(row => {
    const cell = row.children[columnIndex];
    if (cell && !cell.hasAttribute('colspan')) {
      cell.style.width = `${targetWidth}px`;
      cell.style.minWidth = `${targetWidth}px`;
      cell.style.maxWidth = `${targetWidth}px`;
    }
  });
}

function getSuggestedColumnWidth(label, sampleValues = []) {
  const normalized = String(label || '').trim().toLowerCase();
  const fixedMap = {
    'brand': 150,
    'sales platform': 170,
    'ad platform': 150,
    'campaign type': 180,
    'campaign': 340,
    'ad group': 300,
    'keyword / creative': 260,
    'keyword': 220,
    'creative': 220,
    'start date': 132,
    'end date': 132,
    'memo': 260,
    'file name': 320,
    'import file': 320,
    'cost': 150,
    'revenue': 160,
    'roas': 115,
    'impressions': 145,
    'clicks': 120,
    'conversions': 135,
    'ctr': 105,
    'cvr': 105,
    'cpc': 130
  };
  if (fixedMap[normalized]) return fixedMap[normalized];

  const lengths = [String(label || '').length].concat(
    sampleValues.map(v => String(v || '').trim().length).filter(Boolean)
  );
  const longest = lengths.length ? Math.max(...lengths) : 10;
  return Math.max(120, Math.min(380, longest * 10 + 44));
}

function initializeTableColumnWidths(table) {
  if (!table || table.dataset.widthsInitialized === 'true') return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  const bodyRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 24);
  ensureTableColgroup(table);

  headers.forEach((th, index) => {
    const label = th.querySelector('.th-label')?.textContent?.trim() || th.textContent.trim();
    const sampleValues = bodyRows.map(row => row.children[index]?.textContent || '');
    const suggested = getSuggestedColumnWidth(label, sampleValues);
    setTableColumnWidth(table, index, suggested);
  });

  table.dataset.widthsInitialized = 'true';
}

function enableResizableColumns(root = document) {
  root.querySelectorAll('.table-wrap table').forEach(table => {
    initializeTableColumnWidths(table);
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, index) => {
      th.classList.add('resizable-col');
      if (th.querySelector('.resize-handle')) return;
      const handle = document.createElement('span');
      handle.className = 'resize-handle';

      const startResize = clientX => {
        const startX = clientX;
        const startWidth = th.getBoundingClientRect().width;
        document.body.classList.add('col-resizing');
        th.classList.add('resizing');

        const move = event => {
          const pointX = event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX;
          setTableColumnWidth(table, index, startWidth + (pointX - startX));
        };

        const stop = () => {
          document.body.classList.remove('col-resizing');
          th.classList.remove('resizing');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', stop);
          window.removeEventListener('touchmove', move);
          window.removeEventListener('touchend', stop);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', stop);
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', stop, { passive: true });
      };

      handle.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        startResize(event.clientX);
      });

      handle.addEventListener('touchstart', event => {
        if (!event.touches || !event.touches.length) return;
        event.preventDefault();
        event.stopPropagation();
        startResize(event.touches[0].clientX);
      }, { passive: false });

      th.appendChild(handle);
    });
  });
}

function scheduleTableEnhancement() {
  if (tableEnhancementQueued) return;
  tableEnhancementQueued = true;
  requestAnimationFrame(() => {
    tableEnhancementQueued = false;
    enableResizableColumns();
  });
}

function renderSummaryTables(rows, creativeRows = rows) {
  const metricColumns = [
    { key: 'name', label: 'Name' },
    { key: 'cost', label: 'Cost', render: v => formatCurrency(v), num: true },
    { key: 'revenue', label: 'Revenue', render: v => formatCurrency(v), num: true },
    { key: 'roas', label: 'ROAS', render: v => formatPercent(v), num: true },
    { key: 'clicks', label: 'Clicks', render: v => formatNumber(v), num: true },
    { key: 'conversions', label: 'Conversions', render: v => formatNumber(v), num: true },
    { key: 'cpc', label: 'CPC', render: v => formatCurrency(v), num: true }
  ];

  renderSimpleTable('brandTable', summarizeGroupRows(rows, row => row.brand).slice(0, 50), metricColumns, 'No brand data found.', { defaultSort: { key: 'cost', dir: 'desc' } });
  renderSimpleTable('platformTable', summarizeGroupRows(rows, row => getResolvedRowMeta(row).adPlatform).slice(0, 50), metricColumns, 'No ad platform data found.', { defaultSort: { key: 'cost', dir: 'desc' } });
  renderSimpleTable('campaignTable', summarizeGroupRows(rows, row => row.campaign).slice(0, 50), metricColumns, 'No campaign data found.', { defaultSort: { key: 'cost', dir: 'desc' } });
  renderSimpleTable('adgroupTable', summarizeGroupRows(rows, row => row.adgroup).slice(0, 80), metricColumns, 'No ad group data found.', { defaultSort: { key: 'cost', dir: 'desc' } });
  const keywordRows = summarizeGroupRows(creativeRows, row => row.keyword).slice(0, 100);
  renderSimpleTable('keywordTable', keywordRows, metricColumns, 'No keyword or creative data found.', { defaultSort: { key: 'cost', dir: 'desc' } });
}

function startOfWeek(dateObj) {
  const d = new Date(dateObj);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getRowReferenceDate(row) {
  const range = getRowEffectiveDateRange(row);
  return range.end || range.start || '';
}

function formatPeriodKey(dateText, granularity) {
  const d = new Date(dateText + 'T00:00:00');
  if (granularity === 'month') return dateText.slice(0, 7);
  if (granularity === 'week') return formatLocalIso(startOfWeek(d));
  return dateText;
}

function buildPeriodRows(rows, granularity) {
  const grouped = groupBy(rows, row => formatPeriodKey(getRowReferenceDate(row), granularity));
  return Array.from(grouped.entries()).map(([period, items]) => {
    const m = calcMetrics(items);
    return {
      period,
      cost: m.cost,
      revenue: m.revenue,
      clicks: m.clicks,
      conversions: m.conversions
    };
  }).sort((a, b) => a.period.localeCompare(b.period));
}

function destroyChart(name) {
  if (state.charts[name]) {
    state.charts[name].destroy();
    state.charts[name] = null;
  }
}

function addDays(dateText, days) {
  const dateObj = parseMaybeDate(dateText);
  if (!dateObj) return '';
  dateObj.setDate(dateObj.getDate() + days);
  return formatLocalIso(dateObj);
}

function normalizeDateRange(startIso, endIso) {
  let start = startIso || '';
  let end = endIso || '';
  if (start && !end) end = start;
  if (end && !start) start = end;
  return { start, end };
}

function getRangeSpanDays(startIso, endIso) {
  const start = parseMaybeDate(startIso);
  const end = parseMaybeDate(endIso);
  if (!start || !end) return 7;
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return Math.max(1, diff + 1);
}

function getPreviousRange(startIso, endIso) {
  const normalized = normalizeDateRange(startIso, endIso);
  if (!normalized.start || !normalized.end) return { start: '', end: '' };
  const span = getRangeSpanDays(normalized.start, normalized.end);
  return {
    start: addDays(normalized.start, -span),
    end: addDays(normalized.end, -span)
  };
}

function getWeekRangeFromEndDate(endIso) {
  const normalized = normalizeDateRange('', endIso);
  if (!normalized.end) return { start: '', end: '' };
  return {
    start: addDays(normalized.end, -6),
    end: normalized.end
  };
}

function getPreviousWeekRangeFromEndDate(endIso) {
  const currentWeek = getWeekRangeFromEndDate(endIso);
  if (!currentWeek.start || !currentWeek.end) return { start: '', end: '' };
  return {
    start: addDays(currentWeek.start, -7),
    end: addDays(currentWeek.end, -7)
  };
}

function formatRangeTitle(startIso, endIso) {
  if (!startIso && !endIso) return 'Commerce channel ad data';
  const start = parseMaybeDate(startIso || endIso);
  const end = parseMaybeDate(endIso || startIso || endIso);
  if (!start || !end) return 'Commerce channel ad data';
  const year = start.getFullYear();
  const sm = String(start.getMonth() + 1).padStart(2, '0');
  const sd = String(start.getDate()).padStart(2, '0');
  const em = String(end.getMonth() + 1).padStart(2, '0');
  const ed = String(end.getDate()).padStart(2, '0');
  return `${year}-${sm}-${sd} ~ ${em}-${ed} Commerce channel ad data`;
}

function formatReportTitle(weekKey) {
  if (!weekKey) return 'Commerce channel ad data';
  return formatRangeTitle(weekKey, addDays(weekKey, 6));
}

function getRowsDateBounds(rows) {
  const dates = getResolvedRows(rows).flatMap(row => {
      const range = getRowEffectiveDateRange(row);
      return [range.start, range.end || range.start];
    })
    .map(parseDateValue)
    .filter(Boolean)
    .sort();
  if (!dates.length) return { start: '', end: '' };
  return { start: dates[0], end: dates[dates.length - 1] };
}

function getActiveRange(rows) {
  const startInput = document.getElementById('startDateFilter').value;
  const endInput = document.getElementById('endDateFilter').value;
  const bounds = getRowsDateBounds(rows);
  return {
    start: startInput || bounds.start,
    end: endInput || bounds.end || startInput || bounds.start
  };
}


function getComparisonWeekKeys(rows) {
  const comparisonRows = getResolvedRows(rows).filter(row => getRowReferenceDate(row)).map(row => ({
    ...row,
    comparisonDate: getRowReferenceDate(row),
    weekKey: formatPeriodKey(getRowReferenceDate(row), 'week')
  }));
  const weekKeys = Array.from(new Set(comparisonRows.map(row => row.weekKey))).sort();
  return {
    comparisonRows,
    weekKeys,
    previousWeek: weekKeys.length >= 2 ? weekKeys[weekKeys.length - 2] : '',
    currentWeek: weekKeys.length >= 1 ? weekKeys[weekKeys.length - 1] : ''
  };
}


function averageOf(values) {
  const numeric = values.map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!numeric.length) return 0;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function buildWeeklyCampaignGroups(rows, weekKey, rangeOverride = null) {
  let sourceRows = getResolvedRows(rows)
    .filter(row => getRowReferenceDate(row));

  if (rangeOverride && (rangeOverride.start || rangeOverride.end)) {
    const normalizedRange = normalizeDateRange(rangeOverride.start, rangeOverride.end);
    const startDate = parseMaybeDate(normalizedRange.start);
    const endDate = parseMaybeDate(normalizedRange.end);
    sourceRows = sourceRows.filter(row => rowOverlaps(row, startDate, endDate));
  } else {
    sourceRows = sourceRows.filter(row => formatPeriodKey(getRowReferenceDate(row), 'week') === weekKey);
  }

  const campaignMap = new Map();
  sourceRows.forEach(row => {
    const rowMeta = getResolvedRowMeta(row);
    const campaignKey = [safeText(rowMeta.brand), safeText(rowMeta.salesPlatform || '-'), safeText(rowMeta.adPlatform || '-'), safeText(row.campaignType || '-'), safeText(row.campaign)].join('||');
    if (!campaignMap.has(campaignKey)) {
      campaignMap.set(campaignKey, {
        brand: safeText(rowMeta.brand),
        salesPlatform: safeText(rowMeta.salesPlatform || '-'),
        adPlatform: safeText(rowMeta.adPlatform || '-'),
        campaignType: safeText(row.campaignType || '-'),
        campaign: safeText(row.campaign),
        sourceRows: [],
        detailsMap: new Map()
      });
    }
    const group = campaignMap.get(campaignKey);
    group.sourceRows.push(row);
    const detailKey = safeText(row.adgroup || '-');
    if (!group.detailsMap.has(detailKey)) group.detailsMap.set(detailKey, []);
    group.detailsMap.get(detailKey).push(row);
  });

  const groups = Array.from(campaignMap.values()).map(group => {
    const details = Array.from(group.detailsMap.entries()).map(([detailKey, items]) => {
      const adgroup = detailKey;
      const metrics = calcMetrics(items);
      return {
        adgroup,
        cost: metrics.cost,
        revenue: metrics.revenue,
        roas: metrics.roas,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        conversions: metrics.conversions,
        ctr: metrics.ctr,
        cvr: metrics.cvr,
        cpc: metrics.cpc
      };
    });
    const subtotal = calcMetrics(group.sourceRows);
    return {
      brand: group.brand,
      salesPlatform: group.salesPlatform,
      adPlatform: group.adPlatform,
      campaignType: group.campaignType,
      campaign: group.campaign,
      details,
      subtotal
    };
  });

  const grandTotal = calcMetrics(sourceRows);
  return { groups, grandTotal, rowCount: sourceRows.length };
}

function getWeeklyGroupSortValue(group, sortKey) {
  if (['brand', 'salesPlatform', 'adPlatform', 'campaignType', 'campaign'].includes(sortKey)) return group[sortKey];
  if (sortKey === 'adgroup') return group.details[0]?.adgroup || '';
  return group.subtotal?.[sortKey] ?? 0;
}

function sortWeeklyGroups(groups, sortState) {
  if (!sortState || !sortState.key) return groups.slice();
  const numericKeys = new Set(['cost','revenue','roas','impressions','clicks','conversions','ctr','cvr','cpc']);
  const direction = sortState.dir === 'desc' ? -1 : 1;
  return groups.slice().sort((a, b) => {
    const compared = compareValues(getWeeklyGroupSortValue(a, sortState.key), getWeeklyGroupSortValue(b, sortState.key), numericKeys.has(sortState.key));
    if (compared !== 0) return compared * direction;
    return a.campaign.localeCompare(b.campaign, 'ko', { numeric: true, sensitivity: 'base' });
  }).map(group => {
    const sortedDetails = group.details.slice().sort((a, b) => {
      const key = sortState.key;
      const numeric = numericKeys.has(key);
      const av = key === 'adgroup' ? a.adgroup : (a[key] ?? 0);
      const bv = key === 'adgroup' ? b.adgroup : (b[key] ?? 0);
      const compared = compareValues(av, bv, numeric);
      if (compared !== 0) return compared * direction;
      return a.adgroup.localeCompare(b.adgroup, 'ko', { numeric: true, sensitivity: 'base' });
    });
    return { ...group, details: sortedDetails };
  });
}

function buildWeeklyDetailedTableHtml(targetId, groupedData, emptyText) {
  const { groups, grandTotal, rowCount } = groupedData;
  if (!groups.length || (!rowCount && grandTotal.cost === 0 && grandTotal.revenue === 0 && grandTotal.impressions === 0 && grandTotal.clicks === 0 && grandTotal.conversions === 0)) {
    return `<div class="empty">${emptyText}</div>`;
  }
  const sortState = state.weeklySorts[targetId] || { key: 'campaign', dir: 'asc' };
  const orderedGroups = sortWeeklyGroups(groups, sortState);
  const columns = [
    { key: 'brand', label: 'Brand' },
    { key: 'salesPlatform', label: 'Sales platform' },
    { key: 'adPlatform', label: 'Ad platform' },
    { key: 'campaignType', label: 'Campaign type' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'adgroup', label: 'Ad group' },
    { key: 'cost', label: 'Cost', num: true },
    { key: 'revenue', label: 'Revenue', num: true },
    { key: 'roas', label: 'ROAS', num: true },
    { key: 'impressions', label: 'Impressions', num: true },
    { key: 'clicks', label: 'Clicks', num: true },
    { key: 'conversions', label: 'Conversions', num: true },
    { key: 'ctr', label: 'CTR', num: true },
    { key: 'cvr', label: 'CVR', num: true },
    { key: 'cpc', label: 'CPC', num: true }
  ];
  const head = `<tr>${columns.map(col => buildHeaderCell(targetId, col, sortState)).join('')}</tr>`;
  const rowsHtml = orderedGroups.map(group => {
    const detailRows = group.details.map(detail => `
      <tr>
        <td>${escapeHtml(group.brand || '-')}</td>
        <td>${escapeHtml(group.salesPlatform || '-')}</td>
        <td>${escapeHtml(group.adPlatform || '-')}</td>
        <td>${escapeHtml(group.campaignType || '-')}</td>
        <td>${escapeHtml(group.campaign || '-')}</td>
        <td>${escapeHtml(detail.adgroup || '-')}</td>
        <td class="num">${formatCurrency(detail.cost)}</td>
        <td class="num">${formatCurrency(detail.revenue)}</td>
        <td class="num">${formatPercent(detail.roas)}</td>
        <td class="num">${formatNumber(detail.impressions)}</td>
        <td class="num">${formatNumber(detail.clicks)}</td>
        <td class="num">${formatNumber(detail.conversions)}</td>
        <td class="num">${formatPercent(detail.ctr)}</td>
        <td class="num">${formatPercent(detail.cvr)}</td>
        <td class="num">${formatCurrency(detail.cpc)}</td>
      </tr>`).join('');

    const subtotal = group.subtotal;
    const subtotalRow = `
      <tr class="subtotal">
        <td colspan="6"><strong>Sub total</strong></td>
        <td class="num">${formatCurrency(subtotal.cost)}</td>
        <td class="num">${formatCurrency(subtotal.revenue)}</td>
        <td class="num">${formatPercent(subtotal.roas)}</td>
        <td class="num">${formatNumber(subtotal.impressions)}</td>
        <td class="num">${formatNumber(subtotal.clicks)}</td>
        <td class="num">${formatNumber(subtotal.conversions)}</td>
        <td class="num">${formatPercent(subtotal.ctr)}</td>
        <td class="num">${formatPercent(subtotal.cvr)}</td>
        <td class="num">${formatCurrency(subtotal.cpc)}</td>
      </tr>`;
    return detailRows + subtotalRow;
  }).join('');

  const grandTotalRow = `
    <tr class="grand-total">
      <td colspan="6"><strong>Grand total</strong></td>
      <td class="num">${formatCurrency(grandTotal.cost)}</td>
      <td class="num">${formatCurrency(grandTotal.revenue)}</td>
      <td class="num">${formatPercent(grandTotal.roas)}</td>
      <td class="num">${formatNumber(grandTotal.impressions)}</td>
      <td class="num">${formatNumber(grandTotal.clicks)}</td>
      <td class="num">${formatNumber(grandTotal.conversions)}</td>
      <td class="num">${formatPercent(grandTotal.ctr)}</td>
      <td class="num">${formatPercent(grandTotal.cvr)}</td>
      <td class="num">${formatCurrency(grandTotal.cpc)}</td>
    </tr>`;

  return `<table class="report-table" data-table-id="${escapeHtml(targetId)}"><thead>${head}</thead><tbody>${rowsHtml + grandTotalRow}</tbody></table>`;
}

function renderWeeklyDetailedTable(targetId, rows, weekKey, emptyText, rangeOverride = null) {
  document.getElementById(targetId).innerHTML = buildWeeklyDetailedTableHtml(targetId, buildWeeklyCampaignGroups(rows, weekKey, rangeOverride), emptyText);
  scheduleTableEnhancement();
}

function isWeeklySortTableId(tableId) {
  return ['selectedDataTable', 'previousWeekReportTable', 'currentWeekReportTable'].includes(String(tableId || ''));
}

function renderSelectedDataPanel(rows) {
  const titleEl = document.getElementById('selectedDataTitle');
  const noteEl = document.getElementById('selectedDataNote');
  const startInput = document.getElementById('startDateFilter').value;
  const endInput = document.getElementById('endDateFilter').value;
  const selectedRange = normalizeDateRange(startInput, endInput);

  titleEl.textContent = 'Select data';

  if (selectedRange.start && selectedRange.end) {
    noteEl.textContent = formatRangeTitle(selectedRange.start, selectedRange.end);
    renderWeeklyDetailedTable('selectedDataTable', rows, '', 'No report data found for Select data.', selectedRange);
    return;
  }

  noteEl.textContent = 'Enter both Start date and End date to display the selected period data.';
  document.getElementById('selectedDataTable').innerHTML = `<div class="empty">Enter Start date and End date to display Select data.</div>`;
}

function renderWeeklyReportPanels(rows) {
  const previousTitle = document.getElementById('previousWeekReportTitle');
  const currentTitle = document.getElementById('currentWeekReportTitle');
  const previousNote = document.getElementById('costRevenueChartNote');
  const currentNote = document.getElementById('clickConversionChartNote');
  const startInput = document.getElementById('startDateFilter').value;
  const endInput = document.getElementById('endDateFilter').value;
  const explicitWeekRange = endInput ? getWeekRangeFromEndDate(endInput) : normalizeDateRange(startInput, endInput);

  renderSelectedDataPanel(rows);

  previousTitle.textContent = 'Week - 1';
  currentTitle.textContent = 'Week';

  if (explicitWeekRange.start && explicitWeekRange.end) {
    const previousRange = getPreviousWeekRangeFromEndDate(explicitWeekRange.end || endInput);
    previousNote.textContent = formatRangeTitle(previousRange.start, previousRange.end);
    currentNote.textContent = formatRangeTitle(explicitWeekRange.start, explicitWeekRange.end);
    renderWeeklyDetailedTable('previousWeekReportTable', rows, '', 'No report data found for Week - 1.', previousRange);
    renderWeeklyDetailedTable('currentWeekReportTable', rows, '', 'No report data found for Week.', explicitWeekRange);
    return;
  }

  const info = getComparisonWeekKeys(rows);
  previousNote.textContent = info.previousWeek ? formatReportTitle(info.previousWeek) : 'No comparable data found for the previous week.';
  currentNote.textContent = info.currentWeek ? formatReportTitle(info.currentWeek) : 'No comparable data found for the latest week.';

  renderWeeklyDetailedTable('previousWeekReportTable', rows, info.previousWeek, 'No report data found for Week - 1.');
  renderWeeklyDetailedTable('currentWeekReportTable', rows, info.currentWeek, 'No report data found for Week.');
}

function renderWeekOverWeek(rows) {
  const activeRange = getActiveRange(rows);
  if (!rows.length || !activeRange.start) {
    document.getElementById('wowRangeNote').textContent = 'No data is available for the selected date range.';
    document.getElementById('wowTable').innerHTML = `<div class="empty">No creatives found for ROAS ≤ 300% analysis.</div>`;
    return;
  }

  document.getElementById('wowRangeNote').textContent = `${formatRangeTitle(activeRange.start, activeRange.end)} · creatives with ROAS ≤ 300%.`;
  const grouped = summarizeGroupRows(getResolvedRows(rows), row => [safeText(getRowEffectiveDateRange(row).start || '-'), safeText(getRowEffectiveDateRange(row).end || getRowEffectiveDateRange(row).start || '-'), safeText(row.brand), safeText(row.salesPlatform || '-'), safeText(getRowPlatformValue(row)), safeText(row.campaignType || '-', '-'), safeText(row.campaign), safeText(row.adgroup), safeText(row.keyword)].join('||'))
    .map(item => {
      const [periodStart, periodEnd, brand, salesPlatform, adPlatform, campaignType, campaign, adgroup, keyword] = item.name.split('||');
      return {
        periodStart,
        periodEnd,
        brand,
        salesPlatform,
        adPlatform,
        campaignType,
        campaign,
        adgroup,
        keyword,
        cost: item.cost,
        revenue: item.revenue,
        roas: item.roas,
        impressions: item.impressions,
        clicks: item.clicks,
        conversions: item.conversions,
        ctr: item.ctr,
        cvr: item.cvr,
        cpc: item.cpc
      };
    })
    .filter(row => row.cost > 0 && row.roas <= 300)
    .sort((a, b) => a.roas - b.roas || b.cost - a.cost);

  const columns = [
    { key: 'periodStart', label: 'Start date' },
    { key: 'periodEnd', label: 'End date' },
    { key: 'brand', label: 'Brand' },
    { key: 'salesPlatform', label: 'Sales platform' },
    { key: 'adPlatform', label: 'Ad platform' },
    { key: 'campaignType', label: 'Campaign type' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'adgroup', label: 'Ad group' },
    { key: 'keyword', label: 'Creative' },
    { key: 'cost', label: 'Cost', render: v => formatCurrency(v), num: true },
    { key: 'revenue', label: 'Revenue', render: v => formatCurrency(v), num: true },
    { key: 'roas', label: 'ROAS', render: v => formatPercent(v), num: true },
    { key: 'impressions', label: 'Impressions', render: v => formatNumber(v), num: true },
    { key: 'clicks', label: 'Clicks', render: v => formatNumber(v), num: true },
    { key: 'conversions', label: 'Conversions', render: v => formatNumber(v), num: true },
    { key: 'ctr', label: 'CTR', render: v => formatPercent(v), num: true },
    { key: 'cvr', label: 'CVR', render: v => formatPercent(v), num: true },
    { key: 'cpc', label: 'CPC', render: v => formatCurrency(v), num: true }
  ];
  renderSimpleTable('wowTable', grouped, columns, 'No creatives found with ROAS ≤ 300% for the selected range.', { defaultSort: { key: 'roas', dir: 'asc' } });
}

function renderInsights(rows, metrics) {
  const items = [];
  if (!rows.length) {
    items.push({ type: 'warn', text: '현재 선택한 조건에 해당하는 데이터가 없습니다.' });
  } else {
    if (metrics.roas >= 300) items.push({ type: 'good', text: `<strong>ROAS ${formatPercent(metrics.roas)}</strong>로 광고비 대비 매출 효율이 좋은 편입니다.` });
    else if (metrics.roas === 0 && metrics.cost > 0) items.push({ type: 'bad', text: `<strong>광고비 ${formatCurrency(metrics.cost)}</strong>가 집행됐지만 매출은 잡히지 않았습니다.` });
    else items.push({ type: 'warn', text: `<strong>ROAS ${formatPercent(metrics.roas)}</strong>로 소재, 타게팅, 랜딩 흐름 점검이 필요합니다.` });

    if (metrics.ctr < 1 && metrics.impressions > 0) items.push({ type: 'bad', text: `<strong>클릭률 ${formatPercent(metrics.ctr)}</strong>로 낮은 편입니다. 썸네일, 카피, 타게팅 적합성을 점검해야 합니다.` });
    else items.push({ type: 'good', text: `<strong>클릭률 ${formatPercent(metrics.ctr)}</strong>로 노출 대비 반응은 무난한 편입니다.` });

    if (metrics.clicks > 0 && metrics.cvr < 2) items.push({ type: 'warn', text: `<strong>전환율 ${formatPercent(metrics.cvr)}</strong>로 클릭 이후 전환 구간 점검이 필요합니다.` });
    else if (metrics.conversions > 0) items.push({ type: 'good', text: `<strong>${formatNumber(metrics.conversions)}건 전환</strong>이 발생했고 전환율은 ${formatPercent(metrics.cvr)}입니다.` });

    const topBrand = summarizeGroupRows(rows, row => row.brand)[0];
    const topPlatform = summarizeGroupRows(rows, row => row.adPlatform)[0];
    if (topBrand) items.push({ type: 'good', text: `<strong>${topBrand.name}</strong>이(가) 현재 조회 기준 매출 기여도가 가장 높습니다. 매출 ${formatCurrency(topBrand.revenue)}, ROAS ${formatPercent(topBrand.roas)}입니다.` });
    if (topPlatform) items.push({ type: 'good', text: `<strong>${topPlatform.name}</strong>이(가) 현재 조회 기준 광고비 비중이 가장 큽니다. 광고비 ${formatCurrency(topPlatform.cost)}, ROAS ${formatPercent(topPlatform.roas)}입니다.` });
  }
  document.getElementById('insightList').innerHTML = items.map(item => `<div class="insight ${item.type}">${item.text}</div>`).join('');
}


function renderAdvancement(rows, metrics) {
  const noteEl = document.getElementById('advancementNote');
  const listEl = document.getElementById('advancementList');
  if (!listEl || !noteEl) return;

  const items = [];
  if (!rows.length) {
    noteEl.textContent = 'No data is available for the current selection, so no advancement suggestions can be generated.';
    listEl.innerHTML = `<div class="insight warn">현재 선택한 조건에 맞는 데이터가 없어 Advancement 내용을 생성할 수 없습니다.</div>`;
    return;
  }

  noteEl.textContent = 'Based on Key insights, this section summarizes immediately actionable improvement directions.';

  if (metrics.roas < 300) {
    items.push({
      type: 'bad',
      text: `<strong>ROAS 개선이 우선입니다.</strong> 현재 ROAS가 ${formatPercent(metrics.roas)}이므로, 광고비가 많이 들어가는 캠페인부터 소재 교체와 랜딩 페이지 점검을 동시에 진행하는 것이 좋습니다.`
    });
  } else {
    items.push({
      type: 'good',
      text: `<strong>성과 유지 + 확장이 적절합니다.</strong> 현재 ROAS가 ${formatPercent(metrics.roas)}이므로, 효율이 확인된 광고그룹 중심으로 예산을 점진 확대하고 저효율 그룹은 분리 관리하는 것이 좋습니다.`
    });
  }

  if (metrics.ctr < 1 && metrics.impressions > 0) {
    items.push({
      type: 'bad',
      text: `<strong>클릭률 개선이 필요합니다.</strong> CTR이 ${formatPercent(metrics.ctr)} 수준이라면 첫 화면에서 반응을 못 끌고 있다는 뜻이므로, 썸네일·카피·혜택 문구를 2~3개 버전으로 빠르게 교체 테스트해야 합니다.`
    });
  } else {
    items.push({
      type: 'good',
      text: `<strong>유입 단계는 비교적 안정적입니다.</strong> CTR이 ${formatPercent(metrics.ctr)}이므로 클릭 이후 구간 최적화에 더 집중하는 편이 효율적입니다.`
    });
  }

  if (metrics.clicks > 0 && metrics.cvr < 2) {
    items.push({
      type: 'warn',
      text: `<strong>전환 구간 보완이 필요합니다.</strong> CVR이 ${formatPercent(metrics.cvr)}라면 유입 이후 설득이 약한 상태일 수 있어, 상세페이지 핵심 메시지와 구매 유도 영역을 우선 개선해야 합니다.`
    });
  } else if (metrics.conversions > 0) {
    items.push({
      type: 'good',
      text: `<strong>전환 흐름은 유지하되 확장 테스트를 권장합니다.</strong> 현재 전환율 ${formatPercent(metrics.cvr)} 기준으로 신규 소재 확장이나 키워드 확장을 병행해도 됩니다.`
    });
  }

  const lowRoasGroup = summarizeGroupRows(rows, row => row.adgroup)
    .filter(item => item.cost > 0)
    .sort((a, b) => a.roas - b.roas || b.cost - a.cost)[0];
  if (lowRoasGroup) {
    items.push({
      type: lowRoasGroup.roas <= 300 ? 'warn' : 'good',
      text: `<strong>${lowRoasGroup.name}</strong> 광고그룹을 우선 확인하세요. 현재 광고비 ${formatCurrency(lowRoasGroup.cost)}, 매출 ${formatCurrency(lowRoasGroup.revenue)}, ROAS ${formatPercent(lowRoasGroup.roas)}로 집계되었습니다.`
    });
  }

  const topCampaign = summarizeGroupRows(rows, row => row.campaign)
    .filter(item => item.cost > 0)
    .sort((a, b) => b.revenue - a.revenue || b.roas - a.roas)[0];
  if (topCampaign) {
    items.push({
      type: 'good',
      text: `<strong>${topCampaign.name}</strong> 캠페인은 유지 또는 확장 후보입니다. 매출 ${formatCurrency(topCampaign.revenue)}, ROAS ${formatPercent(topCampaign.roas)} 기준으로 예산 재배분 우선순위에 둘 만합니다.`
    });
  }

  listEl.innerHTML = items.map(item => `<div class="insight ${item.type}">${item.text}</div>`).join('');
}

function renderPreview(rows) {
  const previewRows = rows.slice(0, 50);
  const columns = [
    { key: 'brand', label: 'Brand' },
    { key: 'salesPlatform', label: 'Sales platform' },
    { key: 'adPlatform', label: 'Ad platform' },
    { key: 'periodStart', label: 'Start date' },
    { key: 'periodEnd', label: 'End date' },
    { key: 'campaignType', label: 'Campaign type' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'adgroup', label: 'Ad group' },
    { key: 'keyword', label: 'Keyword / creative' },
    { key: 'cost', label: 'Cost', render: v => formatCurrency(v), num: true },
    { key: 'revenue', label: 'Revenue', render: v => formatCurrency(v), num: true },
    { key: 'clicks', label: 'Clicks', render: v => formatNumber(v), num: true },
    { key: 'conversions', label: 'Conversions', render: v => formatNumber(v), num: true }
  ];
  const previewTarget = document.getElementById('rawPreviewTable');
  if (previewTarget) previewTarget.innerHTML = tableHtml('rawPreviewTable', previewRows, columns, 'No normalized data stored.');
}

function renderImportsTable() {
  const rows = state.imports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => ({
    createdAt: item.createdAt.replace('T', ' ').slice(0, 16),
    fileName: item.fileName,
    memo: item.memo || '-',
    brand: normalizeBrandName(item.brand || '-'),
    salesPlatform: normalizeSalesPlatformName(item.salesPlatform || '-'),
    adPlatform: getImportPlatformValue(item) || '-',
    rowCount: item.rowCount,
    period: item.startDate && item.endDate ? `${item.startDate} ~ ${item.endDate}` : '-',
    action: `<div style="display:flex;gap:6px;justify-content:center;"><button class="inline-btn ghost" data-import-action="edit" data-import-id="${item.id}">Edit</button><button class="inline-btn danger" data-import-action="delete" data-import-id="${item.id}">Delete</button></div>`
  }));
  const columns = [
    { key: 'createdAt', label: 'Imported at' },
    { key: 'fileName', label: 'File name' },
    { key: 'brand', label: 'Brand' },
    { key: 'salesPlatform', label: 'Sales platform' },
    { key: 'adPlatform', label: 'Ad platform' },
    { key: 'memo', label: 'Memo' },
    { key: 'rowCount', label: 'Rows', render: v => formatNumber(v), num: true },
    { key: 'period', label: 'Period' },
    { key: 'action', label: 'Action', render: v => v, html: true }
  ];
  renderSimpleTable('importsTable', rows, columns, 'No imported batches yet.', { defaultSort: { key: 'createdAt', dir: 'desc' } });
}

function updateFilterOptions() {
  const brandFilter = document.getElementById('brandFilter');
  const platformFilter = document.getElementById('platformFilter');
  const campaignFilter = document.getElementById('campaignFilter');

  const ALL_VALUE = '__ALL__';
  const resolvedRows = getResolvedRows(state.rows);
  const brands = Array.from(new Set(resolvedRows.map(r => safeText(r.brand)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const currentBrand = brandFilter.value || '';
  brandFilter.innerHTML = `<option value="">Select brand</option><option value="${ALL_VALUE}">All</option>` + brands.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  brandFilter.value = (currentBrand === ALL_VALUE || brands.includes(currentBrand)) ? currentBrand : '';

  const brandScopedRows = !brandFilter.value || brandFilter.value === ALL_VALUE
    ? resolvedRows.slice()
    : resolvedRows.filter(r => rowMatchesBrand(r, brandFilter.value));
  const platforms = Array.from(new Set(brandScopedRows.map(r => safeText(r.adPlatform || r.salesPlatform)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const currentPlatform = platformFilter.value || '';
  platformFilter.innerHTML = `<option value="">Select ad platform</option><option value="${ALL_VALUE}">All</option>` + platforms.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  platformFilter.value = (currentPlatform === ALL_VALUE || platforms.includes(currentPlatform)) ? currentPlatform : '';

  if (!brandFilter.value || !platformFilter.value) {
    campaignFilter.innerHTML = `<option value="">Select brand and ad platform first</option>`;
    campaignFilter.value = '';
    campaignFilter.disabled = true;
  } else {
    const platformScopedRows = platformFilter.value === ALL_VALUE
      ? brandScopedRows
      : brandScopedRows.filter(r => rowMatchesPlatform(r, platformFilter.value));
    const campaigns = Array.from(new Set(platformScopedRows.map(r => safeText(r.campaign)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
    const currentCampaign = campaignFilter.value || '';
    campaignFilter.innerHTML = `<option value="">All campaigns</option>` + campaigns.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    campaignFilter.value = campaigns.includes(currentCampaign) ? currentCampaign : '';
    campaignFilter.disabled = false;
  }

  document.getElementById('storedRowsCount').textContent = formatNumber(state.rows.length);
  document.getElementById('storedImportsCount').textContent = formatNumber(state.imports.length);
}

function renderSelectionRequiredState() {
  const message = 'Select a brand and an ad platform to display dashboard analytics.';
  state.filteredRows = [];
  createKpis(null);
  document.getElementById('insightList').innerHTML = `<div class="insight warn">${message}</div>`;
  document.getElementById('advancementNote').textContent = message;
  document.getElementById('advancementList').innerHTML = `<div class="insight warn">${message}</div>`;
  document.getElementById('wowRangeNote').textContent = message;
  document.getElementById('wowTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('selectedDataTitle').textContent = 'Select data';
  document.getElementById('selectedDataNote').textContent = message;
  document.getElementById('selectedDataTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('previousWeekReportTitle').textContent = 'Week - 1';
  document.getElementById('currentWeekReportTitle').textContent = 'Week';
  document.getElementById('costRevenueChartNote').textContent = message;
  document.getElementById('clickConversionChartNote').textContent = message;
  document.getElementById('previousWeekReportTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('currentWeekReportTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('brandTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('platformTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('campaignTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('adgroupTable').innerHTML = `<div class="empty">${message}</div>`;
  document.getElementById('keywordTable').innerHTML = `<div class="empty">${message}</div>`;
  renderImportsTable();
  scheduleTableEnhancement();
}


function rowOverlaps(row, startDate, endDate) {
  const range = getRowEffectiveDateRange(row);
  const rowStart = parseMaybeDate(range.start);
  const rowEnd = parseMaybeDate(range.end || range.start);
  if (!rowStart || !rowEnd) return true;
  if (startDate && rowEnd < startDate) return false;
  if (endDate && rowStart > endDate) return false;
  return true;
}

function hasMeaningfulKeyword(value) {
  const keyword = String(value || '').trim();
  return !!keyword && keyword !== '-' && keyword.toLowerCase() !== 'all' && keyword !== '전체';
}

function metricsSignature(row) {
  return [
    Number(row.cost || 0),
    Number(row.revenue || 0),
    Number(row.impressions || 0),
    Number(row.clicks || 0),
    Number(row.conversions || 0)
  ].join('|');
}

function dimensionKeyWithoutKeyword(row) {
  const range = getRowEffectiveDateRange(row);
  return [
    safeText(row.brand, ''),
    safeText(row.salesPlatform, ''),
    safeText(getRowPlatformValue(row), ''),
    safeText(range.start, ''),
    safeText(range.end || range.start, ''),
    safeText(row.campaignType, ''),
    safeText(row.campaign, ''),
    safeText(row.adgroup, '')
  ].join('||');
}

function fullRowKey(row) {
  return [
    dimensionKeyWithoutKeyword(row),
    safeText(row.keyword, ''),
    metricsSignature(row)
  ].join('||');
}

function dedupeExactRows(rows) {
  const exactSeen = new Set();
  const exactDeduped = [];
  rows.forEach(row => {
    const key = fullRowKey(row);
    if (exactSeen.has(key)) return;
    exactSeen.add(key);
    exactDeduped.push(row);
  });
  return exactDeduped;
}

function aggregateMetricRows(rows, fallbackKeyword = '-') {
  if (!rows.length) return null;
  const base = { ...rows[0] };
  const range = getRowEffectiveDateRange(base);
  const metrics = calcMetrics(rows);
  return {
    ...base,
    periodStart: range.start,
    periodEnd: range.end || range.start,
    keyword: fallbackKeyword,
    cost: metrics.cost,
    revenue: metrics.revenue,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    conversions: metrics.conversions
  };
}

function groupRowsByDimension(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = dimensionKeyWithoutKeyword(row);
    if (!groups.has(key)) groups.set(key, { detail: [], summary: [] });
    const bucket = hasMeaningfulKeyword(row.keyword) ? 'detail' : 'summary';
    groups.get(key)[bucket].push(row);
  });
  return groups;
}

function getAnalyticsRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const grouped = groupRowsByDimension(dedupeExactRows(getResolvedRows(rows)));
  const result = [];
  grouped.forEach(({ detail, summary }) => {
    if (summary.length) {
      const summaryRow = aggregateMetricRows(summary, '-');
      if (summaryRow) result.push(summaryRow);
      return;
    }
    result.push(...detail);
  });
  return result;
}

function getCreativeAnalyticsRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const grouped = groupRowsByDimension(dedupeExactRows(getResolvedRows(rows)));
  const result = [];
  grouped.forEach(({ detail, summary }) => {
    if (detail.length) {
      result.push(...detail);
      return;
    }
    const summaryRow = aggregateMetricRows(summary, '-');
    if (summaryRow) result.push(summaryRow);
  });
  return result;
}

function applyFilters() {
  const brand = document.getElementById('brandFilter').value;
  const platform = document.getElementById('platformFilter').value;
  const campaign = document.getElementById('campaignFilter').value;
  const startDate = parseMaybeDate(document.getElementById('startDateFilter').value);
  const endDate = parseMaybeDate(document.getElementById('endDateFilter').value);
  const ALL_VALUE = '__ALL__';

  if (!brand || !platform) {
    renderSelectionRequiredState();
    return;
  }

  let baseRows = getResolvedRows(state.rows);
  if (brand !== ALL_VALUE) baseRows = baseRows.filter(r => rowMatchesBrand(r, brand));
  if (platform !== ALL_VALUE) baseRows = baseRows.filter(r => rowMatchesPlatform(r, platform));
  if (campaign) baseRows = baseRows.filter(r => safeText(r.campaign) === campaign);
  const scopedRows = baseRows.filter(row => rowOverlaps(row, startDate, endDate));

  const analyticsRows = getAnalyticsRows(scopedRows);
  const creativeRows = getCreativeAnalyticsRows(scopedRows);
  const weeklyBaseRows = baseRows.slice();
  state.filteredRows = analyticsRows;

  const metrics = calcMetrics(analyticsRows);
  createKpis(metrics);
  renderInsights(analyticsRows, metrics);
  renderAdvancement(analyticsRows, metrics);
  renderSummaryTables(analyticsRows, creativeRows);
  renderWeekOverWeek(creativeRows);
  renderWeeklyReportPanels(weeklyBaseRows);
  renderImportsTable();
  scheduleTableEnhancement();
}

async function persist() {
  state.rows = mergeUniqueRows(state.rows);
  state.imports = mergeUniqueImports(state.imports);
  const rowsPayload = JSON.stringify(state.rows);
  const importsPayload = JSON.stringify(state.imports);
  try {
    if (indexedDbAvailable()) {
      await idbSet(STORAGE_KEY, rowsPayload);
      await idbSet(IMPORTS_KEY, importsPayload);
      return;
    }
    localStorage.setItem(STORAGE_KEY, rowsPayload);
    localStorage.setItem(IMPORTS_KEY, importsPayload);
  } catch (error) {
    throw error;
  }
}

async function loadPersisted() {
  try {
    const remote = await loadRemoteDeploymentJson();
    let rowsRaw = '[]';
    let importsRaw = '[]';
    if (indexedDbAvailable()) {
      rowsRaw = await idbGet(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || '[]';
      importsRaw = await idbGet(IMPORTS_KEY) || localStorage.getItem(IMPORTS_KEY) || '[]';
    } else {
      rowsRaw = localStorage.getItem(STORAGE_KEY) || '[]';
      importsRaw = localStorage.getItem(IMPORTS_KEY) || '[]';
    }
    const localRows = JSON.parse(rowsRaw || '[]').map(normalizeRowRecord);
    const localImports = JSON.parse(importsRaw || '[]').map(normalizeImportRecord);
    state.imports = mergeUniqueImports(remote.imports, localImports);
    state.rows = hydrateRowsFromImports(mergeUniqueRows(remote.rows, localRows), state.imports);
  } catch (error) {
    console.error(error);
    state.rows = [];
    state.imports = [];
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function populateSelect(selectId, headers, autoValue) {
  const el = document.getElementById(selectId);
  const options = ['<option value="">Not selected</option>'].concat(headers.map(header => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`));
  el.innerHTML = options.join('');
  el.value = autoValue && headers.includes(autoValue) ? autoValue : '';
}

function renderMappingPreview(dataRows, headers) {
  const previewRows = dataRows.slice(0, 8);
  const columns = headers.slice(0, 8).map(header => ({ key: header, label: header }));
  document.getElementById('mappingPreview').innerHTML = tableHtml('mappingPreview', previewRows, columns, 'No preview data available.');
}

function guessAdPlatformName(fileName, headers, dataRows) {
  const inferredFromFileName = inferAdPlatformFromFileName(fileName);
  if (inferredFromFileName) return inferredFromFileName;
  const source = (fileName + ' ' + headers.join(' ') + ' ' + JSON.stringify(dataRows.slice(0, 3))).toLowerCase();
  if (source.includes('gfa') || source.includes('display')) return 'DA';
  if (source.includes('파워링크') || source.includes('쇼핑검색') || source.includes('searchad') || source.includes('naver')) return 'SA';
  if (source.includes('fb') || source.includes('meta') || source.includes('facebook') || source.includes('instagram')) return 'Meta';
  return '';
}

function openMappingModal(pending) {
  state.pending = pending;
  const modal = document.getElementById('mappingModal');
  const dateRange = extractDateRangeFromMeta(pending.metaText);
  const headers = pending.headers;

  const autoDate = autoDetectField(headers, 'dateColumn');
  const autoStartDate = autoDate ? '' : autoDetectField(headers, 'startDateColumn');
  const autoEndDate = autoDate ? '' : autoDetectField(headers, 'endDateColumn');

  populateSelect('mappingDateColumn', headers, autoDate);
  populateSelect('mappingStartDateColumn', headers, autoStartDate);
  populateSelect('mappingEndDateColumn', headers, autoEndDate);
  populateSelect('mappingCost', headers, autoDetectField(headers, 'cost'));
  populateSelect('mappingRevenue', headers, autoDetectField(headers, 'revenue'));
  populateSelect('mappingImpressions', headers, autoDetectField(headers, 'impressions'));
  populateSelect('mappingClicks', headers, autoDetectField(headers, 'clicks'));
  populateSelect('mappingConversions', headers, autoDetectField(headers, 'conversions'));
  populateSelect('mappingCampaignType', headers, autoDetectField(headers, 'campaignType'));
  populateSelect('mappingCampaign', headers, autoDetectField(headers, 'campaign'));
  populateSelect('mappingAdgroup', headers, autoDetectField(headers, 'adgroup'));
  populateSelect('mappingKeyword', headers, autoDetectField(headers, 'keyword'));

  document.getElementById('mappingFixedStart').value = dateRange.start || '';
  document.getElementById('mappingFixedEnd').value = dateRange.end || dateRange.start || '';

  const inferredMeta = inferImportMetaFromFileName(pending.fileName);
  const guessedAdPlatform = pending.prefill?.fixedAdPlatform || inferredMeta.adPlatform || guessAdPlatformName(pending.fileName, pending.headers, pending.dataRows) || '';
  const guessedSalesPlatform = pending.prefill?.fixedSalesPlatform || inferredMeta.salesPlatform || inferSalesPlatformFromAdPlatform(guessedAdPlatform) || '';
  const guessedBrand = pending.prefill?.fixedBrand || inferredMeta.brand || '';

  setFixedFieldOptions('mappingFixedBrand', PRESET_BRANDS, guessedBrand, 'Select brand');
  setFixedFieldOptions('mappingFixedSalesPlatform', PRESET_SALES_PLATFORMS, guessedSalesPlatform, 'Select sales platform');
  setFixedFieldOptions('mappingFixedAdPlatform', PRESET_AD_PLATFORMS, guessedAdPlatform, 'Select ad platform');

  if (pending.prefill) {
    const useAutoDateMapping = !pending.prefill.disableAutoDateMapping;
    populateSelect('mappingDateColumn', headers, useAutoDateMapping ? (pending.prefill.dateColumn || autoDate) : (pending.prefill.dateColumn || ''));
    populateSelect('mappingStartDateColumn', headers, useAutoDateMapping ? (pending.prefill.startDateColumn || autoStartDate) : (pending.prefill.startDateColumn || ''));
    populateSelect('mappingEndDateColumn', headers, useAutoDateMapping ? (pending.prefill.endDateColumn || autoEndDate) : (pending.prefill.endDateColumn || ''));
    populateSelect('mappingCost', headers, pending.prefill.cost || autoDetectField(headers, 'cost'));
    populateSelect('mappingRevenue', headers, pending.prefill.revenue || autoDetectField(headers, 'revenue'));
    populateSelect('mappingImpressions', headers, pending.prefill.impressions || autoDetectField(headers, 'impressions'));
    populateSelect('mappingClicks', headers, pending.prefill.clicks || autoDetectField(headers, 'clicks'));
    populateSelect('mappingConversions', headers, pending.prefill.conversions || autoDetectField(headers, 'conversions'));
    populateSelect('mappingCampaignType', headers, pending.prefill.campaignType || autoDetectField(headers, 'campaignType'));
    populateSelect('mappingCampaign', headers, pending.prefill.campaign || autoDetectField(headers, 'campaign'));
    populateSelect('mappingAdgroup', headers, pending.prefill.adgroup || autoDetectField(headers, 'adgroup'));
    populateSelect('mappingKeyword', headers, pending.prefill.keyword || autoDetectField(headers, 'keyword'));
    document.getElementById('mappingFixedStart').value = pending.prefill.fixedStart || dateRange.start || '';
    document.getElementById('mappingFixedEnd').value = pending.prefill.fixedEnd || dateRange.end || dateRange.start || '';
  }

  document.getElementById('mappingMemo').value = pending.prefill?.memo || '';
  document.getElementById('mappingSummaryText').innerHTML = `${state.editingImportId ? '<strong>Edit mode</strong> / ' : ''}File <strong>${escapeHtml(pending.fileName)}</strong> / Sheet <strong>${escapeHtml(pending.sheetName)}</strong> / Detected header row <strong>${pending.headerIndex + 1}</strong> / Data rows <strong>${formatNumber(pending.dataRows.length)}</strong>`;
  document.getElementById('detectedHeaderBadge').textContent = 'Header row ' + (pending.headerIndex + 1) + ' detected';

  const detectionNotes = [];
  if (autoDate) detectionNotes.push(`Auto-detected date column: ${autoDate}`);
  if (!autoDate && autoStartDate && autoEndDate) detectionNotes.push(`Auto-detected start/end date columns: ${autoStartDate} / ${autoEndDate}`);
  if (!autoDate && !autoStartDate && !autoEndDate && dateRange.start) detectionNotes.push(`Auto-detected date range from file metadata: ${dateRange.start} ~ ${dateRange.end || dateRange.start}`);
  if (guessedBrand) detectionNotes.push(`Auto-filled brand from file name: ${guessedBrand}`);
  if (guessedSalesPlatform) detectionNotes.push(`Auto-filled sales platform from file name: ${guessedSalesPlatform}`);
  if (guessedAdPlatform) detectionNotes.push(`Auto-filled ad platform from file name: ${guessedAdPlatform}`);

  document.getElementById('mappingDetectedInfo').textContent = detectionNotes.concat([pending.metaText]).join(' | ');
  document.getElementById('mappingFileName').textContent = 'File: ' + pending.fileName;
  document.getElementById('mappingSheetName').textContent = 'Sheet: ' + pending.sheetName;
  document.getElementById('mappingRowsCount').textContent = 'Rows: ' + formatNumber(pending.dataRows.length);

  renderMappingPreview(pending.dataRows, headers);
  modal.classList.add('show');
}

function closeMappingModal() {
  document.getElementById('mappingModal').classList.remove('show');
  state.pending = null;
  state.editingImportId = null;
  processQueuedFiles();
}

function simpleHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

async function normalizeImportedRows() {
  if (!state.pending) return;
  try {
    const getValue = id => document.getElementById(id).value.trim();
    const selectedBrand = getFixedFieldValue('mappingFixedBrand');
    const selectedSalesPlatform = getFixedFieldValue('mappingFixedSalesPlatform');
    const selectedAdPlatform = getFixedFieldValue('mappingFixedAdPlatform');
    const mapping = {
    brandColumn: '',
    fixedBrand: selectedBrand,
    salesPlatformColumn: '',
    fixedSalesPlatform: selectedSalesPlatform,
    adPlatformColumn: '',
    fixedAdPlatform: selectedAdPlatform,
    dateColumn: getValue('mappingDateColumn'),
    startDateColumn: getValue('mappingStartDateColumn'),
    endDateColumn: getValue('mappingEndDateColumn'),
    fixedStart: getValue('mappingFixedStart'),
    fixedEnd: getValue('mappingFixedEnd'),
    cost: getValue('mappingCost'),
    revenue: getValue('mappingRevenue'),
    impressions: getValue('mappingImpressions'),
    clicks: getValue('mappingClicks'),
    conversions: getValue('mappingConversions'),
    campaignType: getValue('mappingCampaignType'),
    campaign: getValue('mappingCampaign'),
    adgroup: getValue('mappingAdgroup'),
    keyword: getValue('mappingKeyword'),
    memo: getValue('mappingMemo')
  };

  const missing = ['cost', 'revenue', 'impressions', 'clicks', 'conversions'].filter(key => !mapping[key]);
  if (missing.length) {
    alert('필수 지표 컬럼이 누락되어 있습니다: ' + missing.join(', '));
    return;
  }
  if (!mapping.fixedBrand) {
    alert('브랜드는 필수입니다. 파일명 자동 입력값을 확인하거나 직접 입력해 주세요.');
    return;
  }
  if (!mapping.fixedSalesPlatform) {
    alert('판매 플랫폼은 필수입니다. 파일명 자동 입력값을 확인하거나 직접 입력해 주세요.');
    return;
  }
  if (!mapping.fixedAdPlatform && !mapping.fixedSalesPlatform) {
    alert('광고 플랫폼은 필수입니다. 파일명 자동 입력값을 확인하거나 직접 입력해 주세요.');
    return;
  }
  if (!mapping.dateColumn && !mapping.startDateColumn && !mapping.fixedStart) {
    alert('날짜 컬럼이 없으면 시작일 컬럼 또는 대체 시작일 입력이 필요합니다.');
    return;
  }

  const batchId = state.editingImportId || ('import_' + Date.now());
  const now = new Date().toISOString();
  const editingTarget = state.editingImportId
    ? state.imports.find(item => item.id === state.editingImportId) || null
    : null;

  const normalized = state.pending.dataRows.map((row, index) => {
    let start = '';
    let end = '';

    if (mapping.dateColumn) {
      start = parseDateValue(row[mapping.dateColumn]) || mapping.fixedStart || '';
      end = start;
    } else {
      start = mapping.startDateColumn ? (parseDateValue(row[mapping.startDateColumn]) || mapping.fixedStart || '') : (mapping.fixedStart || '');
      end = mapping.endDateColumn ? (parseDateValue(row[mapping.endDateColumn]) || start || mapping.fixedEnd || mapping.fixedStart || '') : (mapping.fixedEnd || start || mapping.fixedStart || '');
    }

    const rawSalesPlatform = safeText(mapping.fixedSalesPlatform, '미지정');
    const rawAdPlatform = safeText(mapping.fixedAdPlatform || mapping.fixedSalesPlatform, '미지정');
    const rawBrand = safeText(mapping.fixedBrand, '미지정');
    const normalizedSalesPlatform = normalizeSalesPlatformName(rawSalesPlatform);
    const normalizedAdPlatform = normalizeAdPlatformName(rawAdPlatform || normalizedSalesPlatform);

    return {
      id: batchId + '_' + index,
      importId: batchId,
      importFileName: normalizeUnicodeNfc(state.pending.fileName),
      importMemo: mapping.memo,
      brand: normalizeBrandName(rawBrand),
      salesPlatform: normalizedSalesPlatform,
      adPlatform: normalizedAdPlatform,
      platform: normalizedAdPlatform,
      periodStart: start || '',
      periodEnd: end || start || '',
      campaignType: mapping.campaignType ? safeText(row[mapping.campaignType]) : '-',
      campaign: mapping.campaign ? safeText(row[mapping.campaign]) : '-',
      adgroup: mapping.adgroup ? safeText(row[mapping.adgroup]) : '-',
      keyword: mapping.keyword ? safeText(row[mapping.keyword]) : '-',
      cost: toNumber(row[mapping.cost]),
      revenue: toNumber(row[mapping.revenue]),
      impressions: toNumber(row[mapping.impressions]),
      clicks: toNumber(row[mapping.clicks]),
      conversions: toNumber(row[mapping.conversions]),
      createdAt: now
    };
  }).filter(row => {
    if (!row.periodStart) return false;
    const hasMetrics = row.cost !== 0 || row.revenue !== 0 || row.impressions !== 0 || row.clicks !== 0 || row.conversions !== 0;
    const hasDimensions = [row.campaignType, row.campaign, row.adgroup, row.keyword].some(value => String(value || '').trim() && String(value).trim() !== '-');
    return hasMetrics || hasDimensions;
  });

  if (!normalized.length) {
    alert('가져올 수 있는 유효한 행이 없습니다. 날짜 및 지표 컬럼 매핑을 다시 확인해 주세요.');
    return;
  }

  const signature = simpleHash(JSON.stringify(normalized.map(row => [
    row.brand, row.salesPlatform, row.adPlatform, row.periodStart, row.periodEnd, row.campaignType, row.campaign, row.adgroup, row.keyword,
    row.cost, row.revenue, row.impressions, row.clicks, row.conversions
  ])));

  // 동일 파일 재업로드를 막지 않습니다.
  // 검색어 포함/미포함 파일을 함께 올리는 운영 방식에서는
  // 배치 단위 차단보다 분석 단계 중복 제거가 더 중요합니다.
  // 실제 지표 계산은 getAnalyticsRows()/getCreativeAnalyticsRows()에서
  // 검색어 포함/미포함 파일의 중복 집계를 제거한 뒤 진행됩니다.

  const dates = normalized.flatMap(row => [row.periodStart, row.periodEnd]).filter(Boolean).sort();
  const previousRows = state.rows.slice();
  const previousImports = state.imports.slice();
  const nextImport = {
    id: batchId,
    createdAt: editingTarget?.createdAt || now,
    fileName: normalizeUnicodeNfc(editingTarget?.fileName || state.pending.fileName),
    sheetName: editingTarget?.sheetName || state.pending.sheetName,
    memo: mapping.memo,
    brand: normalizeBrandName(mapping.fixedBrand),
    salesPlatform: normalizeSalesPlatformName(mapping.fixedSalesPlatform),
    adPlatform: normalizeAdPlatformName(mapping.fixedAdPlatform || mapping.fixedSalesPlatform),
    rowCount: normalized.length,
    startDate: dates[0] || mapping.fixedStart || editingTarget?.startDate || '',
    endDate: dates[dates.length - 1] || mapping.fixedEnd || editingTarget?.endDate || '',
    signature
  };

  if (state.editingImportId) {
    state.rows = state.rows.filter(row => row.importId !== state.editingImportId).concat(normalized);
    state.imports = state.imports.map(item => item.id === state.editingImportId ? nextImport : item);
  } else {
    state.rows = state.rows.concat(normalized);
    state.imports.push(nextImport);
  }

  state.imports = mergeUniqueImports(state.imports);
  state.rows = hydrateRowsFromImports(mergeUniqueRows(state.rows), state.imports);

  try {
    await persist();
  } catch (error) {
    console.error(error);
    state.rows = previousRows;
    state.imports = previousImports;
    const maybeQuota = String(error && (error.message || error.name) || '').toLowerCase();
    const quotaText = maybeQuota.includes('quota') || maybeQuota.includes('space') || maybeQuota.includes('storage');
    alert(quotaText
      ? '파일 크기 또는 누적 저장량이 커서 브라우저 저장소 한도를 넘었습니다. 이번 버전에서는 저장 방식을 개선했지만, 기존 누적 데이터가 많다면 Reset stored data 후 다시 업로드해 주세요.'
      : '파일 가져오기 중 오류가 발생했습니다. 컬럼 매핑과 날짜 컬럼을 다시 확인해 주세요.');
    return;
  }
  updateFilterOptions();
  applyFilters();
  document.getElementById('uploadStatus').innerHTML = state.editingImportId
    ? `<strong>${escapeHtml(nextImport.fileName)}</strong>: <strong>${formatNumber(normalized.length)}개 행</strong> 수정 내용이 저장되었습니다.`
    : `<strong>${escapeHtml(state.pending.fileName)}</strong>: <strong>${formatNumber(normalized.length)}개 행</strong>을 가져와 저장했습니다.${state.fileQueue.length ? ` 대기 중인 파일 <strong>${formatNumber(state.fileQueue.length)}개</strong>.` : ''}`;
  closeMappingModal();
  } catch (error) {
    console.error(error);
    alert('가져오기 처리 중 오류가 발생했습니다. 필수 컬럼 매핑과 날짜 설정을 다시 확인해 주세요.');
  }
}

function downloadNormalizedXlsx() {
  if (!state.rows.length) {
    alert('다운로드할 Raw data가 없습니다.');
    return;
  }
  const exportRows = getAnalyticsRows(state.rows);
  const headers = ['brand', 'salesPlatform', 'adPlatform', 'periodStart', 'periodEnd', 'campaignType', 'campaign', 'adgroup', 'keyword', 'cost', 'revenue', 'impressions', 'clicks', 'conversions', 'importFileName', 'importMemo', 'createdAt'];
  const aoa = [headers].concat(exportRows.map(r => ([
    normalizeUnicodeNfc(r.brand ?? ''),
    normalizeUnicodeNfc(r.salesPlatform ?? ''),
    normalizeUnicodeNfc(r.adPlatform ?? r.platform ?? ''),
    normalizeUnicodeNfc(r.periodStart ?? ''),
    normalizeUnicodeNfc(r.periodEnd ?? ''),
    normalizeUnicodeNfc(r.campaignType ?? ''),
    normalizeUnicodeNfc(r.campaign ?? ''),
    normalizeUnicodeNfc(r.adgroup ?? ''),
    normalizeUnicodeNfc(r.keyword ?? ''),
    Number(r.cost || 0),
    Number(r.revenue || 0),
    Number(r.impressions || 0),
    Number(r.clicks || 0),
    Number(r.conversions || 0),
    normalizeUnicodeNfc(r.importFileName ?? ''),
    normalizeUnicodeNfc(r.importMemo ?? ''),
    normalizeUnicodeNfc(r.createdAt ?? '')
  ])));

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [
    { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 28 }, { wch: 24 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 22 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'raw_data');
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, 'ad_dashboard_raw_data.xlsx');
}



function buildJsonExportRows() {
  const sourceRows = Array.isArray(state.rows) ? state.rows : [];
  const unique = new Map();
  sourceRows.forEach(row => {
    if (!row) return;
    const normalized = normalizeRowRecord(row);
    const key = JSON.stringify([
      normalized.brand,
      normalized.salesPlatform,
      normalized.adPlatform,
      normalized.periodStart,
      normalized.periodEnd,
      normalized.campaignType,
      normalized.campaign,
      normalized.adgroup,
      normalized.keyword,
      normalized.cost,
      normalized.revenue,
      normalized.impressions,
      normalized.clicks,
      normalized.conversions,
      normalized.importFileName,
      normalized.importMemo
    ]);
    if (!unique.has(key)) unique.set(key, normalized);
  });
  return Array.from(unique.values());
}

function buildJsonExportImports() {
  const sourceImports = Array.isArray(state.imports) ? state.imports : [];
  const unique = new Map();
  sourceImports.forEach(item => {
    if (!item) return;
    const normalized = normalizeImportRecord(item);
    const key = JSON.stringify([
      normalized.fileName,
      normalized.sheetName,
      normalized.brand,
      normalized.salesPlatform,
      normalized.adPlatform,
      normalized.startDate,
      normalized.endDate,
      normalized.signature,
      normalized.rowCount
    ]);
    if (!unique.has(key)) unique.set(key, normalized);
  });
  return Array.from(unique.values());
}

async function downloadDashboardJson() {
  const statusEl = document.getElementById('uploadStatus');
  const buttonEl = document.getElementById('downloadJsonBtn');

  if (buttonEl) buttonEl.disabled = true;
  if (statusEl) statusEl.textContent = 'JSON 파일들을 준비하고 있습니다.';

  try {
    await new Promise(resolve => setTimeout(resolve, 0));

    const rows = buildJsonExportRows();
    const imports = buildJsonExportImports();

    if (!rows.length && !imports.length) {
      alert('다운로드할 JSON 데이터가 없습니다.');
      if (statusEl) statusEl.textContent = '다운로드할 JSON 데이터가 없습니다.';
      return;
    }

    const grouped = new Map();
    rows.forEach(row => {
      const key = getDeploymentMonthKey(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    const monthKeys = Array.from(grouped.keys()).sort(compareMonthKeysAsc);
    const manifest = {
      version: 2,
      exportedAt: new Date().toISOString(),
      totalRows: rows.length,
      totalImports: imports.length,
      imports,
      chunks: monthKeys.map(key => ({
        file: `rows_${key}.json`,
        month: key,
        rowCount: (grouped.get(key) || []).length
      }))
    };

    const filesToDownload = [
      {
        fileName: 'dashboard-data__index.json',
        payload: manifest
      },
      ...monthKeys.map(key => ({
        fileName: `dashboard-data__rows_${key}.json`,
        payload: {
          version: 1,
          month: key,
          rowCount: (grouped.get(key) || []).length,
          rows: grouped.get(key) || []
        }
      })),
      {
        fileName: 'data.json',
        payload: {
          version: 1,
          exportedAt: manifest.exportedAt,
          rows,
          imports
        }
      }
    ];

    filesToDownload.forEach((item, index) => {
      const blob = new Blob([JSON.stringify(item.payload)], { type: 'application/json;charset=utf-8' });
      setTimeout(() => triggerDownload(blob, item.fileName), index * 300);
    });

    if (statusEl) {
      statusEl.textContent = `JSON 파일 ${filesToDownload.length}개 다운로드를 시작했습니다. 브라우저에서 다중 다운로드 허용이 필요할 수 있습니다.`;
    }
    alert(`JSON 파일 ${filesToDownload.length}개 다운로드를 시작했습니다. GitHub에는 그대로 올리셔도 됩니다. dashboard-data__index.json / dashboard-data__rows_YYYY_MM.json 형식도 이번 버전에서 읽을 수 있습니다.`);
  } catch (error) {
    console.error(error);
    if (statusEl) statusEl.textContent = 'JSON 파일 다운로드 중 오류가 발생했습니다.';
    alert('JSON down 처리 중 오류가 발생했습니다.');
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}
function triggerDownload(blob, fileName) {
  if (typeof saveAs === 'function') {
    saveAs(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) link.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

function editImport(importId) {
  const target = state.imports.find(item => item.id === importId);
  if (!target) return;

  const sourceRows = state.rows
    .filter(row => row.importId === importId)
    .map(row => normalizeRowRecord(row));

  if (!sourceRows.length) {
    alert('수정할 배치 행이 없습니다.');
    return;
  }

  const headers = ['periodStart','periodEnd','cost','revenue','impressions','clicks','conversions','campaignType','campaign','adgroup','keyword'];
  const dataRows = sourceRows.map(row => ({
    periodStart: row.periodStart || '',
    periodEnd: row.periodEnd || '',
    cost: row.cost,
    revenue: row.revenue,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    campaignType: row.campaignType,
    campaign: row.campaign,
    adgroup: row.adgroup,
    keyword: row.keyword
  }));

  state.editingImportId = importId;
  openMappingModal({
    fileName: target.fileName || 'Imported batch',
    sheetName: target.sheetName || 'Imported rows',
    headers,
    dataRows,
    headerIndex: 0,
    metaText: `${target.startDate || ''} ~ ${target.endDate || ''}`.trim(),
    prefill: {
      fixedBrand: target.brand || '',
      fixedSalesPlatform: target.salesPlatform || '',
      fixedAdPlatform: target.adPlatform || target.salesPlatform || '',
      fixedStart: target.startDate || '',
      fixedEnd: target.endDate || '',
      cost: 'cost',
      revenue: 'revenue',
      impressions: 'impressions',
      clicks: 'clicks',
      conversions: 'conversions',
      campaignType: 'campaignType',
      campaign: 'campaign',
      adgroup: 'adgroup',
      keyword: 'keyword',
      dateColumn: '',
      startDateColumn: '',
      endDateColumn: '',
      disableAutoDateMapping: true,
      memo: target.memo || ''
    }
  });
}

function deleteImport(importId) {
  const target = state.imports.find(item => item.id === importId);
  if (!target) return;
  const proceed = confirm('배치 ' + target.fileName + ' 을(를) 삭제하시겠습니까? 이 배치에서 가져온 모든 행이 함께 삭제됩니다.');
  if (!proceed) return;
  state.rows = state.rows.filter(row => row.importId !== importId);
  state.imports = state.imports.filter(item => item.id !== importId);
  persist();
  updateFilterOptions();
  applyFilters();
}

function updateQueueStatus(extraText = '') {
  const queueCount = state.fileQueue.length;
  const readingText = state.isReadingFile ? ' 파일을 읽는 중입니다.' : '';
  const queueText = queueCount ? ` 대기 중인 파일 ${formatNumber(queueCount)}개.` : '';
  if (extraText) {
    document.getElementById('uploadStatus').textContent = extraText + queueText + readingText;
    return;
  }
  if (queueCount || state.isReadingFile) {
    document.getElementById('uploadStatus').textContent = '파일 업로드를 진행 중입니다.' + queueText + readingText;
  }
}

async function processQueuedFiles() {
  if (state.isReadingFile || state.pending || !state.fileQueue.length) return;
  const file = state.fileQueue.shift();
  state.isReadingFile = true;
  updateQueueStatus(`${file.name} 파일을 읽는 중입니다...`);
  try {
    const pending = await readWorkbook(file);
    if (!pending.dataRows.length) {
      const message = `${file.name} 파일에서 가져올 데이터 행을 찾지 못했습니다.`;
      updateQueueStatus(message);
      alert(message);
    } else {
      openMappingModal(pending);
    }
  } catch (error) {
    console.error(error);
    const message = `${file.name} 파일을 읽지 못했습니다. 유효한 CSV/XLSX 파일인지 확인해 주세요.`;
    updateQueueStatus(message);
    alert(message);
  } finally {
    state.isReadingFile = false;
    if (!state.pending) processQueuedFiles();
  }
}

function enqueueFiles(fileList) {
  const files = Array.from(fileList || []).filter(file => /\.(csv|xlsx|xls|xlsm|xlsb)$/i.test(file.name));
  if (!files.length) {
    document.getElementById('uploadStatus').textContent = 'CSV/XLSX 파일만 업로드할 수 있습니다.';
    return;
  }
  state.fileQueue.push(...files);
  updateQueueStatus(`${formatNumber(files.length)}개 파일을 업로드 대기열에 추가했습니다.`);
  processQueuedFiles();
}

function bindDropzone() {
  const dropzone = document.getElementById('uploadDropzone');
  const prevent = event => {
    event.preventDefault();
    event.stopPropagation();
  };
  ['dragenter', 'dragover'].forEach(type => {
    dropzone.addEventListener(type, event => {
      prevent(event);
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(type => {
    dropzone.addEventListener(type, event => {
      prevent(event);
      if (type !== 'drop') dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', event => {
    dropzone.classList.remove('dragover');
    const files = event.dataTransfer ? event.dataTransfer.files : null;
    enqueueFiles(files);
  });
}

async function clearAllStorage() {
  const proceed = confirm('저장된 대시보드 데이터를 모두 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.');
  if (!proceed) return;
  const entered = prompt('초기화를 진행하려면 비밀번호를 입력해 주세요.');
  if (entered === null) return;
  if (String(entered) !== RESET_PASSWORD) {
    alert('비밀번호가 올바르지 않습니다. 저장된 데이터는 삭제되지 않았습니다.');
    return;
  }
  state.rows = [];
  state.imports = [];
  try {
    if (indexedDbAvailable()) await idbClear();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(IMPORTS_KEY);
  } catch (error) {
    console.error(error);
    alert('저장 데이터 초기화 중 오류가 발생했습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }
  updateFilterOptions();
  applyFilters();
  document.getElementById('uploadStatus').textContent = '저장된 데이터를 초기화했습니다.';
}

function onFileChange(event) {
  enqueueFiles(event.target.files);
  event.target.value = '';
}

function bindEvents() {
  document.getElementById('fileInput').addEventListener('change', onFileChange);
  bindDropzone();
  document.getElementById('confirmImportBtn').addEventListener('click', normalizeImportedRows);
  document.getElementById('cancelMappingBtn').addEventListener('click', closeMappingModal);
  document.getElementById('downloadNormalizedBtn').addEventListener('click', downloadNormalizedXlsx);
  document.getElementById('downloadJsonBtn').addEventListener('click', downloadDashboardJson);
  document.getElementById('clearStorageBtn').addEventListener('click', clearAllStorage);

  ['brandFilter', 'platformFilter', 'campaignFilter', 'startDateFilter', 'endDateFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (id === 'brandFilter' || id === 'platformFilter') updateFilterOptions();
      applyFilters();
    });
  });

  document.getElementById('importsTable').addEventListener('click', event => {
    const button = event.target.closest('[data-import-id]');
    if (!button) return;
    const action = button.getAttribute('data-import-action') || 'delete';
    const importId = button.getAttribute('data-import-id');
    if (action === 'edit') {
      editImport(importId);
      return;
    }
    deleteImport(importId);
  });

  document.getElementById('mappingModal').addEventListener('click', event => {
    if (event.target.id === 'mappingModal') closeMappingModal();
  });

  document.addEventListener('click', event => {
    const sortButton = event.target.closest('.sort-btn[data-sort-table][data-sort-key]');
    if (!sortButton) return;
    event.preventDefault();
    event.stopPropagation();
    const tableId = sortButton.getAttribute('data-sort-table');
    const key = sortButton.getAttribute('data-sort-key');
    const sortStore = isWeeklySortTableId(tableId) ? state.weeklySorts : state.tableSorts;
    const current = sortStore[tableId];
    sortStore[tableId] = current && current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' };
    applyFilters();
  });

}

async function init() {
  await loadPersisted();
  bindEvents();
  updateFilterOptions();
  createKpis(calcMetrics([]));
  applyFilters();
}

init().catch(error => {
  console.error(error);
  alert('대시보드 초기화 중 오류가 발생했습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요.');
});
