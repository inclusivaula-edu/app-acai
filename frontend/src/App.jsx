import React, { useState, useEffect } from 'react';
import { ShoppingCart, LogOut, Package, TrendingUp } from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
};

const STATUS_LABELS = {
  confirmado:  '✓ Confirmado',
  em_preparo:  '👨‍🍳 Em Preparo',
  pronto:      '✅ Pronto',
  em_entrega:  '🚚 Em Entrega',
  entregue:    '📦 Entregue',
  cancelado:   '✕ Cancelado',
};

const STATUS_COLORS = {
  confirmado: { bg: '#f0e7ff', color: '#667eea' },
  em_preparo: { bg: '#fff3e0', color: '#f39c12' },
  pronto:     { bg: '#e8f5e9', color: '#2ecc71' },
  em_entrega: { bg: '#e3f2fd', color: '#3498db' },
  entregue:   { bg: '#e8f5e9', color: '#27ae60' },
  cancelado:  { bg: '#ffebee', color: '#c62828' },
};

// ─── COMPONENTES PARTILHADOS ──────────────────────────────────────────────────

const Alert = ({ msg, type }) => {
  if (!msg) return null;
  const styles = type === 'error'
    ? { background: '#ffebee', color: '#c62828' }
    : { background: '#e8f5e9', color: '#2e7d32' };
  return (
    <div style={{ ...styles, padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', fontWeight: '500' }}>
      {msg}
    </div>
  );
};

const Btn = ({ children, onClick, type = 'button', disabled, variant = 'primary', style = {} }) => {
  const base = { border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, transition: 'opacity 0.2s', padding: '12px 20px' };
  const variants = {
    primary: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' },
    secondary: { background: '#f5f5f5', color: '#555' },
    danger: { background: '#ffebee', color: '#c62828' },
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

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]           = useState('login');
  const [authToken, setAuthToken]     = useState(localStorage.getItem('token'));
  const [user, setUser]               = useState(null);
  const [products, setProducts]       = useState([]);
  const [cart, setCart]               = useState([]);
  const [orders, setOrders]           = useState([]);
  const [dashboard, setDashboard]     = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('base');
  const [loading, setLoading]         = useState(false);
  const [alert, setAlert]             = useState({ msg: '', type: '' });

  // Campos do checkout via state (sem acesso ao DOM)
  const [customerName, setCustomerName]   = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const showAlert = (msg, type = 'error') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert({ msg: '', type: '' }), 4000);
  };

  const headers = () => ({ Authorization: `Bearer ${authToken}` });

  // ── Carregar dados ao logar ──
  useEffect(() => {
    if (!authToken) return;
    fetchProducts();
    if (user?.role === 'vendor') {
      fetchOrders();
      fetchDashboard();
    }
  }, [authToken, user]);

  // Polling de pedidos a cada 30s quando admin está aberto
  useEffect(() => {
    if (!authToken || !['admin', 'orders-admin'].includes(screen)) return;
    const interval = setInterval(() => { fetchOrders(); fetchDashboard(); }, 30000);
    return () => clearInterval(interval);
  }, [authToken, screen]);

  const fetchProducts = async () => {
    try {
      const data = await apiFetch('/products');
      // Compatibilidade: API retorna _id (MongoDB) e pode ter emoji ou icon
      setProducts(data.map(p => ({ ...p, id: p._id || p.id, icon: p.emoji || p.icon || '🫐' })));
    } catch { showAlert('Erro ao carregar produtos'); }
  };

  const fetchOrders = async () => {
    try {
      const data = await apiFetch('/orders', { headers: headers() });
      setOrders(Array.isArray(data) ? data.map(o => ({ ...o, id: o._id || o.id })) : []);
    } catch { /* silencioso no polling */ }
  };

  const fetchDashboard = async () => {
    try {
      const data = await apiFetch('/admin/dashboard', { headers: headers() });
      setDashboard(data);
    } catch { /* silencioso */ }
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
    setCart([]);
    setOrders([]);
    setDashboard(null);
    localStorage.removeItem('token');
    setScreen('login');
  };

  // ─────────────────────────────────────────────
  // TELA: LOGIN
  // ─────────────────────────────────────────────
  if (screen === 'login') {
    const handleLogin = async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: e.target.email.value, password: e.target.password.value }),
        });
        setAuthToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
        setScreen(data.user.role === 'vendor' ? 'admin' : 'menu');
      } catch (err) {
        showAlert(err.message || 'Email ou senha incorretos');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🫐</div>
            <h1 style={{ margin: 0, fontSize: '26px', color: '#333' }}>Açaí Shop</h1>
            <p style={{ color: '#999', margin: '6px 0 0 0', fontSize: '14px' }}>Faça login para continuar</p>
          </div>

          <Alert msg={alert.msg} type={alert.type} />

          <form onSubmit={handleLogin}>
            <Input label="Email" id="email" name="email" type="email" required placeholder="seu@email.com" />
            <Input label="Senha" id="password" name="password" type="password" required placeholder="••••••••" />
            <Btn type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Btn>
          </form>

          <p style={{ textAlign: 'center', marginTop: '20px', color: '#666', fontSize: '14px' }}>
            Novo vendor?{' '}
            <button onClick={() => setScreen('register')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'underline' }}>
              Cadastre-se aqui
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // TELA: REGISTRO
  // ─────────────────────────────────────────────
  if (screen === 'register') {
    const handleRegister = async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
        const data = await apiFetch('/auth/register-vendor', {
          method: 'POST',
          body: JSON.stringify({
            email: e.target.email.value,
            password: e.target.password.value,
            name: e.target.name.value,
            phone: e.target.phone.value,
            address: e.target.address.value,
            cpf: e.target.cpf.value,
          }),
        });
        setAuthToken(data.token);
        setUser(data.vendor);
        localStorage.setItem('token', data.token);
        setScreen('admin');
      } catch (err) {
        showAlert(err.message || 'Erro ao registrar');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '500px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
          <h1 style={{ margin: '0 0 24px 0', textAlign: 'center', fontSize: '24px' }}>📝 Registre sua Batedeira</h1>
          <Alert msg={alert.msg} type={alert.type} />
          <form onSubmit={handleRegister}>
            <Input label="Nome da Batedeira" name="name" required placeholder="Açaí Tropical" />
            <Input label="Email" name="email" type="email" required placeholder="email@exemplo.com" />
            <Input label="Senha (mín. 8 caracteres)" name="password" type="password" required placeholder="••••••••" />
            <Input label="Telefone" name="phone" type="tel" required placeholder="(11) 98765-4321" />
            <Input label="Endereço" name="address" required placeholder="Rua das Frutas, 123" />
            <Input label="CPF" name="cpf" required placeholder="000.000.000-00" />
            <Btn type="submit" disabled={loading} style={{ width: '100%', marginBottom: '10px' }}>
              {loading ? 'Registrando...' : 'Registrar'}
            </Btn>
            <Btn variant="secondary" onClick={() => setScreen('login')} style={{ width: '100%' }}>
              Voltar ao Login
            </Btn>
          </form>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // TELA: MENU (CLIENTE)
  // ─────────────────────────────────────────────
  if (screen === 'menu') {
    const addToCart = (product) => {
      setCart(prev => {
        const existing = prev.find(i => i.id === product.id);
        if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
        return [...prev, { ...product, quantity: 1 }];
      });
      showAlert(`${product.name} adicionado ao carrinho!`, 'success');
    };

    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    const totalPrice = cart.reduce((s, i) => s + i.price * i.quantity, 0);

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        {/* Header */}
        <div style={{ background: '#fff', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ margin: 0, fontSize: '22px', color: '#667eea' }}>🫐 Açaí Shop</h1>
            <button onClick={logout} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>

        {/* Categorias */}
        <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '12px 20px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: '10px', overflowX: 'auto' }}>
            {[['base', '🫐 Açaís'], ['bebidas', '🥤 Bebidas'], ['adicionais', '➕ Adicionais']].map(([cat, label]) => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
                padding: '8px 20px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap',
                border: selectedCategory === cat ? '2px solid #667eea' : '1px solid #ddd',
                background: selectedCategory === cat ? '#f0e7ff' : '#fff',
                color: selectedCategory === cat ? '#667eea' : '#666',
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <Alert msg={alert.msg} type={alert.type} />

        {/* Produtos */}
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
            {products.filter(p => p.category === selectedCategory && p.available !== false).map(product => (
              <div key={product.id} style={{ background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'transform 0.2s' }}>
                <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '28px', textAlign: 'center', fontSize: '52px' }}>
                  {product.icon}
                </div>
                <div style={{ padding: '16px' }}>
                  <h3 style={{ margin: '0 0 4px 0', color: '#333', fontSize: '16px' }}>{product.name}</h3>
                  <p style={{ margin: '0 0 12px 0', color: '#999', fontSize: '13px', lineHeight: '1.4' }}>{product.description || product.desc}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#667eea' }}>R$ {product.price.toFixed(2)}</span>
                    <Btn onClick={() => addToCart(product)} style={{ padding: '8px 16px', fontSize: '14px' }}>
                      + Adicionar
                    </Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Carrinho flutuante */}
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

  // ─────────────────────────────────────────────
  // TELA: CARRINHO
  // ─────────────────────────────────────────────
  if (screen === 'cart') {
    const updateQty = (id, delta) => {
      setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));
    };
    const removeItem = (id) => setCart(prev => prev.filter(i => i.id !== id));
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <button onClick={() => setScreen('menu')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '16px', fontWeight: 'bold', fontSize: '15px' }}>
            ← Voltar ao Menu
          </button>

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
                      <span style={{ fontWeight: 'bold', color: '#667eea', minWidth: '70px', textAlign: 'right' }}>
                        R$ {(item.price * item.quantity).toFixed(2)}
                      </span>
                      <button onClick={() => removeItem(item.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                    </div>
                  </div>
                ))}

                <div style={{ background: '#f0e7ff', padding: '16px', borderRadius: '8px', marginTop: '20px', display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 'bold', color: '#667eea' }}>
                  <span>Total:</span>
                  <span>R$ {total.toFixed(2)}</span>
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

  // ─────────────────────────────────────────────
  // TELA: CHECKOUT  ← BUG CORRIGIDO (state, não DOM)
  // ─────────────────────────────────────────────
  if (screen === 'checkout') {
    const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

    const handleCheckout = async (deliveryType) => {
      if (!customerName.trim()) { showAlert('Informe seu nome'); return; }
      setLoading(true);
      try {
        const data = await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map(i => ({ product_id: i.id, name: i.name, price: i.price, quantity: i.quantity, emoji: i.icon })),
            customer: { name: customerName.trim(), email: customerEmail.trim(), phone: customerPhone.trim() },
            delivery_type: deliveryType,
          }),
        });
        setCart([]);
        setCustomerName(''); setCustomerEmail(''); setCustomerPhone('');
        setScreen('confirmation');
        showAlert('Pedido criado com sucesso! 🎉', 'success');
      } catch (err) {
        showAlert(err.message || 'Erro ao criar pedido');
      } finally {
        setLoading(false);
      }
    };

    const deliveryFee = 5.00;

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <button onClick={() => setScreen('cart')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '16px', fontWeight: 'bold', fontSize: '15px' }}>
            ← Voltar
          </button>

          <div style={{ background: '#fff', borderRadius: '12px', padding: '28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h2 style={{ marginTop: 0 }}>Finalizar Pedido</h2>
            <Alert msg={alert.msg} type={alert.type} />

            <h3 style={{ color: '#555', fontSize: '15px', marginBottom: '12px' }}>Seus dados</h3>
            <Input
              label="Nome *"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="João Silva"
              required
            />
            <Input
              label="Email"
              type="email"
              value={customerEmail}
              onChange={e => setCustomerEmail(e.target.value)}
              placeholder="joao@email.com"
            />
            <Input
              label="Telefone"
              type="tel"
              value={customerPhone}
              onChange={e => setCustomerPhone(e.target.value)}
              placeholder="(11) 98765-4321"
            />

            {/* Resumo */}
            <div style={{ background: '#f9f9f9', padding: '16px', borderRadius: '8px', marginTop: '8px', marginBottom: '24px' }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#555' }}>Resumo</h4>
              {cart.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                  <span>{item.name} × {item.quantity}</span>
                  <span>R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '8px', marginTop: '8px', fontSize: '13px', color: '#666' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Subtotal</span><span>R$ {subtotal.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}>
                  <span>Taxa de entrega</span><span>R$ {deliveryFee.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <h3 style={{ color: '#555', fontSize: '15px', marginBottom: '12px' }}>Como quer receber?</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <button onClick={() => handleCheckout('retirada')} disabled={loading} style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: '#fff', border: 'none', padding: '20px', borderRadius: '10px',
                cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: loading ? 0.6 : 1, textAlign: 'center'
              }}>
                🕐 Retirada<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.9 }}>20–25 min</span>
              </button>
              <button onClick={() => handleCheckout('entrega')} disabled={loading} style={{
                background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                color: '#fff', border: 'none', padding: '20px', borderRadius: '10px',
                cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: loading ? 0.6 : 1, textAlign: 'center'
              }}>
                🚚 Entrega<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.9 }}>30–40 min + R$ {deliveryFee.toFixed(2)}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // TELA: CONFIRMAÇÃO
  // ─────────────────────────────────────────────
  if (screen === 'confirmation') {
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ color: '#2ecc71', marginBottom: '8px' }}>Pedido confirmado!</h2>
          <p style={{ color: '#666', marginBottom: '32px' }}>Recebemos seu pedido. Você pode acompanhar o status pelo WhatsApp caso seu número tenha sido informado.</p>
          <Btn onClick={() => setScreen('menu')} style={{ width: '100%' }}>Fazer novo pedido</Btn>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // HEADER ADMIN (componente interno)
  // ─────────────────────────────────────────────
  const AdminHeader = ({ active }) => (
    <div style={{ background: '#fff', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#667eea' }}>🫐 {user?.name || 'Admin'}</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {[['admin', '📊 Dashboard'], ['orders-admin', '📦 Pedidos']].map(([s, label]) => (
            <button key={s} onClick={() => setScreen(s)} style={{
              background: active === s ? '#f0e7ff' : 'none',
              border: 'none', color: '#667eea', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '14px', padding: '8px 16px', borderRadius: '6px'
            }}>{label}</button>
          ))}
          <button onClick={() => setScreen('menu')} style={{
            background: 'none', border: '1px solid #ddd', color: '#666',
            cursor: 'pointer', padding: '8px 16px', borderRadius: '6px', fontSize: '14px'
          }}>Ver Cardápio</button>
          <button onClick={logout} style={{ background: '#ffebee', border: 'none', color: '#c62828', cursor: 'pointer', padding: '8px 14px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 'bold' }}>
            <LogOut size={15} /> Sair
          </button>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // TELA: ADMIN DASHBOARD
  // ─────────────────────────────────────────────
  if (screen === 'admin') {
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="admin" />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />

          {!dashboard ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>Carregando dashboard...</div>
          ) : (
            <>
              {/* Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                {[
                  { label: 'Total de Pedidos', value: dashboard.totalOrders, icon: '📦', color: '#667eea' },
                  { label: 'Receita Total', value: `R$ ${dashboard.totalRevenue}`, icon: '💰', color: '#2ecc71' },
                  { label: 'Ticket Médio', value: `R$ ${dashboard.averageTicket}`, icon: '📈', color: '#f39c12' },
                  { label: 'Pedidos Hoje', value: dashboard.ordersToday, icon: '📅', color: '#e74c3c' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${card.color}` }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>{card.icon}</div>
                    <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>{card.label}</div>
                    <div style={{ fontSize: '26px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>

              {/* Status */}
              <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Status dos Pedidos</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
                  {Object.entries(dashboard.ordersByStatus || {}).map(([status, count]) => (
                    <div key={status} style={{ background: STATUS_COLORS[status]?.bg || '#f5f5f5', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', fontWeight: 'bold', color: STATUS_COLORS[status]?.color || '#333' }}>{count}</div>
                      <div style={{ color: '#666', marginTop: '4px', fontSize: '13px' }}>{STATUS_LABELS[status] || status}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pedidos recentes */}
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

  // ─────────────────────────────────────────────
  // TELA: ADMIN PEDIDOS
  // ─────────────────────────────────────────────
  if (screen === 'orders-admin') {
    const updateStatus = async (orderId, newStatus) => {
      try {
        await apiFetch(`/orders/${orderId}`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ status: newStatus }),
        });
        showAlert('Pedido atualizado!', 'success');
        fetchOrders();
        fetchDashboard();
      } catch (err) {
        showAlert(err.message || 'Erro ao atualizar pedido');
      }
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
                <div key={order.id || order._id} style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${STATUS_COLORS[order.status]?.color || '#ddd'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                    <div>
                      <h3 style={{ margin: 0, color: '#333', fontSize: '17px' }}>{order.order_number || order.id}</h3>
                      <p style={{ margin: '4px 0 0 0', color: '#999', fontSize: '13px' }}>
                        {new Date(order.createdAt || order.created_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#667eea' }}>R$ {Number(order.total).toFixed(2)}</div>
                      <div style={{ fontSize: '12px', color: order.payment_status === 'pago' ? '#2ecc71' : '#f39c12', marginTop: '2px', fontWeight: 'bold' }}>
                        {order.payment_status === 'pago' ? '✓ Pago' : '⏳ Pagamento pendente'}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', color: '#555' }}>
                    <div><strong>Cliente:</strong> {order.customer?.name || '—'}</div>
                    {order.customer?.phone && <div style={{ marginTop: '3px' }}><strong>Tel:</strong> {order.customer.phone}</div>}
                    <div style={{ marginTop: '3px' }}><strong>Tipo:</strong> {order.delivery_type === 'retirada' ? '🕐 Retirada' : '🚚 Entrega'}</div>
                    {order.customer_notes && <div style={{ marginTop: '3px', color: '#f39c12' }}><strong>Obs:</strong> {order.customer_notes}</div>}
                  </div>

                  <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                    {(order.items || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#666', padding: '2px 0' }}>
                        <span>{item.emoji || item.icon || '🫐'} {item.name} × {item.quantity || 1}</span>
                        <span>R$ {(item.price * (item.quantity || 1)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {['confirmado', 'em_preparo', 'pronto', 'em_entrega', 'entregue'].map(s => (
                      <button key={s} onClick={() => updateStatus(order._id || order.id, s)} disabled={order.status === s} style={{
                        background: order.status === s ? STATUS_COLORS[s]?.color || '#667eea' : '#f5f5f5',
                        color: order.status === s ? '#fff' : '#555',
                        border: 'none', padding: '7px 14px', borderRadius: '6px',
                        cursor: order.status === s ? 'default' : 'pointer',
                        fontWeight: 'bold', fontSize: '12px',
                        opacity: order.status === s ? 1 : 0.75,
                      }}>
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
