# Roteiro do vídeo (8 a 10 minutos)

Objetivo: mostrar o pipeline funcionando com uma **alteração real**, do commit até o site atualizado.

**Antes de gravar:** pipeline já configurado e verde, site publicado, monitoramento rodando há pelo menos algumas horas (para o painel ter histórico). Deixe abertos: o VS Code com o projeto, o PowerShell, a aba **Actions** do GitHub e o site `.pages.dev`.

## 1. Apresentação (30 s)

"Sou o Joaquim, este é o trabalho final de Fundamentos de DevOps. Criei o Telemetria Status: um painel no estilo Downdetector que verifica a cada 15 minutos se os principais serviços estão no ar, publicado no Cloudflare Pages com CI/CD completo no GitHub Actions."

## 2. A aplicação no ar (1 min)

- Mostre o site: faixa de situação geral, indicadores, cartões com a faixa das últimas 24 horas.
- Abra um serviço: disponibilidade em 24 h, 7, 30 e 90 dias, tempo médio de recuperação, incidentes.
- Aponte o **rodapé**: versão, commit e número da execução do pipeline que publicou o site. Anote o commit atual.

## 3. O pipeline (1 min 30 s)

- Abra `.github/workflows/ci-cd.yml` e mostre as etapas e os `needs` (cada etapa depende da anterior).
- Explique: Preparação → Validação → **Testes e Segurança em paralelo** → Build (artefato `dist/`) → Deploy → Verificação pós-deploy.
- Na etapa **🔐 Segurança**, mostre as três verificações: segredos no código, `npm audit` e CodeQL. Abra **Security → Code scanning** para mostrar onde ficam os alertas.
- Mostre `.github/dependabot.yml`: "toda semana o Dependabot abre pull requests de atualização, e cada um passa pelo pipeline".
- Mostre que o deploy usa os **segredos** do Cloudflare (sem senha no código).
- Mostre rapidamente `monitorar.yml`: o agendamento a cada 15 minutos.

## 4. A alteração real (2 min) — o ponto principal

Clique em **🔒 Gerenciar serviços**: o navegador pede usuário e senha (mostre que sem senha não entra). Entre com `admin` e a senha.

- Mostre a tabela com os serviços e clique em **Editar** em um deles para mostrar o formulário preenchido.
- Clique em **Adicionar serviço**: "iFood", categoria "Compras", endereço `http://www.ifood.com.br/`. Mostre a mensagem de erro (precisa de https, a mesma regra do pipeline) e corrija para `https://www.ifood.com.br/`.
- Mostre a barra "1 alteração pendente" e clique em **Salvar e publicar**. Aparece o commit criado ("Serviços: adiciona iFood") e o link para o Actions.

(Se não configurou o `GH_ADMIN_TOKEN`, o botão se chama **Gerar arquivo**: copie o conteúdo e cole no `config/servicos.json` pelo link que a página abre.)

Outra forma, pelo VS Code, acrescentando a linha em `config/servicos.json`:

```json
{ "id": "ifood", "nome": "iFood", "categoria": "Compras", "url": "https://www.ifood.com.br/" },
```

E, para a mudança ficar visível também no texto, troque o subtítulo em `site/index.html`:

```html
<p class="sub">Situação de 15 serviços, verificada a cada 15 minutos</p>
```

Envie:

```powershell
git add .
git commit -m "Adiciona o iFood ao monitoramento"
git push
```

- Vá em **Actions** e mostre a execução começando; abra-a e mostre as etapas ficando verdes uma a uma.
- Abra a etapa de testes e o resumo (38 testes passando) e o resumo da Segurança (0 vulnerabilidades graves).
- Quando o deploy terminar, mostre o resumo com o endereço publicado e a linha "Área /admin sem senha: HTTP 401 (protegida)", o teste de segurança automático.

## 5. Resultado no site (1 min)

- Recarregue o site: subtítulo novo, o cartão do iFood ("Aguardando verificação" até a próxima rodada do monitoramento) e o **rodapé com o commit novo**, igual ao do `git push`.
- Opcional: rode o monitoramento manualmente (**Run workflow**) e mostre o iFood ficando verde.

## 6. O pipeline protegendo a produção (1 min)

Mostre que um erro bloqueia o deploy. Troque a URL do iFood para `http://` (sem o "s") e envie:

```powershell
git commit -am "Teste: configuração inválida"
git push
```

- Em **Actions**, a etapa **Validação** fica vermelha com a mensagem "url deve usar https"; Testes, Build e Deploy nem começam.
- Recarregue o site: continua no ar, na versão anterior.
- Corrija (`https://`), envie de novo e mostre o pipeline verde.

## 7. Rollback: voltando uma versão em segundos (1 min)

"E se uma versão com problema chegasse à produção?"

- **Actions → Rollback — voltar versão → Run workflow**. Motivo: "Demonstração de rollback". Deixe o commit vazio.
- Mostre a execução terminando em poucos segundos e o resumo: versão que estava no ar → versão restaurada.
- Recarregue o site: o rodapé mostra o commit anterior (por exemplo, sem o iFood).
- "Para voltar à versão atual, basta enviar uma nova alteração ou rodar o rollback informando o commit novo."

## 8. Métricas DORA (1 min)

- Antes, rode **Actions → Monitoramento → Run workflow** para as métricas incluírem o rollback (elas se atualizam a cada 15 minutos).
- No site, clique em **📈 Métricas DevOps**.
- Explique as quatro métricas: frequência de deploy, tempo de entrega, taxa de falha e tempo de recuperação, com o nível de cada uma.
- Mostre que o gráfico e a tabela trazem as execuções reais do pipeline, inclusive a falha proposital da etapa 6 e o rollback da etapa 7.
- "Essas são as métricas que o mercado usa para medir times de DevOps; aqui elas são calculadas automaticamente a partir do GitHub Actions."

## 9. Encerramento (30 s)

"Resumindo: cada alteração passa por validação, testes e verificação de segurança; só se tudo passar o GitHub Actions publica no Cloudflare Pages e confere se o site está no ar com a versão nova. Se algo der errado, o rollback volta a versão em segundos, e as métricas DORA mostram a saúde do processo. O código está no GitHub e o site em https://telemetria-status.pages.dev."

## Dicas de gravação

- Grave com o OBS Studio ou com a barra de jogos do Windows (Win + G), em 1080p.
- Aumente o zoom do navegador e do VS Code (Ctrl + +) para o texto ficar legível.
- Se o pipeline demorar, corte a espera na edição; deixe visível o antes e o depois.
