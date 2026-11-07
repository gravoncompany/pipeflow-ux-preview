// Service worker dedicado a notificações push do PipeFlow CRM.
// Não faz cache do aplicativo; apenas recebe eventos push e abre a tela certa ao tocar.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PipeFlow CRM", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PipeFlow CRM";
  const options = {
    body: data.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/favicon.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
