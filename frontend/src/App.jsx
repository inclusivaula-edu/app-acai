import React, { useState, useEffect } from 'react';
import { ShoppingCart, LogOut, Lock } from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const PLAN_ERROR_CODES = new Set(['TRIAL_EXPIRED', 'PLAN_INACTIVE', 'PLAN_EXPIRED', 'TRIAL_LIMIT']);

// Token em memória — mais confiável que cookie cross-origin em alguns ambientes
let authToken = null;

// Slug da loja lido uma vez da URL ao carregar a página
let vendorSlug = new URLSearchParams(window.location.search).get('loja') || null;

const apiFetch = async (path, options = {}) => {
  const { headers: extraHeaders, ...rest } = options;
  const authHeaders = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...extraHeaders },
    ...rest,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Erro na requisição');
    err.code = data.code;
    throw err;
  }
  return data;
};

const STATUS_LABELS = {
  aguardando_pagamento: '⏳ Aguard. Pagamento',
  confirmado:           '✓ Confirmado',
  em_preparo:           '👨‍🍳 Em Preparo',
  pronto:               '✅ Pronto',
  em_entrega:           '🚚 Em Entrega',
  entregue:             '📦 Entregue',
  cancelado:            '✕ Cancelado',
};

const STATUS_COLORS = {
  aguardando_pagamento: { bg: '#fff8e1', color: '#f57f17' },
  confirmado:  { bg: '#f0e7ff', color: '#667eea' },
  em_preparo:  { bg: '#fff3e0', color: '#f39c12' },
  pronto:      { bg: '#e8f5e9', color: '#2ecc71' },
  em_entrega:  { bg: '#e3f2fd', color: '#3498db' },
  entregue:    { bg: '#e8f5e9', color: '#27ae60' },
  cancelado:   { bg: '#ffebee', color: '#c62828' },
};

const PAYMENT_OPTIONS = [
  { value: 'PIX',      label: '📱 PIX',              desc: 'Chave enviada após o pedido' },
  { value: 'Dinheiro', label: '💵 Dinheiro',          desc: 'Na retirada ou entrega' },
  { value: 'Cartão',   label: '💳 Cartão na entrega', desc: 'Máquina na entrega' },
];

const Alert = ({ msg, type }) => {
  if (!msg) return null;
  const styles = type === 'error'
    ? { background: '#ffebee', color: '#c62828' }
    : { background: '#e8f5e9', color: '#2e7d32' };
  return (
    <div style={{ ...styles, padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', fontWeight: '500' }}>
      {msg}
    </div>
  );
};

const Btn = ({ children, onClick, type = 'button', disabled, variant = 'primary', style = {} }) => {
  const base = { border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, transition: 'opacity 0.2s', padding: '12px 20px' };
  const variants = {
    primary:   { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' },
    secondary: { background: '#f5f5f5', color: '#555' },
    danger:    { background: '#ffebee', color: '#c62828' },
    success:   { background: '#e8f5e9', color: '#2e7d32' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
};

const Input = ({ label, id, ...props }) => (
  <div style={{ marginBottom: '15px' }}>
    {label && <label htmlFor={id} style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#444', fontSize: '14px' }}>{label}</label>}
    <input
      id={id}
      {...props}
      style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
    />
  </div>
);

const Select = ({ label, id, children, ...props }) => (
  <div style={{ marginBottom: '15px' }}>
    {label && <label htmlFor={id} style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#444', fontSize: '14px' }}>{label}</label>}
    <select id={id} {...props} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', background: '#fff' }}>
      {children}
    </select>
  </div>
);

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]           = useState(vendorSlug ? 'menu' : 'login');
  const [storeInfo, setStoreInfo]     = useState(null);
  const [user, setUser]               = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [products, setProducts]       = useState([]);
  const [cart, setCart]               = useState([]);
  const [orders, setOrders]           = useState([]);
  const [dashboard, setDashboard]     = useState(null);
  const [deliverers, setDeliverers]   = useState([]);
  const [commissions, setCommissions] = useState(null);
  const [vendorSettings, setVendorSettings] = useState({ deliveries_enabled: true });
  const [plans, setPlans]             = useState([]);
  const [planStatus, setPlanStatus]   = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('base');
  const [loading, setLoading]         = useState(false);
  const [alert, setAlert]             = useState({ msg: '', type: '' });
  const [lastOrder, setLastOrder]     = useState(null);

  const [customerName, setCustomerName]   = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('PIX');

  // estados tela produtos-admin
  const [editingProduct, setEditingProduct] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', category: 'base', emoji: '🫐', calories: '', ingredients: '', allergens: '' });

  // estados tela deliverers-admin
  const [showDelivererForm, setShowDelivererForm] = useState(false);
  const [editingDel, setEditingDel] = useState(null);
  const [delivererForm, setDelivererForm] = useState({ name: '', phone: '', cpf: '', vehicle: '', commission_rate: '10' });

  const showAlert = (msg, type = 'error') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert({ msg: '', type: '' }), 4000);
  };

  const handleFetchError = (err) => {
    if (PLAN_ERROR_CODES.has(err.code)) {
      showAlert(err.message, 'error');
      setScreen('plans');
      return true;
    }
    return false;
  };

  // Carregar info da loja, produtos e restaurar sessão
  useEffect(() => {
    if (vendorSlug) {
      apiFetch(`/store/${vendorSlug}`)
        .then(info => { setStoreInfo(info); fetchProducts(); })
        .catch(() => setStoreInfo(false));
    }
    apiFetch('/plans').then(setPlans).catch(() => {});
    apiFetch('/auth/me')
      .then(data => {
        if (data.token) authToken = data.token;
        setUser(data.user);
        // Sem loja na URL e já autenticado como vendor → vai direto pro admin
        if (!vendorSlug && data.user?.role === 'vendor') setScreen('admin');
      })
      .catch(() => {})
      .finally(() => setSessionLoaded(true));

    // Tratar retorno do Stripe Checkout
    const params = new URLSearchParams(window.location.search);
    if (params.get('plan_success')) {
      window.history.replaceState({}, '', window.location.pathname);
      setScreen('admin');
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'vendor') return;
    fetchOrders();
    fetchDashboard();
    fetchDeliverers();
    apiFetch('/plans/status').then(setPlanStatus).catch(() => {});
    fetchVendorSettings();
  }, [user]);

  useEffect(() => {
    if (!user || !['admin', 'orders-admin'].includes(screen)) return;
    const interval = setInterval(() => { fetchOrders(); fetchDashboard(); }, 30000);
    return () => clearInterval(interval);
  }, [user, screen]);

  const fetchProducts = async () => {
    if (!vendorSlug) return;
    try {
      const data = await apiFetch(`/products?loja=${vendorSlug}`);
      setProducts(data.map(p => ({ ...p, id: p._id || p.id, icon: p.emoji || p.icon || '🫐' })));
    } catch { showAlert('Erro ao carregar produtos'); }
  };

  const fetchOrders = async () => {
    try {
      const data = await apiFetch('/orders');
      setOrders(Array.isArray(data) ? data.map(o => ({ ...o, id: o._id || o.id })) : []);
    } catch (err) { handleFetchError(err); }
  };

  const fetchDashboard = async () => {
    try {
      const data = await apiFetch('/admin/dashboard');
      setDashboard(data);
    } catch (err) { handleFetchError(err); }
  };

  const fetchDeliverers = async () => {
    try {
      const data = await apiFetch('/deliverers');
      setDeliverers(Array.isArray(data) ? data : []);
    } catch (err) { handleFetchError(err); }
  };

  const fetchVendorSettings = async () => {
    try {
      const data = await apiFetch('/vendors/settings');
      setVendorSettings(data);
    } catch { /* silencioso */ }
  };

  const fetchAdminProducts = async () => {
    try {
      const data = await apiFetch('/admin/products');
      setProducts(data.map(p => ({ ...p, id: p.id, icon: p.emoji || '🫐' })));
    } catch (err) { if (!handleFetchError(err)) showAlert('Erro ao carregar produtos: ' + err.message); }
  };

  const subscribePlan = async (plan_id) => {
    setLoading(true);
    try {
      const data = await apiFetch('/plans/subscribe', { method: 'POST', body: JSON.stringify({ plan_id }) });
      window.location.href = data.url;
    } catch (err) { showAlert(err.message || 'Erro ao iniciar assinatura'); setLoading(false); }
  };

  const openPortal = async () => {
    try {
      const data = await apiFetch('/plans/portal', { method: 'POST' });
      window.location.href = data.url;
    } catch (err) { showAlert(err.message || 'Erro ao abrir portal'); }
  };

  const fetchCommissions = async () => {
    try {
      const data = await apiFetch('/commissions');
      setCommissions(data);
    } catch { showAlert('Erro ao carregar comissões'); }
  };

  const logout = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    authToken = null;
    setUser(null); setOrders([]); setDashboard(null);
    setScreen('menu');
  };

  // ─── LOGIN ───────────────────────────────────────────────────────────────────
  if (screen === 'login') {
    const handleLogin = async (e) => {
      e.preventDefault(); setLoading(true);
      try {
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: e.target.email.value, password: e.target.password.value }),
        });
        if (data.token) authToken = data.token;
        setUser(data.user);
        setScreen(data.user.role === 'vendor' ? 'admin' : 'menu');
      } catch (err) { showAlert(err.message || 'Email ou senha incorretos'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔐</div>
            <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>Área do Lojista</h1>
          </div>
          <Alert msg={alert.msg} type={alert.type} />
          <form onSubmit={handleLogin}>
            <Input label="Email" id="email" name="email" type="email" required placeholder="seu@email.com" />
            <Input label="Senha" id="password" name="password" type="password" required placeholder="••••••••" />
            <Btn type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Entrando...' : 'Entrar'}</Btn>
          </form>
          {vendorSlug && (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button onClick={() => setScreen('menu')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px' }}>← Voltar ao Cardápio</button>
            </div>
          )}
          <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <span style={{ fontSize: '14px', color: '#999' }}>Não tem conta? </span>
            <button onClick={() => setScreen('register')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>Criar conta grátis</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── MENU (público) ───────────────────────────────────────────────────────────
  if (screen === 'menu') {
    if (!vendorSlug || storeInfo === false) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', padding: '40px 20px' }}>
          <div style={{ textAlign: 'center', background: '#fff', borderRadius: '16px', padding: '48px 40px', maxWidth: '400px', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>😕</div>
            <h2 style={{ color: '#333', marginBottom: '8px' }}>Loja não encontrada</h2>
            <p style={{ color: '#999', fontSize: '14px' }}>O link que você acessou não corresponde a nenhuma loja ativa.</p>
            <button onClick={() => setScreen('login')} style={{ marginTop: '24px', background: 'none', border: '1px solid #ddd', color: '#667eea', cursor: 'pointer', padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold' }}>Área do Lojista</button>
          </div>
        </div>
      );
    }
    if (!storeInfo) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#999', fontSize: '16px' }}>Carregando loja...</div>
        </div>
      );
    }
    const addToCart = (product) => {
      setCart(prev => {
        const existing = prev.find(i => i.id === product.id);
        if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
        return [...prev, { ...product, quantity: 1 }];
      });
      showAlert(`${product.name} adicionado! 🛒`, 'success');
    };
    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    const totalPrice = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <div style={{ background: '#fff', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ margin: 0, fontSize: '22px', color: '#667eea' }}>🫐 {storeInfo?.name || 'Açaí Shop'}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {user?.role === 'vendor' && (
                <>
                  <button onClick={() => setScreen('admin')} style={{ background: '#f0e7ff', border: 'none', color: '#667eea', cursor: 'pointer', padding: '7px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold' }}>📊 Admin</button>
                  <button onClick={() => setScreen('plans')} style={{ background: 'none', border: '1px solid #ddd', color: '#667eea', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>Ver Planos</button>
                </>
              )}
              {user ? (
                <button onClick={logout} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px' }}><LogOut size={14} /> Sair</button>
              ) : (
                <button onClick={() => setScreen('login')} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}><Lock size={12} /> Lojista</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '12px 20px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: '10px', overflowX: 'auto' }}>
            {[['base', '🫐 Açaís'], ['bebidas', '🥤 Bebidas'], ['adicionais', '➕ Adicionais']].map(([cat, label]) => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
                padding: '8px 20px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap',
                border: selectedCategory === cat ? '2px solid #667eea' : '1px solid #ddd',
                background: selectedCategory === cat ? '#f0e7ff' : '#fff',
                color: selectedCategory === cat ? '#667eea' : '#666',
              }}>{label}</button>
            ))}
          </div>
        </div>
        {alert.msg && (
          <div style={{ maxWidth: '1200px', margin: '16px auto 0', padding: '0 20px' }}>
            <Alert msg={alert.msg} type={alert.type} />
          </div>
        )}
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px' }}>
          {products.filter(p => p.category === selectedCategory && p.available !== false).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🫐</div>
              <p>Carregando produtos...</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
              {products.filter(p => p.category === selectedCategory && p.available !== false).map(product => (
                <div key={product.id} style={{ background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
                  <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: '52px' }}>{product.icon}</span>}
                  </div>
                  <div style={{ padding: '16px' }}>
                    <h3 style={{ margin: '0 0 4px 0', color: '#333', fontSize: '16px' }}>{product.name}</h3>
                    <p style={{ margin: '0 0 12px 0', color: '#999', fontSize: '13px', lineHeight: '1.4' }}>{product.description || product.desc}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#667eea' }}>R$ {product.price.toFixed(2)}</span>
                      <Btn onClick={() => addToCart(product)} style={{ padding: '8px 16px', fontSize: '14px' }}>+ Adicionar</Btn>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {totalItems > 0 && (
          <div onClick={() => setScreen('cart')} style={{
            position: 'fixed', bottom: '24px', right: '24px',
            background: '#667eea', color: '#fff', padding: '16px 24px',
            borderRadius: '12px', boxShadow: '0 8px 24px rgba(102,126,234,0.4)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <ShoppingCart size={22} />
            <div>
              <div style={{ fontSize: '13px', opacity: 0.9 }}>{totalItems} {totalItems === 1 ? 'item' : 'itens'}</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>R$ {totalPrice.toFixed(2)}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── CARRINHO ─────────────────────────────────────────────────────────────────
  if (screen === 'cart') {
    const updateQty = (id, delta) => setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));
    const removeItem = (id) => setCart(prev => prev.filter(i => i.id !== id));
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <button onClick={() => setScreen('menu')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '16px', fontWeight: 'bold', fontSize: '15px' }}>← Voltar ao Cardápio</button>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h2 style={{ marginTop: 0, marginBottom: '20px' }}>🛒 Carrinho ({cart.length} {cart.length === 1 ? 'item' : 'itens'})</h2>
            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛒</div>
                <p>Seu carrinho está vazio</p>
                <Btn onClick={() => setScreen('menu')}>Ver Cardápio</Btn>
              </div>
            ) : (
              <>
                {cart.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#333' }}>{item.icon} {item.name}</div>
                      <div style={{ fontSize: '13px', color: '#999', marginTop: '2px' }}>R$ {item.price.toFixed(2)} cada</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f5f5f5', borderRadius: '8px', padding: '4px 8px' }}>
                        <button onClick={() => updateQty(item.id, -1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#667eea', fontWeight: 'bold', lineHeight: 1 }}>−</button>
                        <span style={{ fontWeight: 'bold', minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                        <button onClick={() => updateQty(item.id, +1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#667eea', fontWeight: 'bold', lineHeight: 1 }}>+</button>
                      </div>
                      <span style={{ fontWeight: 'bold', color: '#667eea', minWidth: '70px', textAlign: 'right' }}>R$ {(item.price * item.quantity).toFixed(2)}</span>
                      <button onClick={() => removeItem(item.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                    </div>
                  </div>
                ))}
                <div style={{ background: '#f0e7ff', padding: '16px', borderRadius: '8px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 'bold', color: '#667eea' }}>
                  <span>Total:</span><span>R$ {total.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                  <Btn onClick={() => setScreen('checkout')} style={{ width: '100%' }}>Finalizar Pedido</Btn>
                  <Btn variant="secondary" onClick={() => setCart([])} style={{ width: '100%' }}>Limpar Carrinho</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── CHECKOUT ─────────────────────────────────────────────────────────────────
  if (screen === 'checkout') {
    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const deliveryFee = 5.00;
    const handleCheckout = async (deliveryType) => {
      if (!customerName.trim()) { showAlert('Informe seu nome'); return; }
      if (!customerPhone.trim()) { showAlert('Informe seu WhatsApp'); return; }
      setLoading(true);
      try {
        const data = await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })),
            customer: { name: customerName.trim(), email: customerEmail.trim(), phone: customerPhone.trim() },
            delivery_type: deliveryType,
            customer_notes: `Pagamento: ${paymentMethod}`,
            vendor_slug: vendorSlug,
          }),
        });
        setLastOrder(data.order);
        setCart([]); setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
        setScreen('confirmation');
      } catch (err) { showAlert(err.message || 'Erro ao criar pedido'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <button onClick={() => setScreen('cart')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '16px', fontWeight: 'bold', fontSize: '15px' }}>← Voltar</button>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h2 style={{ marginTop: 0 }}>Finalizar Pedido</h2>
            <Alert msg={alert.msg} type={alert.type} />
            <h3 style={{ color: '#555', fontSize: '15px', marginBottom: '12px' }}>Seus dados</h3>
            <Input label="Nome *" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="João Silva" />
            <Input label="WhatsApp *" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(11) 98765-4321" />
            <Input label="Email (opcional)" type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="joao@email.com" />
            <h3 style={{ color: '#555', fontSize: '15px', margin: '20px 0 12px' }}>Como vai pagar?</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
              {PAYMENT_OPTIONS.map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', border: paymentMethod === opt.value ? '2px solid #667eea' : '1px solid #ddd', background: paymentMethod === opt.value ? '#f0e7ff' : '#fafafa' }}>
                  <input type="radio" name="payment" value={opt.value} checked={paymentMethod === opt.value} onChange={() => setPaymentMethod(opt.value)} style={{ accentColor: '#667eea' }} />
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#333' }}>{opt.label}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ background: '#f9f9f9', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#555' }}>Resumo</h4>
              {cart.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                  <span>{item.name} × {item.quantity}</span><span>R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '8px', marginTop: '8px', fontSize: '13px', color: '#666' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span>Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}><span>Taxa de entrega</span><span>R$ {deliveryFee.toFixed(2)}</span></div>
              </div>
            </div>
            <h3 style={{ color: '#555', fontSize: '15px', marginBottom: '12px' }}>Como quer receber?</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button onClick={() => handleCheckout('retirada')} disabled={loading} style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none', padding: '20px', borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: loading ? 0.6 : 1, textAlign: 'center' }}>
                🕐 Retirada<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.9 }}>20–25 min • Grátis</span>
              </button>
              <button onClick={() => handleCheckout('entrega')} disabled={loading} style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: '#fff', border: 'none', padding: '20px', borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: loading ? 0.6 : 1, textAlign: 'center' }}>
                🚚 Entrega<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.9 }}>30–40 min • +R$ {deliveryFee.toFixed(2)}</span>
              </button>
            </div>
            <p style={{ fontSize: '11px', color: '#bbb', textAlign: 'center', marginTop: '16px', marginBottom: 0 }}>
              Ao fazer o pedido você concorda com os nossos{' '}
              <button onClick={() => setScreen('terms')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '11px', padding: 0, textDecoration: 'underline' }}>Termos de Uso</button>
              {' '}e{' '}
              <button onClick={() => setScreen('privacy')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '11px', padding: 0, textDecoration: 'underline' }}>Política de Privacidade</button>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── CONFIRMAÇÃO ─────────────────────────────────────────────────────────────
  if (screen === 'confirmation') {
    const isPix = paymentMethod === 'PIX';
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ color: '#2ecc71', marginBottom: '8px' }}>Pedido recebido!</h2>
          {lastOrder?.order_number && (
            <div style={{ background: '#f0e7ff', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', display: 'inline-block' }}>
              <span style={{ fontWeight: 'bold', color: '#667eea', fontSize: '18px' }}>{lastOrder.order_number}</span>
            </div>
          )}
          <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '16px', marginBottom: '20px', textAlign: 'left' }}>
            <div style={{ fontWeight: 'bold', color: '#f57f17', marginBottom: '4px' }}>⏳ Aguardando confirmação de pagamento</div>
            <div style={{ fontSize: '13px', color: '#555' }}>
              {isPix ? 'Assim que recebermos o PIX, confirmaremos seu pedido pelo WhatsApp e iniciaremos o preparo.' : 'Seu pedido será confirmado após a verificação do pagamento.'}
            </div>
          </div>
          {isPix && (
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '10px', padding: '16px', marginBottom: '20px', textAlign: 'left' }}>
              <div style={{ fontWeight: 'bold', color: '#2e7d32', marginBottom: '4px' }}>📱 Pagamento via PIX</div>
              <div style={{ fontSize: '13px', color: '#555' }}>Enviaremos a chave PIX pelo WhatsApp em instantes.</div>
            </div>
          )}
          <Btn onClick={() => setScreen('menu')} style={{ width: '100%' }}>Fazer novo pedido</Btn>
        </div>
      </div>
    );
  }

  // ─── PLANOS ───────────────────────────────────────────────────────────────────
  if (screen === 'plans') {
    const PLAN_INFO = {
      monthly:    { label: 'Mensal',    badge: null,              color: '#667eea' },
      semiannual: { label: 'Semestral', badge: 'Mais popular',    color: '#f39c12' },
      annual:     { label: 'Anual',     badge: 'Melhor custo',    color: '#2ecc71' },
    };
    const canceled = new URLSearchParams(window.location.search).get('plan_canceled');
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', padding: '40px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <button onClick={() => { window.history.replaceState({}, '', '/'); setScreen(user ? 'admin' : 'menu'); }} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', marginBottom: '32px', fontSize: '14px', fontWeight: 'bold' }}>← Voltar</button>

          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🫐</div>
            <h1 style={{ margin: 0, color: '#fff', fontSize: '32px' }}>Escolha seu plano</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', marginTop: '8px', fontSize: '16px' }}>Gerencie seu negócio de açaí com facilidade</p>
          </div>

          {canceled && (
            <div style={{ background: '#ffebee', color: '#c62828', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', textAlign: 'center', fontWeight: '500' }}>
              Assinatura cancelada. Você pode tentar novamente quando quiser.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
            {plans.map(plan => {
              const info = PLAN_INFO[plan.id] || {};
              const isActive = planStatus?.plan === plan.id && planStatus?.plan_status === 'active';
              return (
                <div key={plan.id} style={{ background: '#fff', borderRadius: '16px', padding: '32px 28px', textAlign: 'center', position: 'relative', boxShadow: info.badge ? '0 8px 32px rgba(0,0,0,0.2)' : '0 4px 16px rgba(0,0,0,0.12)', transform: info.badge ? 'scale(1.04)' : 'none' }}>
                  {info.badge && (
                    <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: info.color, color: '#fff', padding: '4px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                      {info.badge}
                    </div>
                  )}
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: info.color, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>{plan.name}</div>
                  <div style={{ fontSize: '42px', fontWeight: 'bold', color: '#333', lineHeight: 1 }}>
                    R$ {plan.price_monthly.toFixed(2).replace('.', ',')}
                  </div>
                  <div style={{ fontSize: '14px', color: '#999', marginBottom: '16px' }}>por mês</div>

                  {plan.months > 1 && (
                    <div style={{ background: '#f0f9f0', border: '1px solid #a5d6a7', borderRadius: '8px', padding: '8px 12px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', color: '#2e7d32', fontWeight: 'bold' }}>
                        Total: R$ {plan.total.toFixed(2).replace('.', ',')}
                      </div>
                      {plan.savings > 0 && (
                        <div style={{ fontSize: '12px', color: '#43a047' }}>
                          Economia de R$ {plan.savings.toFixed(2).replace('.', ',')} vs mensal
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '24px' }}>
                    Cobrado a cada {plan.months === 1 ? 'mês' : `${plan.months} meses`}
                  </div>

                  {isActive ? (
                    <div>
                      <div style={{ background: '#e8f5e9', color: '#2e7d32', padding: '10px', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}>✓ Plano Ativo</div>
                      <button onClick={openPortal} style={{ background: 'none', border: '1px solid #ddd', color: '#666', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        Gerenciar assinatura
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => user ? subscribePlan(plan.id) : setScreen('login')}
                      disabled={loading}
                      style={{ width: '100%', background: `linear-gradient(135deg, ${info.color}, ${info.color}dd)`, color: '#fff', border: 'none', padding: '14px', borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px', opacity: loading ? 0.7 : 1 }}
                    >
                      {user ? 'Assinar agora' : 'Entrar para assinar'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px', color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
            Pagamento seguro via Stripe · Cancele quando quiser
            <div style={{ marginTop: '8px' }}>
              <button onClick={() => setScreen('privacy')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline', marginRight: '12px' }}>Política de Privacidade</button>
              <button onClick={() => setScreen('terms')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>Termos de Uso</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── HEADER ADMIN ─────────────────────────────────────────────────────────────
  const AdminHeader = ({ active }) => (
    <div style={{ background: '#fff', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#667eea' }}>🫐 {user?.name || 'Admin'}</h1>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[['admin','📊 Dashboard'],['orders-admin','📦 Pedidos'],['products-admin','🛍️ Produtos'],['deliverers-admin','🚴 Entregadores'],['commissions-admin','💰 Comissões']].map(([s, label]) => (
            <button key={s} onClick={() => { setScreen(s); if (s === 'commissions-admin') fetchCommissions(); if (s === 'products-admin') fetchAdminProducts(); }} style={{
              background: active === s ? '#f0e7ff' : 'none', border: 'none', color: '#667eea',
              cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', padding: '7px 12px', borderRadius: '6px'
            }}>{label}</button>
          ))}
          <button onClick={() => {
            const slug = vendorSettings?.slug;
            if (slug) window.open(`${window.location.origin}${window.location.pathname}?loja=${slug}`, '_blank');
            else showAlert('Configure o link da loja primeiro (aba Entregadores → Link da Loja)', 'error');
          }} style={{ background: 'none', border: '1px solid #ddd', color: '#666', cursor: 'pointer', padding: '7px 12px', borderRadius: '6px', fontSize: '13px' }}>🔗 Ver Cardápio</button>
          <button onClick={() => setScreen('plans')} style={{ background: planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active' ? '#e8f5e9' : (planStatus?.trial_days_left ?? 99) <= 3 ? '#ffebee' : '#fff8e1', border: 'none', color: planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active' ? '#2e7d32' : (planStatus?.trial_days_left ?? 99) <= 3 ? '#c62828' : '#f57f17', cursor: 'pointer', padding: '7px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold' }}>
            {planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active'
              ? '✓ Plano Ativo'
              : planStatus?.plan === 'trial'
                ? `⏳ Trial: ${planStatus.trial_days_left ?? '?'}d`
                : '⚠️ Planos'}
          </button>
          <button onClick={logout} style={{ background: '#ffebee', border: 'none', color: '#c62828', cursor: 'pointer', padding: '7px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 'bold' }}>
            <LogOut size={14} /> Sair
          </button>
        </div>
      </div>
    </div>
  );

  // ─── ADMIN DASHBOARD ─────────────────────────────────────────────────────────
  if (screen === 'admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="admin" />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          {!dashboard ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>Carregando...</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                {[
                  { label: 'Total de Pedidos', value: dashboard.totalOrders, icon: '📦', color: '#667eea' },
                  { label: 'Receita Confirmada', value: `R$ ${dashboard.totalRevenue}`, icon: '✅', color: '#2ecc71' },
                  { label: 'Pendente (em aberto)', value: `R$ ${dashboard.pendingRevenue || '0.00'}`, icon: '⏳', color: '#f39c12' },
                  { label: 'Ticket Médio', value: `R$ ${dashboard.averageTicket}`, icon: '📈', color: '#667eea' },
                  { label: 'Pedidos Hoje', value: dashboard.ordersToday, icon: '📅', color: '#e74c3c' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${card.color}` }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>{card.icon}</div>
                    <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>{card.label}</div>
                    <div style={{ fontSize: '26px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Status dos Pedidos</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                  {Object.entries(dashboard.ordersByStatus || {}).map(([status, count]) => (
                    <div key={status} style={{ background: STATUS_COLORS[status]?.bg || '#f5f5f5', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', fontWeight: 'bold', color: STATUS_COLORS[status]?.color || '#333' }}>{count}</div>
                      <div style={{ color: '#666', marginTop: '4px', fontSize: '12px' }}>{STATUS_LABELS[status] || status}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <h3 style={{ marginTop: 0 }}>Pedidos Recentes</h3>
                {(!dashboard.recentOrders || dashboard.recentOrders.length === 0) ? (
                  <p style={{ color: '#999', textAlign: 'center', padding: '20px' }}>Nenhum pedido ainda</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #eee' }}>
                          {['Pedido', 'Cliente', 'Total', 'Status'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: '600', fontSize: '13px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.recentOrders.map((order, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 'bold', color: '#333', fontSize: '14px' }}>{order.order_number || order.id}</td>
                            <td style={{ padding: '10px 12px', color: '#666', fontSize: '14px' }}>{order.customer?.name || '—'}</td>
                            <td style={{ padding: '10px 12px', color: '#667eea', fontWeight: 'bold', fontSize: '14px' }}>R$ {Number(order.total).toFixed(2)}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: STATUS_COLORS[order.status]?.bg || '#f5f5f5', color: STATUS_COLORS[order.status]?.color || '#333', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                                {STATUS_LABELS[order.status] || order.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── ADMIN PEDIDOS ────────────────────────────────────────────────────────────
  if (screen === 'orders-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }

    const deleteOrder = async (orderId) => {
      if (!window.confirm('Remover este pedido permanentemente?')) return;
      try {
        await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
        showAlert('Pedido removido', 'success');
        fetchOrders(); fetchDashboard();
      } catch (err) { showAlert(err.message || 'Erro ao remover pedido'); }
    };

    const confirmPayment = async (orderId, delivererId) => {
      try {
        await apiFetch(`/orders/${orderId}/confirm-payment`, {
          method: 'POST',
          body: JSON.stringify({ deliverer_id: delivererId || null }),
        });
        showAlert('Pagamento confirmado! Pedido liberado para preparo.', 'success');
        fetchOrders(); fetchDashboard();
      } catch (err) { showAlert(err.message || 'Erro ao confirmar pagamento'); }
    };

    const updateStatus = async (orderId, newStatus) => {
      try {
        await apiFetch(`/orders/${orderId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: newStatus }),
        });
        showAlert('Pedido atualizado!', 'success');
        fetchOrders(); fetchDashboard();
      } catch (err) { showAlert(err.message || 'Erro ao atualizar pedido'); }
    };

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="orders-admin" />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          {orders.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '60px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
              <p style={{ color: '#999', fontSize: '16px' }}>Nenhum pedido registrado ainda</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {orders.map(order => (
                <div key={order.id} style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${STATUS_COLORS[order.status]?.color || '#ddd'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                    <div>
                      <h3 style={{ margin: 0, color: '#333', fontSize: '17px' }}>{order.order_number || order.id}</h3>
                      <p style={{ margin: '4px 0 0 0', color: '#999', fontSize: '13px' }}>{new Date(order.created_at).toLocaleString('pt-BR')}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#667eea' }}>R$ {Number(order.total).toFixed(2)}</div>
                      <span style={{ background: STATUS_COLORS[order.status]?.bg || '#f5f5f5', color: STATUS_COLORS[order.status]?.color || '#333', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                    </div>
                  </div>

                  <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', color: '#555' }}>
                    <div><strong>Cliente:</strong> {order.customer?.name || '—'}</div>
                    {order.customer?.phone && (
                      <div style={{ marginTop: '3px' }}>
                        <strong>WhatsApp:</strong>{' '}
                        <a href={`https://wa.me/55${order.customer.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" style={{ color: '#25d366', fontWeight: 'bold', textDecoration: 'none' }}>
                          {order.customer.phone} 💬
                        </a>
                      </div>
                    )}
                    <div style={{ marginTop: '3px' }}><strong>Tipo:</strong> {order.delivery_type === 'retirada' ? '🕐 Retirada' : '🚚 Entrega'}</div>
                    {order.customer_notes && <div style={{ marginTop: '3px', color: '#667eea' }}><strong>Pagamento:</strong> {order.customer_notes}</div>}
                    {order.delivery_type === 'entrega' && !['entregue','cancelado'].includes(order.status) && (
                      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>🚴 Entregador:</strong>
                        <select
                          defaultValue={order.deliverer_id || ''}
                          onChange={async (e) => {
                            try {
                              await apiFetch(`/orders/${order.id}/deliverer`, {
                                method: 'PATCH',
                                body: JSON.stringify({ deliverer_id: e.target.value || null }),
                              });
                              showAlert('Entregador atribuído!', 'success');
                              fetchOrders();
                            } catch (err) { showAlert(err.message); }
                          }}
                          style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', background: '#fff' }}
                        >
                          <option value="">— Não atribuído —</option>
                          {deliverers.filter(d => d.status === 'active').map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.commission_rate}%)</option>
                          ))}
                        </select>
                        {order.deliverer_id && order.deliverer_commission && (
                          <span style={{ color: '#2ecc71', fontWeight: 'bold', fontSize: '12px' }}>
                            Comissão: R$ {Number(order.deliverer_commission).toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                    {order.delivery_type === 'entrega' && ['entregue'].includes(order.status) && order.deliverer_id && (
                      <div style={{ marginTop: '6px', color: '#2ecc71', fontWeight: 'bold', fontSize: '13px' }}>
                        🚴 {deliverers.find(d => d.id === order.deliverer_id)?.name || 'Entregador'}
                        {order.deliverer_commission && ` — Comissão: R$ ${Number(order.deliverer_commission).toFixed(2)}`}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                    {(order.items || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#666', padding: '2px 0' }}>
                        <span>{item.emoji || '🫐'} {item.name} × {item.quantity || 1}</span>
                        <span>R$ {(item.price * (item.quantity || 1)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  {order.status === 'aguardando_pagamento' ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {order.delivery_type === 'entrega' && deliverers.filter(d => d.status === 'active').length > 0 && (
                        <select id={`del-${order.id}`} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px' }}>
                          <option value="">Sem entregador</option>
                          {deliverers.filter(d => d.status === 'active').map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.commission_rate}%)</option>
                          ))}
                        </select>
                      )}
                      <button onClick={() => {
                        const sel = document.getElementById(`del-${order.id}`);
                        confirmPayment(order.id, sel?.value || null);
                      }} style={{ background: 'linear-gradient(135deg, #2ecc71, #27ae60)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
                        ✅ Confirmar Pagamento Recebido
                      </button>
                      <button onClick={() => updateStatus(order.id, 'cancelado')} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                        ✕ Cancelar
                      </button>
                      <button onClick={() => deleteOrder(order.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }} title="Excluir pedido">
                        🗑️
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {['confirmado','em_preparo','pronto','em_entrega','entregue'].map(s => (
                        <button key={s} onClick={() => updateStatus(order.id, s)} disabled={order.status === s} style={{
                          background: order.status === s ? STATUS_COLORS[s]?.color || '#667eea' : '#f5f5f5',
                          color: order.status === s ? '#fff' : '#555',
                          border: 'none', padding: '7px 14px', borderRadius: '6px',
                          cursor: order.status === s ? 'default' : 'pointer',
                          fontWeight: 'bold', fontSize: '12px', opacity: order.status === s ? 1 : 0.75,
                        }}>{STATUS_LABELS[s]}</button>
                      ))}
                      {['cancelado','entregue'].includes(order.status) && (
                        <button onClick={() => deleteOrder(order.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }} title="Excluir pedido">
                          🗑️
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── ADMIN PRODUTOS ───────────────────────────────────────────────────────────
  if (screen === 'products-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }

    const openNew = () => { setProductForm({ name: '', description: '', price: '', category: 'base', emoji: '🫐', calories: '', ingredients: '', allergens: '' }); setEditingProduct(null); setShowProductForm(true); };
    const openEdit = (p) => { setProductForm({ name: p.name, description: p.description || '', price: p.price, category: p.category, emoji: p.icon || p.emoji || '🫐', calories: p.calories || '', ingredients: p.ingredients || '', allergens: p.allergens || '' }); setEditingProduct({ ...p }); setShowProductForm(true); };

    const uploadImage = async (productId, file) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 5MB)');
      const headers = { 'Content-Type': file.type };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/products/${productId}/upload-image`, {
        method: 'PUT',
        credentials: 'include',
        headers,
        body: file,
      });
      const data = await res.json().catch(() => ({ error: 'Erro no upload' }));
      if (!res.ok) throw new Error(data.error || 'Erro no upload');
      return data.image_url;
    };

    const saveProduct = async (e) => {
      e.preventDefault(); setLoading(true);
      try {
        const body = { ...productForm, price: parseFloat(productForm.price) };
        if (editingProduct) {
          await apiFetch(`/products/${editingProduct.id}`, { method: 'PUT', body: JSON.stringify(body) });
          showAlert('Produto atualizado!', 'success');
        } else {
          await apiFetch('/products', { method: 'POST', body: JSON.stringify(body) });
          showAlert('Produto criado!', 'success');
        }
        setShowProductForm(false); fetchAdminProducts();
      } catch (err) { showAlert('Erro: ' + err.message); }
      finally { setLoading(false); }
    };

    const toggleAvailable = async (p) => {
      try {
        await apiFetch(`/products/${p.id}`, { method: 'PUT', body: JSON.stringify({ available: !p.available }) });
        fetchAdminProducts();
      } catch (err) { showAlert('Erro: ' + err.message); }
    };

    const deleteProduct = async (id) => {
      if (!window.confirm('Remover produto?')) return;
      try {
        await apiFetch(`/products/${id}`, { method: 'DELETE' });
        showAlert('Produto removido', 'success'); fetchAdminProducts();
      } catch (err) { showAlert('Erro: ' + err.message); }
    };

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="products-admin" />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>🛍️ Produtos</h2>
            <Btn onClick={openNew}>+ Novo Produto</Btn>
          </div>

          {showProductForm && (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <h3 style={{ marginTop: 0 }}>{editingProduct ? 'Editar Produto' : 'Novo Produto'}</h3>
              <form onSubmit={saveProduct}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <Input label="Nome *" value={productForm.name} onChange={e => setProductForm(f => ({...f, name: e.target.value}))} required placeholder="Açaí Tradicional" />
                  <Input label="Preço *" type="number" step="0.01" value={productForm.price} onChange={e => setProductForm(f => ({...f, price: e.target.value}))} required placeholder="24.90" />
                  <Select label="Categoria *" value={productForm.category} onChange={e => setProductForm(f => ({...f, category: e.target.value}))}>
                    <option value="base">🫐 Açaís</option>
                    <option value="bebidas">🥤 Bebidas</option>
                    <option value="adicionais">➕ Adicionais</option>
                  </Select>
                  <Input label="Emoji" value={productForm.emoji} onChange={e => setProductForm(f => ({...f, emoji: e.target.value}))} placeholder="🫐" />
                </div>
                <Input label="Descrição" value={productForm.description} onChange={e => setProductForm(f => ({...f, description: e.target.value}))} placeholder="Açaí 500ml com granola e mel" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <Input label="Calorias" value={productForm.calories} onChange={e => setProductForm(f => ({...f, calories: e.target.value}))} placeholder="450 kcal" />
                  <Input label="Ingredientes" value={productForm.ingredients} onChange={e => setProductForm(f => ({...f, ingredients: e.target.value}))} placeholder="Açaí, granola, mel" />
                  <Input label="Alérgenos" value={productForm.allergens} onChange={e => setProductForm(f => ({...f, allergens: e.target.value}))} placeholder="Glúten, mel" />
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#444', fontSize: '14px' }}>Imagem do Produto</label>
                  {editingProduct?.image_url && (
                    <img src={editingProduct.image_url} alt="atual" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', marginBottom: '8px', display: 'block' }} />
                  )}
                  {editingProduct ? (
                    <input type="file" accept="image/*" onChange={async (e) => {
                      const file = e.target.files[0]; if (!file) return;
                      setLoading(true);
                      try {
                        const url = await uploadImage(editingProduct.id, file);
                        setEditingProduct(prev => ({ ...prev, image_url: url }));
                        showAlert('Imagem atualizada!', 'success');
                        fetchAdminProducts();
                      } catch (err) { showAlert('Erro no upload: ' + err.message); }
                      finally { setLoading(false); e.target.value = ''; }
                    }} style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  ) : (
                    <div style={{ fontSize: '13px', color: '#999', padding: '10px', background: '#f9f9f9', borderRadius: '8px' }}>Salve o produto primeiro para adicionar imagem.</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Btn type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Btn>
                  <Btn variant="secondary" onClick={() => setShowProductForm(false)}>Cancelar</Btn>
                </div>
              </form>
            </div>
          )}

          {['base','bebidas','adicionais'].map(cat => {
            const catProducts = products.filter(p => p.category === cat);
            if (!catProducts.length) return null;
            const catLabels = { base: '🫐 Açaís', bebidas: '🥤 Bebidas', adicionais: '➕ Adicionais' };
            return (
              <div key={cat} style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px', color: '#667eea' }}>{catLabels[cat]}</h3>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {catProducts.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f9f9f9', borderRadius: '8px', opacity: p.available === false ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '28px' }}>{p.icon}</span>
                        <div>
                          <div style={{ fontWeight: 'bold', color: '#333' }}>{p.name}</div>
                          <div style={{ fontSize: '13px', color: '#999' }}>{p.description}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontWeight: 'bold', color: '#667eea', fontSize: '16px' }}>R$ {Number(p.price).toFixed(2)}</span>
                        <button onClick={() => toggleAvailable(p)} style={{ background: p.available !== false ? '#e8f5e9' : '#ffebee', color: p.available !== false ? '#2e7d32' : '#c62828', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          {p.available !== false ? '✓ Ativo' : '✗ Pausado'}
                        </button>
                        <button onClick={() => openEdit(p)} style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>✏️ Editar</button>
                        <button onClick={() => deleteProduct(p.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>🗑️ Remover</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── ADMIN ENTREGADORES ───────────────────────────────────────────────────────
  if (screen === 'deliverers-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }

    const openNew = () => { setDelivererForm({ name: '', phone: '', cpf: '', vehicle: '', commission_rate: '10' }); setEditingDel(null); setShowDelivererForm(true); };
    const openEdit = (d) => { setDelivererForm({ name: d.name, phone: d.phone, cpf: d.cpf || '', vehicle: d.vehicle || '', commission_rate: d.commission_rate }); setEditingDel(d); setShowDelivererForm(true); };

    const saveDel = async (e) => {
      e.preventDefault(); setLoading(true);
      try {
        const body = { ...delivererForm, commission_rate: parseFloat(delivererForm.commission_rate) };
        if (editingDel) {
          await apiFetch(`/deliverers/${editingDel.id}`, { method: 'PUT', body: JSON.stringify(body) });
          showAlert('Entregador atualizado!', 'success');
        } else {
          await apiFetch('/deliverers', { method: 'POST', body: JSON.stringify(body) });
          showAlert('Entregador cadastrado!', 'success');
        }
        setShowDelivererForm(false); fetchDeliverers();
      } catch (err) { showAlert(err.message); }
      finally { setLoading(false); }
    };

    const toggleStatus = async (d) => {
      try {
        await apiFetch(`/deliverers/${d.id}`, { method: 'PUT', body: JSON.stringify({ status: d.status === 'active' ? 'inactive' : 'active' }) });
        fetchDeliverers();
      } catch (err) { showAlert(err.message); }
    };

    const deleteDel = async (id) => {
      if (!window.confirm('Remover entregador?')) return;
      try {
        await apiFetch(`/deliverers/${id}`, { method: 'DELETE' });
        showAlert('Entregador removido', 'success'); fetchDeliverers();
      } catch (err) { showAlert(err.message); }
    };

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="deliverers-admin" />
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />

          {/* Link da Loja */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '12px' }}>🔗 Link da sua loja</div>
            {vendorSettings?.slug ? (
              <div style={{ background: '#f0e7ff', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ color: '#667eea', fontSize: '14px', fontWeight: 'bold', wordBreak: 'break-all' }}>
                  {window.location.origin}{window.location.pathname}?loja={vendorSettings.slug}
                </span>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?loja=${vendorSettings.slug}`).then(() => showAlert('Link copiado!', 'success'))}
                    style={{ background: '#667eea', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
                  >📋 Copiar</button>
                  <button
                    onClick={async () => {
                      const input = window.prompt('Novo link (letras, números e hífens):', vendorSettings.slug);
                      if (!input) return;
                      try {
                        const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ slug: input }) });
                        setVendorSettings(prev => ({ ...prev, ...data }));
                        showAlert('Link atualizado!', 'success');
                      } catch (err) { showAlert(err.message || 'Erro ao atualizar link'); }
                    }}
                    style={{ background: '#f5f5f5', color: '#555', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
                  >✏️ Alterar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff8e1', borderRadius: '8px', padding: '12px 16px' }}>
                <span style={{ color: '#f57f17', fontSize: '14px' }}>⚠️ Link não configurado — clientes não conseguem acessar sua loja</span>
                <button
                  onClick={async () => {
                    const input = window.prompt('Digite o link da sua loja (letras, números e hífens):');
                    if (!input) return;
                    try {
                      const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ slug: input }) });
                      setVendorSettings(prev => ({ ...prev, ...data }));
                      showAlert('Link configurado!', 'success');
                    } catch (err) { showAlert(err.message || 'Erro ao configurar link'); }
                  }}
                  style={{ background: '#f57f17', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flexShrink: 0, marginLeft: '12px' }}
                >Configurar Link</button>
              </div>
            )}
            <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>Compartilhe este link com seus clientes para que eles acessem seu cardápio.</div>
          </div>

          {/* Configuração de entregas */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>🚚 Entregas a domicílio</div>
              <div style={{ fontSize: '13px', color: '#999', marginTop: '3px' }}>
                {vendorSettings?.deliveries_enabled !== false
                  ? 'Ativa — clientes podem escolher entrega'
                  : 'Desativada — somente retirada no local'}
              </div>
            </div>
            <button
              onClick={async () => {
                const next = vendorSettings?.deliveries_enabled === false;
                try {
                  const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ deliveries_enabled: next }) });
                  setVendorSettings(prev => ({ ...prev, ...data }));
                  showAlert(next ? 'Entregas ativadas!' : 'Entregas desativadas!', 'success');
                } catch (err) { showAlert(err.message); }
              }}
              style={{ background: vendorSettings?.deliveries_enabled !== false ? '#e8f5e9' : '#ffebee', color: vendorSettings?.deliveries_enabled !== false ? '#2e7d32' : '#c62828', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
            >
              {vendorSettings?.deliveries_enabled !== false ? '✓ Entregas Ativas' : '✗ Entregas Desativadas'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>🚴 Entregadores</h2>
            <Btn onClick={openNew}>+ Novo Entregador</Btn>
          </div>

          {showDelivererForm && (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <h3 style={{ marginTop: 0 }}>{editingDel ? 'Editar Entregador' : 'Novo Entregador'}</h3>
              <form onSubmit={saveDel}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <Input label="Nome *" value={delivererForm.name} onChange={e => setDelivererForm(f => ({...f, name: e.target.value}))} required placeholder="João da Silva" />
                  <Input label="Telefone *" value={delivererForm.phone} onChange={e => setDelivererForm(f => ({...f, phone: e.target.value}))} required placeholder="(11) 99999-0000" />
                  <Input label="CPF" value={delivererForm.cpf} onChange={e => setDelivererForm(f => ({...f, cpf: e.target.value}))} placeholder="000.000.000-00" />
                  <Input label="Veículo" value={delivererForm.vehicle} onChange={e => setDelivererForm(f => ({...f, vehicle: e.target.value}))} placeholder="Moto Honda CG 160" />
                  <Input label="Comissão sobre taxa de entrega (%)" type="number" step="0.1" min="0" max="100" value={delivererForm.commission_rate} onChange={e => setDelivererForm(f => ({...f, commission_rate: e.target.value}))} placeholder="10" />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <Btn type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Btn>
                  <Btn variant="secondary" onClick={() => setShowDelivererForm(false)}>Cancelar</Btn>
                </div>
              </form>
            </div>
          )}

          {deliverers.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '60px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚴</div>
              <p style={{ color: '#999' }}>Nenhum entregador cadastrado ainda</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {deliverers.map(d => (
                <div key={d.id} style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: d.status === 'inactive' ? 0.6 : 1 }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>🚴 {d.name}</div>
                    <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                      📱 {d.phone}
                      {d.vehicle && <span style={{ marginLeft: '12px' }}>🏍️ {d.vehicle}</span>}
                      {d.cpf && <span style={{ marginLeft: '12px' }}>CPF: {d.cpf}</span>}
                    </div>
                    <div style={{ fontSize: '13px', color: '#667eea', marginTop: '4px', fontWeight: 'bold' }}>Comissão: {d.commission_rate}% da taxa de entrega</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={() => toggleStatus(d)} style={{ background: d.status === 'active' ? '#e8f5e9' : '#ffebee', color: d.status === 'active' ? '#2e7d32' : '#c62828', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                      {d.status === 'active' ? '✓ Ativo' : '✗ Inativo'}
                    </button>
                    <button onClick={() => openEdit(d)} style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>✏️ Editar</button>
                    <button onClick={() => deleteDel(d.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── ADMIN COMISSÕES ──────────────────────────────────────────────────────────
  if (screen === 'commissions-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="commissions-admin" />
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          <h2 style={{ marginBottom: '24px' }}>💰 Comissões dos Entregadores</h2>

          {!commissions ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>Carregando...</div>
          ) : commissions.summary.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '60px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>💰</div>
              <p style={{ color: '#999' }}>Nenhuma comissão registrada ainda. As comissões são calculadas ao confirmar o pagamento de pedidos com entrega.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '28px' }}>
                {commissions.summary.map(d => (
                  <div key={d.id} style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: '4px solid #667eea' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '8px' }}>🚴 {d.name}</div>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>Taxa: {d.commission_rate}% · Entregas: <strong>{d.deliveries}</strong></div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e74c3c' }}>R$ {d.pending_commission}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>a pagar</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2ecc71' }}>R$ {d.paid_commission}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>pago</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <h3 style={{ marginTop: 0 }}>Detalhamento das Entregas</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #eee' }}>
                        {['Pedido', 'Cliente', 'Total', 'Taxa Entrega', 'Entregador', 'Comissão', 'Status'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: '#666', fontWeight: '600', fontSize: '13px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.orders.map((o, i) => {
                        const del = commissions.summary.find(d => d.id === o.deliverer_id);
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', opacity: o.commission_paid ? 0.65 : 1 }}>
                            <td style={{ padding: '10px 12px', fontWeight: 'bold', fontSize: '14px' }}>{o.order_number}</td>
                            <td style={{ padding: '10px 12px', fontSize: '14px', color: '#666' }}>{o.customer_name}</td>
                            <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: 'bold', color: '#667eea' }}>R$ {Number(o.total).toFixed(2)}</td>
                            <td style={{ padding: '10px 12px', fontSize: '14px', color: '#666' }}>R$ {Number(o.delivery_fee).toFixed(2)}</td>
                            <td style={{ padding: '10px 12px', fontSize: '14px', color: '#333' }}>{del?.name || '—'}</td>
                            <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: 'bold', color: o.commission_paid ? '#2ecc71' : '#e74c3c' }}>R$ {Number(o.deliverer_commission || 0).toFixed(2)}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <button
                                onClick={async () => {
                                  try {
                                    await apiFetch(`/orders/${o.id}/commission-paid`, { method: 'PATCH', body: JSON.stringify({ paid: !o.commission_paid }) });
                                    fetchCommissions();
                                  } catch (err) { showAlert(err.message); }
                                }}
                                style={{ background: o.commission_paid ? '#e8f5e9' : '#fff8e1', color: o.commission_paid ? '#2e7d32' : '#f57f17', border: 'none', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                              >
                                {o.commission_paid ? '✓ Pago' : 'Marcar Pago'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── CADASTRO DE LOJISTA ─────────────────────────────────────────────────────
  if (screen === 'register') {
    const handleRegister = async (e) => {
      e.preventDefault(); setLoading(true);
      try {
        const data = await apiFetch('/auth/register-vendor', {
          method: 'POST',
          body: JSON.stringify({
            name:     e.target.name.value.trim(),
            email:    e.target.email.value.trim(),
            password: e.target.password.value,
            phone:    e.target.phone.value.trim(),
            address:  e.target.address.value.trim(),
            cpf:      e.target.cpf.value.trim(),
          }),
        });
        if (data.token) authToken = data.token;
        setUser(data.vendor);
        setScreen('admin');
      } catch (err) { showAlert(err.message || 'Erro ao criar conta'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🫐</div>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', color: '#333' }}>Criar sua conta</h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#999' }}>14 dias grátis, sem cartão</p>
          </div>
          <Alert msg={alert.msg} type={alert.type} />
          <form onSubmit={handleRegister}>
            <Input label="Nome da loja / Responsável *" id="name" name="name" required placeholder="Açaí do João" />
            <Input label="Email *" id="email" name="email" type="email" required placeholder="joao@email.com" />
            <Input label="Senha * (mínimo 8 caracteres)" id="password" name="password" type="password" required placeholder="••••••••" minLength={8} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Input label="Telefone *" id="phone" name="phone" type="tel" required placeholder="(11) 99999-0000" />
              <Input label="CPF *" id="cpf" name="cpf" required placeholder="000.000.000-00" />
            </div>
            <Input label="Endereço *" id="address" name="address" required placeholder="Rua das Flores, 123 — São Paulo/SP" />
            <Btn type="submit" disabled={loading} style={{ width: '100%', marginTop: '4px' }}>
              {loading ? 'Criando conta...' : 'Criar conta grátis'}
            </Btn>
          </form>
          <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <span style={{ fontSize: '14px', color: '#999' }}>Já tem conta? </span>
            <button onClick={() => setScreen('login')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>Entrar</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── POLÍTICA DE PRIVACIDADE ─────────────────────────────────────────────────
  if (screen === 'privacy') {
    const prevScreen = user?.role === 'vendor' ? 'plans' : (vendorSlug ? 'menu' : 'login');
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <button onClick={() => setScreen(prevScreen)} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '20px', fontWeight: 'bold', fontSize: '15px' }}>← Voltar</button>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h1 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '26px' }}>🔒 Política de Privacidade</h1>
            <p style={{ color: '#999', fontSize: '13px', marginTop: 0 }}>Última atualização: junho de 2025</p>

            {[
              { title: '1. Quem somos', body: 'O Açaí Shop é uma plataforma de pedidos online para estabelecimentos de açaí. Atuamos como operador de dados em nome de cada lojista cadastrado, que é o controlador dos dados de seus clientes, conforme a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).' },
              { title: '2. Dados que coletamos', body: 'Coletamos os dados que você nos fornece ao fazer um pedido: nome completo, número de WhatsApp, endereço de e-mail (opcional) e o conteúdo do seu pedido. Lojistas também fornecem e-mail e senha para acesso à plataforma.' },
              { title: '3. Como usamos seus dados', body: 'Seus dados são usados exclusivamente para: (a) processar e acompanhar seu pedido; (b) enviar confirmações de pedido pelo WhatsApp; (c) contato do estabelecimento sobre seu pedido. Não vendemos nem compartilhamos seus dados com terceiros para fins de marketing.' },
              { title: '4. Compartilhamento de dados', body: 'Seus dados são compartilhados apenas com: (a) o estabelecimento ao qual você fez o pedido; (b) a Supabase Inc., nosso provedor de banco de dados (EUA, com cláusulas contratuais padrão da LGPD); (c) a Stripe Inc., para processamento de pagamentos de assinaturas de lojistas — dados de clientes finais não são enviados ao Stripe.' },
              { title: '5. Armazenamento e segurança', body: 'Os dados são armazenados em servidores protegidos da Supabase. Senhas de lojistas são armazenadas com criptografia bcrypt. Tokens de autenticação expiram em 24 horas. Comunicações são criptografadas via HTTPS/TLS.' },
              { title: '6. Seus direitos (LGPD)', body: 'Você tem direito a: confirmar se tratamos seus dados; acessar seus dados; corrigir dados incompletos ou desatualizados; solicitar a eliminação dos dados; revogar consentimento a qualquer momento. Para exercer esses direitos, entre em contato pelo e-mail abaixo.' },
              { title: '7. Retenção de dados', body: 'Pedidos são mantidos por até 1 ano para fins de suporte e auditoria. Você pode solicitar a exclusão antecipada dos seus dados a qualquer momento.' },
              { title: '8. Cookies', body: 'Utilizamos apenas cookies estritamente necessários para manter sua sessão autenticada como lojista. Não utilizamos cookies de rastreamento ou publicidade.' },
              { title: '9. Contato', body: 'Dúvidas ou solicitações sobre privacidade: 17digital.ap@gmail.com' },
            ].map(({ title, body }) => (
              <div key={title} style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '16px', color: '#444', marginBottom: '8px' }}>{title}</h2>
                <p style={{ color: '#666', lineHeight: '1.7', margin: 0, fontSize: '14px' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── TERMOS DE USO ────────────────────────────────────────────────────────────
  if (screen === 'terms') {
    const prevScreen = user?.role === 'vendor' ? 'plans' : (vendorSlug ? 'menu' : 'login');
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <button onClick={() => setScreen(prevScreen)} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '20px', fontWeight: 'bold', fontSize: '15px' }}>← Voltar</button>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h1 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '26px' }}>📄 Termos de Uso</h1>
            <p style={{ color: '#999', fontSize: '13px', marginTop: 0 }}>Última atualização: junho de 2025</p>

            {[
              { title: '1. Aceitação dos Termos', body: 'Ao utilizar o Açaí Shop — seja como cliente final fazendo um pedido ou como lojista gerenciando sua loja — você concorda com estes Termos de Uso. Se não concordar, não utilize a plataforma.' },
              { title: '2. O Serviço', body: 'O Açaí Shop é uma plataforma de gestão de pedidos que conecta clientes a estabelecimentos de açaí. Somos intermediários tecnológicos: o contrato de compra e venda é firmado diretamente entre o cliente e o estabelecimento. Não somos responsáveis pela qualidade, preparo ou entrega dos produtos.' },
              { title: '3. Clientes finais', body: 'Ao fazer um pedido você fornece seus dados voluntariamente e os disponibiliza ao estabelecimento para fins de processamento do pedido. Você é responsável pelas informações fornecidas. Pedidos com dados incorretos podem não ser atendidos.' },
              { title: '4. Lojistas — Planos e pagamentos', body: 'O acesso ao painel de gestão requer uma assinatura paga via Stripe. Os valores dos planos estão disponíveis na página de Planos. Assinaturas são cobradas automaticamente no período contratado e podem ser canceladas a qualquer momento pelo portal do cliente. O cancelamento encerra a renovação automática mas não gera reembolso pelo período já pago.' },
              { title: '5. Período de teste', body: 'Novos lojistas recebem um período de teste gratuito de 14 dias com acesso completo à plataforma. Não é necessário cartão de crédito durante o período de teste.' },
              { title: '6. Uso adequado', body: 'É proibido: usar a plataforma para fins ilegais; tentar acessar dados de outros usuários ou lojas; realizar ataques de negação de serviço; enviar conteúdo ofensivo ou spam. O descumprimento pode resultar no encerramento imediato da conta.' },
              { title: '7. Disponibilidade', body: 'Empreendemos esforços razoáveis para manter a plataforma disponível 24/7, mas não garantimos disponibilidade ininterrupta. Manutenções programadas serão comunicadas com antecedência quando possível.' },
              { title: '8. Limitação de responsabilidade', body: 'Não somos responsáveis por: danos decorrentes de indisponibilidade temporária da plataforma; qualidade ou entrega dos produtos pelos estabelecimentos; perda de dados por eventos fora do nosso controle (force majeure). Nossa responsabilidade máxima está limitada ao valor pago pelo plano no mês em que ocorreu o dano.' },
              { title: '9. Alterações nos Termos', body: 'Podemos atualizar estes Termos periodicamente. Notificaremos lojistas por e-mail em caso de alterações relevantes. O uso continuado da plataforma após a notificação constitui aceite das alterações.' },
              { title: '10. Lei aplicável e foro', body: 'Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da Comarca de São Paulo/SP para dirimir quaisquer controvérsias decorrentes deste instrumento.' },
              { title: '11. Contato', body: 'Dúvidas sobre estes Termos: 17digital.ap@gmail.com' },
            ].map(({ title, body }) => (
              <div key={title} style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '16px', color: '#444', marginBottom: '8px' }}>{title}</h2>
                <p style={{ color: '#666', lineHeight: '1.7', margin: 0, fontSize: '14px' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
