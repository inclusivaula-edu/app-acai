import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, LogOut, Lock } from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const PLAN_ERROR_CODES = new Set(['TRIAL_EXPIRED', 'PLAN_INACTIVE', 'PLAN_EXPIRED', 'TRIAL_LIMIT']);

// Token em memória — mais confiável que cookie cross-origin em alguns ambientes
let authToken = null;

// Slug da loja e ID de rastreamento lidos da URL ao carregar a página
const _urlParams   = new URLSearchParams(window.location.search);
let vendorSlug     = _urlParams.get('loja')          || null;
let initTrackId    = _urlParams.get('pedido')         || null;
const initResetTk  = _urlParams.get('reset_password') || null;
const initConfirmTk = _urlParams.get('confirm_email') || null;

let isRefreshing = false;
let refreshQueue = [];

const apiFetch = async (path, options = {}, _isRetry = false) => {
  const { headers: extraHeaders, ...rest } = options;
  const authHeaders = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...extraHeaders },
    ...rest,
  });
  const data = await res.json().catch(() => ({}));

  // Se token expirou, tentar refresh silencioso
  if (res.status === 401 && data.code === 'TOKEN_EXPIRED' && !_isRetry && path !== '/auth/refresh') {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshData = await apiFetch('/auth/refresh', { method: 'POST' }, true);
        if (refreshData.token) authToken = refreshData.token;
        refreshQueue.forEach(fn => fn(refreshData.token));
        refreshQueue = [];
        isRefreshing = false;
        return apiFetch(path, options, true); // retry original request
      } catch {
        isRefreshing = false;
        refreshQueue.forEach(fn => fn(null));
        refreshQueue = [];
        // Refresh falhou — deixa o erro original passar
      }
    } else {
      // Já está atualizando, aguardar na fila
      await new Promise(resolve => refreshQueue.push(resolve));
      return apiFetch(path, options, true);
    }
  }

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

const PAYMENT_OPTIONS_ALL = [
  { value: 'PIX',      label: '📱 PIX',              desc: 'Chave enviada após o pedido' },
  { value: 'Dinheiro', label: '💵 Dinheiro',          desc: 'Na retirada no local' },
  { value: 'Cartão',   label: '💳 Cartão',            desc: 'Máquina na entrega ou retirada' },
];
const PAYMENT_OPTIONS_ENTREGA = [
  { value: 'PIX',    label: '📱 PIX',    desc: 'Chave enviada após o pedido' },
  { value: 'Cartão', label: '💳 Cartão', desc: 'Máquina na entrega' },
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

// ─── WHITE-LABEL: emoji por tipo de negócio ──────────────────────────────────
const BIZ_EMOJIS = { acai:'🫐', confeitaria:'🎂', pizzaria:'🍕', hamburgueria:'🍔', restaurante:'🍽️', mercado:'🛒', outro:'🏪' };
const getBizEmoji = (settings) => BIZ_EMOJIS[settings?.business_type] || '🏪';

// ─── BOTÃO DE INSTALAÇÃO PWA ─────────────────────────────────────────────────
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const isInStandaloneMode = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

// ─── HEADER ADMIN (fora do App para não ser recriado a cada render) ───────────
function AdminHeader({ active, user, vendorSettings, planStatus, onNavigate, onLogout, showAlert, emailConfirmed, onResendConfirmation }) {
  return (
    <div style={{ background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
      {emailConfirmed === false && (
        <div style={{ background: '#fff8e1', borderBottom: '1px solid #ffe082', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '13px', color: '#f57f17', flexWrap: 'wrap', textAlign: 'center' }}>
          ✉️ <strong>Confirme seu email</strong> — clique no link enviado para {user?.email}.
          <button onClick={onResendConfirmation} style={{ background: 'none', border: '1px solid #f57f17', color: '#f57f17', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Reenviar</button>
        </div>
      )}
      <div style={{ padding: '10px 16px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

          {/* Linha 1: Nome ←→ Sair | Plano */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px' }}>
            <h1 style={{ margin: 0, fontSize: '17px', color: '#667eea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getBizEmoji(vendorSettings)} {user?.name || 'Admin'}</h1>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              <button onClick={onLogout} style={{ background: '#ffebee', border: 'none', color: '#c62828', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🚪 Sair</button>
              <button onClick={() => onNavigate('plans')} style={{
                background: planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active' ? '#e8f5e9' : (planStatus?.trial_days_left ?? 99) <= 3 ? '#ffebee' : '#fff8e1',
                border: 'none',
                color: planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active' ? '#2e7d32' : (planStatus?.trial_days_left ?? 99) <= 3 ? '#c62828' : '#f57f17',
                cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap',
              }}>
                {planStatus?.plan !== 'trial' && planStatus?.plan_status === 'active' ? '✓ Plano Ativo' : planStatus?.plan === 'trial' ? `⏳ ${planStatus.trial_days_left ?? '?'}d trial` : '⚠️ Planos'}
              </button>
            </div>
          </div>

          {/* Linha 2: navegação — 3 cols mobile / 6 cols desktop */}
          <div className="admin-nav-grid">
            {[
              { s: 'admin',             icon: '📊', label: 'Dashboard' },
              { s: 'orders-admin',      icon: '📦', label: 'Pedidos' },
              { s: 'products-admin',    icon: '🛍️', label: 'Produtos' },
              { s: 'deliverers-admin',  icon: '⚙️', label: 'Configuração' },
              { s: 'commissions-admin', icon: '💰', label: 'Comissões' },
              { s: 'tutorial-admin',    icon: '📖', label: 'Tutorial' },
              {
                s: '__cardapio__', icon: '🔗', label: 'Ver Cardápio',
                onClick: () => {
                  const slug = vendorSettings?.slug;
                  if (slug) window.open(`${window.location.origin}${window.location.pathname}?loja=${slug}`, '_blank');
                  else showAlert('Configure o link da loja primeiro', 'error');
                },
                style: { background: '#f0e7ff', color: '#667eea' },
              },
            ].map(({ s, icon, label, onClick, style: extra = {} }) => (
              <button
                key={s}
                onClick={onClick ?? (() => onNavigate(s))}
                style={{
                  background: active === s ? '#667eea' : '#f5f5f5',
                  border: 'none',
                  color: active === s ? '#fff' : '#555',
                  cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
                  padding: '9px 6px', borderRadius: '8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  ...extra,
                  ...(active === s ? { background: '#667eea', color: '#fff' } : {}),
                }}
              >
                <span>{icon}</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]           = useState(
    initResetTk  ? 'reset-password' :
    initConfirmTk ? 'confirm-email' :
    initTrackId  ? 'order-tracking' :
    (vendorSlug  ? 'menu' : 'login')
  );
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
  const [stripeTestMode, setStripeTestMode] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const BUSINESS_TYPES = {
    acai:         { label: 'Açaí',              emoji: '🫐', cats: [{ id:'base',       label:'Açaís',      emoji:'🫐', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true },{ id:'adicionais', label:'Adicionais', emoji:'➕', enabled:true }] },
    confeitaria:  { label: 'Confeitaria/Bolos', emoji: '🎂', cats: [{ id:'bolos',      label:'Bolos',      emoji:'🎂', enabled:true },{ id:'doces',   label:'Doces',   emoji:'🍬', enabled:true },{ id:'salgados',   label:'Salgados',   emoji:'🥐', enabled:true }] },
    pizzaria:     { label: 'Pizzaria',          emoji: '🍕', cats: [{ id:'pizzas',     label:'Pizzas',     emoji:'🍕', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true },{ id:'sobremesas',  label:'Sobremesas', emoji:'🍰', enabled:true }] },
    hamburgueria: { label: 'Hamburgueria',      emoji: '🍔', cats: [{ id:'burgers',    label:'Burgers',    emoji:'🍔', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true },{ id:'complementos',label:'Acompanham.',emoji:'🍟', enabled:true }] },
    restaurante:  { label: 'Restaurante',       emoji: '🍽️', cats: [{ id:'pratos',    label:'Pratos',     emoji:'🍽️', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true },{ id:'sobremesas',  label:'Sobremesas', emoji:'🍰', enabled:true }] },
    mercado:      { label: 'Mercado/Loja',      emoji: '🛒', cats: [{ id:'produtos',   label:'Produtos',   emoji:'🛒', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true }] },
    outro:        { label: 'Outro',             emoji: '🏪', cats: [{ id:'produtos',   label:'Produtos',   emoji:'🏪', enabled:true },{ id:'bebidas', label:'Bebidas', emoji:'🥤', enabled:true }] },
  };
  const getBizType = (settings) => BUSINESS_TYPES[settings?.business_type] || BUSINESS_TYPES.acai;
  const DEFAULT_CATEGORIES = getBizType(vendorSettings).cats;
  const getCategories = (raw) => (Array.isArray(raw) && raw.length ? raw : DEFAULT_CATEGORIES);
  const [loading, setLoading]         = useState(false);
  const [alert, setAlert]             = useState({ msg: '', type: '' });
  const [regPassword, setRegPassword] = useState('');
  const [confirmStatus, setConfirmStatus] = useState('loading');
  const [lastOrder, setLastOrder]     = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled]     = useState(false);
  const installPromptRef = useRef(null);
  const promptShown      = useRef(false);
  const [trackingOrderId, setTrackingOrderId] = useState(initTrackId);
  const [trackedOrder, setTrackedOrder]       = useState(null);

  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [customerEmail, setCustomerEmail]     = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerComplement, setCustomerComplement] = useState('');
  const [checkoutDeliveryType, setCheckoutDeliveryType] = useState('');
  const [paymentMethod, setPaymentMethod]     = useState('PIX');

  // estados email confirmation/reset
  const [emailConfirmed, setEmailConfirmed] = useState(null); // null=desconhecido, true/false

  // estados tela produtos-admin
  const [editingProduct, setEditingProduct] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', category: 'base', emoji: '🫐', calories: '', ingredients: '', allergens: '' });

  // estados tela deliverers-admin
  const [showDelivererForm, setShowDelivererForm] = useState(false);
  const [editingDel, setEditingDel] = useState(null);
  const [delivererForm, setDelivererForm] = useState({ name: '', phone: '', cpf: '', vehicle: '', commission_rate: '10' });
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [showNewCatForm, setShowNewCatForm] = useState(false);
  const [newCatForm, setNewCatForm] = useState({ label: '', emoji: '🍦' });
  const [editingCatIdx, setEditingCatIdx] = useState(null);
  const [editCatForm, setEditCatForm] = useState({ label: '', emoji: '' });

  // estados mensagens WhatsApp
  const [conversations, setConversations]   = useState([]);
  const [activeConv, setActiveConv]         = useState(null);
  const [convMessages, setConvMessages]     = useState([]);
  const [replyText, setReplyText]           = useState('');
  const activeConvRef  = useRef(null);
  const threadBottomRef = useRef(null);

  // estados edição de taxa/valor do pedido
  const [editingFeeId, setEditingFeeId]     = useState(null);
  const [editingFeeVal, setEditingFeeVal]   = useState('');
  const [editingDesconto, setEditingDesconto] = useState('');
  const [editingFeeNote, setEditingFeeNote] = useState('');

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
    apiFetch('/stripe/config').then(d => setStripeTestMode(d.test_mode)).catch(() => {});
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

    // PWA install prompt — captura o evento e dispara no primeiro clique do cliente
    const handler = (e) => {
      e.preventDefault();
      installPromptRef.current = e;
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setInstalled(true); setInstallPrompt(null); installPromptRef.current = null; });

    // Primeiro clique em qualquer lugar na tela do cliente → abre o prompt de instalação
    const onFirstClick = async () => {
      if (promptShown.current || !installPromptRef.current || isInStandaloneMode()) return;
      promptShown.current = true;
      installPromptRef.current.prompt();
      const result = await installPromptRef.current.userChoice;
      if (result.outcome === 'accepted') setInstalled(true);
      setInstallPrompt(null);
      installPromptRef.current = null;
    };
    window.addEventListener('click', onFirstClick, { once: true });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('click', onFirstClick);
    };
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

  // Manter ref sincronizada com activeConv para usar dentro do SSE sem stale closure
  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);

  // Auto-scroll ao receber nova mensagem na thread
  useEffect(() => {
    if (threadBottomRef.current) threadBottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [convMessages]);

  // SSE — tempo real
  useEffect(() => {
    if (!user || screen !== 'messages-admin') return;
    fetchConversations();

    const token = authToken;
    if (!token) return;

    const es = new EventSource(`${API_URL}/messages/stream?token=${token}`);

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        // Atualizar lista de conversas
        setConversations(prev => {
          const exists = prev.find(c => c.phone === msg.phone);
          const updated = {
            phone:        msg.phone,
            contact_name: msg.contact_name || exists?.contact_name || null,
            last_message: msg.message,
            last_at:      msg.created_at,
            from_me:      msg.from_me,
            unread:       exists ? exists.unread + (msg.from_me ? 0 : 1) : (msg.from_me ? 0 : 1),
          };
          return [updated, ...prev.filter(c => c.phone !== msg.phone)];
        });
        // Adicionar à thread se for a conversa ativa
        if (activeConvRef.current?.phone === msg.phone) {
          setConvMessages(prev => [...prev, msg]);
        }
      } catch {}
    };

    es.onerror = () => { es.close(); };

    return () => es.close();
  }, [user, screen]);

  useEffect(() => {
    if (screen !== 'order-tracking' || !trackingOrderId) return;
    const fetchTracking = async () => {
      try {
        const data = await apiFetch(`/orders/${trackingOrderId}/track`);
        setTrackedOrder(data);
      } catch { setTrackedOrder(null); }
    };
    fetchTracking();
    const interval = setInterval(fetchTracking, 30000);
    return () => clearInterval(interval);
  }, [screen, trackingOrderId]);

  useEffect(() => {
    if (screen !== 'confirm-email') return;
    if (!initConfirmTk) { setConfirmStatus('error'); return; }
    apiFetch('/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token: initConfirmTk }) })
      .then(() => { setConfirmStatus('success'); setEmailConfirmed(true); window.history.replaceState({}, '', window.location.pathname); })
      .catch(() => setConfirmStatus('error'));
  }, [screen]);

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

  const fetchConversations = async () => {
    try { setConversations(await apiFetch('/messages')); } catch {}
  };

  const fetchThread = async (phone) => {
    try { setConvMessages(await apiFetch(`/messages/${phone}`)); } catch {}
  };

  const logout = async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    authToken = null;
    setUser(null); setOrders([]); setDashboard(null);
    setScreen('menu');
  };

  const resendConfirmation = async () => {
    try {
      await apiFetch('/auth/resend-confirmation', { method: 'POST' });
      showAlert('Email de confirmação reenviado! Verifique sua caixa de entrada.', 'success');
    } catch (err) { showAlert(err.message || 'Erro ao reenviar email'); }
  };

  // ─── CONFIRMAR EMAIL (redirect do link) ──────────────────────────────────────
  if (screen === 'confirm-email') {
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 40px', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          {confirmStatus === 'loading' && (<><div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div><p style={{ color: '#667eea', fontWeight: 'bold' }}>Confirmando email...</p></>)}
          {confirmStatus === 'success' && (<><div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div><h2 style={{ color: '#2e7d32', margin: '0 0 8px' }}>Email confirmado!</h2><p style={{ color: '#555' }}>Sua conta está ativa. Você já pode usar todos os recursos.</p><Btn onClick={() => setScreen(user ? 'admin' : 'login')} style={{ marginTop: '16px' }}>Ir para o painel</Btn></>)}
          {confirmStatus === 'error' && (<><div style={{ fontSize: '56px', marginBottom: '16px' }}>❌</div><h2 style={{ color: '#c62828', margin: '0 0 8px' }}>Link inválido</h2><p style={{ color: '#555' }}>Este link pode ter expirado ou já foi usado. Faça login e reenvie o email de confirmação.</p><Btn onClick={() => setScreen('login')} style={{ marginTop: '16px' }}>Fazer login</Btn></>)}
        </div>
      </div>
    );
  }

  // ─── VERIFICAÇÃO PENDENTE (após registro) ─────────────────────────────────────
  if (screen === 'verify-email-pending') {
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 40px', maxWidth: '440px', width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>✉️</div>
          <h2 style={{ color: '#333', margin: '0 0 12px' }}>Verifique seu email</h2>
          <p style={{ color: '#555', lineHeight: 1.6, marginBottom: '24px' }}>
            Enviamos um link de confirmação para <strong>{user?.email}</strong>.<br />
            Clique no link para ativar sua conta e acessar o painel.
          </p>
          <div style={{ background: '#f0f9f0', border: '1px solid #a5d6a7', borderRadius: '10px', padding: '14px', marginBottom: '24px', fontSize: '14px', color: '#2e7d32' }}>
            💡 Enquanto isso, você já pode explorar o painel. A confirmação de email não bloqueia o acesso.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Btn onClick={() => setScreen('admin')} style={{ width: '100%' }}>Ir para o painel →</Btn>
            <button onClick={resendConfirmation} style={{ background: 'none', border: '1px solid #ddd', color: '#667eea', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
              Reenviar email de confirmação
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ESQUECEU A SENHA ─────────────────────────────────────────────────────────
  if (screen === 'forgot-password') {
    const handleForgot = async (e) => {
      e.preventDefault(); setLoading(true);
      try {
        await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: e.target.email.value.trim() }) });
        showAlert('Se o email estiver cadastrado, você receberá um link em breve.', 'success');
        setTimeout(() => setScreen('login'), 3000);
      } catch { showAlert('Erro ao processar. Tente novamente.'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔑</div>
            <h1 style={{ margin: '0 0 6px', fontSize: '22px', color: '#333' }}>Recuperar senha</h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#999' }}>Informe seu email para receber o link</p>
          </div>
          <Alert msg={alert.msg} type={alert.type} />
          <form onSubmit={handleForgot}>
            <Input label="Email cadastrado" id="email" name="email" type="email" required placeholder="seu@email.com" />
            <Btn type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Enviando...' : 'Enviar link de recuperação'}</Btn>
          </form>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button onClick={() => setScreen('login')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px' }}>← Voltar ao login</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── REDEFINIR SENHA ──────────────────────────────────────────────────────────
  if (screen === 'reset-password') {
    const handleReset = async (e) => {
      e.preventDefault(); setLoading(true);
      const pw = e.target.password.value;
      const pw2 = e.target.password2.value;
      if (pw !== pw2) { showAlert('As senhas não coincidem'); setLoading(false); return; }
      try {
        await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: initResetTk, password: pw }) });
        showAlert('Senha redefinida com sucesso! Faça login com a nova senha.', 'success');
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => setScreen('login'), 2500);
      } catch (err) { showAlert(err.message || 'Link inválido ou expirado.'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🔒</div>
            <h1 style={{ margin: '0 0 6px', fontSize: '22px', color: '#333' }}>Nova senha</h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#999' }}>Escolha uma senha forte</p>
          </div>
          <Alert msg={alert.msg} type={alert.type} />
          {!initResetTk ? (
            <div style={{ textAlign: 'center', color: '#c62828' }}>
              <p>Link inválido. <button onClick={() => setScreen('forgot-password')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer' }}>Solicite um novo</button>.</p>
            </div>
          ) : (
            <form onSubmit={handleReset}>
              <Input label="Nova senha (mínimo 8 caracteres)" name="password" type="password" required minLength={8} placeholder="••••••••" />
              <Input label="Confirmar nova senha" name="password2" type="password" required minLength={8} placeholder="••••••••" />
              <Btn type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Salvando...' : 'Salvar nova senha'}</Btn>
            </form>
          )}
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button onClick={() => setScreen('login')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px' }}>← Voltar ao login</button>
          </div>
        </div>
      </div>
    );
  }

  // Aguarda carregamento da sessão para evitar flash da tela de login
  if (!sessionLoaded && (screen === 'login' || screen === 'admin' || screen === 'orders-admin' || screen === 'products-admin' || screen === 'deliverers-admin' || screen === 'commissions-admin' || screen === 'messages-admin' || screen === 'plans')) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}><div style={{ fontSize: '32px' }}>🫐</div></div>;
  }

  // ─── LOGIN ───────────────────────────────────────────────────────────────────
  if (screen === 'login') {
    const handleLogin = async (e) => {
      e.preventDefault();
      const emailVal = e.target.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) { showAlert('Email inválido'); return; }
      setLoading(true);
      try {
        const data = await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: e.target.email.value, password: e.target.password.value }),
        });
        if (data.token) authToken = data.token;
        setUser(data.user);
        setEmailConfirmed(data.user.email_confirmed ?? null);
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
            <div style={{ textAlign: 'right', marginBottom: '16px', marginTop: '-8px' }}>
              <button type="button" onClick={() => setScreen('forgot-password')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '13px' }}>Esqueceu a senha?</button>
            </div>
            <Btn type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Entrando...' : 'Entrar'}</Btn>
          </form>
          {vendorSlug && (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button onClick={() => setScreen('menu')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px' }}>← Voltar ao Cardápio</button>
            </div>
          )}
          <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <span style={{ fontSize: '14px', color: '#999' }}>Não tem conta? </span>
            <button onClick={() => setScreen('plans-preview')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>Criar conta grátis</button>
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
        <div style={{ background: '#fff', padding: '12px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }} className="menu-header-wrap">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              {storeInfo?.logo_url
                ? <img src={storeInfo.logo_url} alt="" style={{ height: '40px', width: '40px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
                : <span style={{ fontSize: '28px', flexShrink: 0 }}>{getBizEmoji(storeInfo)}</span>
              }
              <h1 style={{ margin: 0, fontSize: '20px', color: '#667eea', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{storeInfo?.name || 'Açaí Shop'}</h1>
            </div>
            <div className="menu-header-actions">
              {!isInStandaloneMode() && !installed && installPrompt && (
                <button
                  onClick={async () => { installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === 'accepted') setInstalled(true); setInstallPrompt(null); }}
                  style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 13px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >📲 Instalar</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '12px 20px' }}>
          {(() => {
            const enabledCats = getCategories(storeInfo?.categories).filter(c => c.enabled !== false);
            const activeCat = selectedCategory ?? enabledCats[0]?.id;
            return (
              <div style={{ maxWidth: '1200px', margin: '0 auto' }} className="category-tabs">
                {enabledCats.map(cat => (
                  <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={{
                    padding: '8px 20px', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', whiteSpace: 'nowrap', flexShrink: 0,
                    border: activeCat === cat.id ? '2px solid #667eea' : '1px solid #ddd',
                    background: activeCat === cat.id ? '#f0e7ff' : '#fff',
                    color: activeCat === cat.id ? '#667eea' : '#666',
                  }}>{cat.emoji} {cat.label}</button>
                ))}
              </div>
            );
          })()}
        </div>
        {alert.msg && (
          <div style={{ maxWidth: '1200px', margin: '16px auto 0', padding: '0 20px' }}>
            <Alert msg={alert.msg} type={alert.type} />
          </div>
        )}
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px 16px', paddingBottom: totalItems > 0 ? '100px' : '20px' }}>
          {/* Banner da loja */}
          <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '16px', padding: '20px 24px', marginBottom: '24px', color: '#fff', display: 'flex', alignItems: 'center', gap: '16px' }}>
            {storeInfo?.logo_url
              ? <img src={storeInfo.logo_url} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '12px', flexShrink: 0, border: '2px solid rgba(255,255,255,0.3)' }} />
              : <div style={{ fontSize: '44px', flexShrink: 0 }}>{getBizEmoji(storeInfo)}</div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 'bold', fontSize: '20px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{storeInfo?.name || 'Cardápio'}</div>
              <div style={{ opacity: 0.85, fontSize: '14px', lineHeight: '1.4' }}>{storeInfo?.description || `Bem-vindo! Confira nosso cardápio ${getBizEmoji(storeInfo)}`}</div>
            </div>
          </div>

          {(() => {
            const activeCat = selectedCategory ?? getCategories(storeInfo?.categories).filter(c => c.enabled !== false)[0]?.id;
            const visibleProducts = products.filter(p => p.category === activeCat && p.available !== false);
            return visibleProducts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>🫐</div>
                <p>Nenhum produto nesta categoria.</p>
              </div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
              {visibleProducts.map(product => (
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
            );
          })()}
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
    const deliveryFee = storeInfo?.delivery_fee != null ? Number(storeInfo.delivery_fee) : 5.00;
    const paymentOptions = checkoutDeliveryType === 'entrega' ? PAYMENT_OPTIONS_ENTREGA : PAYMENT_OPTIONS_ALL;
    if (checkoutDeliveryType === 'entrega' && paymentMethod === 'Dinheiro') setPaymentMethod('PIX');
    const handleCheckout = async () => {
      if (!checkoutDeliveryType) { showAlert('Escolha retirada ou entrega'); return; }
      if (!customerName.trim()) { showAlert('Informe seu nome'); return; }
      if (!customerPhone.trim()) { showAlert('Informe seu WhatsApp'); return; }
      if (checkoutDeliveryType === 'entrega' && !customerAddress.trim()) { showAlert('Informe o endereço para entrega'); return; }
      setLoading(true);
      try {
        const data = await apiFetch('/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })),
            customer: {
              name: customerName.trim(),
              email: customerEmail.trim(),
              phone: customerPhone.trim(),
              address: checkoutDeliveryType === 'entrega' ? {
                street: customerAddress.trim(),
                number: '',
                neighborhood: customerComplement.trim(),
                city: '', state: '', zip_code: '',
              } : undefined,
            },
            delivery_type: checkoutDeliveryType,
            customer_notes: `Pagamento: ${paymentMethod}`,
            vendor_slug: vendorSlug,
          }),
        });
        setLastOrder(data.order);
        setCart([]); setCustomerName(''); setCustomerPhone(''); setCustomerEmail('');
        setCustomerAddress(''); setCustomerComplement(''); setCheckoutDeliveryType('');
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
              {paymentOptions.map(opt => (
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              <button type="button" onClick={() => setCheckoutDeliveryType('retirada')} style={{ background: checkoutDeliveryType === 'retirada' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f5f5f5', color: checkoutDeliveryType === 'retirada' ? '#fff' : '#555', border: checkoutDeliveryType === 'retirada' ? 'none' : '2px solid #ddd', padding: '16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}>
                🕐 Retirada<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.85 }}>20–25 min • Grátis</span>
              </button>
              {storeInfo?.deliveries_enabled !== false && (
                <button type="button" onClick={() => setCheckoutDeliveryType('entrega')} style={{ background: checkoutDeliveryType === 'entrega' ? 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' : '#f5f5f5', color: checkoutDeliveryType === 'entrega' ? '#fff' : '#555', border: checkoutDeliveryType === 'entrega' ? 'none' : '2px solid #ddd', padding: '16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}>
                  🚚 Entrega<br /><span style={{ fontWeight: 'normal', fontSize: '13px', opacity: 0.85 }}>30–40 min • +R$ {deliveryFee.toFixed(2)}</span>
                </button>
              )}
            </div>

            {checkoutDeliveryType === 'entrega' && (
              <div style={{ background: '#f0f4ff', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                <h3 style={{ color: '#555', fontSize: '15px', margin: '0 0 12px 0' }}>📍 Endereço de entrega</h3>
                <Input label="Rua, número e bairro *" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Rua das Flores, 123 – Jardim das Rosas" />
                <Input label="Complemento / Referência (opcional)" value={customerComplement} onChange={e => setCustomerComplement(e.target.value)} placeholder="Apto 4, próximo à padaria" />
              </div>
            )}

            <Btn onClick={handleCheckout} disabled={loading || !checkoutDeliveryType} style={{ width: '100%' }}>
              {loading ? 'Enviando pedido...' : 'Finalizar Pedido'}
            </Btn>
            <p style={{ fontSize: '11px', color: '#bbb', textAlign: 'center', marginTop: '12px', marginBottom: 0 }}>
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
    const pixKey = storeInfo?.pix_key;
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
          <Alert msg={alert.msg} type={alert.type} />
          {storeInfo?.logo_url
            ? <img src={storeInfo.logo_url} alt="" style={{ height: '56px', width: '56px', objectFit: 'cover', borderRadius: '12px', marginBottom: '12px' }} />
            : <div style={{ fontSize: '56px', marginBottom: '12px' }}>🎉</div>
          }
          <h2 style={{ color: '#2ecc71', marginBottom: '8px' }}>Pedido recebido!</h2>
          {lastOrder?.order_number && (
            <div style={{ background: '#f0e7ff', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', display: 'inline-block' }}>
              <span style={{ fontWeight: 'bold', color: '#667eea', fontSize: '18px' }}>{lastOrder.order_number}</span>
            </div>
          )}
          <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '16px', marginBottom: '16px', textAlign: 'left' }}>
            <div style={{ fontWeight: 'bold', color: '#f57f17', marginBottom: '4px' }}>⏳ Aguardando confirmação de pagamento</div>
            <div style={{ fontSize: '13px', color: '#555' }}>
              {isPix ? 'Assim que recebermos o PIX, confirmaremos seu pedido pelo WhatsApp e iniciaremos o preparo.' : 'Seu pedido será confirmado após a verificação do pagamento.'}
            </div>
          </div>
          {isPix && (
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '10px', padding: '16px', marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ fontWeight: 'bold', color: '#2e7d32', marginBottom: '8px' }}>📱 Pagamento via PIX</div>
              {pixKey ? (
                <>
                  <div style={{ fontSize: '13px', color: '#555', marginBottom: '8px' }}>Pague para a chave abaixo e envie o comprovante pelo WhatsApp:</div>
                  <div style={{ background: '#fff', borderRadius: '8px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#333', wordBreak: 'break-all' }}>{pixKey}</span>
                    <button onClick={() => navigator.clipboard.writeText(pixKey).then(() => showAlert('Chave PIX copiada!', 'success'))} style={{ background: '#2ecc71', color: '#fff', border: 'none', padding: '7px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', flexShrink: 0 }}>📋 Copiar</button>
                  </div>
                  <div style={{ fontSize: '13px', color: '#2e7d32', fontWeight: 'bold' }}>Valor: R$ {lastOrder?.total ? Number(lastOrder.total).toFixed(2) : '—'}</div>
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#555' }}>Enviaremos a chave PIX pelo WhatsApp em instantes.</div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {lastOrder?.id && (
              <Btn variant="secondary" onClick={() => { setTrackingOrderId(lastOrder.id); setScreen('order-tracking'); }} style={{ width: '100%' }}>
                🔍 Acompanhar meu pedido
              </Btn>
            )}
            <Btn onClick={() => setScreen('menu')} style={{ width: '100%' }}>Fazer novo pedido</Btn>

            {/* Botão instalar PWA */}
            {!isInStandaloneMode() && !installed && (
              installPrompt ? (
                <button
                  onClick={async () => { installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === 'accepted') setInstalled(true); setInstallPrompt(null); }}
                  style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', width: '100%' }}
                >
                  📲 Instalar app no celular
                </button>
              ) : isIOS() ? (
                <div style={{ background: '#f0f4ff', border: '1px solid #c5cae9', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: '#555', textAlign: 'left' }}>
                  <strong>📲 Instalar no iPhone:</strong> toque em <strong>Compartilhar</strong> (ícone ↑) → <strong>"Adicionar à Tela de Início"</strong>
                </div>
              ) : null
            )}
            {installed && (
              <div style={{ fontSize: '13px', color: '#2e7d32', textAlign: 'center' }}>✅ App instalado!</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── RASTREAMENTO DE PEDIDO (público) ────────────────────────────────────────
  if (screen === 'order-tracking') {
    const STATUS_STEPS = [
      { key: 'aguardando_pagamento', label: 'Aguardando Pagamento', icon: '⏳' },
      { key: 'confirmado',           label: 'Confirmado',           icon: '✓'  },
      { key: 'em_preparo',           label: 'Em Preparo',           icon: '👨‍🍳' },
      { key: 'pronto',               label: 'Pronto',               icon: '✅' },
      { key: 'em_entrega',           label: 'Em Entrega',           icon: '🚚' },
      { key: 'entregue',             label: 'Entregue',             icon: '📦' },
    ];
    const currentStepIdx = trackedOrder ? STATUS_STEPS.findIndex(s => s.key === trackedOrder?.status) : -1;
    const isCanceled = trackedOrder?.status === 'cancelado';
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto' }}>
          <button onClick={() => setScreen(vendorSlug ? 'menu' : 'login')} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', marginBottom: '16px', fontWeight: 'bold', fontSize: '15px' }}>← Voltar ao cardápio</button>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            {storeInfo?.logo_url && (
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <img src={storeInfo.logo_url} alt="" style={{ height: '48px', width: '48px', objectFit: 'cover', borderRadius: '10px' }} />
              </div>
            )}
            <h2 style={{ marginTop: 0, marginBottom: '4px' }}>🔍 Acompanhar Pedido</h2>
            {!trackedOrder ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏳</div>
                <p>Carregando dados do pedido...</p>
              </div>
            ) : isCanceled ? (
              <div style={{ textAlign: 'center', padding: '32px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>❌</div>
                <h3 style={{ color: '#c62828', margin: '0 0 8px' }}>Pedido Cancelado</h3>
                <p style={{ color: '#999', fontSize: '14px' }}>Este pedido foi cancelado pelo estabelecimento.</p>
              </div>
            ) : (
              <>
                {trackedOrder.order_number && (
                  <div style={{ background: '#f0e7ff', padding: '8px 14px', borderRadius: '8px', marginBottom: '20px', display: 'inline-block' }}>
                    <span style={{ fontWeight: 'bold', color: '#667eea' }}>{trackedOrder.order_number}</span>
                  </div>
                )}
                <div style={{ marginBottom: '24px' }}>
                  {STATUS_STEPS.map((step, idx) => {
                    const done   = idx <= currentStepIdx;
                    const active = idx === currentStepIdx;
                    return (
                      <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 'bold', boxSizing: 'border-box', background: active ? '#667eea' : done ? '#e8f5e9' : '#f5f5f5', color: active ? '#fff' : done ? '#2e7d32' : '#ccc', border: active ? '3px solid #667eea' : 'none' }}>
                          {active ? step.icon : done ? '✓' : step.icon}
                        </div>
                        <div>
                          <div style={{ fontWeight: active ? 'bold' : 'normal', color: active ? '#667eea' : done ? '#2e7d32' : '#ccc', fontSize: '15px' }}>{step.label}</div>
                          {active && <div style={{ fontSize: '12px', color: '#999' }}>Status atual</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: '#f9f9f9', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
                    <strong>Tipo:</strong> {trackedOrder.delivery_type === 'entrega' ? '🚚 Entrega' : '🕐 Retirada no local'}
                  </div>
                  {(trackedOrder.items || []).map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#666', marginBottom: '3px' }}>
                      <span>{item.emoji || '🫐'} {item.name} × {item.quantity || 1}</span>
                      <span>R$ {(item.price * (item.quantity || 1)).toFixed(2)}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid #eee', marginTop: '8px', paddingTop: '8px', fontWeight: 'bold', color: '#667eea', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total</span>
                    <span>R$ {Number(trackedOrder.total).toFixed(2)}</span>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#bbb', textAlign: 'center', marginTop: '14px' }}>Atualizado automaticamente a cada 30 segundos</div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── MENSAGENS WHATSAPP ───────────────────────────────────────────────────────
  if (screen === 'messages-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }

    const selectConv = (conv) => {
      setActiveConv(conv);
      setConvMessages([]);
      fetchThread(conv.phone);
    };

    const sendReply = async () => {
      if (!replyText.trim() || !activeConv) return;
      const text = replyText.trim();
      setReplyText('');
      try {
        const msg = await apiFetch(`/messages/${activeConv.phone}/reply`, {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
        setConvMessages(prev => [...prev, msg]);
        fetchConversations();
      } catch (err) { showAlert(err.message || 'Erro ao enviar'); setReplyText(text); }
    };

    const fmtTime = (iso) => {
      const d = new Date(iso);
      const today = new Date();
      if (d.toDateString() === today.toDateString()) {
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="messages-admin" {...adminHeaderProps} />
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', height: 'calc(100vh - 160px)', minHeight: '400px', boxSizing: 'border-box' }}>
          <Alert msg={alert.msg} type={alert.type} />

          {/* Lista de conversas */}
          <div style={{ width: '300px', minWidth: '260px', flexShrink: 0, flexGrow: window.innerWidth < 700 ? 1 : 0, background: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', fontWeight: 'bold', fontSize: '16px', color: '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>💬 Conversas</span>
              <button onClick={fetchConversations} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#999' }} title="Atualizar">🔄</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {conversations.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#bbb' }}>
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>💬</div>
                  <p style={{ margin: 0, fontSize: '14px' }}>Nenhuma mensagem ainda</p>
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#ddd' }}>As mensagens dos clientes aparecerão aqui</p>
                </div>
              ) : conversations.map(conv => (
                <div
                  key={conv.phone}
                  onClick={() => selectConv(conv)}
                  style={{ padding: '14px 16px', borderBottom: '1px solid #f8f8f8', cursor: 'pointer', background: activeConv?.phone === conv.phone ? '#f0e7ff' : '#fff', transition: 'background 0.1s' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#333' }}>
                      {conv.contact_name || conv.phone}
                    </div>
                    <div style={{ fontSize: '11px', color: '#bbb', flexShrink: 0, marginLeft: '8px' }}>{fmtTime(conv.last_at)}</div>
                  </div>
                  {conv.contact_name && (
                    <div style={{ fontSize: '11px', color: '#bbb', marginBottom: '3px' }}>{conv.phone}</div>
                  )}
                  <div style={{ fontSize: '13px', color: conv.from_me ? '#999' : '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {conv.from_me ? '✓ Você: ' : ''}{conv.last_message}
                  </div>
                  {conv.unread > 0 && (
                    <div style={{ display: 'inline-block', background: '#25D366', color: '#fff', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', padding: '1px 7px', marginTop: '4px' }}>{conv.unread}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Thread da conversa */}
          <div style={{ flex: 1, background: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {!activeConv ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
                <p style={{ margin: 0, fontSize: '16px' }}>Selecione uma conversa</p>
              </div>
            ) : (
              <>
                {/* Cabeçalho da conversa */}
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '18px', flexShrink: 0 }}>
                    {(activeConv.contact_name || activeConv.phone).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 'bold', color: '#333' }}>{activeConv.contact_name || activeConv.phone}</div>
                    {activeConv.contact_name && <div style={{ fontSize: '12px', color: '#999' }}>{activeConv.phone}</div>}
                  </div>
                  <a
                    href={`https://wa.me/${activeConv.phone}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: 'auto', background: '#25D366', color: '#fff', padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', textDecoration: 'none' }}
                  >
                    📱 Abrir no WhatsApp
                  </a>
                </div>

                {/* Mensagens */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#f0f0f0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {convMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#bbb', padding: '40px' }}>Carregando...</div>
                  ) : convMessages.map(msg => (
                    <div key={msg.id} style={{ display: 'flex', justifyContent: msg.from_me ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '8px 12px', borderRadius: msg.from_me ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        background: msg.from_me ? '#DCF8C6' : '#fff',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                        fontSize: '14px', color: '#333', lineHeight: '1.4',
                        wordBreak: 'break-word',
                      }}>
                        <div>{msg.message}</div>
                        <div style={{ fontSize: '10px', color: '#aaa', textAlign: 'right', marginTop: '3px' }}>{fmtTime(msg.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={threadBottomRef} />
                </div>

                {/* Input de resposta */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                    placeholder="Digite uma mensagem... (Enter para enviar)"
                    rows={2}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: '1.4' }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={!replyText.trim()}
                    style={{ background: !replyText.trim() ? '#eee' : '#25D366', color: !replyText.trim() ? '#aaa' : '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', cursor: !replyText.trim() ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '14px', flexShrink: 0 }}
                  >
                    Enviar ✓
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── PLANOS ───────────────────────────────────────────────────────────────────
  if (screen === 'plans') {
    const PLAN_INFO = {
      monthly:    { label: 'Mensal',    badge: null,                      color: '#667eea', savings: null },
      semiannual: { label: 'Semestral', badge: 'Mais popular',            color: '#f39c12', savings: 'Economize R$240/ano vs mensal' },
      annual:     { label: 'Anual',     badge: '⭐ Melhor valor',         color: '#2ecc71', savings: 'Economize R$960/ano vs mensal · 64% vs Premium' },
    };
    const canceled = new URLSearchParams(window.location.search).get('plan_canceled');
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', padding: '40px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <button onClick={() => { window.history.replaceState({}, '', '/'); setScreen(user ? 'admin' : 'menu'); }} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', marginBottom: '32px', fontSize: '14px', fontWeight: 'bold' }}>← Voltar</button>

          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏪</div>
            <h1 style={{ margin: 0, color: '#fff', fontSize: '32px' }}>Escolha seu plano</h1>
            <p style={{ color: 'rgba(255,255,255,0.85)', marginTop: '8px', fontSize: '16px' }}>Gerencie seu negócio com facilidade</p>
          </div>

          {stripeTestMode && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffe082', color: '#f57f17', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', textAlign: 'center', fontSize: '13px', fontWeight: '500' }}>
              ⚠️ Modo de teste ativo — cobranças não são reais. Use o cartão <strong>4242 4242 4242 4242</strong>.
            </div>
          )}
          {canceled && (
            <div style={{ background: '#ffebee', color: '#c62828', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', textAlign: 'center', fontWeight: '500' }}>
              Assinatura cancelada. Você pode tentar novamente quando quiser.
            </div>
          )}

          {/* Âncora Premium */}
          <div style={{ background: '#1a1a2e', borderRadius: '16px', padding: '20px 28px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>💎 Premium — Multilojas</div>
              <div style={{ color: '#fff', fontSize: '14px', marginBottom: '4px' }}>Até 3 lojas · Suporte prioritário 24h · API · Relatórios avançados</div>
              <div style={{ fontSize: '12px', color: '#888' }}>Somente anual · Para redes e franquias</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#fff', lineHeight: 1 }}>R$ 590</div>
              <div style={{ fontSize: '13px', color: '#888' }}>/mês</div>
              <button onClick={() => window.open('https://wa.me/55' + (vendorSettings?.phone || ''), '_blank')}
                style={{ marginTop: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                Solicitar →
              </button>
            </div>
          </div>

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
                  <div style={{ fontSize: '14px', color: '#999', marginBottom: '8px' }}>por mês</div>

                  {info.savings && (
                    <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '8px', padding: '6px 10px', marginBottom: '10px', fontSize: '12px', color: '#e65100', fontWeight: 'bold' }}>
                      🔥 {info.savings}
                    </div>
                  )}

                  {plan.months > 1 && (
                    <div style={{ background: '#f0f9f0', border: '1px solid #a5d6a7', borderRadius: '8px', padding: '8px 12px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', color: '#2e7d32', fontWeight: 'bold' }}>
                        Total: R$ {plan.total.toFixed(2).replace('.', ',')}
                      </div>
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

  const adminHeaderProps = {
    user, vendorSettings, planStatus, showAlert, emailConfirmed, onResendConfirmation: resendConfirmation,
    onLogout: logout,
    onNavigate: (s) => { setScreen(s); if (s === 'commissions-admin') fetchCommissions(); if (s === 'products-admin') fetchAdminProducts(); if (s === 'messages-admin') fetchConversations(); },
  };

  // ─── ADMIN DASHBOARD ─────────────────────────────────────────────────────────
  if (screen === 'admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }
    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="admin" {...adminHeaderProps} />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          {!dashboard ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>Carregando...</div>
          ) : (
            <>
              {/* Row 1: Pedidos hoje | Total de pedidos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                {[
                  { label: 'Pedidos Hoje', value: dashboard.ordersToday, icon: '📅', color: '#e74c3c' },
                  { label: 'Total de Pedidos', value: dashboard.totalOrders, icon: '📦', color: '#667eea' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${card.color}` }}>
                    <div style={{ fontSize: '24px', marginBottom: '6px' }}>{card.icon}</div>
                    <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>{card.label}</div>
                    <div style={{ fontSize: '22px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>
              {/* Row 2: Pendentes | Ticket médio */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                {[
                  { label: 'Pendente (em aberto)', value: `R$ ${dashboard.pendingRevenue || '0.00'}`, icon: '⏳', color: '#f39c12' },
                  { label: 'Ticket Médio', value: `R$ ${dashboard.averageTicket}`, icon: '📈', color: '#667eea' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${card.color}` }}>
                    <div style={{ fontSize: '24px', marginBottom: '6px' }}>{card.icon}</div>
                    <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>{card.label}</div>
                    <div style={{ fontSize: '22px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>
              {/* Row 3: Receita confirmada (full width) */}
              <div style={{ marginBottom: '24px' }}>
                {[{ label: 'Receita Confirmada', value: `R$ ${dashboard.totalRevenue}`, icon: '✅', color: '#2ecc71' }].map(card => (
                  <div key={card.label} style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: `4px solid ${card.color}` }}>
                    <div style={{ fontSize: '24px', marginBottom: '6px' }}>{card.icon}</div>
                    <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>{card.label}</div>
                    <div style={{ fontSize: '26px', fontWeight: 'bold', color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Status dos Pedidos</h3>
                {(() => {
                  const byStatus = dashboard.ordersByStatus || {};
                  const statusCard = (key) => (
                    <div key={key} style={{ background: STATUS_COLORS[key]?.bg || '#f5f5f5', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', fontWeight: 'bold', color: STATUS_COLORS[key]?.color || '#333' }}>{byStatus[key] ?? 0}</div>
                      <div style={{ color: '#666', marginTop: '4px', fontSize: '12px' }}>{STATUS_LABELS[key] || key}</div>
                    </div>
                  );
                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        {statusCard('aguardando_pagamento')}
                        {statusCard('confirmado')}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        {statusCard('em_preparo')}
                        {statusCard('pronto')}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        {statusCard('em_entrega')}
                        {statusCard('cancelado')}
                      </div>
                      <div>{statusCard('entregue')}</div>
                    </>
                  );
                })()}
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

    const updateOrderFee = async (orderId) => {
      const fee      = parseFloat(String(editingFeeVal).replace(',', '.'));
      const desconto = parseFloat(String(editingDesconto).replace(',', '.')) || 0;
      if (isNaN(fee) || fee < 0) { showAlert('Taxa inválida'); return; }
      try {
        await apiFetch(`/orders/${orderId}/fee`, {
          method: 'PATCH',
          body: JSON.stringify({ delivery_fee: fee, desconto, note: editingFeeNote.trim() || undefined }),
        });
        showAlert('Valor atualizado!', 'success');
        setEditingFeeId(null); setEditingFeeVal(''); setEditingDesconto(''); setEditingFeeNote('');
        fetchOrders(); fetchDashboard();
      } catch (err) { showAlert(err.message || 'Erro ao atualizar valor'); }
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
        <AdminHeader active="orders-admin" {...adminHeaderProps} />
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
                    {order.delivery_type === 'entrega' && order.customer?.address?.street && (
                      <div style={{ marginTop: '3px', color: '#3498db' }}><strong>📍 Endereço:</strong> {order.customer.address.street}{order.customer.address.neighborhood ? ` – ${order.customer.address.neighborhood}` : ''}</div>
                    )}
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
                    <div style={{ borderTop: '1px solid #eee', marginTop: '6px', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}><span>Subtotal</span><span>R$ {Number(order.subtotal || 0).toFixed(2)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          Taxa de entrega
                          {!['entregue','cancelado'].includes(order.status) && (
                            <button onClick={() => { setEditingFeeId(order.id); setEditingFeeVal(Number(order.delivery_fee).toFixed(2)); setEditingDesconto(''); setEditingFeeNote(''); }} style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>✏️</button>
                          )}
                        </span>
                        <span>R$ {Number(order.delivery_fee || 0).toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: '#667eea', fontSize: '14px' }}><span>Total</span><span>R$ {Number(order.total).toFixed(2)}</span></div>
                    </div>
                  </div>

                  {editingFeeId === order.id && (
                    <div style={{ background: '#f0f4ff', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '10px', color: '#333' }}>✏️ Ajustar valor do pedido</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '600' }}>Taxa de entrega (R$)</label>
                          <input type="number" step="0.01" min="0" value={editingFeeVal} onChange={e => setEditingFeeVal(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '600' }}>Desconto (R$)</label>
                          <input type="number" step="0.01" min="0" value={editingDesconto} onChange={e => setEditingDesconto(e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '600' }}>Observação (enviada ao cliente)</label>
                        <input type="text" value={editingFeeNote} onChange={e => setEditingFeeNote(e.target.value)} placeholder="Ex: desconto de fidelidade" style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }} />
                      </div>
                      <div style={{ fontSize: '12px', color: '#667eea', fontWeight: 'bold', marginBottom: '10px' }}>
                        Novo total: R$ {(Math.max(0, Number(order.subtotal || 0) + (parseFloat(String(editingFeeVal).replace(',','.')) || 0) - (parseFloat(String(editingDesconto).replace(',','.')) || 0))).toFixed(2)}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => updateOrderFee(order.id)} style={{ background: '#667eea', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>✓ Salvar</button>
                        <button onClick={() => setEditingFeeId(null)} style={{ background: '#f5f5f5', color: '#555', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
                      </div>
                    </div>
                  )}

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

    const scrollToForm = () => setTimeout(() => document.getElementById('product-form-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    const openNew = () => { const firstCat = getCategories(vendorSettings?.categories)[0]?.id || 'base'; setProductForm({ name: '', description: '', price: '', category: firstCat, emoji: '🫐', calories: '', ingredients: '', allergens: '' }); setEditingProduct(null); setShowProductForm(true); scrollToForm(); };
    const openEdit = (p) => { setProductForm({ name: p.name, description: p.description || '', price: p.price, category: p.category, emoji: p.icon || p.emoji || '🫐', calories: p.calories || '', ingredients: p.ingredients || '', allergens: p.allergens || '' }); setEditingProduct({ ...p }); setShowProductForm(true); scrollToForm(); };

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
        <AdminHeader active="products-admin" {...adminHeaderProps} />
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>🛍️ Produtos</h2>
            <Btn onClick={openNew}>+ Novo Produto</Btn>
          </div>

          {showProductForm && (
            <div id="product-form-anchor" style={{ background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <h3 style={{ marginTop: 0 }}>{editingProduct ? 'Editar Produto' : 'Novo Produto'}</h3>
              <form onSubmit={saveProduct}>
                <div className="product-form-grid">
                  <Input label="Nome *" value={productForm.name} onChange={e => setProductForm(f => ({...f, name: e.target.value}))} required placeholder="Açaí Tradicional" />
                  <Input label="Preço *" type="number" step="0.01" value={productForm.price} onChange={e => setProductForm(f => ({...f, price: e.target.value}))} required placeholder="24.90" />
                  <Select label="Categoria *" value={productForm.category} onChange={e => setProductForm(f => ({...f, category: e.target.value}))}>
                    {getCategories(vendorSettings?.categories).map(c => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                    ))}
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

          {getCategories(vendorSettings?.categories).map(cat => {
            const catProducts = products.filter(p => p.category === cat.id);
            if (!catProducts.length) return null;
            return (
              <div key={cat.id} style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', opacity: cat.enabled === false ? 0.6 : 1 }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px', color: '#667eea' }}>{cat.emoji} {cat.label}{cat.enabled === false ? ' (desativada)' : ''}</h3>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {catProducts.map(p => (
                    <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '12px', background: '#f9f9f9', borderRadius: '8px', opacity: p.available === false ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '160px' }}>
                        <span style={{ fontSize: '28px' }}>{p.icon}</span>
                        <div>
                          <div style={{ fontWeight: 'bold', color: '#333' }}>{p.name}</div>
                          <div style={{ fontSize: '13px', color: '#999' }}>{p.description}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 'bold', color: '#667eea', fontSize: '16px' }}>R$ {Number(p.price).toFixed(2)}</span>
                        <button onClick={() => toggleAvailable(p)} style={{ background: p.available !== false ? '#e8f5e9' : '#ffebee', color: p.available !== false ? '#2e7d32' : '#c62828', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                          {p.available !== false ? '✓ Ativo' : '✗ Pausado'}
                        </button>
                        <button onClick={() => openEdit(p)} style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>✏️ Editar</button>
                        <button onClick={() => deleteProduct(p.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>🗑️</button>
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
        <AdminHeader active="deliverers-admin" {...adminHeaderProps} />
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 20px' }}>
          <Alert msg={alert.msg} type={alert.type} />

          {/* Logo da Loja */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '12px' }}>🖼️ Logo da Loja</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {vendorSettings?.logo_url
                ? <img src={vendorSettings.logo_url} alt="Logo" style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #eee' }} />
                : <div style={{ width: '72px', height: '72px', background: '#f0e7ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>🫐</div>
              }
              <div>
                <div style={{ fontSize: '13px', color: '#999', marginBottom: '8px' }}>
                  {vendorSettings?.logo_url ? 'Logo exibida no topo do cardápio' : 'Sem logo — exibindo emoji padrão'}
                </div>
                <input type="file" id="logo-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files[0]; if (!file) return;
                  if (file.size > 5 * 1024 * 1024) { showAlert('Imagem muito grande (máx. 5MB)'); e.target.value = ''; return; }
                  setLoading(true);
                  try {
                    const headers = { 'Content-Type': file.type };
                    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                    const res = await fetch(`${API_URL}/vendors/logo`, { method: 'PUT', credentials: 'include', headers, body: file });
                    const data = await res.json().catch(() => ({ error: 'Erro no upload' }));
                    if (!res.ok) throw new Error(data.error || 'Erro no upload');
                    setVendorSettings(prev => ({ ...prev, logo_url: data.logo_url }));
                    showAlert('Logo atualizada!', 'success');
                  } catch (err) { showAlert('Erro: ' + err.message); }
                  finally { setLoading(false); e.target.value = ''; }
                }} />
                <label htmlFor="logo-upload" style={{ background: '#667eea', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', display: 'inline-block' }}>
                  {loading ? 'Enviando...' : vendorSettings?.logo_url ? '🔄 Trocar Logo' : '📤 Enviar Logo'}
                </label>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: '#bbb', marginTop: '10px' }}>JPG, PNG ou WEBP · Máx. 5MB · Recomendado: formato quadrado (200×200px)</div>
          </div>

          {/* Chave PIX */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>📱 Chave PIX</div>
              <div style={{ fontSize: '13px', color: '#999', marginTop: '3px' }}>
                {vendorSettings?.pix_key
                  ? <><strong style={{ color: '#333' }}>{vendorSettings.pix_key}</strong> — exibida automaticamente ao cliente</>
                  : 'Não configurada — chave será enviada manualmente pelo WhatsApp'}
              </div>
            </div>
            <button
              onClick={async () => {
                const input = window.prompt('Sua chave PIX (CPF, email, telefone ou chave aleatória):', vendorSettings?.pix_key || '');
                if (input === null) return;
                try {
                  const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ pix_key: input.trim() || null }) });
                  setVendorSettings(prev => ({ ...prev, ...data }));
                  showAlert('Chave PIX salva!', 'success');
                } catch (err) { showAlert(err.message || 'Erro ao salvar chave PIX'); }
              }}
              style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flexShrink: 0, marginLeft: '12px' }}
            >{vendorSettings?.pix_key ? '✏️ Alterar' : '+ Configurar'}</button>
          </div>

          {/* Link da Loja */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '12px' }}>🔗 Link da sua loja</div>
            {!editingSlug && vendorSettings?.slug ? (
              <div style={{ background: '#f0e7ff', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ color: '#667eea', fontSize: '13px', fontWeight: 'bold', wordBreak: 'break-all', flex: 1 }}>
                  {window.location.origin}{window.location.pathname}?loja={vendorSettings.slug}
                </span>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?loja=${vendorSettings.slug}`).then(() => showAlert('Link copiado!', 'success'))}
                    style={{ background: '#667eea', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>📋 Copiar</button>
                  <button onClick={() => { setSlugInput(vendorSettings.slug); setEditingSlug(true); }}
                    style={{ background: '#f5f5f5', color: '#555', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>✏️ Alterar</button>
                </div>
              </div>
            ) : null}
            {!editingSlug && !vendorSettings?.slug ? (
              <div style={{ background: '#fff8e1', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px' }}>
                <p style={{ margin: '0 0 10px', color: '#f57f17', fontSize: '14px' }}>⚠️ Link não configurado — clientes não conseguem acessar sua loja</p>
                <button onClick={() => { setSlugInput(''); setEditingSlug(true); }}
                  style={{ background: '#f57f17', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>Configurar Link</button>
              </div>
            ) : null}
            {editingSlug ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="minha-loja"
                  style={{ flex: 1, minWidth: '160px', padding: '10px 12px', border: '2px solid #667eea', borderRadius: '8px', fontSize: '14px' }}
                  autoFocus
                />
                <button onClick={async () => {
                  if (!slugInput.trim()) { showAlert('Digite um link válido'); return; }
                  try {
                    const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ slug: slugInput.trim() }) });
                    setVendorSettings(prev => ({ ...prev, ...data }));
                    setEditingSlug(false);
                    showAlert('Link salvo!', 'success');
                  } catch (err) { showAlert(err.message || 'Erro ao salvar link'); }
                }} style={{ background: '#667eea', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>Salvar</button>
                <button onClick={() => setEditingSlug(false)}
                  style={{ background: '#f5f5f5', color: '#555', border: 'none', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>Cancelar</button>
              </div>
            ) : null}
            <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>Use apenas letras minúsculas, números e hífens. Ex: açaí-da-maria</div>
          </div>

          {/* Configuração de entregas */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

          {/* Taxa de entrega */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>💲 Taxa de entrega</div>
              <div style={{ fontSize: '13px', color: '#999', marginTop: '3px' }}>Valor cobrado do cliente em pedidos de entrega</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '18px', color: '#667eea' }}>
                R$ {Number(vendorSettings?.delivery_fee ?? 5).toFixed(2)}
              </span>
              <button
                onClick={async () => {
                  const input = window.prompt('Nova taxa de entrega (R$):', Number(vendorSettings?.delivery_fee ?? 5).toFixed(2));
                  if (input === null) return;
                  const val = parseFloat(input.replace(',', '.'));
                  if (isNaN(val) || val < 0) { showAlert('Valor inválido'); return; }
                  try {
                    const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ delivery_fee: val }) });
                    setVendorSettings(prev => ({ ...prev, ...data }));
                    showAlert('Taxa atualizada!', 'success');
                  } catch (err) { showAlert(err.message); }
                }}
                style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >✏️ Alterar</button>
            </div>
          </div>

          {/* Configuração WhatsApp Z-API */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>💬 WhatsApp (Z-API)</div>
            <div style={{ fontSize: '13px', color: '#999', marginBottom: '14px' }}>
              Suas credenciais Z-API para envio de notificações e recebimento de mensagens.{' '}
              <span style={{ color: '#667eea' }}>Webhook URL: <strong>{`${process.env.REACT_APP_API_URL || ''}/webhooks/whatsapp?vendor_id=SEU_ID&secret=ZAPI_WEBHOOK_SECRET`}</strong></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '600' }}>Instance ID</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    defaultValue={vendorSettings?.zapi_instance_id || ''}
                    id="zapi-instance"
                    placeholder="3F5067BC38..."
                    style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '600' }}>Token</label>
                <input
                  defaultValue={vendorSettings?.zapi_token || ''}
                  id="zapi-token"
                  placeholder="968911A8C0..."
                  type="password"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={async () => {
                  const instance = document.getElementById('zapi-instance').value.trim();
                  const token    = document.getElementById('zapi-token').value.trim();
                  try {
                    const data = await apiFetch('/vendors/settings', {
                      method: 'PATCH',
                      body: JSON.stringify({ zapi_instance_id: instance || null, zapi_token: token || null }),
                    });
                    setVendorSettings(prev => ({ ...prev, ...data }));
                    showAlert('Configuração WhatsApp salva!', 'success');
                  } catch (err) { showAlert(err.message || 'Erro ao salvar'); }
                }}
                style={{ background: '#25D366', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >💾 Salvar</button>
            </div>
          </div>

          {/* Gerenciar Categorias */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>🏷️ Categorias do Cardápio</div>
              <button onClick={() => { setShowNewCatForm(v => !v); setNewCatForm({ label: '', emoji: '🍦' }); }}
                style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                {showNewCatForm ? '✕ Cancelar' : '+ Nova'}
              </button>
            </div>

            {showNewCatForm && (
              <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '14px', marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <label style={{ fontSize: '12px', color: '#666', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Emoji</label>
                  <input value={newCatForm.emoji} onChange={e => setNewCatForm(f => ({ ...f, emoji: e.target.value }))}
                    style={{ width: '60px', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '20px', textAlign: 'center' }} maxLength={4} />
                </div>
                <div style={{ flex: 3, minWidth: '140px' }}>
                  <label style={{ fontSize: '12px', color: '#666', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Nome da categoria *</label>
                  <input value={newCatForm.label} onChange={e => setNewCatForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="Ex: Sorvetes" style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <button onClick={async () => {
                  if (!newCatForm.label.trim()) { showAlert('Digite um nome'); return; }
                  const id = newCatForm.label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40);
                  if (!id) { showAlert('Nome inválido'); return; }
                  const existing = getCategories(vendorSettings?.categories);
                  if (existing.find(c => c.id === id)) { showAlert('Já existe uma categoria com esse nome'); return; }
                  const updated = [...existing, { id, label: newCatForm.label.trim(), emoji: newCatForm.emoji.trim() || '🍦', enabled: true }];
                  try {
                    const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ categories: updated }) });
                    setVendorSettings(prev => ({ ...prev, ...data }));
                    setShowNewCatForm(false);
                    showAlert('Categoria adicionada!', 'success');
                  } catch (err) { showAlert(err.message || 'Erro'); }
                }} style={{ background: '#667eea', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', alignSelf: 'flex-end' }}>Salvar</button>
              </div>
            )}

            <div style={{ display: 'grid', gap: '8px' }}>
              {getCategories(vendorSettings?.categories).map((cat, idx, arr) => (
                <div key={cat.id} style={{ background: '#f9f9f9', borderRadius: '8px', overflow: 'hidden', opacity: cat.enabled === false ? 0.65 : 1 }}>
                  {editingCatIdx === idx ? (
                    <div style={{ padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <input value={editCatForm.emoji} onChange={e => setEditCatForm(f => ({ ...f, emoji: e.target.value }))}
                        style={{ width: '56px', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '18px', textAlign: 'center' }} maxLength={4} />
                      <input value={editCatForm.label} onChange={e => setEditCatForm(f => ({ ...f, label: e.target.value }))}
                        style={{ flex: 1, minWidth: '120px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }} />
                      <button onClick={async () => {
                        if (!editCatForm.label.trim()) { showAlert('Nome inválido'); return; }
                        const updated = arr.map((c, i) => i === idx ? { ...c, label: editCatForm.label.trim(), emoji: editCatForm.emoji.trim() || c.emoji } : c);
                        try {
                          const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ categories: updated }) });
                          setVendorSettings(prev => ({ ...prev, ...data }));
                          setEditingCatIdx(null);
                          showAlert('Categoria atualizada!', 'success');
                        } catch (err) { showAlert(err.message || 'Erro'); }
                      }} style={{ background: '#667eea', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>Salvar</button>
                      <button onClick={() => setEditingCatIdx(null)} style={{ background: '#eee', color: '#555', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                      <span style={{ fontSize: '22px' }}>{cat.emoji}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{cat.label}</div>
                        <div style={{ fontSize: '11px', color: '#bbb' }}>{cat.id}</div>
                      </div>
                      <button onClick={() => { setEditingCatIdx(idx); setEditCatForm({ label: cat.label, emoji: cat.emoji }); }}
                        style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>✏️</button>
                      <button onClick={async () => {
                        const updated = arr.map((c, i) => i === idx ? { ...c, enabled: c.enabled === false } : c);
                        try {
                          const data = await apiFetch('/vendors/settings', { method: 'PATCH', body: JSON.stringify({ categories: updated }) });
                          setVendorSettings(prev => ({ ...prev, ...data }));
                          showAlert(cat.enabled === false ? 'Ativada!' : 'Desativada!', 'success');
                        } catch (err) { showAlert(err.message || 'Erro'); }
                      }} style={{ background: cat.enabled === false ? '#e8f5e9' : '#ffebee', color: cat.enabled === false ? '#2e7d32' : '#c62828', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                        {cat.enabled === false ? '✓ Ativar' : '✗ Desativar'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>🚴 Entregadores</h2>
            <Btn onClick={openNew}>+ Novo Entregador</Btn>
          </div>

          {showDelivererForm && (
            <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <h3 style={{ marginTop: 0 }}>{editingDel ? 'Editar Entregador' : 'Novo Entregador'}</h3>
              <form onSubmit={saveDel}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
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
                <div key={d.id} style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', opacity: d.status === 'inactive' ? 0.6 : 1 }}>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>🚴 {d.name}</div>
                    <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                      📱 {d.phone}
                      {d.vehicle && <span style={{ marginLeft: '10px' }}>🏍️ {d.vehicle}</span>}
                    </div>
                    <div style={{ fontSize: '13px', color: '#667eea', marginTop: '2px', fontWeight: 'bold' }}>Comissão: {d.commission_rate}% da taxa de entrega</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => toggleStatus(d)} style={{ background: d.status === 'active' ? '#e8f5e9' : '#ffebee', color: d.status === 'active' ? '#2e7d32' : '#c62828', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flex: 1, minWidth: '100px' }}>
                      {d.status === 'active' ? '✓ Ativo' : '✗ Inativo'}
                    </button>
                    <button onClick={() => openEdit(d)} style={{ background: '#f0e7ff', color: '#667eea', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flex: 1, minWidth: '100px' }}>✏️ Editar</button>
                    <button onClick={() => deleteDel(d.id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flex: 1, minWidth: '100px' }}>🗑️ Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── TUTORIAL ────────────────────────────────────────────────────────────────
  if (screen === 'tutorial-admin') {
    if (!sessionLoaded) return null;
    if (!user) { setScreen('login'); return null; }

    const slug = vendorSettings?.slug;
    const cardapioUrl = slug ? `${window.location.origin}${window.location.pathname}?loja=${slug}` : null;

    const steps = [
      {
        num: '1', icon: '🏪', title: 'Configure sua loja',
        desc: 'Vá em Configuração → defina o link da loja, chave PIX e taxa de entrega.',
        action: () => setScreen('deliverers-admin'),
        btn: 'Ir para Configuração',
        done: !!(vendorSettings?.slug && vendorSettings?.pix_key),
      },
      {
        num: '2', icon: '🖼️', title: 'Adicione sua logo',
        desc: 'Em Configuração → envie a logo da sua loja. Ela aparece no topo do cardápio.',
        action: () => setScreen('deliverers-admin'),
        btn: 'Ir para Configuração',
        done: !!vendorSettings?.logo_url,
      },
      {
        num: '3', icon: '🛍️', title: 'Cadastre seus produtos',
        desc: 'Vá em Produtos → clique em "+ Novo Produto" → preencha nome, preço, categoria e foto.',
        action: () => setScreen('products-admin'),
        btn: 'Ir para Produtos',
        done: products.length > 0,
      },
      {
        num: '4', icon: '🔗', title: 'Compartilhe seu cardápio',
        desc: cardapioUrl ? `Seu link: ${cardapioUrl}` : 'Configure o link da loja primeiro (passo 1).',
        action: cardapioUrl ? () => { navigator.clipboard?.writeText(cardapioUrl); showAlert('Link copiado!', 'success'); } : () => setScreen('deliverers-admin'),
        btn: cardapioUrl ? '📋 Copiar link' : 'Configurar link',
        done: !!cardapioUrl,
      },
      {
        num: '5', icon: '💬', title: 'Conecte o WhatsApp (opcional)',
        desc: 'Em Configuração → Z-API: conecte seu WhatsApp para receber pedidos automaticamente.',
        action: () => setScreen('deliverers-admin'),
        btn: 'Ir para Configuração',
        done: !!(vendorSettings?.zapi_instance_id && vendorSettings?.zapi_token),
      },
      {
        num: '6', icon: '📦', title: 'Gerencie seus pedidos',
        desc: 'Em Pedidos você vê todos os pedidos em tempo real. Atualize o status para o cliente acompanhar.',
        action: () => setScreen('orders-admin'),
        btn: 'Ver Pedidos',
        done: orders.length > 0,
      },
    ];

    const doneCount = steps.filter(s => s.done).length;
    const pct = Math.round((doneCount / steps.length) * 100);

    return (
      <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
        <AdminHeader active="tutorial-admin" {...adminHeaderProps} />
        <div className="admin-page-inner">
          <Alert msg={alert.msg} type={alert.type} />

          {/* Cabeçalho */}
          <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '16px', padding: '28px', marginBottom: '28px', color: '#fff' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📖</div>
            <h2 style={{ margin: '0 0 6px' }}>Primeiros Passos</h2>
            <p style={{ margin: '0 0 16px', opacity: 0.85, fontSize: '15px' }}>Siga este guia para configurar sua loja e receber seu primeiro pedido.</p>
            {/* Barra de progresso */}
            <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '8px', height: '10px', marginBottom: '8px' }}>
              <div style={{ background: '#fff', borderRadius: '8px', height: '10px', width: `${pct}%`, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: '13px', opacity: 0.9 }}>{doneCount} de {steps.length} etapas concluídas · {pct}%</div>
          </div>

          {/* Passos */}
          <div style={{ display: 'grid', gap: '14px', marginBottom: '28px' }}>
            {steps.map(step => (
              <div key={step.num} style={{ background: '#fff', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', gap: '16px', alignItems: 'flex-start', borderLeft: `4px solid ${step.done ? '#2ecc71' : '#667eea'}`, opacity: step.done ? 0.8 : 1 }}>
                <div style={{ fontSize: '28px', flexShrink: 0, marginTop: '2px' }}>{step.done ? '✅' : step.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>{step.num}. {step.title}</span>
                    {step.done && <span style={{ background: '#e8f5e9', color: '#2e7d32', fontSize: '11px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '20px' }}>Concluído</span>}
                  </div>
                  <p style={{ margin: '0 0 12px', color: '#666', fontSize: '14px', lineHeight: '1.5', wordBreak: 'break-all' }}>{step.desc}</p>
                  <button onClick={step.action} style={{ background: step.done ? '#f5f5f5' : '#667eea', color: step.done ? '#666' : '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                    {step.btn}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Dicas rápidas */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <h3 style={{ margin: '0 0 16px', color: '#333' }}>💡 Dicas rápidas</h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {[
                ['📱', 'Instale o app no celular', 'Abra o cardápio no Chrome e toque em "Adicionar à tela inicial" para usar como app.'],
                ['🔄', 'Atualize o status dos pedidos', 'Marque como "Em preparo", "Pronto" e "Entregue" — o cliente acompanha em tempo real.'],
                ['📸', 'Foto faz vender mais', 'Produtos com foto vendem até 3× mais. Adicione imagens em alta qualidade.'],
                ['🎯', 'Categorias organizam o cardápio', 'Crie categorias como "Promoções", "Mais pedidos" para destacar produtos.'],
                ['💰', 'Configure o PIX antes de divulgar', 'Sem PIX cadastrado o cliente não consegue finalizar o pedido com pagamento online.'],
              ].map(([icon, title, tip]) => (
                <div key={title} style={{ display: 'flex', gap: '12px', padding: '12px', background: '#f9f9f9', borderRadius: '8px' }}>
                  <span style={{ fontSize: '20px', flexShrink: 0 }}>{icon}</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#333', marginBottom: '2px' }}>{title}</div>
                    <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>{tip}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
        <AdminHeader active="commissions-admin" {...adminHeaderProps} />
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
  // ─── PREVIEW DE PLANOS (antes do cadastro) ───────────────────────────────────
  if (screen === 'plans-preview') {
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '20px', padding: '36px 28px', maxWidth: '560px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '40px', marginBottom: '6px' }}>🏪</div>
            <h1 style={{ margin: '0 0 4px', fontSize: '21px', color: '#333' }}>Comece com 14 dias grátis</h1>
            <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>Sem cartão de crédito. Cancele quando quiser.</p>
          </div>

          {/* Âncora Premium */}
          <div style={{ background: '#1a1a2e', borderRadius: '12px', padding: '14px 18px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>💎 Premium — Multilojas</div>
              <div style={{ color: '#fff', fontSize: '13px' }}>Até 3 lojas · Suporte 24h · API · Relatórios</div>
              <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Somente anual</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>R$590</div>
              <div style={{ fontSize: '10px', color: '#888' }}>/mês</div>
            </div>
          </div>

          {/* Planos reais — grade 3 colunas */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '20px' }}>
            {[
              { id: 'monthly',    label: 'Mensal',    price: 290, months: 1,  badge: null,                badgeColor: null,     highlight: false },
              { id: 'semiannual', label: 'Semestral', price: 250, months: 6,  badge: 'Popular',           badgeColor: '#f39c12', highlight: false },
              { id: 'annual',     label: 'Anual',     price: 210, months: 12, badge: '⭐ Melhor valor',   badgeColor: '#667eea', highlight: true  },
            ].map(p => (
              <div key={p.id} style={{ border: p.highlight ? '2px solid #667eea' : '1px solid #e0e0e0', borderRadius: '12px', padding: '12px 8px', textAlign: 'center', position: 'relative', background: p.highlight ? '#f8f6ff' : '#fff' }}>
                {p.badge && (
                  <div style={{ position: 'absolute', top: '-9px', left: '50%', transform: 'translateX(-50%)', background: p.badgeColor, color: '#fff', fontSize: '9px', padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>{p.badge}</div>
                )}
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{p.label}</div>
                <div style={{ fontSize: '21px', fontWeight: 'bold', color: p.highlight ? '#667eea' : '#333' }}>R${p.price}</div>
                <div style={{ fontSize: '10px', color: '#aaa' }}>/mês</div>
                {p.months > 1 && (
                  <div style={{ fontSize: '10px', color: '#2ecc71', marginTop: '3px', fontWeight: 'bold' }}>
                    −{Math.round((1 - p.price / 290) * 100)}% vs mensal
                  </div>
                )}
                <div style={{ fontSize: '10px', color: '#c0392b', marginTop: '2px', fontWeight: 'bold' }}>
                  −{Math.round((1 - p.price / 590) * 100)}% vs Premium
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: '#f8f9ff', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {['Cardápio online personalizado', 'Pedidos + notificações WhatsApp', 'PIX automático no 1º contato', 'Painel de gestão completo'].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#555' }}>
                <span style={{ color: '#2ecc71', fontWeight: 'bold' }}>✓</span> {item}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button onClick={() => setScreen('register')} style={{ width: '100%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', border: 'none', padding: '14px', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              Criar conta e começar trial →
            </button>
            <button onClick={() => setScreen('login')} style={{ width: '100%', background: 'none', border: '1px solid #e0e0e0', color: '#667eea', padding: '11px', borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}>
              Já tenho conta — entrar
            </button>
          </div>

          <p style={{ fontSize: '11px', color: '#bbb', textAlign: 'center', margin: '14px 0 0' }}>
            Após o trial a conta é bloqueada até a assinatura de um plano.
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'register') {
    const pwChecks = {
      len:     regPassword.length >= 8,
      upper:   /[A-Z]/.test(regPassword),
      number:  /[0-9]/.test(regPassword),
      special: /[^A-Za-z0-9]/.test(regPassword),
    };
    const pwStrength = Object.values(pwChecks).filter(Boolean).length;
    const pwColors = ['#ddd','#e74c3c','#f39c12','#f39c12','#2ecc71'];
    const pwLabels = ['','Fraca','Fraca','Média','Forte'];

    const handleRegister = async (e) => {
      e.preventDefault();
      if (!Object.values(pwChecks).every(Boolean)) { showAlert('A senha não atende todos os requisitos'); return; }
      setLoading(true);
      try {
        const data = await apiFetch('/auth/register-vendor', {
          method: 'POST',
          body: JSON.stringify({
            name:          e.target.name.value.trim(),
            email:         e.target.email.value.trim(),
            password:      regPassword,
            phone:         e.target.phone.value.trim(),
            address:       e.target.address.value.trim(),
            cpf:           e.target.cpf.value.trim(),
            business_type: e.target.business_type.value,
          }),
        });
        if (data.token) authToken = data.token;
        setUser(data.vendor);
        setEmailConfirmed(false);
        setScreen('verify-email-pending');
      } catch (err) { showAlert(err.message || 'Erro ao criar conta'); }
      finally { setLoading(false); }
    };
    return (
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🏪</div>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', color: '#333' }}>Criar sua conta</h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#999' }}>14 dias grátis, sem cartão</p>
          </div>
          <Alert msg={alert.msg} type={alert.type} />
          <form onSubmit={handleRegister}>
            <Select label="Tipo de negócio *" name="business_type" required>
              <option value="acai">🫐 Açaí</option>
              <option value="confeitaria">🎂 Confeitaria / Bolos</option>
              <option value="pizzaria">🍕 Pizzaria</option>
              <option value="hamburgueria">🍔 Hamburgueria</option>
              <option value="restaurante">🍽️ Restaurante</option>
              <option value="mercado">🛒 Mercado / Loja</option>
              <option value="outro">🏪 Outro</option>
            </Select>
            <Input label="Nome da loja / Responsável *" id="name" name="name" required placeholder="Nome do seu estabelecimento" />
            <Input label="Email *" id="email" name="email" type="email" required placeholder="joao@email.com" />
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#444', fontSize: '14px' }}>Senha *</label>
              <input
                type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)}
                required placeholder="••••••••"
                style={{ width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              />
              {regPassword.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i <= pwStrength ? pwColors[pwStrength] : '#eee', transition: 'background 0.2s' }} />
                    ))}
                    <span style={{ fontSize: '11px', color: pwColors[pwStrength], fontWeight: 'bold', marginLeft: '6px', whiteSpace: 'nowrap' }}>{pwLabels[pwStrength]}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                    {[
                      [pwChecks.len,     '8+ caracteres'],
                      [pwChecks.upper,   'Letra maiúscula'],
                      [pwChecks.number,  'Número'],
                      [pwChecks.special, 'Caractere especial'],
                    ].map(([ok, label]) => (
                      <span key={label} style={{ fontSize: '12px', color: ok ? '#2ecc71' : '#999' }}>{ok ? '✓' : '○'} {label}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
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
