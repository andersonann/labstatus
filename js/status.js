/* ════════════════════════════════════════
   STATUS.JS — Lógica de Órdenes / Muestras
   LabStatus Pro

   Depende de: auth.js (supaClient, authState, getAuthHeaders)
════════════════════════════════════════ */

const CACHE_KEY = "labstatus_v5";

// Schema:
// orders[]   → {id, code, client, params[], subsamples[], createdAt}
// subsamples → {id, code, status, params[], note}
// params     → {name, done, auto}   — auto=true = completado desde análisis

let orders        = [];
let expandedOrder = null;
let expandedSub   = null;
let selectionMode = false;
let selectedIds   = new Set();
let pendingDelete = null;

// ════════════════════════════════════════
//  INIT — caché instantáneo + sync en fondo
// ════════════════════════════════════════
function init() {
  // 1. Cargar caché
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) { try { orders = JSON.parse(raw); } catch(e) { orders = []; } }

  // 2. Aplicar resultados de análisis (si volvemos desde analysis.html)
  applyAnalysisResults();

  // 3. Render inmediato desde caché
  if (orders.length) { render(); } else { showSkeleton(); }

  // 4. Sync con Supabase en fondo
  loadRemote();
  setInterval(loadRemote, 30000);

  // 5. Controles de escritura según auth
  _updateWriteControls();
}

function _updateWriteControls() {
  const canWrite = authState.isLoggedIn;

  // Formulario agregar OS
  const addCard = document.querySelector('.add-card');
  if (addCard) {
    if (canWrite) {
      addCard.classList.remove('locked');
      const notice = addCard.querySelector('.locked-notice');
      if (notice) notice.remove();
    } else {
      addCard.classList.add('locked');
      if (!addCard.querySelector('.locked-notice')) {
        const d = document.createElement('div');
        d.className = 'locked-notice';
        d.textContent = '🔒 Inicia sesión para agregar órdenes';
        addCard.appendChild(d);
      }
    }
  }
}

function showSkeleton() {
  document.getElementById('activeList').innerHTML =
    '<div class="skeleton"><div class="skel-line" style="width:35%"></div><div class="skel-line" style="width:20%"></div></div>'.repeat(2);
}

function setSyncStatus(s) {
  document.getElementById('syncDot').className =
    'sync-dot' + (s==='syncing'?' syncing' : s==='error'?' error' : '');
  document.getElementById('syncTxt').textContent =
    s==='syncing' ? 'sync...' : s==='error' ? 'offline' : 'ok';
}

// ════════════════════════════════════════
//  REMOTE — fetch/save/delete Supabase
//  Usa supaClient de auth.js → token correcto automáticamente
// ════════════════════════════════════════
async function loadRemote() {
  setSyncStatus('syncing');
  try {
    const { data, error } = await supaClient
      .from('orders')
      .select('id, data')
      .order('data->>code', { ascending: true });

    if (error) throw error;
    orders = (data || []).map(r => r.data);
    sortOrders();
    localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
    render();
    setSyncStatus('ok');
  } catch(e) {
    console.error('loadRemote error:', e);
    setSyncStatus('error');
  }
}

async function saveOrderRemote(order) {
  const { error } = await supaClient
    .from('orders')
    .upsert(
      { id: order.id, data: order, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  if (error) throw error;
}

async function deleteOrderRemote(id) {
  const { error } = await supaClient
    .from('orders')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

async function saveRemote() {
  setSyncStatus('syncing');
  localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
  try {
    await Promise.all(orders.map(o => saveOrderRemote(o)));
    setSyncStatus('ok');
  } catch(e) {
    console.error('saveRemote error:', e);
    setSyncStatus('error');
  }
}

async function saveOne(order) {
  setSyncStatus('syncing');
  localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
  try {
    await saveOrderRemote(order);
    setSyncStatus('ok');
  } catch(e) {
    console.error('saveOne error:', e);
    setSyncStatus('error');
  }
}

// ════════════════════════════════════════
//  GUARDS — bloquear escritura si no logueado
// ════════════════════════════════════════
function requireAuth(action) {
  if (!authState.isLoggedIn) {
    // Mostrar pantalla de login al intentar escribir
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.add('visible');
    return false;
  }
  return true;
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
const pad3     = n => String(n).padStart(3, '0');
const pillClass = s => s==='Pendiente' ? 'pill-p' : s==='En proceso' ? 'pill-e' : 'pill-c';

function mkParams(raw) {
  return raw.split(',').map(p => p.trim()).filter(Boolean).map(name => ({ name, done: false, auto: false }));
}
function cloneParams(params) {
  return params.map(p => ({ name: p.name, done: false, auto: false }));
}
function sortOrders() {
  // Mayor a menor: 9715, 9345, 4564...
  orders.sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true, sensitivity: 'base' }));
}
function orderStatus(o) {
  const subs = o.subsamples || [];
  if (!subs.length) return 'Pendiente';
  const sts = subs.map(s => s.status);
  if (sts.every(s => s === 'Completado')) return 'Completado';
  if (sts.some(s => s === 'En proceso' || s === 'Completado')) return 'En proceso';
  return 'Pendiente';
}
function autoSyncStatus(s) {
  if (!s.params.length) return;
  if (s.params.every(p => p.done))                                    { s.status = 'Completado'; return; }
  if (s.params.some(p => p.done) && s.status === 'Pendiente')          s.status = 'En proceso';
  if (s.params.some(p => !p.done) && s.status === 'Completado')        s.status = 'En proceso';
}

// ════════════════════════════════════════
//  ADD ORDER
// ════════════════════════════════════════
function addOrder() {
  if (!requireAuth()) return;

  const code = document.getElementById('fCode').value.trim();
  if (!code) { shake('fCode'); return; }

  const paramsRaw  = document.getElementById('fParams').value.trim();
  const client     = document.getElementById('fClient').value.trim();
  const n          = Math.max(1, Math.min(parseInt(document.getElementById('fN').value) || 1, 999));
  const status     = document.getElementById('fStatus').value;
  const baseParams = paramsRaw ? mkParams(paramsRaw) : [];

  const subsamples = Array.from({ length: n }, (_, i) => ({
    id:     Date.now().toString(36) + Math.random().toString(36).slice(2) + i,
    code:   code + '/' + pad3(i + 1),
    status,
    params: cloneParams(baseParams),
    note:   ''
  }));

  orders.push({
    id:        Date.now().toString(36) + Math.random().toString(36).slice(2),
    code, client,
    params:    baseParams,
    subsamples,
    createdAt: new Date().toISOString()
  });
  sortOrders();

  document.getElementById('fCode').value   = '';
  document.getElementById('fParams').value = '';
  document.getElementById('fClient').value = '';
  document.getElementById('fN').value      = '';

  render();
  saveRemote();
}

function shake(id) {
  const el = document.getElementById(id);
  el.style.borderColor = 'var(--red)';
  setTimeout(() => { el.style.borderColor = ''; }, 700);
}

// ════════════════════════════════════════
//  ADD / DELETE SUBSAMPLE
// ════════════════════════════════════════
function addSubsample(orderId) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const srcParams = o.subsamples.length ? cloneParams(o.subsamples[0].params) : cloneParams(o.params);
  o.subsamples.push({
    id:     Date.now().toString(36) + Math.random().toString(36).slice(2),
    code:   '',
    status: 'Pendiente',
    params: srcParams,
    note:   ''
  });
  o.subsamples.forEach((s, i) => s.code = o.code + '/' + pad3(i + 1));
  expandedOrder = orderId;
  render(); saveOne(o);
}

function deleteSubsample(orderId, subId) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  o.subsamples = o.subsamples.filter(s => s.id !== subId);
  o.subsamples.forEach((s, i) => s.code = o.code + '/' + pad3(i + 1));
  expandedOrder = orderId;
  render(); saveOne(o);
}

// ════════════════════════════════════════
//  DELETE ORDER
// ════════════════════════════════════════
function confirmDelete(id) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === id);
  pendingDelete = { type: 'single', id };
  document.getElementById('modalTitle').textContent = '⚠ Confirmar eliminación';
  document.getElementById('modalMsg').textContent   = `¿Eliminar OS "${o.code}" y todas sus muestras? Esta acción no se puede deshacer.`;
  document.getElementById('modalConfirmBtn').onclick = executeDelete;
  document.getElementById('modalOverlay').classList.add('open');
}

async function executeDelete() {
  if (!pendingDelete) return;
  if (pendingDelete.type === 'single') {
    const id = pendingDelete.id;
    orders = orders.filter(o => o.id !== id);
    closeModal(); render();
    localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
    setSyncStatus('syncing');
    try { await deleteOrderRemote(id); setSyncStatus('ok'); } catch(e) { setSyncStatus('error'); }
  } else {
    const ids = [...selectedIds];
    orders = orders.filter(o => !selectedIds.has(o.id));
    clearSelection();
    closeModal(); render();
    localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
    setSyncStatus('syncing');
    try { await Promise.all(ids.map(id => deleteOrderRemote(id))); setSyncStatus('ok'); } catch(e) { setSyncStatus('error'); }
  }
}

function bulkDelete() {
  if (!requireAuth()) return;
  pendingDelete = { type: 'bulk' };
  document.getElementById('modalTitle').textContent = '⚠ Eliminar seleccionadas';
  document.getElementById('modalMsg').textContent   = `¿Eliminar ${selectedIds.size} OS seleccionadas? Esta acción no se puede deshacer.`;
  document.getElementById('modalConfirmBtn').onclick = executeDelete;
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  pendingDelete = null;
}

// ════════════════════════════════════════
//  SELECTION
// ════════════════════════════════════════
function toggleSelectionMode() {
  selectionMode = !selectionMode;
  if (!selectionMode) clearSelection();
  document.getElementById('btnSelect').classList.toggle('active-sel', selectionMode);
  document.getElementById('btnSelect').textContent = selectionMode ? '✕ Cancelar' : '☐ Seleccionar';
  render();
}
function toggleSelect(id) {
  selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  updateBulkBar(); render();
}
function clearSelection() {
  selectedIds.clear(); selectionMode = false;
  document.getElementById('btnSelect').textContent = '☐ Seleccionar';
  document.getElementById('btnSelect').classList.remove('active-sel');
  updateBulkBar();
}
function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  if (selectedIds.size > 0) {
    bar.classList.add('visible');
    document.getElementById('bulkCount').textContent = `${selectedIds.size} seleccionada(s)`;
  } else {
    bar.classList.remove('visible');
  }
}

// ════════════════════════════════════════
//  GO ANALYZE
// ════════════════════════════════════════
function goAnalyze() {
  const selected = orders.filter(o => selectedIds.has(o.id));
  const payload  = selected.flatMap(o => o.subsamples.map(s => ({
    orderId:   o.id,
    orderCode: o.code,
    client:    o.client || '',
    subCode:   s.code,
    subId:     s.id,
    params:    s.params.map(p => p.name)
  })));
  sessionStorage.setItem('analyze_payload', JSON.stringify(payload));
  location.href = 'analysis.html';
}

// ════════════════════════════════════════
//  APPLY ANALYSIS RESULTS
// ════════════════════════════════════════
function applyAnalysisResults() {
  const raw = sessionStorage.getItem('analysis_results');
  if (!raw) return;
  try {
    const results = JSON.parse(raw);
    const affectedOrders = new Set();
    results.forEach(r => {
      for (const o of orders) {
        const s = o.subsamples.find(x => x.id === r.subId);
        if (!s) continue;
        const p = s.params.find(x => x.name === r.paramName);
        if (p && !p.done) { p.done = true; p.auto = true; }
        autoSyncStatus(s);
        affectedOrders.add(o);
      }
    });
    sessionStorage.removeItem('analysis_results');
    localStorage.setItem(CACHE_KEY, JSON.stringify(orders));
    affectedOrders.forEach(o => saveOne(o));
  } catch(e) {}
}

// ════════════════════════════════════════
//  STATUS & PARAMS
// ════════════════════════════════════════
function changeSubStatus(orderId, subId, val) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === orderId);
  const s = o?.subsamples.find(x => x.id === subId);
  if (!s) return;
  s.status = val;
  if (val === 'Completado') s.params.forEach(p => { p.done = true; });
  expandedOrder = orderId; expandedSub = subId;
  render(); saveOne(o);
}

function toggleParam(orderId, subId, idx) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === orderId);
  const s = o?.subsamples.find(x => x.id === subId);
  if (!s) return;
  s.params[idx].done = !s.params[idx].done;
  s.params[idx].auto = false;
  autoSyncStatus(s);
  expandedOrder = orderId; expandedSub = subId;
  render(); saveOne(o);
}

function addParamInline(orderId, subId) {
  if (!requireAuth()) return;
  const el = document.getElementById('ap_' + subId);
  if (!el) return;
  const names = el.value.split(',').map(p => p.trim()).filter(Boolean);
  if (!names.length) return;
  const o = orders.find(x => x.id === orderId);
  const s = o?.subsamples.find(x => x.id === subId);
  if (!s) return;
  names.forEach(name => s.params.push({ name, done: false, auto: false }));
  el.value = '';
  expandedOrder = orderId; expandedSub = subId;
  render(); saveOne(o);
}

function deleteParam(orderId, subId, idx) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === orderId);
  const s = o?.subsamples.find(x => x.id === subId);
  if (!s) return;
  s.params.splice(idx, 1);
  autoSyncStatus(s);
  expandedOrder = orderId; expandedSub = subId;
  render(); saveOne(o);
}

// ════════════════════════════════════════
//  EDIT & NOTE
// ════════════════════════════════════════
function saveOrderEdit(id) {
  if (!requireAuth()) return;
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const codeEl   = document.getElementById('ec_' + id);
  const clientEl = document.getElementById('ecl_' + id);
  const newCode  = codeEl?.value.trim() || o.code;
  if (newCode !== o.code) {
    o.code = newCode;
    o.subsamples.forEach((s, i) => s.code = newCode + '/' + pad3(i + 1));
  }
  if (clientEl) o.client = clientEl.value.trim();
  sortOrders();
  expandedOrder = id;
  render(); saveOne(o);
}

function saveNote(orderId, subId) {
  if (!requireAuth()) return;
  const el = document.getElementById('nt_' + subId);
  if (!el) return;
  const o = orders.find(x => x.id === orderId);
  const s = o?.subsamples.find(x => x.id === subId);
  if (s) { s.note = el.value; saveOne(o); }
}

// ════════════════════════════════════════
//  EXPAND / COLLAPSE
// ════════════════════════════════════════
function toggleOrder(id) {
  if (selectionMode) { toggleSelect(id); return; }
  expandedOrder = expandedOrder === id ? null : id;
  expandedSub   = null;
  render();
}
function toggleSub(subId) {
  expandedSub = expandedSub === subId ? null : subId;
  render();
}
function toggleNote(subId) {
  const el = document.getElementById('nw_' + subId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════
function render() {
  orders.forEach(o => o._st = orderStatus(o));

  const active  = orders.filter(o => o._st !== 'Completado');
  const history = orders.filter(o => o._st === 'Completado');

  const totalSubs = orders.reduce((a, o) => a + o.subsamples.length, 0);
  const doneSubs  = orders.reduce((a, o) => a + o.subsamples.filter(s => s.status === 'Completado').length, 0);
  const pct = totalSubs ? Math.round(doneSubs / totalSubs * 100) : 0;

  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent  = pct + '%';
  document.getElementById('hTotal').textContent  = orders.length;
  document.getElementById('hSubs').textContent   = totalSubs;
  document.getElementById('hDone').textContent   = history.length;
  document.getElementById('countActive').textContent  = active.length;
  document.getElementById('countHistory').textContent = history.length;

  document.getElementById('activeList').innerHTML = active.length
    ? active.map(renderOrder).join('')
    : '<div class="empty">◈ No hay órdenes activas</div>';

  document.getElementById('historyList').innerHTML = history.length
    ? history.map(renderOrder).join('')
    : '<div class="empty" style="padding:14px;font-size:10px">Sin historial aún</div>';

  // Botones de edición solo visibles si logueado
  _updateWriteControls();
}

// ════════════════════════════════════════
//  renderOrder
// ════════════════════════════════════════
function renderOrder(o) {
  const isExp    = expandedOrder === o.id;
  const isSel    = selectedIds.has(o.id);
  const st       = o._st || orderStatus(o);
  const n        = o.subsamples.length;
  const isSingle = n === 1;

  const displayCode = isSingle
    ? o.subsamples[0].code
    : `${o.code}/<span style="color:var(--muted)">(001–${pad3(n)})</span>`;

  const pm = {};
  o.subsamples.forEach(s => s.params.forEach(p => {
    if (!pm[p.name]) pm[p.name] = { tot: 0, done: 0 };
    pm[p.name].tot++;
    if (p.done) pm[p.name].done++;
  }));
  const chipsHtml = Object.entries(pm).map(([name, v]) =>
    `<span class="chip ${v.done===v.tot&&v.tot>0?'done':v.done>0?'wip':''}">${name}${v.done===v.tot&&v.tot>0?' ✓':''}</span>`
  ).join('') || `<span style="font-size:10px;color:var(--muted);font-family:var(--font-mono)">sin params</span>`;

  const checkHtml = selectionMode
    ? `<div class="order-check ${isSel?'checked':''}" onclick="event.stopPropagation();toggleSelect('${o.id}')">${isSel?'✓':''}</div>`
    : '';

  const metaHtml = o.client
    ? `<div class="order-meta">${o.client}${!isSingle?' · '+n+' muestras':''}</div>`
    : (!isSingle ? `<div class="order-meta">${n} muestras</div>` : '');

  // Botón borrar: solo si logueado
  const delBtn = authState.isLoggedIn
    ? `<button class="btn-icon" onclick="confirmDelete('${o.id}')">✕</button>`
    : '';

  const bodyHtml = isSingle ? renderSingleBody(o) : renderMultiBody(o);

  return `
  <div class="order-card ${isExp?'expanded':''} ${isSel?'selected':''}" id="oc_${o.id}">
    <div class="order-header" onclick="toggleOrder('${o.id}')">
      ${checkHtml}
      <div class="order-main">
        <div class="order-code">${displayCode}</div>
        ${metaHtml}
      </div>
      <div class="param-chips">${chipsHtml}</div>
      <div class="order-right" onclick="event.stopPropagation()">
        <span class="status-pill ${pillClass(st)}">${st}</span>
        ${delBtn}
        <span class="expand-arr">▶</span>
      </div>
    </div>
    <div class="order-body ${isExp?'open':''}">${bodyHtml}</div>
  </div>`;
}

// ════════════════════════════════════════
//  SINGLE BODY
// ════════════════════════════════════════
function renderSingleBody(o) {
  const s = o.subsamples[0];
  const editDisabled = authState.isLoggedIn ? '' : 'disabled readonly';
  return `
  <div class="edit-section">
    <div class="edit-section-title">✎ Editar muestra</div>
    <div class="edit-grid">
      <div>
        <div class="edit-label">Código</div>
        <input class="edit-field" id="ec_${o.id}" value="${escHtml(o.code)}" ${editDisabled}
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveOrderEdit('${o.id}');}">
      </div>
      <div>
        <div class="edit-label">Cliente</div>
        <input class="edit-field" id="ecl_${o.id}" value="${escHtml(o.client||'')}" placeholder="Nombre del cliente" ${editDisabled}
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveOrderEdit('${o.id}');}">
      </div>
    </div>
    ${authState.isLoggedIn ? `<button class="btn-save-edit" onclick="saveOrderEdit('${o.id}')">Guardar cambios</button>` : ''}
  </div>
  ${renderParamBlock(o.id, s)}
  <div class="body-actions">
    <select class="body-select" onchange="changeSubStatus('${o.id}','${s.id}',this.value)" ${!authState.isLoggedIn?'disabled':''}>
      <option ${s.status==='Pendiente'?'selected':''}>Pendiente</option>
      <option ${s.status==='En proceso'?'selected':''}>En proceso</option>
      <option ${s.status==='Completado'?'selected':''}>Completado</option>
    </select>
    <button class="btn-note" onclick="toggleNote('${s.id}')">📝 Notas</button>
    ${authState.isLoggedIn ? `<button class="btn-add-sub" style="font-size:10px;padding:5px 10px" onclick="addSubsample('${o.id}')">+ Submuestra</button>` : ''}
  </div>
  <div id="nw_${s.id}" style="display:none" class="note-wrap">
    <textarea id="nt_${s.id}" placeholder="Notas internas..." onblur="saveNote('${o.id}','${s.id}')" ${!authState.isLoggedIn?'readonly':''}>${escHtml(s.note||'')}</textarea>
  </div>`;
}

// ════════════════════════════════════════
//  MULTI BODY
// ════════════════════════════════════════
function renderMultiBody(o) {
  const n     = o.subsamples.length;
  const doneN = o.subsamples.filter(s => s.status === 'Completado').length;
  const editDisabled = authState.isLoggedIn ? '' : 'disabled readonly';
  return `
  <div class="edit-section">
    <div class="edit-section-title">✎ Editar OS</div>
    <div class="edit-grid">
      <div>
        <div class="edit-label">Código</div>
        <input class="edit-field" id="ec_${o.id}" value="${escHtml(o.code)}" ${editDisabled}
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveOrderEdit('${o.id}');}">
      </div>
      <div>
        <div class="edit-label">Cliente</div>
        <input class="edit-field" id="ecl_${o.id}" value="${escHtml(o.client||'')}" placeholder="Cliente" ${editDisabled}
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveOrderEdit('${o.id}');}">
      </div>
    </div>
    ${authState.isLoggedIn ? `<button class="btn-save-edit" onclick="saveOrderEdit('${o.id}')">Guardar</button>` : ''}
  </div>
  <div class="sub-list-title">Muestras internas (${doneN}/${n} completadas)</div>
  ${o.subsamples.map(s => renderSubCard(o.id, s)).join('')}
  ${authState.isLoggedIn ? `
  <div class="add-sub-row">
    <span>Añadir submuestra (hereda parámetros de la primera)</span>
    <button class="btn-add-sub" onclick="addSubsample('${o.id}')">+ Submuestra</button>
  </div>` : ''}`;
}

// ════════════════════════════════════════
//  SUB-CARD
// ════════════════════════════════════════
function renderSubCard(orderId, s) {
  const isExp     = expandedSub === s.id;
  const chipsHtml = s.params.map(p =>
    `<span class="chip ${p.done?'done':s.status==='En proceso'?'wip':''}">${p.name}${p.done?' ✓':''}</span>`
  ).join('') || `<span style="font-size:10px;color:var(--muted)">sin params</span>`;

  const delSubBtn = authState.isLoggedIn
    ? `<button class="btn-icon" style="width:24px;height:24px;font-size:10px" onclick="deleteSubsample('${orderId}','${s.id}')">✕</button>`
    : '';

  return `
  <div class="sub-card ${isExp?'sub-exp':''}">
    <div class="sub-header" onclick="toggleSub('${s.id}')">
      <span class="sub-code">${s.code}</span>
      <div class="sub-chips">${chipsHtml}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
        <span class="status-pill ${pillClass(s.status)}">${s.status}</span>
        ${delSubBtn}
        <span class="expand-arr" style="font-size:10px">▶</span>
      </div>
    </div>
    <div class="sub-body ${isExp?'open':''}">
      ${renderParamBlock(orderId, s)}
      <div class="body-actions">
        <select class="body-select" onchange="changeSubStatus('${orderId}','${s.id}',this.value)" ${!authState.isLoggedIn?'disabled':''}>
          <option ${s.status==='Pendiente'?'selected':''}>Pendiente</option>
          <option ${s.status==='En proceso'?'selected':''}>En proceso</option>
          <option ${s.status==='Completado'?'selected':''}>Completado</option>
        </select>
        <button class="btn-note" onclick="toggleNote('${s.id}')">📝 Notas</button>
      </div>
      <div id="nw_${s.id}" style="display:none" class="note-wrap">
        <textarea id="nt_${s.id}" placeholder="Notas..." onblur="saveNote('${orderId}','${s.id}')" ${!authState.isLoggedIn?'readonly':''}>${escHtml(s.note||'')}</textarea>
      </div>
    </div>
  </div>`;
}

// ════════════════════════════════════════
//  PARAM BLOCK
// ════════════════════════════════════════
function renderParamBlock(orderId, s) {
  const done = s.params.filter(p => p.done).length;
  const rows = s.params.map((p, i) => {
    const btnCls = p.done ? (p.auto ? 'param-check-btn auto' : 'param-check-btn done') : 'param-check-btn';
    const stCol  = p.done ? 'var(--green)' : s.status === 'En proceso' ? 'var(--yellow)' : 'var(--muted)';
    const stTxt  = p.done ? (p.auto ? '✓ Auto' : '✓ Listo') : s.status === 'En proceso' ? 'En proceso' : 'Pendiente';
    const title  = p.auto ? 'Completado desde Análisis — clic para revertir' : '';
    const checkClick = authState.isLoggedIn
      ? `onclick="toggleParam('${orderId}','${s.id}',${i})"`
      : 'disabled';
    const delClick = authState.isLoggedIn
      ? `onclick="deleteParam('${orderId}','${s.id}',${i})"`
      : 'style="display:none"';
    return `
    <div class="param-row">
      <button class="${btnCls}" ${checkClick} title="${title}">${p.done?'✓':''}</button>
      <span class="param-name">${escHtml(p.name)}</span>
      <span class="param-st" style="color:${stCol}">${stTxt}</span>
      <button class="param-del" ${delClick}>✕</button>
    </div>`;
  }).join('');

  const addParamHtml = authState.isLoggedIn ? `
  <div class="add-param-row">
    <input id="ap_${s.id}" placeholder="Añadir (ej: Zn, Fe)"
      onkeydown="if(event.key==='Enter'){event.preventDefault();addParamInline('${orderId}','${s.id}');}">
    <button class="btn-add-param" onclick="addParamInline('${orderId}','${s.id}')">+ Añadir</button>
  </div>` : '';

  return `
  <div class="param-list-title">Parámetros <span style="color:var(--muted);font-weight:400">(${done}/${s.params.length})</span></div>
  ${rows}
  ${addParamHtml}`;
}

// ════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ════════════════════════════════════════
//  PREVENT ENTER EN CAMPOS AUXILIARES
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  ['fParams','fClient','fN'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key==='Enter') e.preventDefault(); });
  });
  const fCode = document.getElementById('fCode');
  if (fCode) fCode.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); addOrder(); } });

  document.getElementById('modalOverlay')?.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Iniciar auth → cuando esté listo, correr init()
  initAuth(init);
});
