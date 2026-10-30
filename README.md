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

### App no ecrã principal

Cada pessoa abre o seu endereço (ex.: https://horas.jardimdamata.pt/mariana), introduz o PIN e adiciona a página ao ecrã principal:

- **iPhone (Safari):** botão Partilhar › **Adicionar ao ecrã principal**.
- **Android (Chrome):** menu ⋮ › **Adicionar ao ecrã principal** (ou **Instalar app**).

A app chama-se "Horas", tem o ícone das árvores e abre sempre na página onde foi adicionada.
O manifesto é gerado pelo Worker (`/manifest.webmanifest?pagina=/mariana`), e o Worker escreve o link certo no HTML
de cada página. O Safari ignora alterações ao manifesto feitas por JavaScript, por isso os links entre páginas
carregam a página de raiz.

- O PIN fica guardado no telemóvel até a pessoa carregar em **Sair**.
- Ao voltar à app depois de mais de um minuto, os dados são atualizados.
- Sem rede, a app abre na mesma e mostra uma mensagem com o botão **Tentar de novo** (`public/sw.js`). Os saldos nunca ficam guardados: vêm sempre da folha.
- Os ícones estão em `public/icones/`, recortados do logótipo em alta resolução do repositório `jardimdamata`.

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
| `Funcionarios` | `id`, `nome`, `pin`, `saldo_inicial`, `ativo`, `entrada`, `saida`, `pausa` | Uma linha por funcionário. O `id` é o endereço (`mariana` → `/mariana`). `saldo_inicial` em horas (ex.: `70`). Escreva `não` em `ativo` para esconder alguém. `entrada`/`saida` são o horário habitual (ex.: `09:30` e `18:30`) e `pausa` as horas sem trabalho (ex.: `1`). |
| `Registos` | `data`, `funcionario`, `entrada`, `saida`, `horas`, `nota`, `atualizado_em`, `tipo` | Uma linha por pessoa e por dia útil, com a hora de entrada e de saída. `horas` é o desvio face às 8h (ex.: `0,5` ou `-2`), calculado a partir do horário. `tipo` fica vazio nos dias normais; `férias` marca o dia como férias dessa pessoa. A app escreve aqui, e todas as noites acrescenta o horário habitual nos dias que ninguém alterou. Também se pode editar à mão. |
| `Feriados` | `data`, `descricao` | Dias que não contam como dias úteis. Na app aparecem como dias inativos, com a descrição, e não podem ser alterados. |

### Manutenção da folha

A folha é a fonte de verdade da app: o que lá estiver aparece na app em até 30 segundos.
Estas são as tarefas de quem a mantém (APJM).

#### Todos os meses

- **Depois do fecho de cada mês** (no primeiro dia útil do mês seguinte), abra a página da equipa na app e veja, para cada pessoa, se houve **horas a descontar no salário** (saldo abaixo de −30h) ou **horas perdidas** (acima de +50h). As horas a descontar têm de ser comunicadas ao processamento salarial. A app não o faz.
- **Durante o mês**, veja quem tem a etiqueta "Perto do limite", "Acima de +50h" ou "Abaixo de −30h", e fale com essa pessoa antes do fecho.
- Confirme que o separador `Registos` tem uma linha por pessoa para cada dia útil que passou (o preenchimento é automático, todas as noites). Se faltarem dias seguidos, avise quem mantém a app: o preenchimento só recupera os últimos 31 dias.

#### Todos os anos

- **Antes de 1 de janeiro**, acrescente ao separador `Feriados` os feriados do ano seguinte: os nacionais (incluindo os móveis, como a Sexta-feira Santa e o Corpo de Deus, que mudam de data todos os anos) e o feriado municipal. Uma linha por feriado, com a `data` e a `descricao`.
- Se a APJM decidir que outros dias de encerramento não contam como dia de trabalho (ex.: pontes), acrescente-os também em `Feriados`.
- Se acrescentar um feriado depois de esse dia já ter passado, apague as linhas desse dia em `Registos` (foram criadas pelo preenchimento noturno).

#### Funcionários (separador `Funcionarios`)

- **Nova pessoa:** acrescente uma linha.
  - O `id` é o endereço da página (ex.: `ana` → https://horas.jardimdamata.pt/ana): só letras minúsculas, números e hífenes.
  - O `pin` é o código de acesso, escrito como texto para não perder zeros à esquerda (ex.: `0427`).
  - Preencha a `entrada` e a `saida` do horário habitual (ex.: `09:00` e `18:00`) e a `pausa` em horas (ex.: `1`). Com 1h de pausa, a saída é 9 horas depois da entrada.
  - Deixe o `saldo_inicial` a `0`. O saldo inicial fica isento dos limites de +50h e −30h, por isso só serve para saldos anteriores à app.
  - Escreva `sim` em `ativo`.
- **Mudança de horário habitual:** altere a `entrada`, a `saida` ou a `pausa`. Vale para os dias ainda sem registo. Os dias que já estão em `Registos` (passados ou já planeados) mantêm o horário que tinham: corrija-os à mão, se for preciso.
- **Mudança de PIN:** altere o `pin`. Na app, a pessoa terá de introduzir o PIN novo.
- **Saída de uma pessoa:** escreva `não` em `ativo`. Não apague a linha nem os registos dessa pessoa, para manter o histórico.

#### Aprovações e correções (separador `Registos`)

Na app, cada pessoa só pode alterar os dias úteis da semana anterior às duas semanas seguintes, e só até 2 horas a mais ou a menos por dia. Tudo o resto faz-se aqui. Registar na folha é a aprovação da APJM, por isso escreva sempre uma `nota` a explicar.

- **Férias:** para cada dia útil de férias, escreva `férias` na coluna `tipo` da linha dessa pessoa nesse dia. Se ainda não houver linha (ex.: férias no futuro), acrescente uma com `data`, `funcionario`, `tipo` = `férias` e, se quiser, uma `nota` (ex.: "Férias de verão"). Uma linha por dia; os fins de semana e feriados não precisam de linha.
  - Um dia de férias não conta para o saldo: a `entrada`, a `saida` e as `horas` dessa linha são ignoradas, e também outras linhas desse dia.
  - Na app, o dia aparece como "Férias", inativo, e a pessoa não o pode alterar.
  - Para cancelar férias, apague `férias` da coluna `tipo` (ou apague a linha, se for no futuro). O dia volta a ser um dia normal.
  - Não use `-8` para férias: isso desconta 8 horas no saldo.
- **Ausência de dia completo** (art. 5.º, sempre com aprovação prévia): na linha dessa pessoa nesse dia, apague a `entrada` e a `saida` e escreva `-8` em `horas`. Se ainda não houver linha, acrescente uma com `data`, `funcionario`, `horas` = `-8` e a `nota`.
- **Ausência de parte do dia com mais de 2 horas:** igual, com as horas em falta (ex.: `-4`) e sem `entrada` nem `saida`.
- **Trabalho ao fim de semana ou num feriado:** acrescente uma linha com as horas trabalhadas em `horas` (ex.: `8`). A `entrada` e a `saida` são opcionais e só servem de referência. O trabalho ao fim de semana conta para o saldo, mas não aparece no histórico da app; o trabalho num feriado aparece.
- **Gozo de horas positivas que afete os períodos não letivos** (art. 4.º): a autorização é dada fora da app. A pessoa regista as horas na app como habitualmente; se quiser, acrescente uma `nota` nessa linha.
- **Corrigir um dia:** altere a `entrada` e a `saida` dessa linha. Quando um dia útil tem entrada e saída, o desvio é calculado a partir delas e a coluna `horas` é ignorada (não precisa de a atualizar).
- **Acertar o saldo de alguém:** prefira acrescentar uma linha com as horas e uma `nota`, em vez de mudar o `saldo_inicial`. Assim o acerto fica visível no histórico e conta para os limites.

#### Cuidados

- Não mude os nomes dos separadores (`Funcionarios`, `Registos`, `Feriados`) nem os cabeçalhos das colunas, e não apague colunas. Para renomear um separador, é preciso mudar também o nome em `FOLHAS`, no início do `Code.gs`, e publicar uma nova versão do Apps Script. Pode acrescentar colunas novas e ordenar as linhas.
- Não apague linhas de `Registos`, exceto para corrigir um engano. O histórico da app e os fechos de mês dependem delas.
- As datas podem estar em `2026-10-24` ou `24/10/2026`. As horas do dia em `09:30`. As horas em `horas` aceitam `1,5`, `-1.25`, `1:30` ou `-2h`.
- A folha tem os PIN de todas as pessoas: partilhe-a só com quem a mantém.
- Os limites (+50h e −30h), a data de início dos limites e o máximo de 2 horas por dia estão no código da app, não na folha. Para os mudar, fale com quem mantém a app.

## Regras de cálculo

As regras seguem o *Regulamento interno de utilização do saldo flexível* da APJM. Estão em [src/saldo.js](src/saldo.js),
e os valores (limites, data de início, máximo diário) em `REGRAS`, no início desse ficheiro.

- Cada dia útil tem hora de entrada e de saída. O desvio é `saída − entrada − pausa − 8h` (ex.: 9:30–19:00 com 1h de pausa = +30min). Os dias até ontem estão **confirmados** e contam para o saldo total. Hoje e os dias seguintes estão **planeados**.
- **Na app**, cada pessoa escolhe a hora de entrada e de saída de cada dia útil, em intervalos de 15 minutos. O desvio é calculado e tem de ficar entre −2h e +2h. Pode registar a semana anterior e planear as duas seguintes.
- **Todos os dias úteis ficam na folha:** todas as noites (02:00 UTC), um Cron Trigger do Worker acrescenta o horário habitual nos dias úteis já terminados sem registo, desde 1 de novembro de 2026. Se uma noite falhar, a seguinte recupera os dias em falta (até 31 dias para trás).
- **Na folha**, a APJM regista o que precisa de aprovação (art. 5.º): dias completos de ausência (`horas` = `-8`, sem entrada nem saída) e trabalho ao fim de semana ou feriado (`horas` = `8`, ou a entrada e a saída). Esse registo é a aprovação. Estes dias aparecem na app como "Registado pela APJM" e não podem ser alterados lá.
- **Limites (art. 2.º):** no fecho de cada mês, o saldo com limites fica entre −30h e +50h. Acima de +50h, as horas a mais perdem-se. Abaixo de −30h, as horas abaixo do limite são descontadas no salário desse mês. O fecho acontece quando termina o último dia do mês. A app guarda o resultado de cada fecho e mostra-o à pessoa e na lista da equipa.
- **Início:** os limites aplicam-se a partir de 1 de novembro de 2026 (`REGRAS.inicioLimites`).
- **Saldo transitado:** o `saldo_inicial` mais o que foi registado antes dessa data. Está isento dos limites e só diminui: as horas de sinal contrário abatem-no primeiro. Por exemplo, a Vera reduz as suas 70h trabalhando menos horas, e só as horas a mais que fizer depois contam para os limites.
- A app avisa quando o saldo com limites passa 80% de um limite (+40h ou −24h) e quando está fora dos limites antes do fecho.

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

**Atualizar uma folha antiga.** Se a folha foi criada antes de haver horários, depois de colar o `Code.gs` novo:
1. Corra outra vez a função `configurar`. Ela acrescenta as colunas `entrada`, `saida` e `pausa` em `Funcionarios`, e `entrada` e `saida` em `Registos`. Também preenche o horário habitual da Mariana (09:00–18:00) e da Vera (09:30–18:30), com 1h de pausa. Não apaga nem altera mais nada.
2. Publique a nova versão, como acima.

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
cp .dev.vars.example .dev.vars   # DEMO=1: usa dados de exemplo em memória; HOJE=… finge outra data
npm run dev                      # http://localhost:8787 (PIN 1234 e 5678)
npm test
```

É preciso Node 22 ou mais recente. O `package.json` força o `undici` 7.30.1 (em `overrides`), porque o Wrangler 4.152 ainda traz uma versão com vulnerabilidades conhecidas. Pode retirar essa linha quando o Wrangler incluir uma versão corrigida.

## Segurança

- O brief pede uma folha de acesso público. Se a folha for partilhada com "qualquer pessoa com o link", **os PIN ficam visíveis** a quem tiver o link. A app não precisa disso: o Apps Script corre com a sua conta. Recomendo manter a folha privada.
- O URL do Apps Script e o token só existem no Worker. O browser nunca os vê.
- Os PIN curtos protegem pouco contra tentativas repetidas. Para mais proteção, use PIN mais longos ou acrescente um limite de tentativas no Worker.
