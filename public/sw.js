// FPL Raptor service worker: shows push notifications and opens the app when
// one is tapped. Kept tiny on purpose; it does no offline caching.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  // iPhones require every push to show a notification, so always show one.
  event.waitUntil(
    self.registration.showNotification(data.title || "FPL Raptor", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined, // a newer alert with the same tag replaces the older one
      data: { url: data.url || "/me" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/me", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
