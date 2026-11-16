# DoseCerta Pet

Controle compartilhado de remédios de pets. Cada família cria uma **casa**, convida quem ajuda a cuidar com um código e todo mundo marca as doses pelo celular. O banco não deixa a mesma dose ser registrada duas vezes.

- Site estático (HTML + CSS + JS, sem build). Use Vercel, Netlify ou GitHub Pages.
- Supabase para login por e-mail (sem senha), banco Postgres e atualização em tempo real.
- Dá para instalar na tela inicial do celular ("Adicionar à tela de início").

## Estrutura

```
index.html            página
styles.css            visual
app.js                lógica do app
config.js             URL e chave do Supabase (você preenche)
supabase/schema.sql   tabelas, regras de acesso e funções
manifest.webmanifest, sw.js, icon*.  instalação no celular
```

## 1. Criar o projeto no Supabase (uns 10 minutos)

1. Crie uma conta em https://supabase.com e um projeto novo (região: São Paulo).
2. Abra **SQL Editor**, cole todo o `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key** para o `config.js`.
4. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço do site (ex.: `https://dosecerta-pet.vercel.app`)
   - **Redirect URLs**: adicione o mesmo endereço e `http://localhost:3000` para testar.
5. Em **Authentication → Emails → Magic Link**, troque o modelo para incluir o código, assim quem instalou o app na tela inicial pode digitar o código em vez de abrir o link:

   ```html
   <h2>Seu acesso ao DoseCerta Pet</h2>
   <p><a href="{{ .ConfirmationURL }}">Toque aqui para entrar</a></p>
   <p>Ou digite este código no app: <b>{{ .Token }}</b></p>
   ```

6. **Importante se mais famílias forem usar:** o e-mail padrão do Supabase manda pouquíssimas mensagens por hora. Em **Authentication → Emails → SMTP Settings**, conecte um serviço de envio (ex.: Resend, plano grátis de 3.000 e-mails/mês).

## 2. Publicar o site

**Vercel (recomendado):** suba esta pasta num repositório do GitHub, entre em https://vercel.com → *Add New Project* → importe o repositório → *Deploy*. Não precisa de nenhuma configuração de build.

Para testar no computador: `npx serve .` dentro da pasta e abra `http://localhost:3000`.

## 3. Usar

1. Entre com o seu e-mail e escolha seu nome.
2. Crie a casa e cadastre os pets (nome, foto, tipo e cor).
3. Toque na casa (canto de cima) → **Convidar pelo WhatsApp**. Quem abrir o link entra direto na casa depois do login. Também dá para digitar o código.
4. Adicione os remédios com os horários. Na aba **Hoje**, a cápsula **Dei** registra quem deu e a que horas.

## Como evita erro

- **Dose dobrada:** cada dose (remédio + dia + horário) só pode existir uma vez no banco (`unique (med_id, date, slot)`). Se duas pessoas tocarem quase juntas, a segunda vê "Fulana já deu às 20:05. Não dê de novo."
- **Dose esquecida:** doses dos dois últimos dias sem registro aparecem num alerta vermelho, com "Foi dado" e "Não foi".
- **Privacidade:** as regras de acesso (RLS) fazem cada pessoa ver só os dados das casas em que está.

## Bom saber

- O plano grátis do Supabase pausa projetos parados por uma semana. Com uso diário, isso não acontece.
- Os horários seguem o fuso do celular de cada pessoa.
- As fotos são reduzidas para 360×360 px e guardadas no próprio banco.

## Próximos passos possíveis

- Lembretes por notificação no horário da dose (Web Push + uma função agendada no Supabase).
- Peso do pet e anotações da veterinária.
- Exportar o histórico em PDF para levar à consulta.
