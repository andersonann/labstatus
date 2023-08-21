/* ════════════════════════════════════════
   ANALYSIS.JS — Lógica de Análisis
   LabStatus Pro

   Depende de: auth.js (supaClient, authState)
════════════════════════════════════════ */

// ════════════════════════════════════════
//  STATE
// ════════════════════════════════════════
let payload      = [];   // [{orderId, orderCode, client, subCode, subId, params:[]}]
let tableData    = {};   // {paramName: [{subCode, subId, lectura, mr, extra:{}}]}
let extraCols    = {};   // {paramName: [colName, ...]}
let histRecords  = [];   // registros cargados desde Supabase
let expandedHist = null;

// ════════════════════════════════════════
//  SYNC INDICATOR
// ════════════════════════════════════════
function setSyncStatus(s) {
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLbl');
  if (!dot || !lbl) return;
  dot.style.background = s === 'syncing' ? 'var(--yellow)' : s === 'error' ? 'var(--red)' : 'var(--green)';
  lbl.textContent = s === 'syncing' ? 'guardando...' : s === 'error' ? 'error' : 'guardado';
}

// ════════════════════════════════════════
//  INIT — se llama desde initAuth() en auth.js
// ════════════════════════════════════════
function init() {
  const raw = sessionStorage.getItem('analyze_payload');
  if (!raw) {
    showEmpty();
  } else {
    try {
      payload = JSON.parse(raw);
      if (payload.length) buildTables();
      else showEmpty();
    } catch(e) { showEmpty(); }
  }
  loadHistory();
}

function showEmpty() {
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('tablesContainer').style.display = 'none';
}

// ════════════════════════════════════════
//  BUILD TABLES FROM PAYLOAD
//  Recupera datos previos del historial si existen
// ════════════════════════════════════════
function buildTables() {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('tablesContainer').style.display = 'block';

  const pm = {};
  payload.forEach(s => {
    s.params.forEach(p => {
      if (!pm[p]) pm[p] = [];
      if (!pm[p].find(x => x.subId === s.subId))
        pm[p].push({ subCode: s.subCode, subId: s.subId });
    });
  });

  tableData = {};
  extraCols  = {};
  Object.entries(pm).forEach(([param, rows]) => {
    tableData[param] = rows.map(r => ({ subCode: r.subCode, subId: r.subId, lectura: '', mr: '', fd: '', extra: {} }));
    extraCols[param] = [];
  });

  // Intentar rellenar con datos del historial más reciente que tenga estas muestras
  _restoreFromHistory();

  renderAll();
  updateStatusBar();
}

// Busca en histRecords el registro más reciente que contenga
// alguna de las muestras actuales y pre-rellena los inputs
function _restoreFromHistory() {
  if (!histRecords.length) return;
  const subIds = new Set(payload.map(s => s.subId));

  // Recorrer del más reciente al más antiguo
  for (const rec of histRecords) {
    let matched = false;
    Object.entries(rec.tableData || {}).forEach(([param, rows]) => {
      if (!tableData[param]) return;
      rows.forEach(hr => {
        if (!subIds.has(hr.subId)) return;
        const local = tableData[param].find(r => r.subId === hr.subId);
        if (!local) return;
        // Solo pre-rellenar si el local está vacío
        if (!local.lectura && hr.lectura) local.lectura = hr.lectura;
        if (!local.mr      && hr.mr)      local.mr      = hr.mr;
        if (!local.fd      && hr.fd)      local.fd      = hr.fd;
        if (hr.extra) {
          Object.entries(hr.extra).forEach(([k, v]) => {
            if (!local.extra[k] && v) local.extra[k] = v;
          });
        }
        matched = true;
      });
      // Restaurar columnas extra
      if (matched && rec.extraCols?.[param]) {
        rec.extraCols[param].forEach(col => {
          if (!extraCols[param].includes(col)) extraCols[param].push(col);
        });
      }
    });
    if (matched) break; // Usar solo el más reciente que coincida
  }
}

// ════════════════════════════════════════
//  RENDER ALL ACTIVE TABLES
// ════════════════════════════════════════
function renderAll() {
  const container = document.getElementById('tablesContainer');
  const params = Object.keys(tableData);
  if (!params.length) { showEmpty(); return; }
  container.innerHTML = params.map(p => renderTable(p)).join('');
}

function renderTable(param) {
  const rows   = tableData[param];
  const ec     = extraCols[param] || [];
  const allLec = rows.every(r => r.lectura.trim() !== '');
  const hasMR  = rows.some(r => r.mr.trim() !== '');
  const stCls  = allLec && hasMR ? 'ts-ok' : !allLec ? 'ts-err' : 'ts-warn';
  const stTxt  = allLec && hasMR ? '✓ Completo' : !allLec ? '⚠ Faltan lecturas' : '⚠ Sin MR';

  const extraTh = ec.map(col =>
    `<th>${esc(col)} <button class="btn-addcol" style="padding:1px 4px;font-size:9px"
      onclick="removeCol('${esc(param)}','${esc(col)}')">✕</button></th>`
  ).join('');

  const rowsHtml = rows.map((r, i) => {
    const lFilled = r.lectura.trim() !== '';
    const extraTd = ec.map(col =>
      `<td class="cell-in"><input type="text" value="${esc(r.extra[col] || '')}" placeholder="-"
        oninput="setExtra('${esc(param)}',${i},'${esc(col)}',this.value)"></td>`
    ).join('');
    return `
    <tr>
      <td class="cell-code">${esc(r.subCode)}</td>
      <td class="cell-in">
        <input type="number" step="any" value="${esc(r.lectura)}" placeholder="Lectura"
          class="no-spin${lFilled ? ' filled' : ''}" id="lec_${slugify(param)}_${i}"
          oninput="setLectura('${esc(param)}',${i},this.value)">
      </td>
      <td class="cell-in">
        <input type="number" step="any" value="${esc(r.mr)}" placeholder="MR (opt.)"
          class="no-spin${r.mr.trim() ? ' filled' : ''}"
          oninput="setMR('${esc(param)}',${i},this.value)">
      </td>
      <td class="cell-in">
        <input type="number" step="any" value="${esc(r.fd || '')}" placeholder="FD (opt.)"
          class="no-spin${(r.fd||'').trim() ? ' filled' : ''}"
          oninput="setFD('${esc(param)}',${i},this.value)">
      </td>
      ${extraTd}
      <td class="cell-st ${lFilled ? 'st-ok' : 'st-muted'}">${lFilled ? '✓' : '—'}</td>
    </tr>`;
  }).join('');

  return `
  <div class="table-card" id="tc_${slugify(param)}">
    <div class="table-card-header">
      <div>
        <div class="param-title">${esc(param)}</div>
        <div class="param-meta">${rows.length} muestra${rows.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="header-right">
        <button class="btn-addcol" onclick="addCol('${esc(param)}')">+ Columna</button>
        <span class="table-status ${stCls}" id="ts_${slugify(param)}">${stTxt}</span>
      </div>
    </div>
    <div class="data-wrap">
      <table>
        <thead><tr><th>Muestra</th><th>Lectura</th><th>MR</th><th>FD</th>${extraTh}<th>Estado</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="mr-note">* MR = Material de Referencia. FD = Factor de Dilución (opcional).</div>
  </div>`;
}

// ════════════════════════════════════════
//  DATA SETTERS — actualizan modelo sin re-render completo
// ════════════════════════════════════════
function setLectura(param, idx, val) {
  tableData[param][idx].lectura = val;
  const el = document.getElementById('lec_' + slugify(param) + '_' + idx);
  if (el) el.className = val.trim() ? 'filled' : '';
  updateTableStatus(param);
  updateStatusBar();
}
function setMR(param, idx, val) {
  tableData[param][idx].mr = val;
  updateTableStatus(param);
  updateStatusBar();
}
function setFD(param, idx, val) {
  tableData[param][idx].fd = val;
}
function setExtra(param, idx, col, val) {
  if (!tableData[param][idx].extra) tableData[param][idx].extra = {};
  tableData[param][idx].extra[col] = val;
}

function updateTableStatus(param) {
  const rows   = tableData[param] || [];
  const allLec = rows.every(r => r.lectura.trim() !== '');
  const hasMR  = rows.some(r => r.mr.trim() !== '');
  const el = document.getElementById('ts_' + slugify(param));
  if (!el) return;
  if (allLec && hasMR)  { el.className = 'table-status ts-ok';   el.textContent = '✓ Completo'; }
  else if (!allLec)     { el.className = 'table-status ts-err';  el.textContent = '⚠ Faltan lecturas'; }
  else                  { el.className = 'table-status ts-warn'; el.textContent = '⚠ Sin MR'; }
}

function updateStatusBar() {
  const params = Object.keys(tableData);
  let totalR = 0, filledR = 0, tabsMR = 0;
  params.forEach(p => {
    tableData[p].forEach(r => { totalR++; if (r.lectura.trim()) filledR++; });
    if (tableData[p].some(r => r.mr.trim())) tabsMR++;
  });
  const allSubs = new Set(payload.map(s => s.subCode)).size;
  document.getElementById('stTotal').textContent   = `${allSubs} muestras · ${params.length} parámetros`;
  document.getElementById('stMissing').textContent = totalR - filledR > 0 ? `${totalR - filledR} lecturas faltantes` : '✓ Todas ingresadas';
  document.getElementById('stMR').textContent      = tabsMR === params.length ? '✓ MR en todas las tablas' : `⚠ ${params.length - tabsMR} tabla(s) sin MR`;
}

// ════════════════════════════════════════
//  EXTRA COLUMNS
// ════════════════════════════════════════
function addCol(param) {
  const name = prompt('Nombre de columna (ej: Dilución, Abs):');
  if (!name?.trim()) return;
  const col = name.trim();
  if (extraCols[param].includes(col)) return;
  extraCols[param].push(col);
  tableData[param].forEach(r => { r.extra[col] = ''; });
  reRenderTable(param);
}
function removeCol(param, col) {
  extraCols[param] = extraCols[param].filter(c => c !== col);
  tableData[param].forEach(r => { delete r.extra[col]; });
  reRenderTable(param);
}
function reRenderTable(param) {
  const old = document.getElementById('tc_' + slugify(param));
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderTable(param);
  old.replaceWith(tmp.firstElementChild);
}

// ════════════════════════════════════════
//  VALIDATE
// ════════════════════════════════════════
function validateAll() {
  const params = Object.keys(tableData);
  let ok = 0, warn = 0, err = 0;
  params.forEach(p => {
    const allLec = tableData[p].every(r => r.lectura.trim() !== '');
    const hasMR  = tableData[p].some(r => r.mr.trim() !== '');
    if (allLec && hasMR) ok++;
    else if (!allLec)    err++;
    else                 warn++;
  });
  renderAll();
  const card = document.getElementById('summaryCard');
  card.style.display = 'block';
  document.getElementById('summaryGrid').innerHTML = `
    <div class="result-item"><div class="result-num green">${ok}</div><div class="result-label">Tablas OK</div></div>
    <div class="result-item"><div class="result-num yellow">${warn}</div><div class="result-label">Sin MR</div></div>
    <div class="result-item"><div class="result-num red">${err}</div><div class="result-label">Incompletas</div></div>
    <div class="result-item"><div class="result-num blue">${params.length}</div><div class="result-label">Total params</div></div>`;
  card.scrollIntoView({ behavior: 'smooth' });
}

// ════════════════════════════════════════
//  EXPORTAR TXT
// ════════════════════════════════════════
function exportTxt(record = null) {
  const isHist  = record !== null;
  const date    = isHist ? new Date(record.savedAt) : new Date();
  const dateStr = date.toLocaleString('es-PE');
  const data    = isHist ? record.tableData : tableData;
  const ec      = isHist ? record.extraCols : extraCols;
  const codes   = isHist
    ? [...new Set(Object.values(data).flatMap(rows => rows.map(r => r.subCode)))]
    : [...new Set(payload.map(s => s.subCode))];

  if (!Object.keys(data).length) { showToast('⚠ Sin datos para exportar', true); return; }

  let txt = '==================================================\n';
  txt    += '  LABSTATUS PRO — REPORTE DE ANÁLISIS\n';
  txt    += `  Fecha    : ${dateStr}\n`;
  txt    += `  Muestras : ${codes.join(', ')}\n`;
  txt    += '==================================================\n\n';

  Object.entries(data).forEach(([param, rows]) => {
    txt += `PARÁMETRO: ${param}\n`;
    txt += '─'.repeat(48) + '\n';
    const cols = ['Muestra', 'Lectura', 'MR', 'FD', ...(ec[param] || [])];
    txt += cols.map(c => c.padEnd(16)).join('') + '\n';
    txt += '─'.repeat(cols.length * 16) + '\n';
    rows.forEach(r => {
      const vals = [
        (r.subCode || '').padEnd(16),
        (r.lectura || '—').padEnd(16),
        (r.mr || '—').padEnd(16),
        (r.fd || '—').padEnd(16),
        ...(ec[param] || []).map(col => (r.extra?.[col] || '—').padEnd(16))
      ];
      txt += vals.join('') + '\n';
    });
    txt += '\n';
  });

  txt += '==================================================\n';
  txt += '  Generado por LabStatus Pro\n';
  txt += '==================================================\n';

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `analisis_${(codes[0] || 'reporte').replace(/\//g, '-')}_${date.toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📄 TXT descargado');
}

// ════════════════════════════════════════
//  GUARDAR EN SUPABASE HISTORIAL
//  — usa supaClient de auth.js automáticamente (token correcto)
// ════════════════════════════════════════
async function saveToHistory() {
  const codes = [...new Set(payload.map(s => s.subCode))];
  if (!codes.length) return null;

  const record = {
    id:       crypto.randomUUID(),
    codes:    codes.join(', '),
    saved_at: new Date().toISOString(),
    data:     JSON.stringify({ tableData, extraCols, payload, savedAt: new Date().toISOString() })
  };

  setSyncStatus('syncing');
  try {
    const { error } = await supaClient
      .from('analysis_history')
      .insert(record);

    if (error) throw error;

    setSyncStatus('ok');
    histRecords.unshift({
      id:        record.id,
      codes:     record.codes,
      savedAt:   record.saved_at,
      tableData: JSON.parse(JSON.stringify(tableData)),
      extraCols: JSON.parse(JSON.stringify(extraCols)),
      payload:   JSON.parse(JSON.stringify(payload))
    });
    renderHistory();
    return record;
  } catch(e) {
    console.error('saveToHistory error:', e);
    setSyncStatus('error');
    return null;
  }
}

// ════════════════════════════════════════
//  CARGAR HISTORIAL DESDE SUPABASE
// ════════════════════════════════════════
async function loadHistory() {
  try {
    const { data, error } = await supaClient
      .from('analysis_history')
      .select('id, codes, saved_at, data')
      .order('saved_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    histRecords = (data || []).map(r => {
      let parsed = {};
      try { parsed = JSON.parse(r.data); } catch(e) {}
      return {
        id:        r.id,
        codes:     r.codes,
        savedAt:   r.saved_at,
        tableData: parsed.tableData || {},
        extraCols: parsed.extraCols || {},
        payload:   parsed.payload   || []
      };
    });
    renderHistory();
  } catch(e) {
    console.error('loadHistory error:', e);
    document.getElementById('historyList').innerHTML =
      '<div class="hist-empty">⚠ No se pudo cargar el historial. Verifica tu conexión o que la tabla analysis_history exista en Supabase.</div>';
  }
}

async function deleteHistRecord(id) {
  if (!confirm('¿Eliminar este registro del historial? No se puede deshacer.')) return;
  try {
    const { error } = await supaClient
      .from('analysis_history')
      .delete()
      .eq('id', id);

    if (error) throw error;
    histRecords = histRecords.filter(r => r.id !== id);
    if (expandedHist === id) expandedHist = null;
    renderHistory();
    showToast('🗑 Registro eliminado');
  } catch(e) {
    showToast('⚠ Error al eliminar', true);
  }
}

// ════════════════════════════════════════
//  RENDER HISTORIAL
// ════════════════════════════════════════
function renderHistory() {
  const q      = (document.getElementById('histSearch')?.value || '').toLowerCase().trim();
  const list   = document.getElementById('historyList');

  let filtered = histRecords;
  if (q) {
    filtered = histRecords.filter(r =>
      r.codes.toLowerCase().includes(q) ||
      new Date(r.savedAt).toLocaleString('es-PE').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="hist-empty">${q ? `Sin resultados para "${esc(q)}"` : 'Sin registros de análisis aún'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(r => {
    const isOpen  = expandedHist === r.id;
    const params  = Object.keys(r.tableData);
    const dateStr = new Date(r.savedAt).toLocaleString('es-PE');
    const chips   = params.map(p => `<span class="hist-chip">${esc(p)}</span>`).join('');

    const bodyHtml = params.map(param => {
      const rows = r.tableData[param] || [];
      const ec   = r.extraCols[param] || [];
      const extraTh  = ec.map(c => `<th>${esc(c)}</th>`).join('');
      const rowsHtml = rows.map(row => `
        <tr>
          <td>${esc(row.subCode || '')}</td>
          <td class="${row.lectura ? 'td-lec' : 'td-empty'}">${esc(row.lectura || '—')}</td>
          <td class="${row.mr ? 'td-mr' : 'td-empty'}">${esc(row.mr || '—')}</td>
          <td class="${row.fd ? 'td-mr' : 'td-empty'}">${esc(row.fd || '—')}</td>
          ${ec.map(c => `<td>${esc(row.extra?.[c] || '—')}</td>`).join('')}
        </tr>`).join('');
      return `
        <div class="hist-param-title">▸ ${esc(param)}</div>
        <div style="overflow-x:auto">
          <table class="hist-table">
            <thead><tr><th>Muestra</th><th>Lectura</th><th>MR</th><th>FD</th>${extraTh}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }).join('');

    // Botones de historial — eliminar solo si logueado
    const delBtn = authState.isLoggedIn
      ? `<button class="btn-hist-del" onclick="deleteHistRecord('${r.id}')">🗑 Eliminar</button>`
      : '';

    return `
    <div class="hist-card ${isOpen ? 'hist-open' : ''}" id="hc_${r.id}">
      <div class="hist-row" onclick="toggleHist('${r.id}')">
        <div style="flex:1;min-width:0">
          <div class="hist-code">${esc(r.codes)}</div>
          <div class="hist-meta">${dateStr} · ${params.length} parámetro${params.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="hist-params">${chips}</div>
        <span class="hist-arr" style="margin-left:12px">▶</span>
      </div>
      <div class="hist-body ${isOpen ? 'open' : ''}" id="hb_${r.id}">
        ${bodyHtml}
        <div class="hist-actions">
          <button class="btn-hist-txt" onclick="exportTxtFromHist('${r.id}')">📄 Exportar TXT</button>
          ${delBtn}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHist(id) {
  expandedHist = expandedHist === id ? null : id;
  renderHistory();
}

function exportTxtFromHist(id) {
  const r = histRecords.find(x => x.id === id);
  if (r) exportTxt(r);
}

// ════════════════════════════════════════
//  GUARDAR Y VOLVER A MUESTRAS
// ════════════════════════════════════════
async function pushResultsAndBack() {
  const results = [];
  Object.entries(tableData).forEach(([paramName, rows]) => {
    rows.forEach(r => {
      if (r.lectura.trim() !== '') results.push({ subId: r.subId, paramName });
    });
  });
  if (results.length) {
    sessionStorage.setItem('analysis_results', JSON.stringify(results));
  }

  const saved = await saveToHistory();
  if (saved) {
    showToast('✓ Guardado en historial');
  } else {
    showToast('⚠ No se pudo guardar en historial\n(los parámetros sí se marcarán)', true);
  }

  setTimeout(() => { location.href = 'index.html'; }, 1300);
}

function goBack() { location.href = 'index.html'; }

function clearData() {
  if (!confirm('¿Limpiar todos los datos ingresados?')) return;
  Object.values(tableData).forEach(rows => rows.forEach(r => { r.lectura = ''; r.mr = ''; r.extra = {}; }));
  renderAll(); updateStatusBar();
  document.getElementById('summaryCard').style.display = 'none';
}

// ════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════
function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function slugify(str) {
  return String(str || '').replace(/[^a-z0-9]/gi, '_');
}

// ════════════════════════════════════════
//  ARRANQUE — espera a auth.js
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // initAuth viene de auth.js; cuando haya sesión (o no) llama init()
  // El historial es público (lectura libre), pero guardar requiere login
  initAuth(init);
});
