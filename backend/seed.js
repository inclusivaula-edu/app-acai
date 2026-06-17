// ============================================
// SEED — Açaí Shop (Supabase)
// Uso: node seed.js
// ============================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRODUCTS = [
  { name: 'Açaí Tradicional',    description: 'Açaí 500ml com granola e mel',           price: 24.90, category: 'base',       emoji: '🫐' },
  { name: 'Açaí Energético',     description: 'Açaí + banana + cacau + granola',         price: 29.90, category: 'base',       emoji: '⚡' },
  { name: 'Açaí Tropicale',      description: 'Açaí + morango + coco + mel',             price: 32.90, category: 'base',       emoji: '🍓' },
  { name: 'Açaí Premium',        description: 'Açaí + frutas vermelhas + nuts + mel',    price: 39.90, category: 'base',       emoji: '👑' },
  { name: 'Vitamina de Morango', description: 'Morango + leite + mel',                   price: 19.90, category: 'bebidas',    emoji: '🥤' },
  { name: 'Suco Detox',          description: 'Maçã + gengibre + limão',                 price: 16.90, category: 'bebidas',    emoji: '🥒' },
  { name: 'Milkshake Chocolate', description: 'Chocolate + leite + sorvete',             price: 21.90, category: 'bebidas',    emoji: '🍫' },
  { name: 'Granola Extra',       description: 'Porção extra de granola artesanal',       price:  8.90, category: 'adicionais', emoji: '🥣' },
  { name: 'Mel + Castanha',      description: 'Mel puro + castanha de caju',             price:  7.90, category: 'adicionais', emoji: '🍯' },
  { name: 'Frutas Frescas',      description: 'Mix de frutas vermelhas frescas',         price:  9.90, category: 'adicionais', emoji: '🍒' },
];

async function seed() {
  console.log('🫐 Iniciando seed...\n');

  // Verificar conexão
  const { error: pingErr } = await supabase.from('vendors').select('id').limit(1);
  if (pingErr) {
    console.error('❌ Erro de conexão com Supabase:', pingErr.message);
    console.error('   Verifique SUPABASE_URL e SUPABASE_SERVICE_KEY no .env');
    process.exit(1);
  }
  console.log('✅ Supabase conectado');

  // Criar ou reutilizar vendor
  const EMAIL = 'admin@acaishop.com';
  let vendor;

  const { data: existing } = await supabase
    .from('vendors')
    .select('*')
    .eq('email', EMAIL)
    .maybeSingle();

  if (existing) {
    vendor = existing;
    console.log('ℹ️  Vendor já existe, reutilizando');
  } else {
    const hashed = await bcrypt.hash('Admin@123456', 12);
    const { data, error } = await supabase
      .from('vendors')
      .insert({
        email: EMAIL, password: hashed,
        name: 'Açaí Shop Admin', phone: '(11) 99999-0000',
        address: 'Rua das Frutas, 1', cpf: '00000000000'
      })
      .select()
      .single();

    if (error) { console.error('❌ Erro ao criar vendor:', error.message); process.exit(1); }
    vendor = data;
    console.log('✅ Vendor criado');
  }

  // Recriar produtos
  await supabase.from('products').delete().eq('vendor_id', vendor.id);

  const { data: created, error: pErr } = await supabase
    .from('products')
    .insert(PRODUCTS.map(p => ({ ...p, vendor_id: vendor.id })))
    .select();

  if (pErr) { console.error('❌ Erro ao criar produtos:', pErr.message); process.exit(1); }
  console.log(`✅ ${created.length} produtos criados`);

  console.log('\n🎉 Seed concluído!');
  console.log('─────────────────────────────');
  console.log('  Email: admin@acaishop.com');
  console.log('  Senha: Admin@123456');
  console.log('  ID:   ', vendor.id);
  console.log('─────────────────────────────');
  console.log('\n⚠️  Troque a senha após o primeiro login!\n');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });