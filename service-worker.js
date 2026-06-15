const CACHE_NAME = "ciudadela-jugadores-v17";
const APP_FILES = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg",
  "./grupo1.jpeg", "./grupo2.jpeg", "./grupo3.jpeg",
  "./portrait-arthas.jpg", "./portrait-miguel-angel.jpg", "./portrait-nilux.jpg",
  "./portrait-galahad.jpg", "./portrait-amber.jpg", "./grupo-chibi.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  // Solo cachear archivos propios — nunca interceptar Firebase ni requests externas
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
