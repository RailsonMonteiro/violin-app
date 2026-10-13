import { describe, expect, it } from "vitest";
import { apiTokenHeaders } from "@/config/Api";

describe("apiTokenHeaders", () => {
  it.each([
    "https://api.louvorja.workers.dev/json_db/config",
    "https://api.louvorja.com.br/json_db/music_1",
    "https://files.louvorja.com.br/json_db/config.json",
  ])("não manda o token à API oficial (evita pré-voo CORS): %s", (url) => {
    expect(apiTokenHeaders("segredo", url)).toEqual({});
  });

  it("manda o token a um servidor próprio que o exija", () => {
    expect(apiTokenHeaders("segredo", "https://meu-servidor.exemplo/json_db/config")).toEqual({
      "Api-Token": "segredo",
    });
  });

  it("não manda cabeçalho vazio", () => {
    expect(apiTokenHeaders("", "https://meu-servidor.exemplo/json_db/config")).toEqual({});
  });

  it("não manda o token quando a URL é inválida", () => {
    expect(apiTokenHeaders("segredo", "não é url")).toEqual({});
  });

  it("não confunde um domínio parecido com o oficial", () => {
    expect(apiTokenHeaders("segredo", "https://evil-louvorja.com.br/x")).toEqual({
      "Api-Token": "segredo",
    });
  });
});
