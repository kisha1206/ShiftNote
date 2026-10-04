/*
 * Install prompt. Every time the site is opened in a normal browser tab
 * (not as the installed app), a popup asks the person to install it.
 * "Not now" only hides it for this visit.
 */
(function () {
  'use strict';

  const standalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://');

  if (standalone()) return;

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
        </div>
      </div>`;
  }

  function show() { render(); wrap.hidden = false; }
  function hide() { wrap.hidden = true; }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    if (!wrap.hidden) render(); // swap instructions for the Install button
  });

  window.addEventListener('appinstalled', () => { deferred = null; hide(); });

  wrap.addEventListener('click', async e => {
    const btn = e.target.closest('[data-install]');
    if (!btn) return;
    if (btn.dataset.install === 'close') return hide();
    if (btn.dataset.install === 'go' && deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (choice && choice.outcome === 'accepted') hide(); else render();
    }
  });

  // Give Chrome a moment to offer its install event, then show the popup on every visit.
  setTimeout(show, 700);
})();
