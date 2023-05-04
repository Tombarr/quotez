(function() {
  const NEW_QUOTE_ENDPOINT = 'https://api.quotable.io/quotes/random';
  const ONE_DAY = 60 * 60 * 24;
  const HAS_MESSAGE_HANDLER = (typeof navigator === 'object' && 'mozSetMessageHandler' in navigator);
  const PUBLISHER_ID = 'ed847862-2f6a-441e-855e-7e405549cf48';

  const QUOTE = document.getElementById('quote');
  const AUTHOR = document.getElementById('author');
  const TAGS = document.getElementById('tags');
  const NO_INTERNET = document.getElementById('no-internet');
  const AD_CONTAINER = document.getElementById('ad-container');

  // @return [Headers]
  function toHeaders(headerStr) {
      const headerEntries = headerStr.split('\r\n')
          .map((h) => {
              const firstSemi = h.indexOf(':');
              return [h.substring(0, firstSemi).trim(), h.substring(firstSemi + 1).trim()];
          })
          .filter((h) => h && h[0] && h[0].length > 0 && h[1] && h[1].length > 0);

      const headers = new Headers();
      headerEntries.forEach(([key, value]) => {
          try {
              headers.append(key, value);
          } catch (e) {
              // TypeError "is an invalid header value" for Set-Cookie
              if (e && !e.message.indexOf('is an invalid header value')) {
                  onError(e);
              }
          }
      });

      return headers;
  }

  // @return [Response]
  function toResponse(xhr) {
      // Assumes responseType = 'blob'
      return new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: toHeaders(xhr.getAllResponseHeaders()),
      });
  }

  // @return [Promise<Response>] Make Fetch-like request without CORS
  function xhrFetch(url) {
      return new Promise((resolve, reject) => {
          let xhr = new XMLHttpRequest({
              mozSystem: true,
              mozAnon: true,
              mozBackgroundRequest: true
          });
          xhr.responseType = 'blob';
          xhr.open('GET', url, true);
          xhr.addEventListener('error', (e) =>
              reject(new Error('Network Error #' + e.target.status)));
          xhr.addEventListener('loadend', (e) => resolve(toResponse(e.target)));
          xhr.send();
      });
  }

  function getRandomQuote() {
      return xhrFetch(NEW_QUOTE_ENDPOINT)
          .then((r) => r.json())
          .then((r) => ({
              content: r[0].content,
              author: r[0].author,
              tags: r[0].tags || [],
          }));
  }

  function hasSync() {
      return (typeof navigator['sync'] !== 'undefined');
  }

  function register(taskName, minInterval) {
      if (!hasSync()) return Promise.resolve(false);

      return navigator.sync.registrations()
          .then(function(registrations) {
              let existingReg;
              registrations.some(function(reg) {
                  if (reg.task === taskName) {
                      return !!(existingReg = reg);
                  }
              });

              if (existingReg) {
                  return false;
              }

              return navigator.sync.register(taskName, {
                  minInterval: minInterval, // seconds
                  oneShot: false,
                  wifiOnly: false,
                  wakeUpPage: location.href
              });
          });
  }

  function unregister(taskName) {
      if (!hasSync()) return Promise.resolve(false);

      return navigator.sync.unregister(taskName);
  }

  function unregisterAll() {
      if (!hasSync()) return Promise.resolve(false);

      return navigator.sync.registrations().then(function(registrations) {
          return Promise.all(registrations.map(unregister));
      });
  }

  function focusAdvertisement() {
    const ad = document.querySelector('[tabindex="0"]');
    if (!ad) {
        return setTimeout(focusAdvertisement, 100);
    }

    ad.focus();
  }

  function hideAdvertisement() {
    AD_CONTAINER.setAttribute('hidden', '');
  }

  function loadKaiAd() {
    return new Promise((resolve, reject) => {
      return getKaiAd({
        publisher: PUBLISHER_ID,
        container: AD_CONTAINER,
        app: 'quotes',
        slot: 'main',
        h: 36,
	    w: 216,
        test: 0,
        onerror: (err) => reject(err),
        onready: (ad) => {
            AD_CONTAINER.removeAttribute('hidden');
            ad.on('display', focusAdvertisement);
            ad.on('click', hideAdvertisement);
            ad.on('close', hideAdvertisement);
            ad.call('display', { display: 'block' });
            return resolve(ad);
        },
      });
    });
  }

  // @returns [Boolean|Promise]
  function setMessageHandler(name, handler) {
      if (HAS_MESSAGE_HANDLER) {
          // KaiOS 2.5
          return Promise.resolve(navigator.mozSetMessageHandler(name, handler) || true);
      } else if ('systemMessageManager' in ServiceWorkerRegistration.prototype) {
          // KaiOS 3.0
          return getRegistration()
              .then((registration) => {
                  if (registration && registration.systemMessageManager) {
                      return registration.systemMessageManager.subscribe(name);
                  }
              })
              .catch((e) => console.warn(`Cannot subscribe to ${name} system messages.`, e));
      }

      return false;
  }

  setMessageHandler('request-sync', function(evt) {
    if (HAS_MESSAGE_HANDLER) {
      navigator.mozSetMessageHandlerPromise(loadNewQuote());
    }
  });

  setMessageHandler('serviceworker-notification', function(evt) {
    if (HAS_MESSAGE_HANDLER) {
      navigator.mozSetMessageHandlerPromise(loadNewQuote());
    }
  });

  setMessageHandler('activity', function(evt) {
    if (HAS_MESSAGE_HANDLER) {
      navigator.mozSetMessageHandlerPromise(loadNewQuote());
    }
  });

  // @returns [Promise] Register ServiceWorker
  function registerServiceWorker() {
      return navigator.serviceWorker
          .register('./sw.js', {
              scope: '/'
          })
          .then((registration) => {
              if (!navigator.serviceWorker.controller) {
                  // The window client isn't currently controlled so it's a new service
                  // worker that will activate immediately
                  return Promise.resolve(true);
              }

              // Start handling messages immediately
              if ('startMessages' in navigator.serviceWorker) {
                  navigator.serviceWorker.startMessages();
              }

              // Update the SW, if available
              if ('update' in registration && navigator.onLine) {
                  return registration.update();
              }

              return Promise.resolve(true);
          });
  }

  // @returns [ServiceWorkerRegistration] ServiceWorkerRegistration
  function getRegistration() {
      if (typeof self === 'object' && self.registration) {
          return Promise.resolve(self.registration);
      }

      if (typeof navigator === 'object' && navigator.serviceWorker) {
          return navigator.serviceWorker.ready;
      }

      return Promise.resolve(undefined);
  }

  function displayQuote(author, quote, tags) {
    QUOTE.innerText = quote;
    AUTHOR.innerText = author;

    let frag = document.createDocumentFragment();
    tags.forEach((tag) => {
      let li = document.createElement('li');
      li.innerText = tag;
      frag.appendChild(li);
    });

    TAGS.innerHTML = '';
    TAGS.appendChild(frag);

    showNotification(author, quote);
  }

  function showNotification(title, body) {
      return getRegistration()
          .then((registration) => registration.showNotification(title, {
              actions: [{
                  action: 'open',
                  title: 'Open',
              }, {
                  action: 'dismiss',
                  title: 'Dismiss',
              }],
              body,
              data: {
                  title,
                  body
              },
              icon: '/img/logo-112.png',
              tag: 'dailyquote',
              silent: true,
              requireInteraction: false,
              renotify: true,
              noscreen: true,
              mozbehavior: {
                  showOnlyOnce: false,
              },
          }));
  }

  function exit() {
    return Promise.resolve(setTimeout(() => window.close()));
  }

  function onKeyPress(key) {
    switch (key) {
      case 'SoftRight':
        if (navigator.onLine) {
            requestAnimationFrame(loadNewQuote);
        }
        break;
      case 'Backspace':
      case 'Delete':
      case 'GoBack':
        exit();
        break;
      case '*':
        loadKaiAd()
          .catch((e) => console.error(e))
        break;
    }
  }

  const buttons = Array.from(document.querySelectorAll('[data-action]'));

  buttons.forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      onKeyPress(e.currentTarget.dataset.action);
    });
  });

  window.addEventListener('keydown', function onKeyDown(e) {
    onKeyPress(e.key);
  });

  function onInternetChange() {
    if (navigator.onLine === false) {
        NO_INTERNET.removeAttribute('hidden');
        document.body.classList.add('no-scroll');
    } else if (navigator.onLine === true) {
        NO_INTERNET.setAttribute('hidden', '');
        document.body.classList.remove('no-scroll');
    }
  }

  function loadNewQuote() {
    return registerServiceWorker().then(() =>
      Promise.all([
        register('dailyquote', ONE_DAY)
          .catch((e) => console.error(e)),
        getRandomQuote()
          .then((quote) => displayQuote(quote.author, quote.content, quote.tags)),
        loadKaiAd()
          .catch((e) => console.error(e))
      ])
    );
  }

  window.addEventListener('online', onInternetChange);
  window.addEventListener('focus', onInternetChange);
  document.addEventListener('visibilitychange', onInternetChange);

  requestAnimationFrame(onInternetChange);
  requestAnimationFrame(loadNewQuote);

})();