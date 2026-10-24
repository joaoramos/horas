# Horas — Jardim da Mata

Web app para os funcionários registarem as horas de trabalho e manterem o balanço de horas em dia.
Fica em https://horas.jardimdamata.pt/ (requisitos em [brief.md](brief.md)).

## Como funciona

```
Browser ──▶ Cloudflare Worker (horas.jardimdamata.pt) ──▶ Google Apps Script ──▶ Google Sheets
            public/  → páginas                            apps-script/Code.gs
            src/     → API e cálculo do balanço
```

- **`public/`**: a interface (HTML, CSS e JS, sem build). Rotas: `/` (equipa), `/regras` e `/<id>` (ex.: `/mariana`).
- **`src/saldo.js`**: as regras de cálculo (prazo de 5 dias úteis, máximo de 2h por dia, incumprimento, saldo transitado).
- **`src/dados.js`**: lê e grava na folha, através do Apps Script. As leituras ficam 30 segundos em cache.
- **`apps-script/Code.gs`**: script ligado à folha que lê os separadores e grava os registos.
- **`public/jm/`**: os estilos do site do Jardim da Mata (tokens, `site.css`, os temas e o seletor de temas), copiados sem alterações.
  `public/styles.css` só tem os componentes próprios da app e usa apenas tokens semânticos, para que todos os temas se apliquem.

### Estilos e temas

Os estilos vêm do repositório `jardimdamata`. Depois de os alterar lá, atualize a cópia e faça commit:

```sh
npm run sincronizar-estilos              # assume ../jardimdamata
npm run sincronizar-estilos -- /outro/caminho/jardimdamata
```

O seletor de temas (canto inferior direito) guarda a escolha no browser, com a mesma chave do site (`jm-theme`).
Quando o site escolher um tema definitivo e apagar `themes.css` e `theme-switcher.js`, basta voltar a sincronizar e retirar as duas linhas correspondentes em `public/index.html`.

Tudo cabe nos planos gratuitos do Cloudflare Workers e do Google Apps Script.

## A folha Google Sheets

| Separador | Colunas | Para quê |
| --- | --- | --- |
| `Funcionarios` | `id`, `nome`, `pin`, `saldo_inicial`, `ativo` | Uma linha por funcionário. O `id` é o endereço (`mariana` → `/mariana`). `saldo_inicial` em horas (ex.: `70`). Escreva `não` em `ativo` para esconder alguém. |
| `Registos` | `data`, `funcionario`, `horas`, `nota`, `atualizado_em` | Uma linha por dia com horas a mais (`1,5`) ou a menos (`-2`). A app escreve aqui, mas também se pode editar à mão. |
| `Feriados` | `data`, `descricao` | Dias que não contam como dias úteis. |

- Para **acrescentar um funcionário**, basta uma nova linha em `Funcionarios`.
- Para **acertar o balanço** de alguém, altere `saldo_inicial` ou acrescente uma linha em `Registos`.
- As datas podem estar em `2026-10-24` ou `24/10/2026`. As horas aceitam `1,5`, `-1.25`, `1:30` ou `-2h`.
- As alterações feitas à mão aparecem na app em até 30 segundos.

## Regras de cálculo

- Cada registo é a diferença face às 8 horas do dia, entre −2h e +2h, em intervalos de 15 minutos.
- Pode registar a semana anterior, a corrente e planear as duas seguintes.
- Os dias até ontem estão **confirmados** e contam para o saldo total. Hoje e os dias seguintes estão **planeados**.
- Cada desvio tem de ser compensado nos 5 dias úteis seguintes. As compensações abatem primeiro os desvios mais antigos.
- Se o prazo passar sem a compensação confirmada, o funcionário fica **em incumprimento** até compensar.
- O `saldo_inicial` é **saldo transitado** e não tem prazo. Vai sendo abatido por horas de sinal contrário quando já não há outros desvios por compensar. Por exemplo, a Mariana reduz as suas 70h trabalhando menos horas.
- "A compensar até sexta" soma os desvios com prazo até ao fim dessa semana, contando já com as horas planeadas. Ao fim de semana, a "semana corrente" passa a ser a semana seguinte.

## Instalação

### 1. Google Sheets e Apps Script

1. Crie uma folha Google Sheets.
2. Em **Extensões › Apps Script**, cole o conteúdo de [apps-script/Code.gs](apps-script/Code.gs) e guarde.
3. Escolha a função `configurar` e clique em **Executar**. Autorize o acesso quando for pedido.
   A função cria os separadores (com a Mariana, 70h, e a Vera, 0h) e regista um token no **Registo de execução**. Copie esse token.
4. Na folha, mude os PIN da Mariana e da Vera (vêm como `0000`).
5. Em **Implementar › Nova implementação › Aplicação Web**:
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**

   Copie o URL que termina em `/exec`.

Sempre que alterar o `Code.gs`, faça **Implementar › Gerir implementações › Editar › Nova versão**, para que o URL continue o mesmo.

### 2. Cloudflare (deploy automático a partir do GitHub)

O site é publicado automaticamente sempre que se faz `git push` para o ramo `main` de
[joaoramos/horas](https://github.com/joaoramos/horas), através dos Workers Builds do Cloudflare (gratuitos).
É preciso que o domínio `jardimdamata.pt` esteja na conta Cloudflare.

Configuração (uma única vez):

1. Faça o primeiro `git push` para o GitHub.
2. No painel do Cloudflare, vá a **Workers & Pages › Create › Import a repository**, ligue a conta GitHub e escolha `joaoramos/horas`.
3. Nas definições de build:
   - Project name: **`horas`** (tem de ser igual ao `name` em `wrangler.jsonc`)
   - Build command: **`npm test`** (se os testes falharem, o deploy não avança)
   - Deploy command: **`npx wrangler deploy`**
   - Root directory: deixe vazio
4. Depois do primeiro deploy, em **Settings › Variables and Secrets**, acrescente dois segredos (tipo **Secret**, não Text):
   - `APPS_SCRIPT_URL`: o URL `/exec` do passo 1.5
   - `APPS_SCRIPT_TOKEN`: o token do passo 1.3

   Os segredos mantêm-se entre deploys. As variáveis do tipo Text seriam apagadas no deploy seguinte, porque não estão no `wrangler.jsonc`.
5. Confirme em **Settings › Builds** que o ramo de produção é `main`.

A partir daí, cada `git push` para `main` corre os testes e publica em https://horas.jardimdamata.pt/.
Os pushes para outros ramos geram uma versão de pré-visualização, sem mexer no site.
O progresso e os erros de cada build aparecem no separador **Deployments** do Worker e no próprio commit, no GitHub.

O `wrangler.jsonc` já liga o Worker ao domínio `horas.jardimdamata.pt`. O ficheiro `.node-version` pede Node 22 ao ambiente de build.

### Desenvolvimento local

```sh
cp .dev.vars.example .dev.vars   # DEMO=1: usa dados de exemplo em memória
npm run dev                      # http://localhost:8787 (PIN 1234 e 5678)
npm test
```

É preciso Node 22 ou mais recente. O `package.json` força o `undici` 7.30.1 (em `overrides`), porque o Wrangler 4.152 ainda traz uma versão com vulnerabilidades conhecidas. Pode retirar essa linha quando o Wrangler incluir uma versão corrigida.

## Segurança

- O brief pede uma folha de acesso público. Se a folha for partilhada com "qualquer pessoa com o link", **os PIN ficam visíveis** a quem tiver o link. A app não precisa disso: o Apps Script corre com a sua conta. Recomendo manter a folha privada.
- O URL do Apps Script e o token só existem no Worker. O browser nunca os vê.
- Os PIN curtos protegem pouco contra tentativas repetidas. Para mais proteção, use PIN mais longos ou acrescente um limite de tentativas no Worker.
