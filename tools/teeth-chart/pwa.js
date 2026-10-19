(() => {
  'use strict';
  const dedicated = location.hostname === 'teeth.nithi.land';
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  const preview = localHost && /^\/(?:tools\/teeth-chart|teeth)(?:\/|$)/.test(location.pathname);
  if (!dedicated && !preview) return;
  const offlineSupported = window.isSecureContext && 'serviceWorker' in navigator;

  const manifest = document.querySelector('link[rel="manifest"]');
  manifest.href = dedicated ? '/manifest.webmanifest' : '/tools/teeth-chart/manifest.webmanifest';
  const buttons = [...document.querySelectorAll('[data-install-teeth]')];
  const nativeButtons = [...document.querySelectorAll('[data-pwa-native-install]')];
  const statuses = [...document.querySelectorAll('[data-teeth-offline-status]')];
  const dialog = document.querySelector('[data-pwa-install-dialog]');
  const installCard = document.querySelector('[data-install-local-card]');
  const standalone = () => window.TeethInstallation.appWindow(navigator,window);
  let installEvent = null;
  let installed = standalone();
  let ready = false;
  let updateReady = false;
  function render() {
    installCard.hidden = installed;
    buttons.forEach(button => { button.hidden = installed; });
    nativeButtons.forEach(button => { button.hidden = installed || !installEvent; });
    const text = !offlineSupported ? 'Local network preview · PWA installation and offline caching require HTTPS.'
      : updateReady ? 'Update ready. Close Teeth Chart in all tabs and app windows, then reopen to update.'
      : ready ? (navigator.onLine ? 'Ready offline · Charts save on this device.' : 'Offline · Charts save on this device. Cloud changes sync when connected.')
      : 'Preparing Teeth Chart for offline use…';
    statuses.forEach(status => { status.textContent = text; });
  }
  window.addEventListener('beforeinstallprompt', event => {
    if (installed) return;
    event.preventDefault();
    installEvent = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installEvent = null;
    if (dialog.open) dialog.close();
    render();
  });
  [...buttons, ...nativeButtons].forEach(button => button.addEventListener('click', async () => {
    if (!installEvent) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    const prompt = installEvent;
    installEvent = null;
    [...buttons, ...nativeButtons].forEach(button => { button.disabled = true; });
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      if (!dialog.open) dialog.showModal();
    } finally {
      [...buttons, ...nativeButtons].forEach(button => { button.disabled = false; });
      render();
    }
  }));
  dialog.querySelector('[data-close-pwa-install]').addEventListener('click', () => dialog.close());
  const url = new URL(location.href);
  if (url.searchParams.get('install') === '1') {
    // Open above first-visit onboarding, after the app's scripts have loaded.
    window.addEventListener('load', () => { if (!installed && !dialog.open) dialog.showModal(); }, { once: true });
    url.searchParams.delete('install');
    history.replaceState(history.state, '', url);
  }
  window.TeethInstallation.appQueries.forEach(query=>matchMedia(query).addEventListener('change', () => { installed = standalone(); render(); }));
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
  if (!offlineSupported) return;
  navigator.serviceWorker.register('/tools/teeth-chart/service-worker.js', {
    scope: dedicated ? '/' : '/tools/teeth-chart/', updateViaCache: 'none'
  }).then(registration => {
    function updateState() {
      ready = registration.active?.state === 'activated';
      updateReady = Boolean(registration.waiting && registration.active);
      render();
    }
    function watch(worker) {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !registration.active) failed();
        else updateState();
      });
    }
    watch(registration.installing);
    watch(registration.waiting);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    navigator.serviceWorker.addEventListener('controllerchange', updateState);
    updateState();
  }).catch(failed);
  function failed() {
    statuses.forEach(status => { status.textContent = 'Offline setup could not finish. Reconnect and reload to try again. Your saved charts are kept.'; });
  }
})();
