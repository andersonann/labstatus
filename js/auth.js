/* ════════════════════════════════════════
   AUTH.JS — Autenticación Supabase
   LabStatus Pro

   Requiere: @supabase/supabase-js v2 cargado antes de este script.

   Exporta al window:
     - supaClient        → cliente Supabase autenticado
     - authState         → { session, user, isLoggedIn }
     - initAuth(onReady) → inicializa auth y llama onReady() cuando listo
     - doLogin()         → lee #loginEmail + #loginPass y hace signIn
     - doLogout()        → cierra sesión
════════════════════════════════════════ */

const SUPA_URL = "https://puwgkmjxystqfgubmtwv.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1d2drbWp4eXN0cWZndWJtdHd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzA2NTYsImV4cCI6MjA5MzAwNjY1Nn0.ZeV9g3p2dfdRuGguT9nrBUaqq2-RH8uZklhlOff2vxc";

// Cliente Supabase (disponible globalmente)
const supaClient = supabase.createClient(SUPA_URL, SUPA_KEY);

// Estado de autenticación global
const authState = {
  session:    null,
  user:       null,
  isLoggedIn: false
};

/* ────────────────────────────────────────
   initAuth(onReady)
   Muestra login si no hay sesión, o llama
   onReady() si ya está autenticado.
   En ambos casos reacciona a cambios de sesión.
──────────────────────────────────────── */
async function initAuth(onReady) {
  // Obtener sesión actual y llamar onReady UNA sola vez
  const { data: { session } } = await supaClient.auth.getSession();
  _applySession(session);
  if (typeof onReady === 'function') onReady();

  // Escuchar cambios posteriores — solo actualiza UI, no reinicia la app
  supaClient.auth.onAuthStateChange((_event, session) => {
    _applySession(session);
  });
}

function _applySession(session) {
  authState.session    = session;
  authState.user       = session?.user ?? null;
  authState.isLoggedIn = !!session;

  _updateUI();

  const loginScreen = document.getElementById('loginScreen');
  const appRoot     = document.getElementById('appRoot');
  if (loginScreen) loginScreen.classList.remove('visible');
  if (appRoot)     appRoot.style.display = '';
}

/* ────────────────────────────────────────
   _updateUI — actualiza badge de usuario
   y visibilidad de controles de escritura
──────────────────────────────────────── */
function _updateUI() {
  const logoutBtn = document.getElementById('btnLogout');
  const loginBtn  = document.getElementById('btnLoginHeader');
  const badge     = document.getElementById('userBadge');

  if (authState.isLoggedIn) {
    // mostramos el nombre corto dentro del botón salir
    const short = authState.user.email.split('@')[0];
    if (badge)     badge.textContent = short;
    if (logoutBtn) logoutBtn.style.display = '';
    if (loginBtn)  loginBtn.style.display  = 'none';
  } else {
    if (badge)     badge.textContent = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (loginBtn)  loginBtn.style.display  = '';
  }

  // controles de escritura — se bloquean si no hay sesión
  document.querySelectorAll('.requires-auth').forEach(el => {
    if (authState.isLoggedIn) {
      el.classList.remove('locked');
      el.removeAttribute('disabled');
    } else {
      el.classList.add('locked');
    }
  });

  // aviso de solo lectura
  document.querySelectorAll('.auth-notice').forEach(el => {
    el.style.display = authState.isLoggedIn ? 'none' : '';
  });
}

/* ────────────────────────────────────────
   doLogin — lee el formulario de login
──────────────────────────────────────── */
async function doLogin() {
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPass');
  const errEl   = document.getElementById('loginError');
  const btnEl   = document.getElementById('btnLoginSubmit');

  const email    = emailEl?.value?.trim() || '';
  const password = passEl?.value || '';

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Ingresa email y contraseña.';
    return;
  }

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Ingresando...'; }
  if (errEl)   errEl.textContent = '';

  const { error } = await supaClient.auth.signInWithPassword({ email, password });

  if (error) {
    if (errEl) errEl.textContent = 'Credenciales incorrectas. Intenta de nuevo.';
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; }
  }
  // Si OK, onAuthStateChange dispara y _applySession maneja el resto
}

/* ────────────────────────────────────────
   doLogout
──────────────────────────────────────── */
async function doLogout() {
  await supaClient.auth.signOut();
}

/* ────────────────────────────────────────
   getAuthHeaders — para fetch() manual si
   se necesita en alguna llamada directa
──────────────────────────────────────── */
function getAuthHeaders() {
  const token = authState.session?.access_token ?? SUPA_KEY;
  return {
    "Content-Type":  "application/json",
    "apikey":        SUPA_KEY,
    "Authorization": "Bearer " + token
  };
}

// Permitir Enter en el formulario de login
document.addEventListener('DOMContentLoaded', () => {
  const passEl = document.getElementById('loginPass');
  if (passEl) {
    passEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  }
  const emailEl = document.getElementById('loginEmail');
  if (emailEl) {
    emailEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  }

  // menú hamburguesa — solo aplica en móvil, en desktop no pasa nada
  const logoBtn  = document.getElementById('logoBtn');
  const headerNav = document.getElementById('headerNav');
  const hamburgerIcon = document.getElementById('hamburgerIcon');

  if (logoBtn && headerNav) {
    logoBtn.addEventListener('click', () => {
      // si estamos en desktop (nav siempre visible) no hacemos nada
      if (window.innerWidth > 600) return;
      const isOpen = headerNav.classList.toggle('open');
      if (hamburgerIcon) hamburgerIcon.textContent = isOpen ? '✕' : '☰';
    });
  }

  // cerrar el menú si se hace click fuera
  document.addEventListener('click', e => {
    if (window.innerWidth > 600) return;
    if (!e.target.closest('header')) {
      headerNav?.classList.remove('open');
      if (hamburgerIcon) hamburgerIcon.textContent = '☰';
    }
  });
});
