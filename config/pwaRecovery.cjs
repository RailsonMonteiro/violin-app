/** Executado inline no HTML, antes de qualquer módulo do aplicativo. Sem imports. */
function installPwaRecovery({ scope, build, storageKey, startupWaitMs }) {
  const win = window;
  if (!navigator.serviceWorker || win.louvorjaApi || win.__ljPwaRecovery) return;
  let mounted = false;
  let reloading = false;
  let checking = null;
  let registration = null;
  let banner = null;
  let settle;
  const events = [];
  const ready = new Promise((resolve) => {
    settle = resolve;
  });
  const base = new URL(scope, location.origin);
  const record = (stage, error) => {
    if (events.length < 10)
      events.push({
        stage,
        loaded_build: build,
        error_name: typeof error?.name === "string" ? error.name.slice(0, 100) : "Error",
        error_message:
          typeof error?.message === "string"
            ? error.message.slice(0, 500)
            : "Falha ao iniciar o aplicativo",
      });
  };
  const remember = (target) => {
    try {
      const old = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (old?.target === target && Date.now() - old.at < 60_000) return false;
      sessionStorage.setItem(storageKey, JSON.stringify({ target, at: Date.now(), events }));
      return true;
    } catch {
      return false;
    }
  };
  const inspect = async () => {
    if (!navigator.serviceWorker.controller || reloading) return;
    // Infraestrutura de boot: não depende de Http.ts, Vue, IndexedDB ou chunks.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetch(new URL("app-build.json", base), {
        cache: "no-store",
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(`Identidade do código: HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 256) throw new Error("Identidade do código inválida");
      const active = JSON.parse(body);
      if (
        active?.version !== 1 ||
        typeof active.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(active.id)
      ) {
        throw new Error("Identidade do código inválida");
      }
      if (!mounted && active.id !== build && remember(active.id)) {
        reloading = true;
        settle(true);
        location.reload();
      }
    } finally {
      clearTimeout(timer);
    }
  };
  const check = () => {
    if (checking) return checking;
    checking = (async () => {
      let timer;
      try {
        registration = await Promise.race([
          navigator.serviceWorker.register(new URL("sw.js", base), {
            scope: base.pathname,
            updateViaCache: "none",
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Registro do código demorou demais")),
              10_000
            );
          }),
        ]);
        clearTimeout(timer);
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        await inspect();
        if (reloading) return;
        // Registrar o mesmo script pode apenas devolver o registro existente.
        // update() força a busca mesmo numa retomada ocorrida poucos segundos depois.
        await Promise.race([
          registration.update(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Verificação do código demorou demais")),
              10_000
            );
          }),
        ]);
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        await inspect();
      } catch (error) {
        record("recover", error);
        // Uma falha de rede não impede aplicar código já guardado pelo SW.
        try {
          await inspect();
        } catch (failure) {
          record("active_build", failure);
        }
      } finally {
        clearTimeout(timer);
        settle(reloading);
        checking = null;
      }
    })();
    return checking;
  };
  const showFailure = () => {
    if (mounted || reloading || banner || !document.body) return;
    banner = document.createElement("section");
    banner.setAttribute("role", "alert");
    banner.style.cssText =
      "position:fixed;inset:auto 16px 16px;z-index:2147483647;padding:20px;background:#fff;color:#172033;border:2px solid #235cbd;border-radius:12px;font:16px system-ui;box-shadow:0 4px 24px #0004";
    const text = document.createElement("p");
    text.textContent =
      "O aplicativo ainda não conseguiu iniciar. Estamos tentando recuperar o código. Seus dados serão mantidos.";
    const button = document.createElement("button");
    button.textContent = "Verificar e recuperar";
    button.style.cssText =
      "padding:12px 20px;font:inherit;background:#235cbd;color:white;border:0;border-radius:8px";
    button.onclick = () => {
      void check();
    };
    banner.append(text, button);
    document.body.append(banner);
  };
  const startupTimer = setTimeout(() => settle(reloading), startupWaitMs);
  const failureTimer = setTimeout(showFailure, 15_000);
  const retryTimer = setInterval(() => {
    if (!mounted && document.visibilityState !== "hidden") void check();
  }, 60_000);
  const foreground = () => {
    if (!mounted && document.visibilityState !== "hidden") void check();
  };
  const failed = (event) => {
    if (mounted) return;
    record("bootstrap", event.error || event.reason || event.payload || event.detail);
    showFailure();
    void check();
  };
  const activated = () => {
    void inspect().catch((error) => record("active_build", error));
  };
  navigator.serviceWorker.addEventListener("controllerchange", activated);
  win.addEventListener("online", foreground);
  win.addEventListener("pageshow", foreground);
  document.addEventListener("visibilitychange", foreground);
  win.addEventListener("error", failed);
  win.addEventListener("unhandledrejection", failed);
  win.addEventListener("vite:preloadError", failed);
  win.addEventListener("lj:bootstrap-failed", failed);
  win.__ljPwaRecovery = {
    ready,
    markMounted() {
      mounted = true;
      settle(false);
      clearTimeout(startupTimer);
      clearTimeout(failureTimer);
      clearInterval(retryTimer);
      banner?.remove();
      navigator.serviceWorker.removeEventListener("controllerchange", activated);
      win.removeEventListener("online", foreground);
      win.removeEventListener("pageshow", foreground);
      document.removeEventListener("visibilitychange", foreground);
      win.removeEventListener("error", failed);
      win.removeEventListener("unhandledrejection", failed);
      win.removeEventListener("vite:preloadError", failed);
      win.removeEventListener("lj:bootstrap-failed", failed);
    },
    drainDiagnostics() {
      let previous = [];
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (saved?.target === build && Array.isArray(saved.events)) {
          previous = saved.events.slice(0, 10);
          // Mantém a trava de recarga, mas consome os diagnósticos uma vez.
          sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, events: [] }));
        }
      } catch {
        /* storage indisponível não impede iniciar */
      }
      return [...previous, ...events.splice(0)];
    },
  };
  void check();
}

module.exports = { installPwaRecovery };
