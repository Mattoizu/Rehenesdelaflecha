const CACHE_NAME = "ciudadela-jugadores-v18";
const APP_FILES = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg",
  "./grupo1.jpeg", "./grupo2.jpeg", "./grupo3.jpeg",
  "./portrait-arthas.jpg", "./portrait-miguel-angel.jpg", "./portrait-nilux.jpg",
  "./portrait-galahad.jpg", "./portrait-amber.jpg", "./grupo-chibi.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept Firebase or external requests
  if (url.origin !== location.origin) return;

  // Network first for HTML and JS — always get fresh code
  if (url.pathname.endsWith(".html") || url.pathname.endsWith(".js") || url.pathname === "/" || url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first for images — they never change
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
