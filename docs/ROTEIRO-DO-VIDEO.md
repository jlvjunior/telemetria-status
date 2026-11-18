# Roteiro do vídeo (6 a 8 minutos)

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
- Explique: Preparação → Validação → Testes → Build (artefato `dist/`) → Deploy → Verificação pós-deploy.
- Mostre que o deploy usa os **segredos** do Cloudflare (sem senha no código).
- Mostre rapidamente `monitorar.yml`: o agendamento a cada 15 minutos.

## 4. A alteração real (2 min) — o ponto principal

Acrescente um serviço novo em `config/servicos.json`, por exemplo:

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
- Abra a etapa de testes e o resumo (19 testes passando).
- Quando o deploy terminar, mostre o resumo com o endereço publicado.

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

## 7. Encerramento (30 s)

"Resumindo: cada alteração passa por validação, testes e build; só se tudo passar o GitHub Actions publica no Cloudflare Pages e confere se o site está no ar com a versão nova. O monitoramento agendado mantém o painel atualizado sozinho. O código está no GitHub e o site em [endereço]."

## Dicas de gravação

- Grave com o OBS Studio ou com a barra de jogos do Windows (Win + G), em 1080p.
- Aumente o zoom do navegador e do VS Code (Ctrl + +) para o texto ficar legível.
- Se o pipeline demorar, corte a espera na edição; deixe visível o antes e o depois.
