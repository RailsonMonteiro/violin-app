# Remover a migração do cache do Canva (`<dados>/canva` → `files/canva`)

> **Documento temporário.** Ele existe só para a tarefa de limpeza. Ao concluir,
> apague este arquivo e os comentários `TODO` que apontam para ele.

## O que é

O cache de export do Canva nasceu em `<dados>/canva`, fora do acervo. Passou para
`<dados>/files/canva` para: acompanhar a raiz escolhida em Armazenamento (troca de
pasta e backup levam tudo junto), ter contagem própria na tela de Armazenamento, e
ficar fora da cota e das limpezas automáticas — apagar um PDF por idade forçaria
uma reexportação, que gasta a cota do Canva.

Instalações que rodaram a versão anterior têm arquivos no endereço velho. **Três
peças temporárias** lidam com isso, todas em `electron/main/`:

| # | Peça | Onde | O que faz |
|---|------|------|-----------|
| 1 | `migrarCacheCanva` + `migrarCacheAntigo` + `migrateCache` | `canva/migration.js`, `canva/export.js`, `canva/index.js` | Move os arquivos no boot, antes da janela abrir |
| 2 | `_migrarReferenciasDoCanva` | `main.cjs` | Reescreve caminhos absolutos guardados na playlist da Biblioteca de Mídia (`modules.media_library.playlist` no `user_data`) |
| 3 | `_enderecoNovoDoCanva` | `protocol.js` | Fallback do `louvorja://local`: serve do endereço novo a URL guardada em `LJ_FILE_PROJECTION` (o que faz o telão reabrir a última projeção) |

## Quando remover

**Critério:** depois de pelo menos um ciclo de release completo com a versão que
migra, e idealmente com a certeza de que ninguém mais migra nada.

**Como medir antes de remover** (opcional, mas recomendado): o log
`[canva] Cache movido: … (N arquivos)` e o `[canva] N referência(s) da playlist
atualizadas` saem sempre que há algo a migrar. Se houver telemetria/diagnóstico à
mão, emitir um evento quando `movidos > 0` por uma versão e confirmar que zerou é
o sinal mais direto de que é seguro apagar.

**O que acontece se remover cedo** (para uma instalação que ainda tenha
`<dados>/canva`):

- os arquivos presos no endereço antigo são ignorados e o design é **reexportado**
  no próximo clique (gasta cota do Canva);
- item da playlist apontando para o caminho antigo **não projeta**;
- reabrir o telão nessa condição abre **vazio** até o operador projetar de novo.

Nada disso perde dado do operador — o pior caso é um export a mais e um clique
repetido —, mas é por isso que o item 2 e o item 3 existem separadamente da
migração de arquivos: eles cobrem referências já guardadas.

## Passo a passo

Âncoras por texto: os números de linha mudam entre versões.

### 1. `electron/main/protocol.js`

Remova a função `_enderecoNovoDoCanva` (o bloco que começa com o comentário
`Endereço novo de um arquivo que ficou no cache ANTIGO do Canva`) e o fallback
dentro do host `local`:

```js
        if (!(await fs.pathExists(raw))) {
          /* Cache do Canva no endereço antigo: serve do novo (ver o TODO acima). */
          const migrado = _enderecoNovoDoCanva(raw);
          if (migrado && (await fs.pathExists(migrado))) {
            return await _responderArquivo(migrado, request);
          }
          return new Response("Not found", { status: 404 });
        }
```

deve voltar a ser:

```js
        if (!(await fs.pathExists(raw))) {
          return new Response("Not found", { status: 404 });
        }
```

### 2. `electron/main.cjs`

- Remova `_migrarReferenciasDoCanva` (comentário
  `Referências guardadas ao cache do Canva que ficaram no endereço antigo`).
- Remova o bloco do boot logo **antes** de `createWindow();`:

```js
  /*
   * O cache de export do Canva saiu de `<dados>/canva` para `files/canva`.
   * ANTES da janela de propósito: mover arquivo enquanto o renderer pode pedir
   * um export deixaria a troca competir com o download (um PDF recém-exportado
   * poderia ser sobrescrito pelo antigo). São renomeações no mesmo volume —
   * custo de milissegundos — e depois daqui a pasta só tem o endereço novo.
   */
  try {
    const migracaoCanva = await canva.migrateCache();
    /* Só reescreve as referências se a migração deu certo: com arquivo preso no
       endereço antigo, apontar a playlist para o novo quebraria o item. */
    if (migracaoCanva?.ok) {
      _migrarReferenciasDoCanva(migracaoCanva.antigo, migracaoCanva.novo);
    }
  } catch (e) {
    console.warn("[main] Falha ao migrar o cache do Canva:", e?.message || e);
  }
```

Depois disso, `createWindow();` volta a ser o primeiro item do trecho (dentro do
`app.whenReady`). Não há mais nada do Canva no boot.

### 3. `electron/main/canva/index.js`

- Remova o require: `const { migrarCaminhosCanva } = require("./migration.js");`
- Remova a função `migrateCache` (comentário `Traz o cache de export do endereço
  antigo`) e as duas entradas `migrateCache` e `migrarCaminhosCanva` do
  `module.exports`.

### 4. `electron/main/canva/export.js`

- Remova o require: `const { migrarCacheCanva } = require("./migration.js");`
- Remova a função `migrarCacheAntigo` (comentário `Traz o cache do endereço
  antigo`) e a entrada `migrarCacheAntigo` do `module.exports`.
- **`pastaCanva()` fica**: `path.join(paths.filesDir(), "canva")` é o endereço
  definitivo.
- Ajuste o comentário de cabeçalho do módulo se ele ainda citar a mudança de
  endereço.

### 5. Apague os arquivos temporários

```
electron/main/canva/migration.js
electron/main/__tests__/protocolCanvaCache.spec.js
```

### 6. `electron/main/__tests__/canvaExport.spec.js`

Remova os dois `describe` que existem **só** para a migração:

- `migração do cache antigo (<dados>/canva → files/canva)`
- `referências guardadas ao cache (playlist da Biblioteca de Mídia)`

O resto do spec (export, cache por formato, selo, limpeza) não depende deles; os
constantes `PDF_ESPERADO`/`META_ESPERADO`/`JPG_ESPERADO` apontam para
`files/canva` e continuam valendo.

### 7. Confirme que não sobrou resíduo

```bash
rg "migrarCacheCanva|migrarCaminhosCanva|migrarCacheAntigo|migrateCache|_migrarReferenciasDoCanva|_enderecoNovoDoCanva"
```

A busca deve voltar vazia (nem em comentário). Se sobrar algo em
`docs/architecture.md` ou `CLAUDE.md`, ajuste junto — hoje a doc descreve
`files/canva` como o endereço e **não** descreve a migração, então o esperado é
não precisar mexer nela.

## O que **não** remover

- `pastaCanva()` e os alvos em `files/canva` (`canva/export.js`).
- A categoria própria "Exportações do Canva" na tela de Armazenamento
  (`AppMenuSincronizar.vue`), o `canva` no `stats()` de `electron/main/storage.js`
  e as chaves `options.storage.canva_size`/`clear_canva*` em `src/lang/{pt,es}.json`.
- A proteção de `files/canva` contra `enforceQuota` e `verify`/`clearUnused`, e o
  `clearFiles` que preserva a subpasta (`electron/main/storage.js`).
- O IPC `canva:clearCachedPdfs` (botão "Limpar exportações do Canva").

## Verificação

```bash
npm run validate:agent-context
npm run validate:manifests
npm run typecheck
npm test
npm run lint
```

Teste manual (uma vez, em um perfil de teste): coloque um arquivo qualquer em
`<dados>/canva/` e abra o app. Depois da remoção, a pasta **não** é migrada e o
app segue normal (ela fica órfã, sem ninguém lendo). Confirme também que a aba
Canva continua acendendo o selo de um design já exportado em `files/canva` e que
o botão "Limpar exportações do Canva" funciona.

## Checklist

- [ ] `_enderecoNovoDoCanva` e o fallback do `protocol.js` removidos
- [ ] `_migrarReferenciasDoCanva` e o bloco de boot removidos do `main.cjs`
- [ ] `migrateCache`/`migrarCaminhosCanva` removidos da fachada do Canva
- [ ] `migrarCacheAntigo` removido do `export.js`
- [ ] `canva/migration.js` apagado
- [ ] `protocolCanvaCache.spec.js` apagado
- [ ] `describe` de migração removidos do `canvaExport.spec.js`
- [ ] busca de resíduo vazia
- [ ] verificações do bloco acima passando
- [ ] este arquivo apagado, junto com os `TODO` que apontam para ele
