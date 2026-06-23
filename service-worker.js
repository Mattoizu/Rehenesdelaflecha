const CACHE_NAME = "ciudadela-jugadores-v19";
const IMAGE_FILES = [
  "./grupo1.jpeg", "./grupo2.jpeg", "./grupo3.jpeg", "./grupo4.jpeg",
  "./portrait-arthas.jpg", "./portrait-miguel-angel.jpg", "./portrait-nilux.jpg",
  "./portrait-galahad.jpg", "./portrait-amber.jpg", "./grupo-chibi.png",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(IMAGE_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // NUNCA cachear código — siempre desde red
  const isCode = url.pathname.endsWith(".js") ||
                 url.pathname.endsWith(".css") ||
                 url.pathname.endsWith(".html") ||
                 url.pathname === "/" ||
                 url.pathname.endsWith(".webmanifest");
  if (isCode) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Imágenes: cache first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
