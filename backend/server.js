// ============================================
// SERVIDOR EXPRESS - AÇAÍ SHOP (Supabase/PostgreSQL)
// ============================================

const express      = require('express');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const dotenv       = require('dotenv');
const cookieParser = require('cookie-parser');
const https        = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

dotenv.config();

// ── Validar variáveis obrigatórias ─────────────
const REQUIRED = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ FATAL: variáveis faltando no .env: ${missing.join(', ')}`);
  process.exit(1);
}

const app          = express();
const PORT         = process.env.PORT || 5000;
const JWT_SECRET   = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Supabase client (service key = acesso total, backend only) ─
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── CORS ───────────────────────────────────────
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5001'],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(cookieParser());
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhooks/stripe') return next();
  express.json({ limit: '100kb' })(req, res, next);
});

// ── Rate limiting simples ──────────────────────
const hits = new Map();
app.use((req, res, next) => {
  const ip  = req.ip;
  const now = Date.now();
  const win = 15 * 60 * 1000;
  const max = 300;

  // Limpar entradas antigas para evitar vazamento de memória
  for (const [k, v] of hits) {
    if (now - v.start > win) hits.delete(k);
  }

  const d = hits.get(ip);
  if (!d || now - d.start > win) { hits.set(ip, { count: 1, start: now }); }
  else if (d.count++ > max) return res.status(429).json({ error: 'Muitas requisições. Aguarde 15 minutos.' });
  next();
});

// ── SSE: clientes conectados ao stream de mensagens ───────────────────────────
const sseClients = new Set();

function broadcastMessage(msg) {
  if (!sseClients.size) return;
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// ── WhatsApp via Z-API (opcional — configura no .env) ─────────────────────────
async function sendWhatsApp(phone, message) {
  let instanceId    = process.env.ZAPI_INSTANCE_ID || '';
  let token         = process.env.ZAPI_TOKEN || '';
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || '';

  // Suporte ao formato URL completa: extrai instance ID e token automaticamente
  if (instanceId.startsWith('http')) {
    const m = instanceId.match(/instances\/([^/]+)\/token\/([^/]+)/);
    if (m) { instanceId = m[1]; token = m[2]; }
  }

  if (!instanceId || !token || !phone) return;
  try {
    let p = String(phone).replace(/\D/g, '');
    if (!p.startsWith('55')) p = '55' + p;
    const body = JSON.stringify({ phone: p, message });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.z-api.io',
        path:     `/instances/${instanceId}/token/${token}/send-text`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Client-Token': clientToken, 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          if (res.statusCode >= 400) console.error('WhatsApp API error:', res.statusCode, raw);
          resolve();
        });
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
  } catch (err) { console.error('WhatsApp notification error:', err.message); }
}

function waMsgNovoPedido(name, storeName, orderNum, total, deliveryType, trackingUrl, pixKey) {
  const delivIcon = deliveryType === 'entrega' ? '🚚 Entrega a domicílio' : '🕐 Retirada no local';
  let msg = `🫐 Olá, *${name}*! Seu pedido no *${storeName}* foi recebido! 🎉\n\n📦 Pedido: *${orderNum || '#'}*\n💰 Total: R$ ${Number(total).toFixed(2)}\n${delivIcon}`;
  if (pixKey) {
    msg += `\n\n━━━━━━━━━━━━━━━━━\n📱 *PAGUE VIA PIX*\nChave: *${pixKey}*\nValor: *R$ ${Number(total).toFixed(2)}*\nEnvie o comprovante após pagar.\n━━━━━━━━━━━━━━━━━`;
  }
  msg += `\n\n🔍 Acompanhe seu pedido:\n${trackingUrl}`;
  return msg;
}

const WA_STATUS_MSG = {
  confirmado:  (n, url) => `✅ *${n}*, seu pagamento foi confirmado!\nSeu pedido está sendo preparado. 👨‍🍳\nAcompanhe: ${url}`,
  em_preparo:  (n, url) => `👨‍🍳 Estamos preparando seu açaí, *${n}*!\nAcompanhe: ${url}`,
  pronto:      (n, url, type) => type === 'entrega'
    ? `✅ Pedido pronto, *${n}*! O entregador está a caminho. 🚚\nAcompanhe: ${url}`
    : `✅ Pedido pronto, *${n}*! Pode vir buscar. 🏃\nAcompanhe: ${url}`,
  em_entrega:  (n, url) => `🚚 Seu pedido saiu para entrega, *${n}*!\nAcompanhe: ${url}`,
  entregue:    (n)      => `📦 Pedido entregue, *${n}*!\nObrigado pela preferência! 🫐❤️`,
  cancelado:   (n)      => `❌ *${n}*, seu pedido foi cancelado.\nEntre em contato pelo WhatsApp se tiver dúvidas.`,
};

// ── Helper: erro do Supabase ───────────────────
const sbErr = (error, res) => {
  console.error('Supabase error:', error);
  return res.status(500).json({ error: 'Erro interno' });
};

// ── Helper: validação de email ──────────────────
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).toLowerCase());

// ── Helper: gera slug URL-safe a partir do nome ─
const generateSlug = (name) =>
  name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ── Stripe ────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const PLANS = {
  monthly:    { name: 'Mensal',    price: 290.00, months: 1,  priceId: process.env.STRIPE_PRICE_MONTHLY    },
  semiannual: { name: 'Semestral', price: 250.00, months: 6,  priceId: process.env.STRIPE_PRICE_SEMIANNUAL },
  annual:     { name: 'Anual',     price: 210.00, months: 12, priceId: process.env.STRIPE_PRICE_ANNUAL     },
};

const TRIAL_DAYS = 14;

// ── Opções de cookie httpOnly ──────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 24 * 60 * 60 * 1000, // 24h
};

// ============================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ============================================
const auth = (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    req.user  = jwt.verify(token, JWT_SECRET);
    req.token = token;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
};

// ── Verificação de plano ────────────────────────────────
const planCheck = async (req, res, next) => {
  try {
    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('plan, plan_status, plan_expires_at, created_at')
      .eq('id', req.user.id)
      .single();

    if (error || !vendor) return res.status(403).json({ error: 'Vendor não encontrado', code: 'VENDOR_NOT_FOUND' });

    if (vendor.plan === 'trial') {
      const trialEnd = new Date(vendor.created_at);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      if (new Date() > trialEnd) {
        return res.status(403).json({
          error: `Seu período de trial de ${TRIAL_DAYS} dias encerrou. Assine um plano para continuar.`,
          code: 'TRIAL_EXPIRED',
        });
      }
    } else if (vendor.plan_status !== 'active') {
      return res.status(403).json({
        error: 'Sua assinatura está inativa. Renove seu plano para continuar.',
        code: 'PLAN_INACTIVE',
      });
    } else if (vendor.plan_expires_at && new Date(vendor.plan_expires_at) < new Date()) {
      return res.status(403).json({
        error: 'Sua assinatura expirou. Renove seu plano para continuar.',
        code: 'PLAN_EXPIRED',
      });
    }

    req.vendor = vendor;
    next();
  } catch {
    res.status(500).json({ error: 'Erro ao verificar plano' });
  }
};

// ============================================
// WEBHOOK STRIPE (antes de qualquer middleware de body)
// ============================================
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe não configurado' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig error:', err.message);
    return res.status(400).json({ error: 'Webhook inválido' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { vendor_id, plan_id } = session.metadata || {};
      if (vendor_id && PLANS[plan_id] && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const expiresAt = new Date(sub.current_period_end * 1000);
        await supabase.from('vendors').update({
          plan: plan_id,
          plan_status: 'active',
          plan_expires_at: expiresAt.toISOString(),
          stripe_subscription_id: session.subscription,
        }).eq('id', vendor_id);
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      if (!invoice.subscription) { res.json({ received: true }); return; }
      const sub = await stripe.subscriptions.retrieve(invoice.subscription);
      const priceId = sub.items.data[0]?.price.id;
      const plan_id = Object.keys(PLANS).find(k => PLANS[k].priceId === priceId);
      if (!plan_id) { res.json({ received: true }); return; }
      const expiresAt = new Date(sub.current_period_end * 1000);
      const { data: vendor } = await supabase
        .from('vendors').select('id').eq('stripe_subscription_id', invoice.subscription).maybeSingle();
      if (vendor) {
        await supabase.from('vendors').update({
          plan: plan_id, plan_status: 'active', plan_expires_at: expiresAt.toISOString(),
        }).eq('id', vendor.id);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const { data: vendor } = await supabase
        .from('vendors').select('id').eq('stripe_subscription_id', sub.id).maybeSingle();
      if (vendor) {
        await supabase.from('vendors').update({ plan_status: 'canceled', stripe_subscription_id: null }).eq('id', vendor.id);
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }

  res.json({ received: true });
});

// ============================================
// WEBHOOK WHATSAPP — Z-API (receber eventos)
// ============================================
app.post('/api/webhooks/whatsapp', express.json({ limit: '500kb' }), async (req, res) => {
  res.json({ received: true }); // responder rápido para Z-API não retentar

  try {
    const event = req.body;
    const type  = event?.type || event?.event || 'unknown';

    if (type === 'Disconnected' || type === 'disconnected') {
      console.warn('⚠️ WhatsApp desconectado! Acesse z-api.io e escaneie o QR Code novamente.');
      return;
    }

    if (type === 'ReceivedCallback' || type === 'received') {
      const rawPhone   = String(event?.phone || event?.from || '').replace('@c.us', '').replace(/\D/g, '');
      const text       = event?.text?.message || event?.body || '';
      const fromMe     = event?.fromMe || false;
      const name       = event?.senderName || event?.chatName || null;
      const messageId  = event?.messageId || event?.zaapId || null;
      if (!fromMe && rawPhone && text) {
        const { data: saved } = await supabase.from('whatsapp_messages').insert({
          phone:        rawPhone,
          contact_name: name,
          message:      text,
          from_me:      false,
          message_id:   messageId,
        }).select().single();
        if (saved) broadcastMessage(saved);
      }
      return;
    }
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
  }
});

// ============================================
// MENSAGENS WHATSAPP: STREAM EM TEMPO REAL (SSE)
// ============================================
app.get('/api/messages/stream', (req, res) => {
  const token = req.query.token || req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).end();
  try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).end(); }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); sseClients.delete(res); }
  }, 25000);

  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
});

// ============================================
// MENSAGENS WHATSAPP: LISTAR CONVERSAS (vendor)
// ============================================
app.get('/api/messages', auth, async (req, res) => {
  try {
    // Última mensagem por número de telefone
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, phone, contact_name, message, from_me, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return sbErr(error, res);

    // Agrupar por phone — manter a mais recente e contar não-lidas (from_me=false)
    const convMap = new Map();
    for (const msg of data) {
      if (!convMap.has(msg.phone)) {
        convMap.set(msg.phone, {
          phone:        msg.phone,
          contact_name: msg.contact_name,
          last_message: msg.message,
          last_at:      msg.created_at,
          from_me:      msg.from_me,
          unread:       0,
        });
      }
      if (!msg.from_me) convMap.get(msg.phone).unread++;
    }

    res.json([...convMap.values()].sort((a, b) => new Date(b.last_at) - new Date(a.last_at)));
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// MENSAGENS WHATSAPP: THREAD DE UM CONTATO (vendor)
// ============================================
app.get('/api/messages/:phone', auth, async (req, res) => {
  try {
    const phone = String(req.params.phone).replace(/\D/g, '');
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, phone, contact_name, message, from_me, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// MENSAGENS WHATSAPP: RESPONDER (vendor)
// ============================================
app.post('/api/messages/:phone/reply', auth, async (req, res) => {
  try {
    const phone = String(req.params.phone).replace(/\D/g, '');
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensagem não pode ser vazia' });

    await sendWhatsApp(phone, message.trim());

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .insert({ phone, message: message.trim(), from_me: true })
      .select()
      .single();
    if (error) return sbErr(error, res);

    broadcastMessage(data);
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao enviar mensagem' });
  }
});

// ============================================
// LOJA PÚBLICA: info por slug (multi-tenant)
// ============================================
app.get('/api/store/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('name, slug, deliveries_enabled, delivery_fee, pix_key, logo_url')
      .eq('slug', req.params.slug)
      .eq('status', 'active')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Loja não encontrada' });
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  const { error } = await supabase.from('vendors').select('id').limit(1);
  res.json({
    status: 'ok',
    supabase: error ? 'erro' : 'conectado',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// PLANOS: LISTAR (público)
// ============================================
app.get('/api/plans', (req, res) => {
  res.json(Object.entries(PLANS).map(([id, p]) => ({
    id,
    name: p.name,
    price_monthly: p.price,
    months: p.months,
    total: +(p.price * p.months).toFixed(2),
    savings: +((290 - p.price) * p.months).toFixed(2),
  })));
});

// ============================================
// PLANOS: INICIAR CHECKOUT (vendor)
// ============================================
app.post('/api/plans/subscribe', auth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe não configurado' });

  const { plan_id } = req.body;
  const plan = PLANS[plan_id];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });
  if (!plan.priceId) return res.status(500).json({ error: 'Price ID do plano não configurado' });

  try {
    const { data: vendor } = await supabase
      .from('vendors').select('email, name, stripe_customer_id').eq('id', req.user.id).single();

    let customerId = vendor.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: vendor.email, name: vendor.name, metadata: { vendor_id: req.user.id },
      });
      customerId = customer.id;
      await supabase.from('vendors').update({ stripe_customer_id: customerId }).eq('id', req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}?plan_success=1`,
      cancel_url:  `${FRONTEND_URL}/plans?plan_canceled=1`,
      metadata: { vendor_id: req.user.id, plan_id },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
  }
});

// ============================================
// PLANOS: STATUS DA ASSINATURA (vendor)
// ============================================
app.get('/api/plans/status', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendors').select('plan, plan_status, plan_expires_at, created_at').eq('id', req.user.id).single();
    if (error) return sbErr(error, res);

    let trial_days_left = null;
    if (data.plan === 'trial') {
      const trialEnd = new Date(data.created_at);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      trial_days_left = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
    }

    res.json({ plan: data.plan, plan_status: data.plan_status, plan_expires_at: data.plan_expires_at, trial_days_left });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// PLANOS: PORTAL DO CLIENTE (gerenciar assinatura)
// ============================================
app.post('/api/plans/portal', auth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe não configurado' });
  try {
    const { data: vendor } = await supabase
      .from('vendors').select('stripe_customer_id').eq('id', req.user.id).single();
    if (!vendor?.stripe_customer_id)
      return res.status(400).json({ error: 'Sem assinatura ativa' });
    const session = await stripe.billingPortal.sessions.create({
      customer: vendor.stripe_customer_id,
      return_url: FRONTEND_URL,
    });
    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Erro ao abrir portal' });
  }
});

// ============================================
// AUTH: SESSÃO ATUAL
// ============================================
app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user, token: req.token });
});

// ============================================
// AUTH: REGISTRO
// ============================================
app.post('/api/auth/register-vendor', async (req, res) => {
  try {
    const { email, password, name, phone, address, cpf } = req.body;

    if (!email || !password || !name || !phone || !address || !cpf)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Senha deve ter mínimo 8 caracteres' });

    const { data: existing } = await supabase
      .from('vendors')
      .select('id')
      .or(`email.eq.${email},cpf.eq.${cpf}`)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Email ou CPF já cadastrado' });

    const hashed = await bcrypt.hash(password, 12);

    // Gera slug único a partir do nome
    let slug = generateSlug(name) || 'loja';
    let attempt = 0;
    while (true) {
      const { data: taken } = await supabase.from('vendors').select('id').eq('slug', slug).maybeSingle();
      if (!taken) break;
      attempt++;
      slug = `${generateSlug(name)}-${attempt + 1}`;
    }

    const { data: vendor, error } = await supabase
      .from('vendors')
      .insert({ email, password: hashed, name, phone, address, cpf, slug })
      .select('id, email, name, role, slug')
      .single();

    if (error) return sbErr(error, res);

    const token = jwt.sign(
      { id: vendor.id, email: vendor.email, role: vendor.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.status(201).json({ message: 'Vendor registrado com sucesso', vendor, token });
  } catch {
    res.status(500).json({ error: 'Erro interno ao registrar' });
  }
});

// ============================================
// AUTH: LOGIN
// ============================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email inválido' });

    const { data: user, error } = await supabase
      .from('vendors')
      .select('id, email, name, role, status, password')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) return sbErr(error, res);
    if (!user)  return res.status(401).json({ error: 'Email ou senha incorretos' });
    if (user.status !== 'active') return res.status(401).json({ error: 'Conta suspensa ou inativa' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email ou senha incorretos' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.json({
      message: 'Login bem-sucedido',
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch {
    res.status(500).json({ error: 'Erro interno ao fazer login' });
  }
});

// ============================================
// AUTH: LOGOUT
// ============================================
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { ...COOKIE_OPTS, maxAge: 0 });
  res.json({ message: 'Logout realizado' });
});

// ============================================
// PRODUTOS: LISTAR (público — filtrado por loja)
// ============================================
app.get('/api/products', async (req, res) => {
  try {
    const { loja } = req.query;
    if (!loja) return res.status(400).json({ error: 'Parâmetro ?loja= obrigatório' });

    const { data: vendor } = await supabase
      .from('vendors').select('id').eq('slug', loja).eq('status', 'active').maybeSingle();
    if (!vendor) return res.status(404).json({ error: 'Loja não encontrada' });

    let query = supabase
      .from('products')
      .select('*')
      .eq('vendor_id', vendor.id)
      .eq('available', true)
      .order('category')
      .order('created_at', { ascending: false });

    if (req.query.category) query = query.eq('category', req.query.category);

    const { data, error } = await query;
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao carregar produtos' });
  }
});

// ============================================
// PRODUTOS: LISTAR TODOS (admin — inclui inativos)
// ============================================
app.get('/api/admin/products', [auth, planCheck], async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('vendor_id', req.user.id)
      .order('category')
      .order('created_at', { ascending: false });

    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao carregar produtos' });
  }
});

// ============================================
// PRODUTOS: CRIAR (vendor)
// ============================================
app.post('/api/products', [auth, planCheck], async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Apenas vendors' });

    const { name, description, price, category, emoji, calories, ingredients, allergens } = req.body;
    if (!name || price == null || !category) return res.status(400).json({ error: 'Nome, preço e categoria são obrigatórios' });

    if (req.vendor.plan === 'trial') {
      const { count, error: cErr } = await supabase
        .from('products').select('id', { count: 'exact', head: true }).eq('vendor_id', req.user.id);
      if (!cErr && count >= 5) {
        return res.status(403).json({
          error: 'Limite de 5 produtos no trial. Assine um plano para adicionar mais.',
          code: 'TRIAL_LIMIT',
        });
      }
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Preço inválido' });

    const nullify = v => (v === '' || v === undefined) ? null : v;

    const { data, error } = await supabase
      .from('products')
      .insert({
        vendor_id:    req.user.id,
        name,
        description:  nullify(description),
        price:        parsedPrice,
        category,
        emoji:        nullify(emoji) || '🫐',
        calories:     nullify(calories),
        ingredients:  nullify(ingredients),
        allergens:    nullify(allergens),
      })
      .select()
      .single();

    if (error) return sbErr(error, res);
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao criar produto' });
  }
});

// ============================================
// PRODUTOS: ATUALIZAR (vendor)
// ============================================
app.put('/api/products/:id', [auth, planCheck], async (req, res) => {
  try {
    const allowed = ['name','description','price','category','emoji','available','calories','ingredients','allergens'];
    const updates = Object.fromEntries(
      Object.entries(req.body)
        .filter(([k]) => allowed.includes(k))
        .map(([k, v]) => [k, typeof v === 'string' && v === '' ? null : v])
    );

    if (updates.price != null) {
      updates.price = parseFloat(updates.price);
      if (isNaN(updates.price) || updates.price < 0)
        return res.status(400).json({ error: 'Preço inválido' });
    }

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select()
      .single();

    if (error) return sbErr(error, res);
    if (!data)  return res.status(404).json({ error: 'Produto não encontrado' });

    res.json({ message: 'Produto atualizado', product: data });
  } catch {
    res.status(500).json({ error: 'Erro interno ao atualizar produto' });
  }
});

// ============================================
// PRODUTOS: DELETAR (vendor)
// ============================================
app.delete('/api/products/:id', [auth, planCheck], async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id);

    if (error) return sbErr(error, res);
    res.json({ message: 'Produto removido' });
  } catch {
    res.status(500).json({ error: 'Erro interno ao remover produto' });
  }
});

// ============================================
// PEDIDOS: CRIAR (público — cliente faz pedido)
// ============================================
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, delivery_type, customer_notes, vendor_slug } = req.body;

    if (!items?.length)      return res.status(400).json({ error: 'Pedido deve ter pelo menos 1 item' });
    if (!customer?.name)     return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    if (!delivery_type)      return res.status(400).json({ error: 'Tipo de entrega obrigatório' });
    if (!vendor_slug)        return res.status(400).json({ error: 'vendor_slug obrigatório' });

    // Resolver vendor antes de validar produtos — garante isolamento multi-tenant
    if (!customer?.phone?.trim()) return res.status(400).json({ error: 'Telefone do cliente é obrigatório' });
    if (delivery_type === 'entrega' && !customer?.address?.street?.trim())
      return res.status(400).json({ error: 'Endereço é obrigatório para entregas' });

    const { data: vendor, error: vErr } = await supabase
      .from('vendors')
      .select('id, slug, name, deliveries_enabled, delivery_fee, pix_key')
      .eq('slug', vendor_slug)
      .eq('status', 'active')
      .single();

    if (vErr || !vendor) return res.status(404).json({ error: 'Loja não encontrada' });

    // Buscar preços do banco filtrando por vendor_id — nunca confiar no preço enviado pelo cliente
    const productIds = items.map(i => i.product_id).filter(Boolean);
    if (productIds.length !== items.length)
      return res.status(400).json({ error: 'product_id obrigatório em todos os itens' });

    const { data: dbProducts, error: pErr } = await supabase
      .from('products')
      .select('id, name, price, emoji, available')
      .in('id', productIds)
      .eq('vendor_id', vendor.id)
      .eq('available', true);

    if (pErr) return sbErr(pErr, res);

    const productMap = Object.fromEntries(dbProducts.map(p => [p.id, p]));
    const validatedItems = [];
    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product) return res.status(400).json({ error: `Produto ${item.product_id} não encontrado ou indisponível` });
      validatedItems.push({
        product_id: item.product_id,
        name:       product.name,
        price:      product.price,
        quantity:   Math.max(1, parseInt(item.quantity) || 1),
        emoji:      product.emoji,
      });
    }

    if (delivery_type === 'entrega' && vendor.deliveries_enabled === false)
      return res.status(400).json({ error: 'Entregas não disponíveis no momento. Escolha retirada no local.' });

    const subtotal     = validatedItems.reduce((s, i) => s + (i.price * i.quantity), 0);
    const delivery_fee = delivery_type === 'entrega' ? (Number(vendor.delivery_fee) || 5.00) : 0;
    const total        = subtotal + delivery_fee;

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        order_number:            '',
        vendor_id:               vendor.id,
        customer_name:           customer.name,
        customer_email:          customer.email || null,
        customer_phone:          customer.phone || null,
        customer_street:         customer.address?.street || null,
        customer_number:         customer.address?.number || null,
        customer_neighborhood:   customer.address?.neighborhood || null,
        customer_city:           customer.address?.city || null,
        customer_state:          customer.address?.state || null,
        customer_zip:            customer.address?.zip_code || null,
        items:                   validatedItems,
        subtotal,
        delivery_fee,
        total,
        delivery_type,
        status:                  'aguardando_pagamento',
        customer_notes:          customer_notes || null,
      })
      .select()
      .single();

    if (error) return sbErr(error, res);

    // Notificação WhatsApp automática ao cliente
    if (customer.phone) {
      const trackingUrl = `${FRONTEND_URL}?loja=${vendor.slug}&pedido=${order.id}`;
      const isPix = String(customer_notes || '').toUpperCase().includes('PIX');
      sendWhatsApp(customer.phone, waMsgNovoPedido(
        customer.name, vendor.name, order.order_number, order.total,
        delivery_type, trackingUrl, isPix ? vendor.pix_key : null
      )).catch(() => {});
    }

    res.status(201).json({
      message: 'Pedido criado com sucesso',
      order: {
        ...order,
        preparation_time: delivery_type === 'retirada' ? '20–25 min' : '30–40 min'
      }
    });
  } catch {
    res.status(500).json({ error: 'Erro interno ao criar pedido' });
  }
});

// ============================================
// PEDIDOS: RASTREAR (público — apenas por ID)
// ============================================
app.get('/api/orders/:id/track', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, items, subtotal, delivery_fee, total, delivery_type, created_at, customer_name')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// PEDIDOS: LISTAR (vendor)
// ============================================
app.get('/api/orders', [auth, planCheck], async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Acesso negado' });

    let query = supabase
      .from('orders')
      .select('*')
      .eq('vendor_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query;
    if (error) return sbErr(error, res);

    res.json(data.map(normalizeOrder));
  } catch {
    res.status(500).json({ error: 'Erro interno ao listar pedidos' });
  }
});

// ============================================
// PEDIDOS: CONFIRMAR PAGAMENTO (vendor)
// ============================================
app.post('/api/orders/:id/confirm-payment', [auth, planCheck], async (req, res) => {
  try {
    const { deliverer_id } = req.body;

    const { data: order, error: findErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .single();

    if (findErr || !order) return res.status(404).json({ error: 'Pedido não encontrado' });

    const updates = { payment_status: 'pago', status: 'confirmado' };

    if (deliverer_id && order.delivery_type === 'entrega') {
      const { data: del } = await supabase
        .from('deliverers')
        .select('commission_rate')
        .eq('id', deliverer_id)
        .eq('vendor_id', req.user.id)
        .single();
      if (del) {
        updates.deliverer_id         = deliverer_id;
        updates.deliverer_commission = (order.delivery_fee * del.commission_rate / 100);
      }
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return sbErr(error, res);
    res.json({ message: 'Pagamento confirmado', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao confirmar pagamento' });
  }
});

// ============================================
// PEDIDOS: ATUALIZAR STATUS (vendor)
// ============================================
app.put('/api/orders/:id', [auth, planCheck], async (req, res) => {
  try {
    const VALID = ['aguardando_pagamento','confirmado','em_preparo','pronto','em_entrega','entregue','cancelado'];
    const { status, vendor_notes, deliverer_id } = req.body;
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Status inválido' });

    const updates = { status, vendor_notes: vendor_notes || null };
    if (deliverer_id !== undefined) updates.deliverer_id = deliverer_id || null;
    if (status === 'em_preparo') updates.started_at   = new Date().toISOString();
    if (status === 'entregue')   updates.completed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select()
      .single();

    if (error) return sbErr(error, res);
    if (!data)  return res.status(404).json({ error: 'Pedido não encontrado' });

    // Notificação WhatsApp ao cliente na mudança de status
    if (data.customer_phone && WA_STATUS_MSG[status]) {
      try {
        const { data: v } = await supabase.from('vendors').select('slug').eq('id', req.user.id).single();
        const trackingUrl = v?.slug ? `${FRONTEND_URL}?loja=${v.slug}&pedido=${data.id}` : FRONTEND_URL;
        const msgFn = WA_STATUS_MSG[status];
        const msg   = status === 'pronto'
          ? msgFn(data.customer_name, trackingUrl, data.delivery_type)
          : status === 'entregue' || status === 'cancelado'
            ? msgFn(data.customer_name)
            : msgFn(data.customer_name, trackingUrl);
        sendWhatsApp(data.customer_phone, msg).catch(() => {});
      } catch {}
    }

    res.json({ message: 'Pedido atualizado', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao atualizar pedido' });
  }
});

// ============================================
// PEDIDOS: ALTERAR TAXA / VALOR (vendor)
// ============================================
app.patch('/api/orders/:id/fee', [auth, planCheck], async (req, res) => {
  try {
    const { delivery_fee, desconto, note } = req.body;

    const { data: current, error: findErr } = await supabase
      .from('orders')
      .select('subtotal, delivery_fee, customer_phone, customer_name')
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .single();
    if (findErr || !current) return res.status(404).json({ error: 'Pedido não encontrado' });

    const newFee      = delivery_fee !== undefined ? Number(delivery_fee) : Number(current.delivery_fee);
    const newDesconto = desconto     !== undefined ? Math.max(0, Number(desconto)) : 0;
    if (isNaN(newFee) || newFee < 0) return res.status(400).json({ error: 'Taxa inválida' });

    const newTotal = Math.max(0, Number(current.subtotal) + newFee - newDesconto);

    const updates = { delivery_fee: newFee, total: newTotal };
    if (newDesconto > 0) updates.desconto = newDesconto;
    if (note)            updates.vendor_notes = note;

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select()
      .single();

    if (error) return sbErr(error, res);

    // Notifica cliente se o valor mudou
    if (current.customer_phone) {
      const msg = `ℹ️ *${current.customer_name}*, o valor do seu pedido foi atualizado.\n💰 Novo total: *R$ ${newTotal.toFixed(2)}*${newDesconto > 0 ? `\n🎁 Desconto aplicado: R$ ${newDesconto.toFixed(2)}` : ''}${note ? `\nObs: ${note}` : ''}`;
      sendWhatsApp(current.customer_phone, msg).catch(() => {});
    }

    res.json({ message: 'Valor atualizado', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao atualizar valor' });
  }
});

// ============================================
// PEDIDOS: ATRIBUIR ENTREGADOR (sem mudar status)
// ============================================
app.patch('/api/orders/:id/deliverer', [auth, planCheck], async (req, res) => {
  try {
    const { deliverer_id } = req.body;

    let commission = null;
    if (deliverer_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('delivery_fee')
        .eq('id', req.params.id)
        .eq('vendor_id', req.user.id)
        .single();

      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

      const { data: del } = await supabase
        .from('deliverers')
        .select('commission_rate')
        .eq('id', deliverer_id)
        .eq('vendor_id', req.user.id)
        .single();

      if (order && del) commission = (order.delivery_fee * del.commission_rate / 100);
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ deliverer_id: deliverer_id || null, deliverer_commission: commission })
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select().single();

    if (error) return sbErr(error, res);
    res.json({ message: 'Entregador atribuído', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao atribuir entregador' });
  }
});

// ============================================
// PEDIDOS: DELETAR (vendor)
// ============================================
app.delete('/api/orders/:id', [auth, planCheck], async (req, res) => {
  try {
    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id);
    if (error) return sbErr(error, res);
    res.json({ message: 'Pedido removido' });
  } catch {
    res.status(500).json({ error: 'Erro interno ao remover pedido' });
  }
});

// ============================================
// PAGAMENTOS: criar intenção (simulado)
// ============================================
app.post('/api/payments/create-intent', async (req, res) => {
  try {
    const { order_id, amount } = req.body;
    if (!order_id || !amount) return res.status(400).json({ error: 'order_id e amount obrigatórios' });

    res.json({
      client_secret: `pi_simulated_${Date.now()}`,
      payment_id:    `pay_${Date.now()}`,
    });
  } catch {
    res.status(500).json({ error: 'Erro interno ao criar intenção de pagamento' });
  }
});

// ============================================
// PAGAMENTOS: confirmar (requer autenticação + ownership)
// ============================================
app.post('/api/payments/confirm', [auth, planCheck], async (req, res) => {
  try {
    const { payment_id, order_id } = req.body;

    const { data: existing, error: findErr } = await supabase
      .from('orders')
      .select('id')
      .eq('id', order_id)
      .eq('vendor_id', req.user.id)
      .maybeSingle();

    if (findErr) return sbErr(findErr, res);
    if (!existing) return res.status(404).json({ error: 'Pedido não encontrado' });

    const { data, error } = await supabase
      .from('orders')
      .update({ payment_status: 'pago', payment_id })
      .eq('id', order_id)
      .select()
      .single();

    if (error) return sbErr(error, res);
    res.json({ message: 'Pagamento confirmado', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao confirmar pagamento' });
  }
});

// ============================================
// COMISSÕES: MARCAR COMO PAGO
// ============================================
app.patch('/api/orders/:id/commission-paid', [auth, planCheck], async (req, res) => {
  try {
    const paid = req.body.paid !== false;
    const { data, error } = await supabase
      .from('orders')
      .update({ commission_paid: paid, commission_paid_at: paid ? new Date().toISOString() : null })
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .not('deliverer_id', 'is', null)
      .select().single();
    if (error) return sbErr(error, res);
    if (!data) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json({ message: 'Comissão atualizada', order: data });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// CONFIGURAÇÕES DO VENDOR (entregas)
// ============================================
app.get('/api/vendors/settings', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendors').select('deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url').eq('id', req.user.id).single();
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.patch('/api/vendors/settings', auth, async (req, res) => {
  try {
    const allowed = ['deliveries_enabled', 'slug', 'delivery_fee', 'pix_key'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

    if (updates.slug !== undefined) {
      const slug = String(updates.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '');
      if (slug.length < 2) return res.status(400).json({ error: 'Link muito curto (mínimo 2 caracteres)' });
      const { data: taken } = await supabase.from('vendors').select('id').eq('slug', slug).neq('id', req.user.id).maybeSingle();
      if (taken) return res.status(400).json({ error: 'Este link já está em uso por outra loja' });
      updates.slug = slug;
    }

    if (updates.delivery_fee !== undefined) {
      const fee = Number(updates.delivery_fee);
      if (isNaN(fee) || fee < 0) return res.status(400).json({ error: 'Taxa de entrega inválida' });
      updates.delivery_fee = fee;
    }

    if (updates.pix_key !== undefined) {
      updates.pix_key = typeof updates.pix_key === 'string' ? updates.pix_key.trim() || null : null;
    }

    const { data, error } = await supabase
      .from('vendors').update(updates).eq('id', req.user.id).select('deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url').single();
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao salvar configurações' });
  }
});

// ============================================
// DASHBOARD ADMIN
// ============================================
app.get('/api/admin/dashboard', [auth, planCheck], async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Acesso negado' });

    const vendorId = req.user.id;

    const { data: allOrders, error } = await supabase
      .from('orders')
      .select('id, total, status, payment_status, created_at, customer_name, order_number')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) return sbErr(error, res);

    const today         = new Date(); today.setHours(0,0,0,0);
    const paidOrders    = allOrders.filter(o => o.payment_status === 'pago');
    const pendingOrders = allOrders.filter(o => o.payment_status !== 'pago' && o.status !== 'cancelado');
    const totalRevenue  = paidOrders.reduce((s, o) => s + Number(o.total), 0);
    const pendingRevenue = pendingOrders.reduce((s, o) => s + Number(o.total), 0);
    const averageTicket = paidOrders.length ? totalRevenue / paidOrders.length : 0;
    const ordersToday   = allOrders.filter(o => new Date(o.created_at) >= today).length;

    const byStatus = { aguardando_pagamento: 0, confirmado: 0, em_preparo: 0, pronto: 0, em_entrega: 0, entregue: 0, cancelado: 0 };
    allOrders.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });

    res.json({
      totalOrders:    allOrders.length,
      totalRevenue:   totalRevenue.toFixed(2),
      pendingRevenue: pendingRevenue.toFixed(2),
      averageTicket:  averageTicket.toFixed(2),
      ordersToday,
      ordersByStatus: byStatus,
      recentOrders:   allOrders.slice(0, 10).map(o => ({
        ...o,
        customer: { name: o.customer_name }
      }))
    });
  } catch {
    res.status(500).json({ error: 'Erro interno no dashboard' });
  }
});

// ============================================
// PRODUTOS: IMAGEM — upload direto via backend (evita CORS do Supabase)
// ============================================
app.put('/api/products/:id/upload-image', [auth, planCheck, express.raw({ type: '*/*', limit: '6mb' })], async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'Arquivo de imagem obrigatório' });

    const { data: product } = await supabase
      .from('products').select('id').eq('id', req.params.id).eq('vendor_id', req.user.id).single();
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

    const content_type = (req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    const ext  = content_type.split('/')[1]?.split('+')[0] || 'jpg';
    const path = `${req.user.id}/${req.params.id}.${ext}`;

    const { error: bErr } = await supabase.storage.getBucket('product-images');
    if (bErr) await supabase.storage.createBucket('product-images', { public: true, fileSizeLimit: 5242880 });

    const { error: uploadErr } = await supabase.storage.from('product-images').upload(path, req.body, {
      contentType: content_type,
      upsert: true,
    });
    if (uploadErr) { console.error('Storage upload error:', uploadErr); return res.status(500).json({ error: 'Erro ao fazer upload da imagem' }); }

    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path);
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

    const { data, error } = await supabase
      .from('products').update({ image_url: cacheBustedUrl }).eq('id', req.params.id).eq('vendor_id', req.user.id).select().single();
    if (error) return sbErr(error, res);

    res.json({ message: 'Imagem atualizada', image_url: cacheBustedUrl, product: data });
  } catch {
    res.status(500).json({ error: 'Erro interno ao fazer upload' });
  }
});

// ============================================
// PRODUTOS: IMAGEM — gerar URL de upload assinada
// ============================================
app.post('/api/products/:id/image-url', [auth, planCheck], async (req, res) => {
  try {
    const { content_type = 'image/jpeg' } = req.body;
    const { data: product } = await supabase
      .from('products').select('id').eq('id', req.params.id).eq('vendor_id', req.user.id).single();
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

    const ext  = content_type.split('/')[1]?.split('+')[0] || 'jpg';
    const path = `${req.user.id}/${req.params.id}.${ext}`;

    // Garante que o bucket existe
    const { error: bErr } = await supabase.storage.getBucket('product-images');
    if (bErr) await supabase.storage.createBucket('product-images', { public: true, fileSizeLimit: 5242880 });

    const { data, error } = await supabase.storage.from('product-images').createSignedUploadUrl(path);
    if (error) { console.error('Storage error:', error); return res.status(500).json({ error: 'Erro ao gerar URL de upload' }); }

    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path);
    res.json({ signed_url: data.signedUrl, token: data.token, path, public_url: publicUrl });
  } catch {
    res.status(500).json({ error: 'Erro interno ao gerar URL' });
  }
});

// ============================================
// PRODUTOS: IMAGEM — salvar URL após upload
// ============================================
app.patch('/api/products/:id/image', [auth, planCheck], async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url obrigatória' });
    const { data, error } = await supabase
      .from('products').update({ image_url }).eq('id', req.params.id).eq('vendor_id', req.user.id).select().single();
    if (error) return sbErr(error, res);
    if (!data) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json({ message: 'Imagem atualizada', product: data });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// LOGO DO VENDOR: upload direto via backend
// ============================================
app.put('/api/vendors/logo', [auth, express.raw({ type: '*/*', limit: '6mb' })], async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'Arquivo de imagem obrigatório' });

    const content_type = (req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    const ext  = content_type.split('/')[1]?.split('+')[0] || 'jpg';
    const path = `${req.user.id}/logo.${ext}`;

    const { error: bErr } = await supabase.storage.getBucket('vendor-logos');
    if (bErr) await supabase.storage.createBucket('vendor-logos', { public: true, fileSizeLimit: 5242880 });

    const { error: uploadErr } = await supabase.storage.from('vendor-logos').upload(path, req.body, {
      contentType: content_type,
      upsert: true,
    });
    if (uploadErr) { console.error('Logo upload error:', uploadErr); return res.status(500).json({ error: 'Erro ao fazer upload da logo' }); }

    const { data: { publicUrl } } = supabase.storage.from('vendor-logos').getPublicUrl(path);
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

    const { error } = await supabase.from('vendors').update({ logo_url: cacheBustedUrl }).eq('id', req.user.id);
    if (error) return sbErr(error, res);

    res.json({ message: 'Logo atualizada', logo_url: cacheBustedUrl });
  } catch {
    res.status(500).json({ error: 'Erro interno ao fazer upload da logo' });
  }
});

// ============================================
// ENTREGADORES: LISTAR
// ============================================
app.get('/api/deliverers', [auth, planCheck], async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deliverers')
      .select('*')
      .eq('vendor_id', req.user.id)
      .order('name');
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao listar entregadores' });
  }
});

// ============================================
// ENTREGADORES: CRIAR
// ============================================
app.post('/api/deliverers', [auth, planCheck], async (req, res) => {
  try {
    const { name, phone, cpf, vehicle, commission_rate } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });
    const { data, error } = await supabase
      .from('deliverers')
      .insert({ vendor_id: req.user.id, name, phone, cpf: cpf || null, vehicle: vehicle || null, commission_rate: commission_rate || 10 })
      .select().single();
    if (error) return sbErr(error, res);
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao criar entregador' });
  }
});

// ============================================
// ENTREGADORES: ATUALIZAR
// ============================================
app.put('/api/deliverers/:id', [auth, planCheck], async (req, res) => {
  try {
    const allowed = ['name','phone','cpf','vehicle','commission_rate','status'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    const { data, error } = await supabase
      .from('deliverers')
      .update(updates)
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select().single();
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno ao atualizar entregador' });
  }
});

// ============================================
// ENTREGADORES: DELETAR
// ============================================
app.delete('/api/deliverers/:id', [auth, planCheck], async (req, res) => {
  try {
    const { error } = await supabase
      .from('deliverers')
      .delete()
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id);
    if (error) return sbErr(error, res);
    res.json({ message: 'Entregador removido' });
  } catch {
    res.status(500).json({ error: 'Erro interno ao remover entregador' });
  }
});

// ============================================
// COMISSÕES: RELATÓRIO POR PERÍODO
// ============================================
app.get('/api/commissions', [auth, planCheck], async (req, res) => {
  try {
    const { start, end } = req.query;
    let query = supabase
      .from('orders')
      .select('id, order_number, total, delivery_fee, deliverer_id, deliverer_commission, commission_paid, commission_paid_at, status, created_at, customer_name')
      .eq('vendor_id', req.user.id)
      .not('deliverer_id', 'is', null)
      .eq('payment_status', 'pago');

    if (start) query = query.gte('created_at', start);
    if (end)   query = query.lte('created_at', end);

    const { data: orders, error } = await query.order('created_at', { ascending: false });
    if (error) return sbErr(error, res);

    const { data: deliverers } = await supabase
      .from('deliverers')
      .select('id, name, commission_rate')
      .eq('vendor_id', req.user.id);

    const summary = (deliverers || []).map(d => {
      const deliveries        = orders.filter(o => o.deliverer_id === d.id);
      const paid              = deliveries.filter(o => o.commission_paid);
      const pending           = deliveries.filter(o => !o.commission_paid);
      const total_commission  = deliveries.reduce((s, o) => s + Number(o.deliverer_commission || 0), 0);
      const paid_commission   = paid.reduce((s, o) => s + Number(o.deliverer_commission || 0), 0);
      const pending_commission = pending.reduce((s, o) => s + Number(o.deliverer_commission || 0), 0);
      return {
        ...d,
        deliveries: deliveries.length,
        total_commission: total_commission.toFixed(2),
        paid_commission: paid_commission.toFixed(2),
        pending_commission: pending_commission.toFixed(2),
        orders: deliveries,
      };
    });

    res.json({ summary, orders });
  } catch {
    res.status(500).json({ error: 'Erro interno ao carregar comissões' });
  }
});

// ============================================
// HELPER: normaliza linha do banco para o frontend
// ============================================
function normalizeOrder(o) {
  return {
    ...o,
    customer: {
      name:  o.customer_name,
      email: o.customer_email,
      phone: o.customer_phone,
      address: {
        street:       o.customer_street,
        number:       o.customer_number,
        neighborhood: o.customer_neighborhood,
        city:         o.customer_city,
        state:        o.customer_state,
        zip_code:     o.customer_zip,
      }
    }
  };
}

// ============================================
// START
// ============================================
app.listen(PORT, () => {
  console.log(`\n🫐 Açaí Shop rodando em http://localhost:${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Banco:    Supabase (${process.env.SUPABASE_URL?.split('.')[0]?.replace('https://', '') || '?'})`);
  console.log('\nRotas: /api/health | /api/auth/* | /api/products | /api/orders | /api/admin/dashboard\n');
});

module.exports = app;
