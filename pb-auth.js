/* pb-auth.js — the single seam between this app and its backend identity.
 *
 * The template ships an anonymous owner id, which gives persistence and not
 * security. This app needs more than that: the spec says posting requires a
 * signed-in account, and that the account behind each pseudonym is recorded. So
 * this seam wraps PocketBase's own `users` auth collection — email and password,
 * a token in localStorage, sent as Authorization on every call.
 *
 * What that does and does not buy you:
 *   - Other readers see only the pseudonym on a post. The account id is never
 *     returned by any /api/forum/* route.
 *   - It is not anonymity. The server stores the account against every post, and
 *     an administrator can read it. Say so in the UI, do not let anyone assume
 *     otherwise.
 *
 * If solhann.net later fronts these apps with real single sign-on, this file is
 * what changes. App code using PBAuth stays as it is.
 */
const PBAuth = (() => {
  const KEY = 'forum_auth';
  const HANDLE_KEY = 'forum_handle';
  const listeners = [];

  function state() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function save(next) {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
    listeners.forEach((fn) => fn(next && next.user));
  }

  function user() {
    const s = state();
    return s ? s.user : null;
  }

  function token() {
    const s = state();
    return s ? s.token : '';
  }

  function handle() {
    return localStorage.getItem(HANDLE_KEY) || '';
  }

  function setHandle(value) {
    if (value) localStorage.setItem(HANDLE_KEY, value);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  // Every call to this app's backend goes through here.
  async function api(path, options) {
    const opts = options || {};
    const headers = { 'Content-Type': 'application/json' };
    const tk = token();
    if (tk) headers.Authorization = tk;
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      if (res.status === 401) save(null);
      const err = new Error((data && data.message) || 'Something went wrong.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function login(identity, password) {
    const res = await fetch('/api/collections/users/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: identity, password: password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not sign in.');
    save({ token: data.token, user: { id: data.record.id, email: data.record.email } });
    return data.record;
  }

  async function register(email, password, passwordConfirm) {
    const res = await fetch('/api/collections/users/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: password,
        passwordConfirm: passwordConfirm,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data.data && Object.keys(data.data).length
        ? Object.keys(data.data).map((k) => k + ': ' + data.data[k].message).join(' ')
        : (data.message || 'Could not create the account.');
      throw new Error(detail);
    }
    return login(email, password);
  }

  function logout() {
    save(null);
  }

  // The topbar chip and the sign-in dialog, built once and reused by every page
  // so the three pages do not each carry a copy of the markup.
  function mountAuth(slot) {
    const dialog = document.createElement('div');
    dialog.className = 'overlay';
    dialog.id = 'authDialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = [
      '<div class="panel" style="width:440px;height:auto">',
      '  <div class="panel-head">',
      '    <span class="monogram monogram--lg">FM</span>',
      '    <div><h3>Sign in to post</h3><div class="panel-sub">Reading is open, posting is not</div></div>',
      '    <div style="margin-left:auto"></div>',
      '    <button class="btn btn--icon" style="width:34px;height:34px" data-dialog-close aria-label="Close">✕</button>',
      '  </div>',
      '  <div class="panel-body" style="padding:var(--space-5)">',
      '    <p class="t-muted" style="font-size:var(--text-sm);margin:0 0 var(--space-4)">',
      '      Your account is recorded against every post you make. Other readers see only your pseudonym, but an administrator can see who wrote what.',
      '    </p>',
      '    <div class="field" style="margin-bottom:var(--space-3)"><label for="authEmail">Email</label>',
      '      <input class="input" id="authEmail" type="email" autocomplete="username"></div>',
      '    <div class="field" style="margin-bottom:var(--space-3)"><label for="authPass">Password</label>',
      '      <input class="input" id="authPass" type="password" autocomplete="current-password"></div>',
      '    <div class="field" id="authConfirmField" hidden style="margin-bottom:var(--space-3)"><label for="authPass2">Confirm password</label>',
      '      <input class="input" id="authPass2" type="password" autocomplete="new-password"></div>',
      '    <p id="authError" class="t-muted" hidden style="font-size:var(--text-sm);color:var(--danger);margin:0 0 var(--space-3)"></p>',
      '    <div style="display:flex;gap:var(--space-2);align-items:center">',
      '      <button class="btn btn--primary" id="authSubmit">Sign in</button>',
      '      <button class="btn btn--ghost btn--sm" id="authToggle">Create an account</button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
    document.body.appendChild(dialog);

    const email = dialog.querySelector('#authEmail');
    const pass = dialog.querySelector('#authPass');
    const pass2 = dialog.querySelector('#authPass2');
    const confirmField = dialog.querySelector('#authConfirmField');
    const error = dialog.querySelector('#authError');
    const submit = dialog.querySelector('#authSubmit');
    const toggle = dialog.querySelector('#authToggle');
    let registering = false;

    function setMode(next) {
      registering = next;
      confirmField.hidden = !registering;
      submit.textContent = registering ? 'Create account' : 'Sign in';
      toggle.textContent = registering ? 'I already have an account' : 'Create an account';
      error.hidden = true;
    }

    toggle.addEventListener('click', () => setMode(!registering));

    submit.addEventListener('click', async () => {
      error.hidden = true;
      submit.disabled = true;
      try {
        if (registering) {
          if (pass.value !== pass2.value) throw new Error('The two passwords do not match.');
          await register(email.value.trim(), pass.value, pass2.value);
        } else {
          await login(email.value.trim(), pass.value);
        }
        pass.value = '';
        if (pass2) pass2.value = '';
        GL.closeDialog(dialog);
        GL.toast(registering ? 'Account created, you are signed in' : 'Signed in');
        setMode(false);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });

    function render() {
      const u = user();
      slot.innerHTML = '';
      if (!u) {
        const btn = document.createElement('button');
        btn.className = 'btn btn--secondary btn--sm';
        btn.textContent = 'Sign in';
        btn.addEventListener('click', () => GL.openDialog(dialog));
        slot.appendChild(btn);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'auth-menu';
      wrap.innerHTML = [
        '<button class="avatar" aria-label="Account"></button>',
        '<div class="auth-pop">',
        '  <b class="auth-name"></b>',
        '  <span class="auth-mail"></span>',
        '  <span class="t-faint" style="font-size:var(--text-xs)">Posts are recorded against this account.</span>',
        '  <button class="btn btn--secondary btn--sm auth-out">Sign out</button>',
        '</div>',
      ].join('\n');
      wrap.querySelector('.avatar').textContent = u.email.slice(0, 2).toUpperCase();
      wrap.querySelector('.auth-name').textContent = handle() || 'No handle yet';
      wrap.querySelector('.auth-mail').textContent = u.email;
      wrap.querySelector('.avatar').addEventListener('click', () => wrap.classList.toggle('open'));
      wrap.querySelector('.auth-out').addEventListener('click', () => {
        logout();
        GL.toast('Signed out');
      });
      slot.appendChild(wrap);
    }

    onChange(render);
    render();
    return { open: () => GL.openDialog(dialog) };
  }

  return { api, login, register, logout, user, token, handle, setHandle, onChange, mountAuth };
})();
