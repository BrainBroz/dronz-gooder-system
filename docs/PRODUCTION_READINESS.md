# Prontidão para produção

**Baseline técnica:** `8644188` — Batches 0–8 e auditorias independentes aprovados. A fundação de integração do Batch 8 permanece desabilitada para providers reais. A Trading API `GetMyeBayBuying` é uma fonte oficial tecnicamente compatível com o caso buyer do eBay, mas o adapter, as credenciais, a elegibilidade produtiva e a política de sincronização ainda não foram implementados nem validados. Esta classificação cobre código, migrations e testes; publicação continua condicionada à infraestrutura e aos segredos do ambiente.

## Segurança

- Configure `WEB_ORIGIN` com a origem HTTPS exata da aplicação web; CORS não aceita wildcard com credenciais.
- Gere valores fortes e distintos para `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` em um gerenciador de segredos.
- Em `NODE_ENV=production`, o refresh token usa cookie `HttpOnly`, `SameSite=Lax`, `Secure` e `Path=/`; o token bruto não integra respostas nem storage do navegador.
- Mantenha PostgreSQL e backups fora do host efêmero. Não use o banco local em produção.

## Publicação

1. Instale dependências com lockfile (`npm ci`).
2. Configure as variáveis de ambiente sem copiar `.env` para a imagem.
3. Execute `npm run db:migrate:deploy`.
4. Execute `npm run typecheck`, `npm run lint`, `npm run test` e `npm run build`.
5. Inicie a API e valide `GET /health` atrás do proxy HTTPS.

O seed cria dados administrativos e deve ser executado deliberadamente, somente com `SEED_ADMIN_*` definidos para o ambiente correto. O Batch 8 prepara conexões e sincronização explícita por adapters, mas ingestão automática de compras buyer, tracking automático, e-mail operacional, QR Code, PDF e Excel não fazem parte desta versão.

Referências `env:MARKETPLACE_*` não são credenciais: são ponteiros. Valores devem existir somente no ambiente/secret manager e nunca em banco, logs, respostas ou commits. Dronz e Gooder operam como compradores. Amazon SP-API e eBay Sell Fulfillment não atendem ao histórico geral de compras consumer; portanto, os adapters seller permanecem adiados e nenhuma conexão desse tipo deve ser ativada como solução do fluxo buyer. Para eBay buyer, a fonte candidata oficial é `GetMyeBayBuying`, não Sell Fulfillment nem Buy Order API. Sua ativação exige consentimento/token do usuário, confirmação de quota e teste no keyset real.

Os testes de integração exigem `DATABASE_TEST_URL` apontando para um PostgreSQL exclusivo de testes. A suíte aplica migrations e seed nesse banco antes da execução e nunca deve receber a URL do banco de desenvolvimento ou produção.

## Baseline de desenvolvimento

- A versão oficial é Node.js 22, definida em `.nvmrc`. Em instalações Homebrew, use `export PATH="$(brew --prefix node@22)/bin:$PATH"` antes dos comandos do projeto.
- O monorepo usa npm workspaces e mantém `package-lock.json` versionado. Instalações reproduzíveis devem usar `npm ci`.
- Prisma CLI e Prisma Client permanecem alinhados em `6.19.3`; upgrades major exigem batch próprio.
- `npm test` prepara o banco PostgreSQL de testes com valores locais não sensíveis quando `SEED_ADMIN_*` não estiver definido. Esses defaults existem somente no runner de testes e não alteram o seed de desenvolvimento ou produção.
- Scripts de desenvolvimento não contêm segredos. A API carrega o `.env` local, que permanece ignorado pelo Git.

## Histórico local e stashes

Os stashes anteriores a esta baseline foram preservados apenas como histórico. Eles contêm versões antigas e sobrepostas do frontend e backend e não devem ser reaplicados integralmente. Qualquer recuperação futura exige comparação por arquivo e comprovação de que a mudança ainda não existe na `main`.

## Riscos conhecidos

O `npm audit` de 2026-07-13 reporta cinco vulnerabilidades na toolchain de desenvolvimento Vitest/Vite transitiva: três moderadas, uma alta e uma crítica. O audit de dependências de produção (`--omit=dev`) reporta zero vulnerabilidades. A correção completa indicada exige upgrade major do Vitest; por restrição de dependências, deve ser tratada em batch próprio com validação de compatibilidade. Não exponha servidores Vite/Vitest à rede pública.

O frontend usa lazy routes e chunks estáveis de vendor. O Batch 7 reduziu o maior chunk de 789,22 kB para 297,25 kB e eliminou o aviso do Vite para chunks acima de 500 kB, sem alterar comportamento ou dependências.

Na validação do Batch 8, Prisma validate/generate, lint, typecheck, builds e duas execuções globais passaram. A baseline registrou 126 testes de API e 78 testes web, totalizando 204 testes por execução, sem ignorados.
