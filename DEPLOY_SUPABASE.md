# 🚀 DO ZERO AO AR — Node.js + Supabase + Railway + Vercel
# Tempo estimado: ~1h30

---

## PASSO 1 — Instalar Node.js

1. Acesse https://nodejs.org
2. Clique em **LTS** (botão verde maior)
3. Baixe e instale (next → next → finish)
4. Abra o terminal e confirme:
   ```
   node --version   → v18.x ou v20.x
   npm --version    → 9.x ou 10.x
   ```

---

## PASSO 2 — Criar projeto no Supabase

### 2.1 Criar conta e projeto
1. Acesse https://supabase.com → **Start your project**
2. Crie conta com GitHub (mais rápido)
3. Clique em **New project**
4. Preencha:
   - **Name:** acai-shop
   - **Database Password:** crie uma senha forte e ANOTE (ex: AcaiShop@2026!)
   - **Region:** South America (São Paulo)
5. Clique em **Create new project** — aguarde ~2 minutos

### 2.2 Pegar as chaves da API
1. No painel do projeto, clique em **Settings** (engrenagem, lado esquerdo)
2. Clique em **API**
3. Anote dois valores:
   - **Project URL** → algo como `https://abcdefghij.supabase.co`
   - **service_role** key (clique em "Reveal") → string longa começando com `eyJ...`
   
   ⚠️ Use a `service_role`, NÃO a `anon`. A service_role tem acesso total — só use no backend.

### 2.3 Criar as tabelas (executar o schema)
1. No painel, clique em **SQL Editor** (ícone de terminal, lado esquerdo)
2. Clique em **New query**
3. Abra o arquivo `schema.sql` (fornecido) no bloco de notas
4. Copie TODO o conteúdo e cole na janela do SQL Editor
5. Clique em **Run** (▶)
6. Deve aparecer: `Success. No rows returned`

✅ Banco configurado. As tabelas `vendors`, `products` e `orders` foram criadas.

---

## PASSO 3 — Configurar o backend localmente

### 3.1 Estrutura de arquivos
Certifique-se que a pasta `backend/` contém:
```
backend/
├── server.js       ← novo (Supabase)
├── seed.js         ← novo (Supabase)
├── package.json    ← novo
├── Procfile        ← web: node server.js
├── .gitignore
└── .env            ← você cria agora
```

### 3.2 Criar o arquivo .env
Dentro da pasta `backend/`, crie um arquivo chamado `.env` com este conteúdo:
```
PORT=5000
NODE_ENV=development
JWT_SECRET=cole_aqui_uma_string_longa_e_aleatoria

SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...seu_service_role_key

FRONTEND_URL=http://localhost:3000
STRIPE_KEY=sk_test_qualquer_por_enquanto
STRIPE_PUBLIC_KEY=pk_test_qualquer_por_enquanto
```

Para gerar o JWT_SECRET, acesse: https://generate-secret.vercel.app/64
Copie o resultado e cole no .env.

### 3.3 Instalar dependências e testar
```bash
cd backend
npm install
node seed.js
```

Deve aparecer:
```
✅ Supabase conectado
✅ Vendor criado
✅ 10 produtos criados
🎉 Seed concluído!
  Email: admin@acaishop.com
  Senha: Admin@123456
```

Depois rode o servidor:
```bash
npm run dev
```

Acesse http://localhost:5000/api/health — deve retornar:
```json
{ "status": "ok", "supabase": "conectado" }
```

✅ Backend funcionando localmente!

---

## PASSO 4 — Testar o frontend localmente

1. Abra outro terminal na pasta `frontend/`
2. Crie o arquivo `frontend/.env`:
   ```
   REACT_APP_API_URL=http://localhost:5000/api
   REACT_APP_STRIPE_PUBLIC_KEY=pk_test_qualquer
   ```
3. Rode:
   ```bash
   npm install
   npm start
   ```
4. Abra http://localhost:3000
5. Teste o fluxo completo:
   - Login com `admin@acaishop.com` / `Admin@123456`
   - Clique em "Ver Cardápio"
   - Adicione produtos ao carrinho
   - Finalize um pedido
   - Volte ao admin → verifique se o pedido aparece
   - Troque o status do pedido

✅ Tudo funcionando — pronto para subir!

---

## PASSO 5 — Subir no GitHub

1. Crie conta em https://github.com (se não tiver)
2. Crie dois repositórios privados: `acai-shop-backend` e `acai-shop-frontend`

**Backend:**
```bash
cd backend
git init
git add .
git commit -m "feat: initial commit with Supabase"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/acai-shop-backend.git
git push -u origin main
```

**Frontend:**
```bash
cd frontend
git init
git add .
git commit -m "feat: initial commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/acai-shop-frontend.git
git push -u origin main
```

⚠️ O `.gitignore` já bloqueia o `.env`. Antes do push, confirme que `.env` NÃO aparece no `git status`.

---

## PASSO 6 — Deploy do backend no Railway

1. Acesse https://railway.app → **Login with GitHub**
2. Clique em **New Project** → **Deploy from GitHub repo**
3. Selecione `acai-shop-backend`
4. Aguarde o deploy inicial (vai falhar por falta de variáveis — normal)
5. Clique na aba **Variables** e adicione:

| Variável | Valor |
|---|---|
| NODE_ENV | production |
| PORT | 5000 |
| JWT_SECRET | (mesma do .env local) |
| SUPABASE_URL | https://SEU-PROJETO.supabase.co |
| SUPABASE_SERVICE_KEY | eyJhbGci... (service_role) |
| STRIPE_KEY | sk_test_qualquer |
| STRIPE_PUBLIC_KEY | pk_test_qualquer |
| FRONTEND_URL | https://acai-shop.vercel.app ← preencha depois |

6. Vá em **Settings** → **Networking** → **Generate Domain**
7. Copie a URL (ex: `acai-shop-production.up.railway.app`)
8. Teste: `https://SUA-URL.railway.app/api/health` → deve retornar `{"status":"ok","supabase":"conectado"}`

---

## PASSO 7 — Deploy do frontend no Vercel

1. Acesse https://vercel.com → **Add New Project**
2. Selecione `acai-shop-frontend`
3. Em **Environment Variables**, adicione:

| Variável | Valor |
|---|---|
| REACT_APP_API_URL | https://SUA-URL.railway.app/api |
| REACT_APP_STRIPE_PUBLIC_KEY | pk_test_qualquer |

4. Clique em **Deploy**
5. Vercel gera uma URL (ex: `acai-shop.vercel.app`)

6. **Volte ao Railway** → Variables → atualize `FRONTEND_URL` com a URL do Vercel

---

## PASSO 8 — Teste final em produção

- [ ] https://acai-shop.vercel.app carrega o login
- [ ] Login com `admin@acaishop.com` / `Admin@123456` funciona
- [ ] Produtos aparecem no cardápio
- [ ] Pedido de teste funciona
- [ ] Pedido aparece no painel admin
- [ ] Troca de status funciona
- [ ] Supabase → Table Editor → orders → pedido aparece lá

**🎉 Está no ar e monetizável!**

---

## CUSTOS MENSAIS

| Serviço | Plano | Custo |
|---|---|---|
| Supabase | Free (500MB, 50k req/mês) | R$ 0 |
| Railway | Starter | ~R$ 25–50 |
| Vercel | Hobby | R$ 0 |
| Stripe | Pay-as-go | 2.99% + R$0.30/venda |
| **Total fixo** | | **~R$ 25–50/mês** |

---

## PRÓXIMO PASSO PARA MONETIZAR

Assim que o site estiver no ar:
1. Crie conta no Stripe em https://stripe.com
2. Me manda as chaves `sk_live_` e `pk_live_`
3. Integro o pagamento real em 15 minutos

---

## PROBLEMAS COMUNS

**`supabase: "erro"` no health check**
→ Confirme `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` corretos no Railway

**Tabelas não existem**
→ Execute novamente o `schema.sql` no SQL Editor do Supabase

**CORS error no browser**
→ Confirme que `FRONTEND_URL` no Railway tem a URL exata do Vercel (sem `/` no final)

**Seed retorna erro de conexão**
→ Verifique `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` no `.env` local

**Railway não faz deploy**
→ Verifique se o `Procfile` existe na raiz do backend com o conteúdo: `web: node server.js`