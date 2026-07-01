// ============================================
// SERVIDOR EXPRESS - AÇAÍ SHOP (Supabase/PostgreSQL)
// ============================================

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const dotenv       = require('dotenv');
const cookieParser = require('cookie-parser');
const https        = require('https');
const crypto       = require('crypto');
const nodemailer   = require('nodemailer');
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

app.use(helmet({
  contentSecurityPolicy: false, // frontend inline styles são extensos
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // imagens públicas do Storage
}));
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
  if (req.originalUrl === '/api/webhooks/mercadopago') return next();
  if (/\/upload-image$/.test(req.originalUrl)) return next(); // binary body — handled by express.raw per-route
  if (/\/api\/vendors\/logo$/.test(req.originalUrl)) return next();
  express.json({ limit: '100kb' })(req, res, next);
});

// ── Rate limiting ──────────────────────────────
function makeRateLimiter(windowMs, max, message) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    // Limpar entradas antigas
    for (const [k, v] of hits) { if (now - v.start > windowMs) hits.delete(k); }
    const d = hits.get(key);
    if (!d || now - d.start > windowMs) { hits.set(key, { count: 1, start: now }); return next(); }
    if (d.count++ >= max) return res.status(429).json({ error: message });
    next();
  };
}

// Global: 300 req / 15 min por IP
const globalLimiter = makeRateLimiter(15 * 60 * 1000, 300, 'Muitas requisições. Aguarde 15 minutos.');
// Auth: 10 tentativas / 15 min por IP (proteção contra brute-force)
const authLimiter   = makeRateLimiter(15 * 60 * 1000, 10, 'Muitas tentativas de login. Aguarde 15 minutos.');

app.use(globalLimiter);
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register-vendor', authLimiter);

// ── SSE: clientes conectados ao stream de mensagens, isolados por vendor_id ───
const sseClients = new Map(); // vendorId → Set<res>

function broadcastMessage(msg) {
  const vendorId = msg.vendor_id;
  const clients  = vendorId ? sseClients.get(String(vendorId)) : null;
  if (!clients?.size) return;
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { clients.delete(client); }
  }
}

// ── WhatsApp via Z-API — suporta credenciais por vendor ou fallback para .env ──
async function sendWhatsApp(phone, message, creds = {}) {
  let instanceId    = creds.instanceId    || process.env.ZAPI_INSTANCE_ID || '';
  let token         = creds.token         || process.env.ZAPI_TOKEN        || '';
  const clientToken = creds.clientToken   || process.env.ZAPI_CLIENT_TOKEN || '';

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

// ── Mercado Pago ───────────────────────────────
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || null;

async function mpRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.mercadopago.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const PLANS = {
  monthly:    { name: 'Mensal',    monthlyPrice: 290.00, months: 1,  repetitions: 0  }, // 0 = sem fim
  semiannual: { name: 'Semestral', monthlyPrice: 250.00, months: 6,  repetitions: 6  },
  annual:     { name: 'Anual',     monthlyPrice: 210.00, months: 12, repetitions: 12 },
};

const TRIAL_DAYS = 14;

// ── Opções de cookie httpOnly ──────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 4 * 60 * 60 * 1000, // 4h (access token)
};

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias (refresh token)
  path: '/api/auth/refresh',
};

// ── Email transacional ─────────────────────────
const emailTransporter = process.env.EMAIL_HOST ? nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_PORT === '465',
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
}) : null;

async function sendEmail({ to, subject, html }) {
  if (!emailTransporter) {
    console.warn('[email] Transporte não configurado. EMAIL_HOST, EMAIL_USER e EMAIL_PASS são necessários.');
    return;
  }
  try {
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM || `"Açaí Shop" <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
  } catch (err) {
    console.error('[email] Erro ao enviar:', err.message);
  }
}

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
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', code: 'TOKEN_EXPIRED' });
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
// WEBHOOK MERCADO PAGO
// ============================================
app.post('/api/webhooks/mercadopago', express.json({ limit: '500kb' }), async (req, res) => {
  res.json({ received: true });

  try {
    const { type, data } = req.body;
    if (!data?.id) return;

    // Evento de assinatura: verifica status da assinatura
    if (type === 'subscription_preapproval') {
      const { status: hs, data: sub } = await mpRequest('GET', `/preapproval/${data.id}`);
      if (hs !== 200) return;
      const [vendor_id, plan_id] = (sub.external_reference || '').split('|');
      if (!vendor_id || !PLANS[plan_id]) return;

      if (sub.status === 'authorized') {
        const months = PLANS[plan_id].months;
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + months);
        await supabase.from('vendors').update({
          plan: plan_id, plan_status: 'active',
          plan_expires_at: expiresAt.toISOString(),
          mp_payment_id: String(sub.id),
        }).eq('id', vendor_id);
        console.log(`✅ Assinatura ${plan_id} ativada vendor ${vendor_id}`);
      } else if (sub.status === 'cancelled') {
        await supabase.from('vendors').update({ plan_status: 'canceled' }).eq('id', vendor_id);
      } else if (sub.status === 'paused') {
        await supabase.from('vendors').update({ plan_status: 'past_due' }).eq('id', vendor_id);
      }
      return;
    }

    // Evento de pagamento: cobre tanto cobrança de assinatura quanto pagamento avulso
    if (type === 'payment') {
      const { status: hs, data: payment } = await mpRequest('GET', `/v1/payments/${data.id}`);
      if (hs !== 200) return;

      // Se é pagamento de assinatura, busca a assinatura pelo preapproval_id
      if (payment.preapproval_id) {
        const { status: hs2, data: sub } = await mpRequest('GET', `/preapproval/${payment.preapproval_id}`);
        if (hs2 !== 200) return;
        const [vendor_id, plan_id] = (sub.external_reference || '').split('|');
        if (!vendor_id || !PLANS[plan_id]) return;

        if (payment.status === 'approved') {
          // Renova por mais 1 mês a cada pagamento aprovado
          const { data: vendor } = await supabase.from('vendors').select('plan_expires_at').eq('id', vendor_id).single();
          const base = vendor?.plan_expires_at && new Date(vendor.plan_expires_at) > new Date()
            ? new Date(vendor.plan_expires_at) : new Date();
          base.setMonth(base.getMonth() + 1);
          await supabase.from('vendors').update({
            plan: plan_id, plan_status: 'active',
            plan_expires_at: base.toISOString(),
            mp_payment_id: String(payment.id),
          }).eq('id', vendor_id);
          console.log(`✅ Pagamento assinatura ${plan_id} aprovado vendor ${vendor_id}`);
        } else if (payment.status === 'rejected') {
          await supabase.from('vendors').update({ plan_status: 'past_due' }).eq('id', vendor_id);
        }
        return;
      }

      // Pagamento avulso (external_reference = vendor_id|plan_id)
      const [vendor_id, plan_id] = (payment.external_reference || '').split('|');
      if (!vendor_id || !PLANS[plan_id]) return;
      if (payment.status === 'approved') {
        const months = PLANS[plan_id].months || 1;
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + months);
        await supabase.from('vendors').update({
          plan: plan_id, plan_status: 'active',
          plan_expires_at: expiresAt.toISOString(),
          mp_payment_id: String(payment.id),
        }).eq('id', vendor_id);
      }
    }
  } catch (err) {
    console.error('MP webhook error:', err.message);
  }
});

// ============================================
// WEBHOOK WHATSAPP — Z-API (receber eventos)
// ============================================
app.post('/api/webhooks/whatsapp', express.json({ limit: '500kb' }), async (req, res) => {
  // Verificar secret token se configurado
  const waSecret = process.env.ZAPI_WEBHOOK_SECRET;
  if (waSecret) {
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (provided !== waSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

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
      const vendorId   = req.query.vendor_id || null;
      if (!fromMe && rawPhone && text) {
        const { data: saved } = await supabase.from('whatsapp_messages').insert({
          phone:        rawPhone,
          contact_name: name,
          message:      text,
          from_me:      false,
          message_id:   messageId,
          vendor_id:    vendorId,
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
  let user;
  try { user = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).end(); }

  const vendorId = String(user.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');

  if (!sseClients.has(vendorId)) sseClients.set(vendorId, new Set());
  sseClients.get(vendorId).add(res);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {
      clearInterval(heartbeat);
      sseClients.get(vendorId)?.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.get(vendorId)?.delete(res);
  });
});

// ============================================
// MENSAGENS WHATSAPP: LISTAR CONVERSAS (vendor)
// ============================================
app.get('/api/messages', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, phone, contact_name, message, from_me, created_at')
      .eq('vendor_id', req.user.id)
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
      .eq('vendor_id', req.user.id)
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

    // Buscar credenciais Z-API do vendor para envio
    const { data: vendorCreds } = await supabase
      .from('vendors')
      .select('zapi_instance_id, zapi_token, zapi_client_token')
      .eq('id', req.user.id)
      .single();

    await sendWhatsApp(phone, message.trim(), {
      instanceId:  vendorCreds?.zapi_instance_id,
      token:       vendorCreds?.zapi_token,
      clientToken: vendorCreds?.zapi_client_token,
    });

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .insert({ phone, message: message.trim(), from_me: true, vendor_id: req.user.id })
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
// LOJAS PÚBLICAS: listagem geral
// ============================================
app.get('/api/stores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('name, slug, logo_url, business_type, description')
      .eq('status', 'active')
      .order('name');
    if (error) throw error;
    res.json(data || []);
  } catch { res.status(500).json({ error: 'Erro interno' }); }
});

// LOJA PÚBLICA: info por slug (multi-tenant)
// ============================================
app.get('/api/store/:slug', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('name, slug, deliveries_enabled, delivery_fee, pix_key, logo_url, categories, business_type')
      .eq('slug', req.params.slug)
      .eq('status', 'active')
      .single();
    if ((error || !data) && error?.message?.includes('categories')) {
      const { data: d2, error: e2 } = await supabase
        .from('vendors').select('name, slug, deliveries_enabled, delivery_fee, pix_key, logo_url')
        .eq('slug', req.params.slug).eq('status', 'active').single();
      if (e2 || !d2) return res.status(404).json({ error: 'Loja não encontrada' });
      return res.json(d2);
    }
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
// MP: config pública
// ============================================
app.get('/api/stripe/config', (req, res) => {
  res.json({ publishable_key: null, test_mode: !MP_ACCESS_TOKEN?.startsWith('APP_USR') });
});

// ============================================
// PLANOS: LISTAR (público)
// ============================================
app.get('/api/plans', (req, res) => {
  res.json(Object.entries(PLANS).map(([id, p]) => ({
    id,
    name: p.name,
    price_monthly: p.monthlyPrice,
    months: p.months,
    total: +(p.monthlyPrice * (p.months || 1)).toFixed(2),
    savings: +((290 - p.monthlyPrice) * (p.months || 1)).toFixed(2),
  })));
});

// ============================================
// PLANOS: INICIAR CHECKOUT (vendor)
// ============================================
app.post('/api/plans/subscribe', auth, async (req, res) => {
  if (!MP_ACCESS_TOKEN) return res.status(503).json({ error: 'Mercado Pago não configurado' });

  const { plan_id } = req.body;
  const plan = PLANS[plan_id];
  if (!plan) return res.status(400).json({ error: 'Plano inválido' });

  try {
    const { data: vendor } = await supabase
      .from('vendors').select('email, name').eq('id', req.user.id).single();

    const BACKEND_URL = process.env.BACKEND_URL || 'https://app-acai-production.up.railway.app';

    // Criar plano de assinatura no MP
    const planBody = {
      reason: `App Cardápio — Plano ${plan.name}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plan.monthlyPrice,
        currency_id: 'BRL',
        ...(plan.repetitions > 0 ? { repetitions: plan.repetitions } : {}),
      },
      back_url: `${FRONTEND_URL}?plan_success=1`,
      notification_url: `${BACKEND_URL}/api/webhooks/mercadopago`,
    };

    const { status: ps, data: mpPlan } = await mpRequest('POST', '/preapproval_plan', planBody);
    if (ps !== 201 && ps !== 200) {
      console.error('MP plan error:', mpPlan);
      return res.status(500).json({ error: 'Erro ao criar plano no Mercado Pago' });
    }

    // Criar assinatura vinculada ao plano
    const subBody = {
      preapproval_plan_id: mpPlan.id,
      reason: `App Cardápio — Plano ${plan.name}`,
      payer_email: vendor.email,
      back_url: `${FRONTEND_URL}?plan_success=1`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plan.monthlyPrice,
        currency_id: 'BRL',
        ...(plan.repetitions > 0 ? { repetitions: plan.repetitions } : {}),
      },
      external_reference: `${req.user.id}|${plan_id}`,
    };

    const { status: ss, data: sub } = await mpRequest('POST', '/preapproval', subBody);
    if (ss !== 201 && ss !== 200) {
      console.error('MP subscription error:', sub);
      return res.status(500).json({ error: 'Erro ao criar assinatura' });
    }

    res.json({ url: sub.init_point });
  } catch (err) {
    console.error('MP subscribe error:', err);
    res.status(500).json({ error: 'Erro ao iniciar pagamento' });
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
// PLANOS: CANCELAR ASSINATURA (contato via suporte)
// ============================================
app.post('/api/plans/portal', auth, async (req, res) => {
  res.json({ url: null, message: 'Para cancelar ou alterar seu plano, entre em contato com o suporte.' });
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
    const { email, password, name, phone, address, cpf, business_type } = req.body;
    const VALID_BIZ_TYPES = ['acai','confeitaria','pizzaria','hamburgueria','restaurante','mercado','outro'];
    const bizType = VALID_BIZ_TYPES.includes(business_type) ? business_type : 'outro';

    if (!email || !password || !name || !phone || !address || !cpf)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Senha deve ter mínimo 8 caracteres' });
    if (!/[A-Z]/.test(password))
      return res.status(400).json({ error: 'Senha deve conter ao menos uma letra maiúscula' });
    if (!/[0-9]/.test(password))
      return res.status(400).json({ error: 'Senha deve conter ao menos um número' });
    if (!/[^A-Za-z0-9]/.test(password))
      return res.status(400).json({ error: 'Senha deve conter ao menos um caractere especial (!@#$%...)' });

    const { data: existing } = await supabase
      .from('vendors')
      .select('id')
      .or(`email.eq.${email},cpf.eq.${cpf}`)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Email ou CPF já cadastrado' });

    const hashed = await bcrypt.hash(password, 12);

    // Gera slug único a partir do nome (máximo 10 tentativas)
    const baseSlug = generateSlug(name) || 'loja';
    let slug = baseSlug;
    let attempt = 0;
    while (attempt < 10) {
      const { data: taken } = await supabase.from('vendors').select('id').eq('slug', slug).maybeSingle();
      if (!taken) break;
      attempt++;
      slug = `${baseSlug}-${attempt + 1}`;
    }
    if (attempt >= 10) slug = `${baseSlug}-${Date.now().toString(36)}`;

    // Gerar token de confirmação de email
    const confirmToken   = crypto.randomBytes(32).toString('hex');
    const confirmExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { data: vendor, error } = await supabase
      .from('vendors')
      .insert({
        email, password: hashed, name, phone, address, cpf, slug,
        business_type: bizType,
        email_confirm_token:   confirmToken,
        email_confirm_expires: confirmExpires.toISOString(),
      })
      .select('id, email, name, role, slug')
      .single();

    if (error) return sbErr(error, res);

    const token = jwt.sign(
      { id: vendor.id, email: vendor.email, role: vendor.role },
      JWT_SECRET,
      { expiresIn: '4h' }
    );
    const refreshToken = jwt.sign(
      { id: vendor.id },
      JWT_SECRET + '_refresh',
      { expiresIn: '30d' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS);

    // Enviar email de confirmação (não bloqueia a resposta)
    const confirmUrl = `${FRONTEND_URL}?confirm_email=${confirmToken}`;
    sendEmail({
      to:      vendor.email,
      subject: '✉️ Confirme seu email — Açaí Shop',
      html:    emailConfirmHtml(vendor.name, confirmUrl),
    }).catch(() => {});

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
      .select('id, email, name, role, status, password, email_confirmed')
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
      { expiresIn: '4h' }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET + '_refresh',
      { expiresIn: '30d' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS);
    res.json({
      message: 'Login bem-sucedido',
      user: { id: user.id, email: user.email, name: user.name, role: user.role, email_confirmed: user.email_confirmed },
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
  res.clearCookie('refresh_token', { ...REFRESH_COOKIE_OPTS, maxAge: 0 });
  res.json({ message: 'Logout realizado' });
});

// ============================================
// AUTH: REFRESH TOKEN
// ============================================
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refresh_token;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token ausente', code: 'NO_REFRESH' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET + '_refresh');
    } catch {
      return res.status(401).json({ error: 'Refresh token inválido ou expirado', code: 'REFRESH_EXPIRED' });
    }

    // Buscar usuário para confirmar que ainda existe e está ativo
    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('id, email, name, role, status')
      .eq('id', payload.id)
      .single();

    if (error || !vendor || vendor.status !== 'active') {
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo', code: 'USER_INACTIVE' });
    }

    const newToken = jwt.sign(
      { id: vendor.id, email: vendor.email, role: vendor.role },
      JWT_SECRET,
      { expiresIn: '4h' }
    );
    const newRefresh = jwt.sign(
      { id: vendor.id },
      JWT_SECRET + '_refresh',
      { expiresIn: '30d' }
    );

    res.cookie('token', newToken, COOKIE_OPTS);
    res.cookie('refresh_token', newRefresh, REFRESH_COOKIE_OPTS);
    res.json({ token: newToken });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// AUTH: CONFIRMAR EMAIL
// ============================================
app.post('/api/auth/confirm-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token obrigatório' });

    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('id, email, email_confirmed, email_confirm_expires')
      .eq('email_confirm_token', token)
      .maybeSingle();

    if (error || !vendor) return res.status(400).json({ error: 'Token inválido ou expirado' });
    if (vendor.email_confirmed) return res.json({ message: 'Email já confirmado' });
    if (vendor.email_confirm_expires && new Date() > new Date(vendor.email_confirm_expires)) {
      return res.status(400).json({ error: 'Token expirado. Solicite um novo link.' });
    }

    await supabase.from('vendors').update({
      email_confirmed: true,
      email_confirm_token: null,
      email_confirm_expires: null,
    }).eq('id', vendor.id);

    res.json({ message: 'Email confirmado com sucesso!' });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// AUTH: REENVIAR CONFIRMAÇÃO DE EMAIL
// ============================================
app.post('/api/auth/resend-confirmation', authLimiter, auth, async (req, res) => {
  try {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('email, name, email_confirmed')
      .eq('id', req.user.id)
      .single();

    if (!vendor) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (vendor.email_confirmed) return res.json({ message: 'Email já confirmado' });

    const confirmToken   = crypto.randomBytes(32).toString('hex');
    const confirmExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await supabase.from('vendors').update({
      email_confirm_token:   confirmToken,
      email_confirm_expires: confirmExpires.toISOString(),
    }).eq('id', req.user.id);

    const confirmUrl = `${FRONTEND_URL}?confirm_email=${confirmToken}`;
    await sendEmail({
      to:      vendor.email,
      subject: '✉️ Confirme seu email — Açaí Shop',
      html:    emailConfirmHtml(vendor.name, confirmUrl),
    });

    res.json({ message: 'Email de confirmação reenviado' });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// AUTH: ESQUECEU A SENHA
// ============================================
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  // Sempre retornar 200 para não vazar quais emails existem
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.json({ message: 'Se o email estiver cadastrado, você receberá um link em breve.' });
    }

    const { data: vendor } = await supabase
      .from('vendors')
      .select('id, name, email')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (vendor) {
      const resetToken   = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await supabase.from('vendors').update({
        password_reset_token:   resetToken,
        password_reset_expires: resetExpires.toISOString(),
      }).eq('id', vendor.id);

      const resetUrl = `${FRONTEND_URL}?reset_password=${resetToken}`;
      await sendEmail({
        to:      vendor.email,
        subject: '🔑 Redefinir senha — Açaí Shop',
        html:    passwordResetHtml(vendor.name, resetUrl),
      });
    }

    res.json({ message: 'Se o email estiver cadastrado, você receberá um link em breve.' });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ============================================
// AUTH: REDEFINIR SENHA
// ============================================
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token e nova senha obrigatórios' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha deve ter mínimo 8 caracteres' });

    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('id, password_reset_expires')
      .eq('password_reset_token', token)
      .maybeSingle();

    if (error || !vendor) return res.status(400).json({ error: 'Token inválido ou expirado' });
    if (vendor.password_reset_expires && new Date() > new Date(vendor.password_reset_expires)) {
      return res.status(400).json({ error: 'Link expirado. Solicite um novo.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await supabase.from('vendors').update({
      password:               hashed,
      password_reset_token:   null,
      password_reset_expires: null,
    }).eq('id', vendor.id);

    res.json({ message: 'Senha redefinida com sucesso!' });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Templates de email ─────────────────────────────────────────
function emailConfirmHtml(name, url) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:48px">🫐</span>
        <h1 style="color:#667eea;margin:8px 0 4px">Açaí Shop</h1>
      </div>
      <h2 style="color:#333">Olá, ${name}! Confirme seu email</h2>
      <p style="color:#555;line-height:1.6">Clique no botão abaixo para confirmar seu endereço de email e ativar sua conta:</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${url}" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">✉️ Confirmar meu email</a>
      </div>
      <p style="color:#999;font-size:13px">Este link expira em 24 horas. Se você não criou uma conta no Açaí Shop, ignore este email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:12px;text-align:center">© Açaí Shop · <a href="${FRONTEND_URL}" style="color:#bbb">app-acai-omega.vercel.app</a></p>
    </div>`;
}

function passwordResetHtml(name, url) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:48px">🫐</span>
        <h1 style="color:#667eea;margin:8px 0 4px">Açaí Shop</h1>
      </div>
      <h2 style="color:#333">Olá, ${name}! Redefinição de senha</h2>
      <p style="color:#555;line-height:1.6">Recebemos uma solicitação para redefinir a senha da sua conta. Clique abaixo para criar uma nova senha:</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${url}" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">🔑 Redefinir minha senha</a>
      </div>
      <p style="color:#999;font-size:13px">Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição de senha, ignore este email — sua senha não será alterada.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#bbb;font-size:12px;text-align:center">© Açaí Shop · <a href="${FRONTEND_URL}" style="color:#bbb">app-acai-omega.vercel.app</a></p>
    </div>`;
}

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

    const insertData = {
      vendor_id:    req.user.id,
      name,
      description:  nullify(description),
      price:        parsedPrice,
      category,
      calories:     nullify(calories),
      ingredients:  nullify(ingredients),
      allergens:    nullify(allergens),
    };
    // tenta inserir com 'emoji'; se a coluna não existir, tenta 'icon'
    let { data, error } = await supabase.from('products').insert({ ...insertData, emoji: nullify(emoji) || '🫐' }).select().single();
    if (error && error.message?.includes('emoji')) {
      ({ data, error } = await supabase.from('products').insert({ ...insertData, icon: nullify(emoji) || '🫐' }).select().single());
    }

    if (error) {
      console.error('Supabase insert product error:', error);
      return res.status(500).json({ error: error.message || 'Erro interno', detail: error.details || null });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/products error:', err);
    res.status(500).json({ error: err.message || 'Erro interno ao criar produto' });
  }
});

// ============================================
// PRODUTOS: ATUALIZAR (vendor)
// ============================================
app.put('/api/products/:id', [auth, planCheck], async (req, res) => {
  try {
    const allowed = ['name','description','price','category','emoji','icon','available','calories','ingredients','allergens'];
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

    let { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id)
      .select()
      .single();

    // se coluna 'emoji' não existe, tenta com 'icon'
    if (error && error.message?.includes('emoji') && updates.emoji !== undefined) {
      const { emoji, ...rest } = updates;
      ({ data, error } = await supabase
        .from('products')
        .update({ ...rest, icon: emoji })
        .eq('id', req.params.id)
        .eq('vendor_id', req.user.id)
        .select()
        .single());
    }

    if (error) { console.error('PUT /api/products error:', error); return res.status(500).json({ error: error.message }); }
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

    // Gerar número de pedido sequencial baseado em timestamp + 4 dígitos aleatórios
    const order_number = `#${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(1000 + Math.random() * 9000)}`;

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        order_number,
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

    // Notificação WhatsApp automática ao cliente (usando credenciais do vendor)
    if (customer.phone) {
      const trackingUrl = `${FRONTEND_URL}?loja=${vendor.slug}&pedido=${order.id}`;
      const { data: vCreds } = await supabase
        .from('vendors').select('zapi_instance_id, zapi_token, zapi_client_token').eq('id', vendor.id).single();
      sendWhatsApp(customer.phone, waMsgNovoPedido(
        customer.name, vendor.name, order.order_number, order.total,
        delivery_type, trackingUrl, vendor.pix_key || null
      ), { instanceId: vCreds?.zapi_instance_id, token: vCreds?.zapi_token, clientToken: vCreds?.zapi_client_token })
        .catch(() => {});
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
        const { data: v } = await supabase.from('vendors')
          .select('slug, zapi_instance_id, zapi_token, zapi_client_token')
          .eq('id', req.user.id).single();
        const trackingUrl = v?.slug ? `${FRONTEND_URL}?loja=${v.slug}&pedido=${data.id}` : FRONTEND_URL;
        const msgFn = WA_STATUS_MSG[status];
        const msg   = status === 'pronto'
          ? msgFn(data.customer_name, trackingUrl, data.delivery_type)
          : status === 'entregue' || status === 'cancelado'
            ? msgFn(data.customer_name)
            : msgFn(data.customer_name, trackingUrl);
        sendWhatsApp(data.customer_phone, msg, {
          instanceId: v?.zapi_instance_id, token: v?.zapi_token, clientToken: v?.zapi_client_token,
        }).catch(() => {});
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
    let { data, error } = await supabase
      .from('vendors')
      .select('deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url, zapi_instance_id, zapi_token, zapi_client_token, categories, business_type')
      .eq('id', req.user.id).single();
    if (error && (error.message?.includes('categories') || error.message?.includes('business_type'))) {
      ({ data, error } = await supabase
        .from('vendors')
        .select('deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url, zapi_instance_id, zapi_token, zapi_client_token')
        .eq('id', req.user.id).single());
    }
    if (error) return sbErr(error, res);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.patch('/api/vendors/settings', auth, async (req, res) => {
  try {
    const allowed = ['deliveries_enabled', 'slug', 'delivery_fee', 'pix_key', 'zapi_instance_id', 'zapi_token', 'zapi_client_token', 'categories'];
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

    if (updates.categories !== undefined) {
      if (!Array.isArray(updates.categories)) return res.status(400).json({ error: 'Categorias inválidas' });
      updates.categories = updates.categories.map(c => ({
        id: String(c.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || null,
        label: String(c.label || '').trim().slice(0, 60),
        emoji: String(c.emoji || '').trim().slice(0, 8),
        enabled: c.enabled !== false,
      })).filter(c => c.id && c.label);
    }

    // Tenta salvar com categories; se a coluna não existir, remove do update e retorna sem ela
    const selectWith    = 'deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url, zapi_instance_id, zapi_token, zapi_client_token, categories';
    const selectWithout = 'deliveries_enabled, slug, name, delivery_fee, pix_key, logo_url, zapi_instance_id, zapi_token, zapi_client_token';
    let { data, error } = await supabase
      .from('vendors').update(updates).eq('id', req.user.id).select(selectWith).single();
    if (error && error.message?.includes('categories')) {
      const { categories: _dropped, ...updatesWithout } = updates;
      ({ data, error } = await supabase
        .from('vendors').update(updatesWithout).eq('id', req.user.id).select(selectWithout).single());
    }
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

    // Buscar apenas os últimos 500 pedidos para as métricas — evita OOM com lojas grandes
    const { data: allOrders, error } = await supabase
      .from('orders')
      .select('id, total, status, payment_status, created_at, customer_name, order_number')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false })
      .limit(500);

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
const ALLOWED_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Detecta tipo de imagem pelos magic bytes sem depender do file-type package
function detectImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

app.put('/api/products/:id/upload-image', [auth, planCheck, express.raw({ type: '*/*', limit: '6mb' })], async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'Arquivo de imagem obrigatório' });

    // Validar tipo real pelos magic bytes
    const detectedMime = detectImageType(req.body);
    if (!detectedMime) {
      return res.status(400).json({ error: 'Tipo de arquivo inválido. Envie JPG, PNG, WEBP ou GIF.' });
    }

    const { data: product } = await supabase
      .from('products').select('id').eq('id', req.params.id).eq('vendor_id', req.user.id).single();
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

    const content_type = detectedMime;
    const ext  = ALLOWED_IMAGE_TYPES[content_type];
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
  } catch (err) {
    console.error('upload-image error:', err);
    res.status(500).json({ error: err.message || 'Erro interno ao fazer upload' });
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
const SUPABASE_STORAGE_HOST = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;

app.patch('/api/products/:id/image', [auth, planCheck], async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url obrigatória' });

    // Aceitar apenas URLs do próprio Supabase Storage
    try {
      const parsed = new URL(image_url);
      if (SUPABASE_STORAGE_HOST && parsed.hostname !== SUPABASE_STORAGE_HOST) {
        return res.status(400).json({ error: 'URL de imagem inválida' });
      }
    } catch {
      return res.status(400).json({ error: 'image_url inválida' });
    }
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

    const detectedMime2 = detectImageType(req.body);
    if (!detectedMime2) {
      return res.status(400).json({ error: 'Tipo de arquivo inválido. Envie JPG, PNG, WEBP ou GIF.' });
    }

    const content_type = detectedMime2;
    const ext  = ALLOWED_IMAGE_TYPES[content_type];
    const path = `${req.user.id}/logo.${ext}`;

    const { error: bErr } = await supabase.storage.getBucket('vendor-logos');
    if (bErr) await supabase.storage.createBucket('vendor-logos', { public: true, fileSizeLimit: 5242880 });

    const { error: uploadErr } = await supabase.storage.from('vendor-logos').upload(path, req.body, {
      contentType: detectedMime2,
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
