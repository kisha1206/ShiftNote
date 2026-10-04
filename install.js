/*
 * Install prompt. Every time the site is opened in a normal browser tab
 * (not as the installed app), a popup asks the person to install it,
 * unless Payrate is already installed on this device.
 * "Not now" only hides it for this visit.
 *
 * How "already installed" is known:
 *  - the app itself was opened from the home screen on this device (remembered),
 *  - the browser reported the install (appinstalled), or
 *  - Chrome lists it via getInstalledRelatedApps().
 * If Chrome later offers to install it again (beforeinstallprompt), it was
 * removed, so the popup comes back.
 */
(function () {
  'use strict';

  const standalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://');

  const KEY = 'payrate.installed';
  const remember = on => { try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } };
  const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };

  if (standalone()) { remember(true); return; }

  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  let deferred = null;

  const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
  const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';

  const wrap = document.createElement('div');
  wrap.className = 'install-wrap';
  wrap.id = 'install-popup';
  wrap.hidden = true;
  document.body.appendChild(wrap);

  function steps() {
    if (deferred) return '';
    if (isIOSSafari) {
      return `<ol class="install-steps">
        <li><span class="step-ico">${SHARE_ICON}</span><span>Tap the <b>Share</b> button in Safari's toolbar.</span></li>
        <li><span class="step-ico">${PLUS_ICON}</span><span>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></li>
      </ol>`;
    }
    if (isIOS) {
      return `<p class="install-note">Open this page in <b>Safari</b>, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>`;
    }
    return `<p class="install-note">Open your browser menu (<b>⋮</b>) and choose <b>Install app</b> or <b>Add to Home screen</b>. If Payrate is already installed, open it from your home screen instead.</p>`;
  }

  function render() {
    wrap.innerHTML = `
      <div class="install-backdrop" data-install="close"></div>
      <div class="install-card" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div class="install-head">
          <img src="icons/icon-192.png" alt="" width="56" height="56" onerror="this.style.display='none'">
          <div>
            <h2 id="install-title">Install Payrate</h2>
            <p>Add it to your home screen. It opens like an app and works with no internet.</p>
          </div>
        </div>
        <ul class="install-perks">
          <li>Works fully offline</li>
          <li>Your data stays on your phone</li>
          <li>No account or login</li>
        </ul>
        ${steps()}
        <div class="install-actions">
          ${deferred ? '<button class="btn primary block" data-install="go">Install app</button>' : ''}
          <button class="btn block" data-install="close">Not now</button>
          ${deferred ? '' : '<button class="text-btn install-have" data-install="have">I already have the app</button>'}
        </div>
      </div>`;
  }

  function show() { render(); wrap.hidden = false; }
  function hide() { wrap.hidden = true; }

  let installed = remembered();

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    // The browser only offers this when the app is not installed.
    if (installed) { installed = false; remember(false); show(); return; }
    if (!wrap.hidden) render(); // swap instructions for the Install button
  });

  window.addEventListener('appinstalled', () => { deferred = null; installed = true; remember(true); hide(); });

  wrap.addEventListener('click', async e => {
    const btn = e.target.closest('[data-install]');
    if (!btn) return;
    if (btn.dataset.install === 'close') return hide();
    if (btn.dataset.install === 'have') { installed = true; remember(true); return hide(); }
    if (btn.dataset.install === 'go' && deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (choice && choice.outcome === 'accepted') hide(); else render();
    }
  });

  async function relatedInstalled() {
    if (!navigator.getInstalledRelatedApps) return false;
    try { return (await navigator.getInstalledRelatedApps()).length > 0; } catch (e) { return false; }
  }

  // Give Chrome a moment to offer its install event, then show the popup
  // on every visit, unless the app is already on this device.
  setTimeout(async () => {
    if (installed) return;
    if (await relatedInstalled()) { installed = true; remember(true); return; }
    if (!installed) show();
  }, 700);
})();
