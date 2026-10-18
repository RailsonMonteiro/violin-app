// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * `files/canva` é o cache de export do Canva, dentro da pasta de mídia.
 *
 * Estes testes fixam o que separa um do outro: contagem própria em
 * Armazenamento, `clearFiles` que não leva o cache junto, e nenhuma remoção
 * automática (`enforceQuota`, `clearUnused`) tocando nele.
 */
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let base, filesDir, storage;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-canva-"));
  filesDir = path.join(base, "files");
  const pathsModule = require.resolve("../paths.js");
  require.cache[pathsModule] = {
    id: pathsModule,
    filename: pathsModule,
    loaded: true,
    exports: {
      dataDir: () => base,
      dataDirIssue: () => null,
      profileRestartRequired: () => false,
      filesDir: () => filesDir,
      jsonCacheDir: () => path.join(base, "json_db"),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    return request === "electron" ? { shell: {} } : originalLoad.call(this, request, ...args);
  };
  try {
    delete require.cache[require.resolve("../storage.js")];
    storage = require("../storage.js");
  } finally {
    Module._load = originalLoad;
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(base);
});

/** Arquivo com tamanho previsível (bytes), criando as pastas do caminho. */
const arquivo = (rel, bytes) =>
  fs.outputFile(path.join(filesDir, rel), "x".repeat(bytes));

const CANVA_PDF = "canva/D1.pdf";

describe("storage.stats — o cache do Canva é categoria própria", () => {
  it("tira o Canva do acervo e conta só a mídia dele, não o meta", async () => {
    await arquivo("musica.mp3", 10);
    await arquivo(CANVA_PDF, 100);
    await arquivo("canva/D1.pdf.json", 5);

    const stats = await storage.stats();

    /* Acervo: só o que o operador trouxe. */
    expect(stats.files).toEqual({ bytes: 10, count: 1 });
    /* Canva: os bytes são do par, mas a contagem é da apresentação. */
    expect(stats.canva).toEqual({ bytes: 105, count: 1 });
    expect(stats.total).toEqual({ bytes: 115, count: 2 });
  });

  it("sem cache do Canva a categoria zera, sem quebrar a soma", async () => {
    await arquivo("musica.mp3", 10);

    const stats = await storage.stats();

    expect(stats.canva).toEqual({ bytes: 0, count: 0 });
    expect(stats.total.bytes).toBe(10);
  });
});

describe("storage.clearFiles — limpar mídia não leva o cache do Canva", () => {
  it("apaga o acervo e preserva files/canva", async () => {
    await arquivo("musica.mp3", 10);
    await arquivo("library/media/upload.png", 20);
    await arquivo(CANVA_PDF, 100);
    await arquivo("canva/D1.pdf.json", 5);

    await expect(storage.clearFiles()).resolves.toEqual({ ok: true });

    expect(await fs.pathExists(path.join(filesDir, "musica.mp3"))).toBe(false);
    expect(await fs.pathExists(path.join(filesDir, "library"))).toBe(false);
    /* O cache tem botão próprio — apagar aqui forçaria reexportar (gasta cota). */
    expect(await fs.pathExists(path.join(filesDir, CANVA_PDF))).toBe(true);
    expect(await fs.pathExists(path.join(filesDir, "canva/D1.pdf.json"))).toBe(true);
  });

  it("a pasta continua existindo depois de limpar, mesmo sem acervo", async () => {
    await fs.remove(filesDir);

    await expect(storage.clearFiles()).resolves.toEqual({ ok: true });

    expect(await fs.pathExists(filesDir)).toBe(true);
  });
});

describe("storage.enforceQuota — o cache do Canva não é descartável", () => {
  it("remove só o acervo antigo e deixa o Canva intacto", async () => {
    await arquivo(CANVA_PDF, 1000);
    await arquivo("musica.mp3", 100);

    const r = await storage.enforceQuota(50);

    expect(r.removed).toBe(1);
    expect(await fs.pathExists(path.join(filesDir, CANVA_PDF))).toBe(true);
    expect(await fs.pathExists(path.join(filesDir, "musica.mp3"))).toBe(false);
  });

  it("acervo dentro do limite não remove nada, nem contando o Canva", async () => {
    await arquivo(CANVA_PDF, 5000);
    await arquivo("musica.mp3", 10);

    await expect(storage.enforceQuota(50)).resolves.toMatchObject({ removed: 0 });
    expect(await fs.pathExists(path.join(filesDir, CANVA_PDF))).toBe(true);
  });
});

describe("storage.verify/clearUnused — o cache do Canva não é 'sobra'", () => {
  it("verify não lista o Canva como extra", async () => {
    await arquivo(CANVA_PDF, 100);
    await arquivo("musica.mp3", 10);

    const { extra } = await storage.verify([]);

    expect(extra.map((f) => f.remote)).toEqual(["musica.mp3"]);
  });

  it("clearUnused apaga a sobra do acervo e nunca o Canva", async () => {
    await arquivo(CANVA_PDF, 100);
    await arquivo("canva/D1.pdf.json", 5);
    await arquivo("musica.mp3", 10);

    const r = await storage.clearUnused([]);

    expect(r).toEqual({ removed: 1 });
    expect(await fs.pathExists(path.join(filesDir, CANVA_PDF))).toBe(true);
    expect(await fs.pathExists(path.join(filesDir, "canva/D1.pdf.json"))).toBe(true);
    expect(await fs.pathExists(path.join(filesDir, "musica.mp3"))).toBe(false);
  });
});
