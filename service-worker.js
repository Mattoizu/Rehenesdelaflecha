const CACHE_NAME = "ciudadela-jugadores-v16";
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
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
