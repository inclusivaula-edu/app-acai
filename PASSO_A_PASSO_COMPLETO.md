# 🚀 DO ZERO À PRODUÇÃO — Açaí Shop
# Tempo estimado: 1h30 seguindo este guia

---

## ESTRUTURA DE PASTAS FINAL

Crie esta estrutura no seu computador:

```
acai-shop/
├── backend/
│   ├── server.js          ← arquivo fornecido
│   ├── seed.js            ← arquivo fornecido
│   ├── package.json       ← arquivo fornecido
│   ├── Procfile           ← arquivo fornecido
│   ├── .gitignore         ← arquivo fornecido
│   └── .env               ← você cria (copie o .env.example)
│
└── frontend/
    ├── src/
    │   ├── App.jsx        ← arquivo fornecido
    │   └── index.js       ← arquivo fornecido
    ├── public/
    │   └── index.html     ← arquivo fornecido
    ├── package.json       ← arquivo fornecido
    └── .env               ← você cria (copie o .env.example)
```

---

## PASSO 1 — Instalar Node.js no seu computador

1. Acesse https://nodejs.org
2. Clique no botão **LTS** (versão recomendada)
3. Baixe e instale normalmente (next, next, finish)
4. Abra o terminal (CMD no Windows / Terminal no Mac) e confirme:
   ```
   node --version   → deve aparecer v18 ou v20
   npm --version    → deve aparecer 9 ou 10
   ```

---

## PASSO 2 — Criar conta no MongoDB Atlas (banco de dados)

1. Acesse https://www.mongodb.com/cloud/atlas
2. Clique em **Try Free** → crie conta com Google ou email
3. Clique em **Create** → escolha **M0 Free**
4. Provider: AWS | Region: **São Paulo (sa-east-1)**
5. Clique em **Create Deployment**
6. Na tela seguinte, crie um usuário:
   - Username: `acaiadmin`
   - Password: crie uma senha forte (anote!)
   - Clique em **Create Database User**
7. Em **IP Access List** → clique em **Add My Current IP** + **Add Entry 0.0.0.0/0**
8. Clique em **Go to Overview**
9. Clique em **Connect** → **Drivers** → copie a string que parece com:
   ```
   mongodb+srv://acaiadmin:SENHA@cluster0.abc123.mongodb.net/?retryWrites=true
   ```
10. Adicione `/acai-shop` antes do `?`:
    ```
    mongodb+srv://acaiadmin:SENHA@cluster0.abc123.mongodb.net/acai-shop?retryWrites=true
    ```
    **Guarde esta string. Você vai usá-la em vários lugares.**

---

## PASSO 3 — Testar o backend localmente

1. Na pasta `backend/`, crie o arquivo `.env`:
   ```
   PORT=5000
   NODE_ENV=development
   JWT_SECRET=mude_isso_para_uma_string_longa_e_aleatoria_minimo_32_chars
   MONGODB_URI=mongodb+srv://acaiadmin:SENHA@cluster0.abc123.mongodb.net/acai-shop?retryWrites=true
   STRIPE_KEY=sk_test_qualquer_por_enquanto
   STRIPE_PUBLIC_KEY=pk_test_qualquer_por_enquanto
   FRONTEND_URL=http://localhost:3000
   ```

2. Abra o terminal dentro da pasta `backend/` e rode:
   ```bash
   npm install
   ```
   (aguarde instalar, pode demorar 1-2 minutos)

3. Popule o banco com os produtos:
   ```bash
   node seed.js
   ```
   Deve aparecer:
   ```
   ✅ MongoDB conectado
   ✅ Vendor criado: admin@acaishop.com / Admin@123456
   ✅ 10 produtos criados
   🎉 Seed concluído!
   ```

4. Inicie o servidor:
   ```bash
   npm run dev
   ```
   Deve aparecer:
   ```
   ✅ MongoDB conectado
   🫐 Servidor rodando em http://localhost:5000
   ```

5. Abra o navegador e acesse: http://localhost:5000/api/health
   Deve retornar: `{"status":"ok","mongodb":"conectado"}`

   **Se chegou aqui, o backend está funcionando! ✅**

---

## PASSO 4 — Testar o frontend localmente

1. Abra **outro terminal** (mantenha o do backend aberto)
2. Vá para a pasta `frontend/`
3. Crie o arquivo `.env`:
   ```
   REACT_APP_API_URL=http://localhost:5000/api
   REACT_APP_STRIPE_PUBLIC_KEY=pk_test_qualquer
   ```

4. Instale e rode:
   ```bash
   npm install
   npm start
   ```
   O navegador vai abrir automaticamente em http://localhost:3000

5. Teste o fluxo completo:
   - Login com `admin@acaishop.com` / `Admin@123456`
   - Você deve entrar no painel admin
   - Clique em "Ver Cardápio"
   - Adicione produtos ao carrinho
   - Faça um pedido de teste
   - Volte ao admin e mude o status do pedido

   **Se tudo funcionou, está pronto para subir! ✅**

---

## PASSO 5 — Criar repositório no GitHub

> O GitHub serve para Railway e Vercel fazerem deploy automático.

1. Acesse https://github.com e crie uma conta (se não tiver)
2. Clique em **New repository**
3. Nome: `acai-shop-backend` | Visibility: Private | Clique **Create**
4. No terminal, dentro da pasta `backend/`:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/acai-shop-backend.git
   git push -u origin main
   ```
5. Repita para o frontend (crie outro repo `acai-shop-frontend`):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/acai-shop-frontend.git
   git push -u origin main
   ```

   ⚠️ O `.gitignore` já está configurado para NÃO subir o `.env`. Verifique antes de fazer push.

---

## PASSO 6 — Deploy do backend no Railway

1. Acesse https://railway.app
2. Clique em **Login with GitHub** → autorize
3. Clique em **New Project** → **Deploy from GitHub repo**
4. Selecione `acai-shop-backend`
5. Railway vai detectar automaticamente que é Node.js
6. Vá na aba **Variables** e adicione uma por uma:
   ```
   NODE_ENV          = production
   PORT              = 5000
   JWT_SECRET        = (mesma string do seu .env local)
   MONGODB_URI       = (a string do Atlas com /acai-shop)
   STRIPE_KEY        = sk_test_qualquer_por_enquanto
   STRIPE_PUBLIC_KEY = pk_test_qualquer_por_enquanto
   FRONTEND_URL      = https://acai-shop.vercel.app  ← preencha depois
   ```
7. Vá na aba **Settings** → **Networking** → **Generate Domain**
8. Copie a URL gerada (ex: `acai-shop-production.up.railway.app`)
9. Teste: acesse `https://SUA-URL.railway.app/api/health` — deve retornar `{"status":"ok","mongodb":"conectado"}`

---

## PASSO 7 — Deploy do frontend no Vercel

1. Acesse https://vercel.com
2. Clique em **Add New Project**
3. Selecione `acai-shop-frontend`
4. Em **Environment Variables**, adicione:
   ```
   REACT_APP_API_URL           = https://SUA-URL.railway.app/api
   REACT_APP_STRIPE_PUBLIC_KEY = pk_test_qualquer
   ```
5. Clique em **Deploy**
6. Vercel gera uma URL (ex: `acai-shop.vercel.app`)

7. Volte no Railway → Variables → atualize:
   ```
   FRONTEND_URL = https://acai-shop.vercel.app
   ```

---

## PASSO 8 — Teste final em produção

Acesse sua URL do Vercel e teste:

- [ ] Tela de login carrega
- [ ] Login com `admin@acaishop.com` / `Admin@123456` funciona
- [ ] Produtos aparecem no cardápio
- [ ] Criar pedido funciona
- [ ] Pedido aparece no painel admin
- [ ] Trocar status do pedido funciona

**Está no ar! 🎉**

---

## PASSO 9 — Trocar senha do admin

Após o primeiro login, crie um novo vendor com a sua senha real:
1. Acesse sua URL `/register`
2. Crie seu usuário real
3. Pronto — use este novo usuário daqui em diante

---

## CUSTOS MENSAIS

| Serviço       | Custo     |
|---------------|-----------|
| MongoDB Atlas | R$ 0      |
| Railway       | ~R$ 25-50 |
| Vercel        | R$ 0      |
| Stripe        | 2.99% + R$ 0.30 por venda |
| **Total fixo**| **~R$ 25-50/mês** |

---

## PROBLEMAS COMUNS

**"Cannot connect to MongoDB"**
→ Confirme que o IP `0.0.0.0/0` está liberado no Atlas (Network Access)

**"CORS error" no console do browser**
→ Confirme que `FRONTEND_URL` no Railway está com a URL exata do Vercel

**Produtos não aparecem**
→ Rode `node seed.js` apontando para o banco do Atlas (não o local)

**Railway não faz deploy**
→ Verifique se o `Procfile` está na raiz da pasta backend (`web: node server.js`)

**Login retorna erro 401**
→ Confirme que o `JWT_SECRET` é o mesmo no `.env` local e no Railway
