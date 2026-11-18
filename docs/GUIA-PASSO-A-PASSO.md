# Guia passo a passo (Windows)

Do zero até o site publicado. Use o PowerShell, dentro da pasta do projeto.

## 1. Criar o repositório no GitHub

1. Acesse https://github.com/new.
2. Nome: `telemetria-status`. Marque **Public** (repositórios públicos não gastam a cota gratuita de minutos do Actions; o monitoramento roda 96 vezes por dia).
3. **Não** marque README, `.gitignore` nem licença. Clique em **Create repository**.

## 2. Enviar o código

Extraia o zip numa pasta (por exemplo `F:\Faculdade\devops\telemetria-status`) e rode:

```powershell
cd F:\Faculdade\devops\telemetria-status
git init
git add .
git commit -m "Telemetria Status: primeira versão"
git branch -M main
git remote add origin https://github.com/jlvjunior/telemetria-status.git
git push -u origin main
```

Esse primeiro push já dispara o pipeline. As etapas de validação, testes e build vão passar; o **deploy vai falhar** com a mensagem "Cadastre os segredos…", porque o Cloudflare ainda não foi configurado. É esperado.

## 3. Criar o token de acesso no Cloudflare

1. Entre em https://dash.cloudflare.com (crie a conta gratuita, se ainda não tiver).
2. Clique no ícone de perfil (canto superior direito) → **My Profile** → **API Tokens** → **Create Token**.
3. Em **Custom token**, clique em **Get started**.
4. Nome: `github-actions-telemetria-status`.
5. Em **Permissions**, escolha: **Account** → **Cloudflare Pages** → **Edit**.
6. **Continue to summary** → **Create Token**. Copie o token (ele só aparece uma vez).

## 4. Descobrir o Account ID

No painel do Cloudflare, abra **Workers & Pages**: o **Account ID** aparece na coluna da direita. Outra forma é o endereço do navegador, que tem o formato `dash.cloudflare.com/<ACCOUNT_ID>/...`.

## 5. Cadastrar os segredos no GitHub

No repositório: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crie os dois:

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | o token do passo 3 |
| `CLOUDFLARE_ACCOUNT_ID` | o Account ID do passo 4 |

Opcional: na aba **Variables**, crie `CF_PAGES_PROJECT` com outro nome de projeto (o padrão é `telemetria-status`). O nome vira o endereço `https://<nome>.pages.dev`; se já estiver em uso por outra pessoa, o Cloudflare acrescenta letras ao final.

## 6. Rodar o pipeline de novo

**Actions** → **CI/CD — Telemetria Status** → **Run workflow** → **Run workflow**. Desta vez as seis etapas devem ficar verdes. O endereço do site aparece:

- no resumo da execução (seção "Deploy concluído");
- na página inicial do repositório, em **Deployments** (ambiente `production`).

## 7. Ligar o monitoramento

**Actions** → **Monitoramento — verificação agendada** → **Run workflow**. Essa primeira execução manual já testa os serviços, cria o ramo `dados` e publica o painel com os primeiros resultados. Depois disso ele roda sozinho a cada 15 minutos.

## 8. Conferir

Abra o endereço `.pages.dev`: os cartões devem aparecer com a situação de cada serviço. No rodapé do site estão a versão, o commit e o número da execução do pipeline que publicou aquela versão.

## Problemas comuns

| Sintoma | Causa provável e solução |
|---|---|
| Deploy falha com "Cadastre os segredos…" | Os segredos não foram criados ou estão com outro nome. Confira o passo 5. |
| Deploy falha com "Authentication error" | Token sem a permissão **Cloudflare Pages → Edit**, ou Account ID errado. |
| Painel mostra "Aguardando a primeira verificação" | O monitoramento ainda não rodou. Faça o passo 7. |
| Monitoramento falha ao gravar o ramo `dados` | Em **Settings → Actions → General → Workflow permissions**, marque **Read and write permissions**. |
| Um serviço aparece sempre fora do ar | O site bloqueia acessos vindos de servidores. Troque o endereço ou retire o serviço da lista. |
