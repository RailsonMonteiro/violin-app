import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPwaRecovery } from "./pwaRecovery.cjs";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
let sw;
let reload;
let active;
const boot = (build = A) => {
  installPwaRecovery({ scope: "/", build, storageKey: "test-recovery", startupWaitMs: 2500 });
  return window.__ljPwaRecovery;
};
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  document.body.innerHTML = "";
  delete window.__ljPwaRecovery;
  active = A;
  reload = vi.fn();
  vi.stubGlobal("location", { origin: "https://app.test", reload });
  sw = Object.assign(new EventTarget(), {
    controller: {},
    register: vi
      .fn()
      .mockResolvedValue({ waiting: null, update: vi.fn().mockResolvedValue(undefined) }),
  });
  vi.stubGlobal("navigator", { serviceWorker: sw });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ version: 1, id: active })))
  );
});
afterEach(() => {
  window.__ljPwaRecovery?.markMounted();
  delete window.__ljPwaRecovery;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recuperação independente do aplicativo", () => {
  it("aplica código pronto antes de iniciar, sem importar módulos do app", async () => {
    active = B;
    const recovery = boot();
    expect(await recovery.ready).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("primeira instalação não recarrega nem apaga o armazenamento", async () => {
    const recovery = boot();
    expect(await recovery.ready).toBe(false);
    sw.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("um bootstrap quebrado continua buscando código corrigido e recupera na ativação", async () => {
    const recovery = boot();
    await recovery.ready;
    window.dispatchEvent(
      new CustomEvent("lj:bootstrap-failed", { detail: new Error("chunk antigo ausente") })
    );
    expect(document.body.textContent).toContain("Verificar e recuperar");
    active = B;
    sw.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem("test-recovery")).events[0]).toMatchObject({
      stage: "bootstrap",
      error_message: "chunk antigo ausente",
    });
  });

  it("não entra em laço se a recarga receber novamente o HTML antigo", async () => {
    sessionStorage.setItem("test-recovery", JSON.stringify({ target: B, at: Date.now() }));
    active = B;
    expect(await boot().ready).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("sai do caminho quando a interface monta e não recarrega uma apresentação", async () => {
    const recovery = boot();
    await recovery.ready;
    recovery.markMounted();
    active = B;
    sw.dispatchEvent(new Event("controllerchange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(sw.register).toHaveBeenCalledTimes(1);
  });

  it("registro pendurado não bloqueia boot nem impede nova tentativa", async () => {
    sw.register.mockImplementationOnce(() => new Promise(() => {}));
    const recovery = boot();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await recovery.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(7500);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(2);
    expect(recovery.drainDiagnostics()).toEqual([expect.objectContaining({ stage: "recover" })]);
  });

  it("uma resposta inválida não provoca recarga", async () => {
    fetch.mockResolvedValue(new Response("<html>portal</html>"));
    expect(await boot().ready).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("falha de registro offline ainda aplica código que já foi guardado", async () => {
    sw.register.mockRejectedValue(new TypeError("Failed to fetch"));
    active = B;
    expect(await boot().ready).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
