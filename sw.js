const CACHE_NAME = "wagewise-v1";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./css/styles.css",
    "./js/app.js",
    "./js/calculator.js",
    "./js/storage.js",
    "./js/charts.js",
    "./js/tax.js",
    "./js/ni.js",
    "./js/pdf.js",
    "./js/payslip.js",
    "./js/forecast.js",
    "./js/notifications.js",
    "./manifest.json"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});