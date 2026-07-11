# Prontidão para produção

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

O seed cria dados administrativos e deve ser executado deliberadamente, somente com `SEED_ADMIN_*` definidos para o ambiente correto. Integrações externas, tracking, e-mail, QR Code, PDF e Excel não fazem parte desta versão.

Os testes de integração exigem `DATABASE_TEST_URL` apontando para um PostgreSQL exclusivo de testes. A suíte aplica migrations e seed nesse banco antes da execução e nunca deve receber a URL do banco de desenvolvimento ou produção.

## Riscos conhecidos

O `npm audit` de 2026-07-11 reporta vulnerabilidades na toolchain de testes Vitest 2/Vite transitivo, incluindo um alerta crítico ligado ao servidor de UI do Vitest. Essa UI não é iniciada pelos scripts do projeto e os pacotes são de desenvolvimento, não do runtime publicado. A correção indicada exige upgrade major do Vitest; por restrição de dependências, deve ser tratada em batch próprio com validação de compatibilidade. Não exponha servidores Vite/Vitest à rede pública.

O bundle web atual gera aviso de chunk principal acima de 500 kB. A aplicação compila corretamente; code splitting deve ser medido e tratado em trabalho específico de performance, sem mudança arquitetural incidental.
