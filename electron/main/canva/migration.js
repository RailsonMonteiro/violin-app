"use strict";

/**
 * migration.js — Traz o cache de export do Canva para dentro de `files/`.
 *
 * O cache nasceu em `<dados>/canva`, fora do acervo. Passou para
 * `<dados>/files/canva` para viajar junto da pasta de dados (troca de raiz,
 * backup, contagem em Armazenamento) e para o operador achar num lugar só tudo
 * que é arquivo do app.
 *
 * TODO: remover esta migração na versão seguinte. A partir dela nenhuma
 * instalação nova cria `<dados>/canva`, e o código vira peso morto.
 * Roteiro completo (inclui as referências guardadas e o fallback do protocolo):
 * `docs/canva-cache-migration-removal.md`.
 */

const fs = require("fs-extra");
const path = require("path");

/**
 * Move o conteúdo de `origem` para `destino`, entrada por entrada.
 *
 * Sem a pasta antiga não faz nada; com o destino já povoado, não sobrescreve —
 * o arquivo de lá é mais novo (foi reexportado depois). Um arquivo que não
 * migrou custa um export a mais, que gasta cota do Canva, mas nada disso pode
 * derrubar o boot: falha vira contagem no retorno e a origem fica no lugar
 * para a próxima tentativa.
 *
 * @param {string} origem  `<dados>/canva`
 * @param {string} destino `<dados>/files/canva`
 * @returns {Promise<{movidos: number, falhas: number}>}
 */
async function migrarCacheCanva(origem, destino) {
  const resumo = { movidos: 0, falhas: 0 };
  if (path.resolve(origem) === path.resolve(destino)) return resumo;

  let entradas = [];
  try {
    entradas = await fs.readdir(origem);
  } catch (_) {
    /* Pasta antiga não existe: cache já está no endereço novo (ou nunca houve). */
    return resumo;
  }
  if (!entradas.length) return resumo;

  try {
    await fs.ensureDir(destino);
  } catch (_) {
    /* Sem destino gravável não há o que mover; a origem permanece intacta. */
    return { movidos: 0, falhas: entradas.length };
  }

  for (const nome of entradas) {
    try {
      const de = path.join(origem, nome);
      const para = path.join(destino, nome);
      if (await fs.pathExists(para)) continue;
      await fs.move(de, para, { overwrite: false });
      resumo.movidos += 1;
    } catch (_) {
      resumo.falhas += 1;
    }
  }

  /* Só some com a pasta antiga se ficou vazia — o que sobrou é o que o próximo
     boot deve tentar de novo (arquivo travado, permissão, meta órfão). */
  try {
    await fs.rmdir(origem);
  } catch (_) {
    /* ignore */
  }
  return resumo;
}

/**
 * Reescreve os caminhos que apontavam para o endereço antigo do cache.
 *
 * A playlist da Biblioteca de Mídia guarda o caminho ABSOLUTO do arquivo
 * (`modules.media_library.playlist` no user_data): sem isto, um design do Canva
 * que o operador pôs na lista antes da atualização deixaria de projetar — o
 * arquivo mudou de lugar e a referência ficou apontando para o vazio.
 *
 * Pura de propósito: só o array e os dois diretórios entram, para o teste rodar
 * sem user_data e o main decidir onde persistir.
 *
 * @param {unknown} lista
 * @param {string} antigo
 * @param {string} destino
 * @returns {{lista: unknown[], trocados: number}}
 */
function migrarCaminhosCanva(lista, antigo, destino) {
  if (!Array.isArray(lista)) return { lista, trocados: 0 };
  if (typeof antigo !== "string" || typeof destino !== "string") return { lista, trocados: 0 };
  const prefixo = antigo.endsWith(path.sep) ? antigo : `${antigo}${path.sep}`;
  let trocados = 0;
  const nova = lista.map((item) => {
    if (!item || typeof item !== "object") return item;
    const atual = item.path;
    if (typeof atual !== "string" || !atual.startsWith(prefixo)) return item;
    trocados += 1;
    return { ...item, path: path.join(destino, atual.slice(prefixo.length)) };
  });
  return { lista: nova, trocados };
}

module.exports = { migrarCacheCanva, migrarCaminhosCanva };
