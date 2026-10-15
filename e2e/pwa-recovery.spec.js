import { test, expect, devices } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import recovery from "../config/pwaRecovery.cjs";

const { installPwaRecovery } = recovery;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

// Um bootstrap quebrado não importa módulos do app: a recuperação tem que funcionar sozinha.
function html(build) {
  const script = `(${installPwaRecovery.toString()})(${JSON.stringify({ scope: "/", build, storageKey: "recovery-test", startupWaitMs: 2500 })});
    ${build === A ? "throw new Error('broken old bootstrap')" : "window.__ljPwaRecovery.ready.then(reloading => { if (!reloading) { window.__ljPwaRecovery.markMounted(); document.body.dataset.mounted = 'yes'; } });"}`;
  const hash = createHash("sha256").update(script).digest("base64");
  return `<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'"></head><body data-build="${build}"><script>${script}</script></body></html>`;
}

for (const mobile of [false, true]) {
  test(`recupera PWA com bootstrap quebrado e preserva dados (${mobile ? "Android emulado" : "PC"})`, async ({
    browser,
  }) => {
    let current = A;
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      if (request.url === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(`const cache = 'code-' + ${JSON.stringify(current)};
          self.addEventListener('install', event => event.waitUntil((async () => {
            const c = await caches.open(cache); await c.addAll(['/', '/app-build.json']); await self.skipWaiting();
          })()));
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
          self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
          self.addEventListener('fetch', event => {
            if (event.request.mode === 'navigate' || new URL(event.request.url).pathname === '/app-build.json')
              event.respondWith(caches.open(cache).then(c => c.match(event.request.mode === 'navigate' ? '/' : '/app-build.json')));
          });`);
      } else if (request.url === "/app-build.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ version: 1, id: current }));
      } else {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html(current));
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const context = await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : {}),
      bypassCSP: false,
      serviceWorkers: "allow",
    });
    try {
      const page = await context.newPage();
      const violations = [];
      page.on("console", (message) => {
        if (message.text().includes("Content Security Policy")) violations.push(message.text());
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(
        () => navigator.serviceWorker.controller && window.__ljPwaRecovery
      );
      await page.evaluate(async () => {
        localStorage.setItem("preference", "keep");
        await (
          await caches.open("downloaded-audio")
        ).put("/song.opus", new Response("saved audio"));
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("user-data", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("data");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("data", "readwrite");
            transaction.objectStore("data").put("saved schedule", "schedule");
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        });
      });
      current = B;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForFunction(
        (build) => document.body.dataset.build === build && document.body.dataset.mounted === "yes",
        B
      );
      const inspect = () =>
        page.evaluate(async () => ({
          preference: localStorage.getItem("preference"),
          audio: await (await (await caches.open("downloaded-audio")).match("/song.opus")).text(),
          schedule: await new Promise((resolve, reject) => {
            const request = indexedDB.open("user-data");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction("data");
              const read = transaction.objectStore("data").get("schedule");
              read.onsuccess = () => resolve(read.result);
              transaction.oncomplete = () => db.close();
            };
          }),
        }));
      const saved = { preference: "keep", audio: "saved audio", schedule: "saved schedule" };
      expect(await inspect()).toEqual(saved);
      expect(await page.evaluate(() => window.__ljPwaRecovery.drainDiagnostics())).toEqual(
        expect.arrayContaining([expect.objectContaining({ error_message: "broken old bootstrap" })])
      );
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => document.body.dataset.mounted === "yes");
      expect(await inspect()).toEqual(saved);
      await context.setOffline(false);
      current = C;
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
      await page.waitForFunction(
        async (build) => (await (await fetch("/app-build.json")).json()).id === build,
        C
      );
      expect(await page.evaluate(() => document.body.dataset.build)).toBe(B);
      await page.reload();
      await page.waitForFunction(
        (build) => document.body.dataset.build === build && document.body.dataset.mounted === "yes",
        C
      );
      expect(await inspect()).toEqual(saved);
      expect(violations).toEqual([]);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
