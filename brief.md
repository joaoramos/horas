# Brief

Esta web app permite aos funcionários registar as suas horas de trabalho, e gerir o seu horário de forma a que o seu balanço de horas seja sempre nulo ao final de cada semana.

## Regras
- O horário de trabalho é de segunda a sexta-feira.
- O horário de trabalho padrão é de 8 horas.
- Os funcionários podem adicionar ou subtrair horas do seu dia de trabalho, o que afeta o seu balanço de horas
- As horas adicionadas ou subtraídas devem ser compensadas nos próximos 5 dias úteis. Por exemplo, se um funcionário adicionar 2 horas ao seu horário de trabalho numa quarta-feira, deverá subtrair 2 horas até à quarta-feira da semana seguinte para compensar o seu balanço de horas. Se não o fizer, será notificado na app que está em incomprimento.
- Os funcionários podem adicionar ou subtrair horas em qualquer combinação de dias úteis e horas de trabalho, desde que as horas totais adicionadas ou subtraídas sejam compensadas nos próximos 5 dias úteis.
- Os funcionários não podem alterar o seu balanço de horas em mais de 2 horas por dia.
- Os funcionários são responsáveis por manter o seu balanço de horas nulo ao final de cada semana.


## Experiência para os funcionários
- Cada funcionário consegue ver o balanço total de horas
- Cada funcionário consegue ver o balanço de horas a ser compensado até ao final da semana corrente
- Cada funcionário consegue ver o balanço de horas a ser compensado até ao final da semana seguinte
- Cada funcionário consegue adicionar ou subtrair até duas horas ao seu balanço de horas por dia
- Ao final de cada dia útil, o balanço de horas é atualizado subtraindo ou adicionando as horas trabalhadas
- Cada funcionário consegue ver o seu histórico de horas trabalhadas
- Cada funcionário consegue ver as regras de gestão e compensação de horas de trabalho
- Cada funcionário consegue ver quando está em incomprimento

## Considerações
- A web app deverá ser servida via Cloudflare de forma gratuita (não pode exceder o plano gratuito)
- Os dados deverão ser guardados numa folha Google Sheets de acesso público sem autenticação
- Deverá ser fácil ajustar o número e nome de funcionários, bem como o balanço de horas de trabalho diretamente no Google Sheets
- A web app será acessível via https://horas.jardimdamata.pt/
- A página inicial deverá conter uma lista de todos os funcionários com o seu balanço total de horas e o balanço de horas a ser compensado até ao final da semana corrente e até ao final da semana seguinte.
- Clicando no nome de cada funcionário, deverá ser levado para uma página dedicada a esse funcionário, onde poderá ver o balanço total de horas, o balanço de horas a ser compensado até ao final da semana corrente e até ao final da semana seguinte, e o seu histórico de horas trabalhadas. Poderá também adicionar ou subtrair horas ao seu balanço de horas, até um máximo de 2 horas por dia.
- Haverá inicialmente apenas 2 funcinários: Mariana (com um balanço pré-existente de 70 horas) e Vera (sem balanço pré-existente), acessíveis respetivamente via https://horas.jardimdamata.pt/mariana e https://horas.jardimdamata.pt/vera.
- A página dedicada a cada funcionário terá um PIN de acesso a ser especificado na folha de Google Sheets.
- A web app deverá ser responsiva e funcionar em dispositivos móveis.