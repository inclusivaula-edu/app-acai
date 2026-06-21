# Deploy — Pendências

## O que já foi feito

- [x] Middleware `planCheck` no backend (trial 14 dias, limite 5 produtos)
- [x] Frontend redireciona para tela de planos quando trial/plano expira
- [x] `backend/Procfile` criado (`web: node server.js`)
- [x] `frontend/package.json` criado com `react-scripts`
- [x] `backend/.env` com Stripe secret key e price IDs corretos
- [x] Push para GitHub (`inclusivaula-edu/app-acai`)

---

## O que falta

### 1. Backend no Railway

- [ ] railway.app → New Project → Deploy from GitHub → `inclusivaula-edu/app-acai`
- [ ] Settings → Source → **Root Directory: `backend`**
- [ ] Adicionar variáveis de ambiente (copiar do `backend/.env`):
  - `NODE_ENV=production`
  - `JWT_SECRET`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET` ← deixar vazio por agora
  - `STRIPE_PRICE_MONTHLY`
  - `STRIPE_PRICE_SEMIANNUAL`
  - `STRIPE_PRICE_ANNUAL`
  - `FRONTEND_URL` ← preencher após o Vercel estar no ar
- [ ] Anotar a URL gerada: `https://app-acai-???.railway.app`

### 2. Frontend no Vercel

- [ ] vercel.com → New Project → Import `inclusivaula-edu/app-acai`
- [ ] **Root Directory: `frontend`**
- [ ] Environment Variable:
  - `REACT_APP_API_URL=https://app-acai-???.railway.app/api`
- [ ] Anotar a URL gerada: `https://app-acai.vercel.app`

### 3. Depois dos dois no ar

- [ ] Railway → Variables → atualizar `FRONTEND_URL=https://app-acai.vercel.app`
- [ ] Fazer redeploy do backend no Railway

### 4. Webhook do Stripe

- [ ] Stripe Dashboard → Desenvolvedores → Webhooks → Add endpoint
  - URL: `https://app-acai-???.railway.app/api/webhooks/stripe`
  - Eventos: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- [ ] Copiar o **Signing secret** (`whsec_...`) gerado
- [ ] Railway → Variables → `STRIPE_WEBHOOK_SECRET=whsec_...`
- [ ] Fazer redeploy do backend

### 5. Testar fluxo completo

- [ ] Registrar vendor → verificar trial de 14 dias ativo
- [ ] Tentar assinar um plano via Stripe Checkout (modo test)
- [ ] Verificar que o webhook atualiza o plano no Supabase
- [ ] Verificar botão "✓ Plano Ativo" no painel
