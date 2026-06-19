// ============================================
// SERVIDOR EXPRESS - AÇAÍ SHOP (Supabase/PostgreSQL)
// ============================================

const express      = require('express');
const cors         = require('cors');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const dotenv       = require('dotenv');
const cookieParser = require('cookie-parser');
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
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5001'],
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

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

// ── Helper: erro do Supabase ───────────────────
const sbErr = (error, res) => {
  console.error('Supabase error:', error);
  return res.status(500).json({ error: 'Erro interno' });
};

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
    // Lê do cookie httpOnly primeiro; Authorization header como fallback de API
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
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
// AUTH: SESSÃO ATUAL
// ============================================
app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user });
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
      { expiresIn: '24h' }
    );

    res.cookie('token', token, COOKIE_OPTS);
    res.status(201).json({ message: 'Vendor registrado com sucesso', vendor });
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
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
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
// PRODUTOS: LISTAR (público — só ativos)
// ============================================
app.get('/api/products', async (req, res) => {
  try {
    let query = supabase
      .from('products')
      .select('*')
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
app.get('/api/admin/products', auth, async (req, res) => {
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
app.post('/api/products', auth, async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Apenas vendors' });

    const { name, description, price, category, emoji, calories, ingredients, allergens } = req.body;
    if (!name || price == null || !category) return res.status(400).json({ error: 'Nome, preço e categoria são obrigatórios' });

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
app.put('/api/products/:id', auth, async (req, res) => {
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
app.delete('/api/products/:id', auth, async (req, res) => {
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
    const { items, customer, delivery_type, customer_notes } = req.body;

    if (!items?.length)      return res.status(400).json({ error: 'Pedido deve ter pelo menos 1 item' });
    if (!customer?.name)     return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    if (!delivery_type)      return res.status(400).json({ error: 'Tipo de entrega obrigatório' });

    // Buscar preços do banco — nunca confiar no preço enviado pelo cliente
    const productIds = items.map(i => i.product_id).filter(Boolean);
    if (productIds.length !== items.length)
      return res.status(400).json({ error: 'product_id obrigatório em todos os itens' });

    const { data: dbProducts, error: pErr } = await supabase
      .from('products')
      .select('id, name, price, emoji, available')
      .in('id', productIds)
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

    // Pegar o primeiro vendor ativo (MVP single-vendor)
    const { data: vendor, error: vErr } = await supabase
      .from('vendors')
      .select('id')
      .eq('status', 'active')
      .limit(1)
      .single();

    if (vErr || !vendor) return res.status(500).json({ error: 'Nenhum vendor disponível' });

    const subtotal     = validatedItems.reduce((s, i) => s + (i.price * i.quantity), 0);
    const delivery_fee = delivery_type === 'entrega' ? 5.00 : 0;
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

    res.json(data.map(normalizeOrder));
  } catch {
    res.status(500).json({ error: 'Erro interno ao listar pedidos' });
  }
});

// ============================================
// PEDIDOS: CONFIRMAR PAGAMENTO (vendor)
// ============================================
app.post('/api/orders/:id/confirm-payment', auth, async (req, res) => {
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
app.put('/api/orders/:id', auth, async (req, res) => {
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

    res.json({ message: 'Pedido atualizado', order: normalizeOrder(data) });
  } catch {
    res.status(500).json({ error: 'Erro interno ao atualizar pedido' });
  }
});

// ============================================
// PEDIDOS: ATRIBUIR ENTREGADOR (sem mudar status)
// ============================================
app.patch('/api/orders/:id/deliverer', auth, async (req, res) => {
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
app.post('/api/payments/confirm', auth, async (req, res) => {
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
// DASHBOARD ADMIN
// ============================================
app.get('/api/admin/dashboard', auth, async (req, res) => {
  try {
    if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Acesso negado' });

    const vendorId = req.user.id;

    const { data: allOrders, error } = await supabase
      .from('orders')
      .select('id, total, status, payment_status, created_at, customer_name, order_number')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) return sbErr(error, res);

    const today      = new Date(); today.setHours(0,0,0,0);
    const paidOrders = allOrders.filter(o => o.payment_status === 'pago');
    const totalRevenue  = paidOrders.reduce((s, o) => s + Number(o.total), 0);
    const averageTicket = paidOrders.length ? totalRevenue / paidOrders.length : 0;
    const ordersToday   = allOrders.filter(o => new Date(o.created_at) >= today).length;

    const byStatus = { aguardando_pagamento: 0, confirmado: 0, em_preparo: 0, pronto: 0, em_entrega: 0, entregue: 0, cancelado: 0 };
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
  } catch {
    res.status(500).json({ error: 'Erro interno no dashboard' });
  }
});

// ============================================
// ENTREGADORES: LISTAR
// ============================================
app.get('/api/deliverers', auth, async (req, res) => {
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
app.post('/api/deliverers', auth, async (req, res) => {
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
app.put('/api/deliverers/:id', auth, async (req, res) => {
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
app.delete('/api/deliverers/:id', auth, async (req, res) => {
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
app.get('/api/commissions', auth, async (req, res) => {
  try {
    const { start, end } = req.query;
    let query = supabase
      .from('orders')
      .select('id, order_number, total, delivery_fee, deliverer_id, deliverer_commission, status, created_at, customer_name')
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
      const deliveries       = orders.filter(o => o.deliverer_id === d.id);
      const total_commission = deliveries.reduce((s, o) => s + Number(o.deliverer_commission || 0), 0);
      return { ...d, deliveries: deliveries.length, total_commission: total_commission.toFixed(2), orders: deliveries };
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
