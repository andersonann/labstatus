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
  // Badge de usuario en header
  const badge = document.getElementById('userBadge');
  if (badge) {
    if (authState.isLoggedIn) {
      const email = authState.user.email;
      const short = email.split('@')[0];
      badge.innerHTML = `<span>${short}</span>`;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Botón logout
  const logoutBtn = document.getElementById('btnLogout');
  if (logoutBtn) {
    logoutBtn.style.display = authState.isLoggedIn ? '' : 'none';
  }

  // Botón login (aparece si NO está logueado)
  const loginBtn = document.getElementById('btnLoginHeader');
  if (loginBtn) {
    loginBtn.style.display = authState.isLoggedIn ? 'none' : '';
  }

  // Controles de escritura: formulario add, botones de edición/borrado
  // Se marcan con class="requires-auth" y se ocultan/deshabilitan
  document.querySelectorAll('.requires-auth').forEach(el => {
    if (authState.isLoggedIn) {
      el.classList.remove('locked');
      el.removeAttribute('disabled');
    } else {
      el.classList.add('locked');
    }
  });

  // Aviso "Inicia sesión para editar" — visible solo si no logueado
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
});
