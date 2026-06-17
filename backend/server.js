// ============================================
// SERVIDOR EXPRESS - AÇAÍ SHOP (Supabase/PostgreSQL)
// ============================================

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const dotenv   = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

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
  origin: [FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// ── Rate limiting simples ──────────────────────
const hits = new Map();
app.use((req, res, next) => {
  const ip  = req.ip;
  const now = Date.now();
  const win = 15 * 60 * 1000;
  const max = 300;
  const d   = hits.get(ip);
  if (!d || now - d.start > win) { hits.set(ip, { count: 1, start: now }); }
  else if (d.count++ > max) return res.status(429).json({ error: 'Muitas requisições. Aguarde 15 minutos.' });
  next();
});

// ── Helper: erro do Supabase ───────────────────
const sbErr = (error, res) => {
  console.error('Supabase error:', error);
  return res.status(500).json({ error: error.message || 'Erro interno' });
};

// ============================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ============================================
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  const { error } = await supabase.from('vendors').select('id').limit(1);
  res.json({
    status: 'ok',
    supabase: error ? 'erro' : 'conectado',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// AUTH: REGISTRO
// ============================================
app.post('/api/auth/register-vendor', async (req, res) => {
  try {
    const { email, password, name, phone, address, cpf } = req.body;

    if (!email || !password || !name || !phone || !address || !cpf)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Senha deve ter mínimo 8 caracteres' });

    // Verificar duplicatas
    const { data: existing } = await supabase
      .from('vendors')
      .select('id')
      .or(`email.eq.${email},cpf.eq.${cpf}`)
      .maybeSingle();

    if (existing) return res.status(400).json({ error: 'Email ou CPF já cadastrado' });

    const hashed = await bcrypt.hash(password, 12);

    const { data: vendor, error } = await supabase
      .from('vendors')
      .insert({ email, password: hashed, name, phone, address, cpf })
      .select('id, email, name, role')
      .single();

    if (error) return sbErr(error, res);

    const token = jwt.sign(
      { id: vendor.id, email: vendor.email, role: vendor.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ message: 'Vendor registrado com sucesso', token, vendor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// AUTH: LOGIN
// ============================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const { data: user, error } = await supabase
      .from('vendors')
      .select('*')
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
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login bem-sucedido',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUTOS: LISTAR (público)
// ============================================
app.get('/api/products', async (req, res) => {
  try {
    let query = supabase
      .from('products')
      .select('*')
      .eq('available', true)
      .order('created_at', { ascending: false });

    if (req.query.category) query = query.eq('category', req.query.category);

    const { data, error } = await query;
    if (error) return sbErr(error, res);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUTOS: CRIAR (vendor)
// ============================================
app.post('/api/products', auth, async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Apenas vendors' });

    const { name, description, price, category, emoji, calories, ingredients, allergens } = req.body;
    if (!name || !price || !category) return res.status(400).json({ error: 'Nome, preço e categoria são obrigatórios' });

    const { data, error } = await supabase
      .from('products')
      .insert({ vendor_id: req.user.id, name, description, price, category, emoji, calories, ingredients, allergens })
      .select()
      .single();

    if (error) return sbErr(error, res);
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUTOS: ATUALIZAR (vendor)
// ============================================
app.put('/api/products/:id', auth, async (req, res) => {
  try {
    const allowed = ['name','description','price','category','emoji','available','calories','ingredients','allergens'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PRODUTOS: DELETAR (vendor)
// ============================================
app.delete('/api/products/:id', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('vendor_id', req.user.id);

    if (error) return sbErr(error, res);
    res.json({ message: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PEDIDOS: CRIAR (público — cliente faz pedido)
// ============================================
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, delivery_type, customer_notes } = req.body;

    if (!items?.length)      return res.status(400).json({ error: 'Pedido deve ter pelo menos 1 item' });
    if (!customer?.name)     return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    if (!delivery_type)      return res.status(400).json({ error: 'Tipo de entrega obrigatório' });

    // Pegar o primeiro vendor ativo (MVP single-vendor)
    const { data: vendor, error: vErr } = await supabase
      .from('vendors')
      .select('id')
      .eq('status', 'active')
      .limit(1)
      .single();

    if (vErr || !vendor) return res.status(500).json({ error: 'Nenhum vendor disponível' });

    const subtotal     = items.reduce((s, i) => s + (i.price * (i.quantity || 1)), 0);
    const delivery_fee = delivery_type === 'entrega' ? 5.00 : 0;
    const total        = subtotal + delivery_fee;

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        order_number:        '',     // trigger preenche automaticamente
        vendor_id:           vendor.id,
        customer_name:       customer.name,
        customer_email:      customer.email || null,
        customer_phone:      customer.phone || null,
        customer_street:     customer.address?.street || null,
        customer_number:     customer.address?.number || null,
        customer_neighborhood: customer.address?.neighborhood || null,
        customer_city:       customer.address?.city || null,
        customer_state:      customer.address?.state || null,
        customer_zip:        customer.address?.zip_code || null,
        items,
        subtotal,
        delivery_fee,
        total,
        delivery_type,
        customer_notes:      customer_notes || null,
      })
      .select()
      .single();

    if (error) return sbErr(error, res);

    res.status(201).json({
      message: 'Pedido criado com sucesso',
      order: {
        ...order,
        preparation_time: delivery_type === 'retirada' ? '20–25 min' : '30–40 min'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PEDIDOS: LISTAR (vendor)
// ============================================
app.get('/api/orders', auth, async (req, res) => {
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

    // Normaliza para o frontend (customer como objeto)
    res.json(data.map(normalizeOrder));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PEDIDOS: ATUALIZAR STATUS (vendor)
// ============================================
app.put('/api/orders/:id', auth, async (req, res) => {
  try {
    const VALID = ['confirmado','em_preparo','pronto','em_entrega','entregue','cancelado'];
    const { status, vendor_notes } = req.body;
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Status inválido' });

    const updates = { status, vendor_notes: vendor_notes || null };
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

    res.json({ message: 'Pedido atualizado', order: normalizeOrder(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAGAMENTOS: criar intenção (simulado)
// ============================================
app.post('/api/payments/create-intent', async (req, res) => {
  try {
    const { order_id, amount, email } = req.body;
    if (!order_id || !amount) return res.status(400).json({ error: 'order_id e amount obrigatórios' });

    // TODO: descomente quando tiver chave live do Stripe
    // const stripe = require('stripe')(process.env.STRIPE_KEY);
    // const intent = await stripe.paymentIntents.create({
    //   amount: Math.round(amount * 100), currency: 'brl',
    //   receipt_email: email, metadata: { order_id }
    // });
    // return res.json({ client_secret: intent.client_secret, payment_id: intent.id });

    res.json({
      client_secret:   `pi_simulated_${Date.now()}`,
      payment_id:      `pay_${Date.now()}`,
      publishable_key: process.env.STRIPE_PUBLIC_KEY
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAGAMENTOS: confirmar
// ============================================
app.post('/api/payments/confirm', async (req, res) => {
  try {
    const { payment_id, order_id } = req.body;

    const { data, error } = await supabase
      .from('orders')
      .update({ payment_status: 'pago', payment_id })
      .eq('id', order_id)
      .select()
      .single();

    if (error) return sbErr(error, res);
    res.json({ message: 'Pagamento confirmado', order: normalizeOrder(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DASHBOARD ADMIN
// ============================================
app.get('/api/admin/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Acesso negado' });

    const vendorId = req.user.id;

    // Todos os pedidos do vendor
    const { data: allOrders, error } = await supabase
      .from('orders')
      .select('id, total, status, payment_status, created_at, customer_name, order_number')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) return sbErr(error, res);

    const today     = new Date(); today.setHours(0,0,0,0);
    const paidOrders = allOrders.filter(o => o.payment_status === 'pago');
    const totalRevenue  = paidOrders.reduce((s, o) => s + Number(o.total), 0);
    const averageTicket = paidOrders.length ? totalRevenue / paidOrders.length : 0;
    const ordersToday   = allOrders.filter(o => new Date(o.created_at) >= today).length;

    const byStatus = { confirmado: 0, em_preparo: 0, pronto: 0, em_entrega: 0, entregue: 0, cancelado: 0 };
    allOrders.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });

    res.json({
      totalOrders:    allOrders.length,
      totalRevenue:   totalRevenue.toFixed(2),
      averageTicket:  averageTicket.toFixed(2),
      ordersToday,
      ordersByStatus: byStatus,
      recentOrders:   allOrders.slice(0, 10).map(o => ({
        ...o,
        customer: { name: o.customer_name }
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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