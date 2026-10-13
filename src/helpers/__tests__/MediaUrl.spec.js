import { describe, expect, it } from "vitest";
import { resolveMediaReference } from "@/helpers/MediaUrl";

describe("resolveMediaReference", () => {
  it("mantém URL completa e extrai o caminho local", () => {
    expect(resolveMediaReference("https://cdn.louvorja.com/musics/pt/hino.opus")).toEqual({
      url: "https://cdn.louvorja.com/musics/pt/hino.opus",
      relativePath: "/musics/pt/hino.opus",
    });
  });

  it("aceita o formato relativo antigo", () => {
    const result = resolveMediaReference("/images/capa.jpg");
    expect(result?.relativePath).toBe("/images/capa.jpg");
    expect(result?.url).toContain("/images/capa.jpg");
  });

  it("remove o prefixo /file de URLs antigas completas", () => {
    expect(
      resolveMediaReference("https://api.louvorja.com.br/file/covers/capa.bmp")?.relativePath
    ).toBe("/covers/capa.bmp");
  });

  it.each([
    ["https://api.louvorja.workers.dev/file/musics/pt/Hin%C3%A1rio%20Adventista/Conta.opus"],
    ["https://api.louvorja.com.br/file/musics/pt/Hin%C3%A1rio%20Adventista/Conta.opus"],
  ])(
    "manda para o armazenamento a mídia que o catálogo antigo apontava para a API: %s",
    (legacy) => {
      const result = resolveMediaReference(legacy);
      expect(result?.url).toBe(
        "https://files.louvorja.com.br/musics/pt/Hin%C3%A1rio%20Adventista/Conta.opus"
      );
      expect(result?.relativePath).toBe("/musics/pt/Hinário Adventista/Conta.opus");
    }
  );

  it("não troca endereços que não são do /file da API", () => {
    expect(resolveMediaReference("https://api.louvorja.workers.dev/params")?.url).toBe(
      "https://api.louvorja.workers.dev/params"
    );
    expect(resolveMediaReference("https://files.louvorja.com.br/covers/1992.jpg")?.url).toBe(
      "https://files.louvorja.com.br/covers/1992.jpg"
    );
  });

  it("rejeita protocolos e traversal", () => {
    expect(resolveMediaReference("ftp://cdn.louvorja.com/file.mp3")).toBeNull();
    expect(resolveMediaReference("/musics/../secret.mp3")).toBeNull();
  });
});
