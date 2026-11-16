import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ================= constantes ================= */
const COLORS = {
  laranja:  ['#F06A1F', '#fff'],
  rosa:     ['#E8457F', '#fff'],
  azul:     ['#2A7FE0', '#fff'],
  roxo:     ['#8455F0', '#fff'],
  amarelo:  ['#FFC233', '#2A1F4A'],
  turquesa: ['#0B9AAA', '#fff'],
};
const SPECIES = { cao: ['🐶', 'Cachorro'], gato: ['🐱', 'Gato'], ave: ['🐦', 'Ave'], roedor: ['🐹', 'Roedor'], coelho: ['🐰', 'Coelho'], outro: ['🐾', 'Outro'] };
const HIST_DAYS = 14;
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* ================= estado ================= */
const S = {
  session: null, uid: null, nick: null,
  households: [], hid: null, house: null,
  pets: [], meds: [], doses: {}, members: [], names: {},
  petId: null, view: 'hoje', screen: 'loading', authEmail: '',
  channel: null, now: new Date(),
};
const store = {
  get: k => { try { return localStorage.getItem('dcp.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('dcp.' + k) : localStorage.setItem('dcp.' + k, v); } catch {} },
};
S.view = store.get('view') || 'hoje';

/* ================= utilidades ================= */
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const hm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const slotKey = (medId, date, slot) => `${medId}|${date}|${slot}`;
const dayName = s => {
  const t = ymd(S.now);
  if (s === t) return 'Hoje';
  if (s === ymd(addDays(S.now, -1))) return 'Ontem';
  if (s === ymd(addDays(S.now, 1))) return 'Amanhã';
  const d = parseYmd(s); const w = WD[d.getDay()];
  return `${w[0].toUpperCase() + w.slice(1)}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};
const emoji = p => (SPECIES[p?.species] || SPECIES.outro)[0];
const petVars = p => { const [c, ink] = COLORS[p?.color] || COLORS.roxo; return `--pet:${c};--pet-ink:${ink};--c:${c}`; };
const nameOf = uid => (uid && S.names[uid]) || 'Alguém';
const initials = n => (n || '?').trim().slice(0, 1).toUpperCase();

function toast(msg, warn = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (warn ? ' warn' : '');
  t.textContent = msg;
  document.getElementById('toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}
function applyPetTheme(p) {
  const [c, ink] = COLORS[p?.color] || COLORS.roxo;
  document.documentElement.style.setProperty('--pet', c);
  document.documentElement.style.setProperty('--pet-ink', ink);
}
function errMsg(e) {
  const m = e?.message || '';
  if (m.includes('codigo_invalido')) return 'Esse código não existe. Confira com quem te convidou.';
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'Sem conexão. Tente de novo quando a internet voltar.';
  console.error('Supabase:', e);
  if (e?.code === '42501') return 'Você não tem permissão para isso nesta casa.';
  return 'Algo deu errado. Tente de novo.';
}

/* ================= agenda ================= */
const medsOf = (petId, all = false) => S.meds.filter(m => m.pet_id === petId && (all || m.active));
function slotsOn(date, petId) {
  const out = [];
  for (const m of medsOf(petId, true)) {
    if (!m.active && !(m.archived_on && date < m.archived_on)) continue;
    if (date < m.start_date) continue;
    if (m.end_date && date > m.end_date) continue;
    if (m.kind === 'interval' && dayDiff(m.start_date, date) % Math.max(1, m.every_days) !== 0) continue;
    for (const t of m.times) out.push({ med: m, date, time: t, key: slotKey(m.id, date, t), dose: S.doses[slotKey(m.id, date, t)] || null });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}
function statusOf(s) {
  if (s.dose) return s.dose.skipped ? 'skip' : 'done';
  const today = ymd(S.now);
  if (s.date < today) return 'missed';
  if (s.date > today) return 'later';
  const [h, mi] = s.time.split(':').map(Number);
  const due = new Date(S.now); due.setHours(h, mi, 0, 0);
  const diff = (S.now - due) / 60000;
  if (diff < -60) return 'later';
  return diff <= 120 ? 'now' : 'late';
}
function scheduleText(m) {
  const t = m.times.join(' e ');
  let s = m.kind === 'interval' ? (m.every_days === 1 ? `Todo dia às ${t}` : `A cada ${m.every_days} dias, às ${t}`) : `Todo dia às ${t}`;
  if (m.end_date) s += `, até ${m.end_date.split('-').reverse().slice(0, 2).join('/')}`;
  return s;
}
function nextDose(m) {
  for (let i = 0; i < 400; i++) {
    const d = ymd(addDays(S.now, i));
    if (m.end_date && d > m.end_date) return null;
    const s = slotsOn(d, m.pet_id).find(x => x.med.id === m.id && !x.dose && (i > 0 || statusOf(x) !== 'late'));
    if (s) return `${dayName(d).toLowerCase()} às ${s.time}`;
  }
  return null;
}

/* ================= dados ================= */
async function loadProfile() {
  const { data } = await sb.from('profiles').select('nick').eq('id', S.uid).maybeSingle();
  S.nick = data?.nick || null;
}
async function loadHouseholds() {
  const { data, error } = await sb.from('households').select('*').order('created_at');
  if (error) throw error;
  S.households = data || [];
}
async function loadPets() {
  const { data } = await sb.from('pets').select('*').eq('household_id', S.hid).order('created_at');
  S.pets = data || [];
}
async function loadMeds() {
  const { data } = await sb.from('meds').select('*').eq('household_id', S.hid).order('created_at');
  S.meds = data || [];
}
async function loadDoses() {
  const since = ymd(addDays(new Date(), -(HIST_DAYS + 2)));
  const { data } = await sb.from('doses').select('*').eq('household_id', S.hid).gte('date', since).limit(5000);
  const map = {};
  (data || []).forEach(d => { map[slotKey(d.med_id, d.date, d.slot)] = d; });
  S.doses = map;
}
async function loadMembers() {
  const { data: mem } = await sb.from('household_members').select('user_id, role, joined_at').eq('household_id', S.hid).order('joined_at');
  S.members = mem || [];
  const ids = S.members.map(m => m.user_id);
  if (ids.length) {
    const { data: profs } = await sb.from('profiles').select('id, nick').in('id', ids);
    (profs || []).forEach(p => { S.names[p.id] = p.nick; });
  }
}
async function openHouse(hid) {
  S.hid = hid; store.set('house', hid);
  S.house = S.households.find(h => h.id === hid);
  S.petId = store.get('pet:' + hid);
  S.screen = 'loading'; render();
  await Promise.all([loadPets(), loadMeds(), loadDoses(), loadMembers()]);
  subscribe();
  S.screen = 'main'; render();
}

let reloadTimers = {};
function reloadSoon(table) {
  clearTimeout(reloadTimers[table]);
  reloadTimers[table] = setTimeout(async () => {
    if (table === 'pets') await loadPets();
    else if (table === 'meds') await loadMeds();
    else if (table === 'doses') await loadDoses();
    else if (table === 'household_members') await loadMembers();
    if (!document.querySelector('.scrim')) render();
  }, 250);
}
function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  const filter = `household_id=eq.${S.hid}`;
  S.channel = sb.channel('casa-' + S.hid);
  for (const table of ['pets', 'meds', 'doses', 'household_members']) {
    S.channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => reloadSoon(table));
  }
  S.channel.subscribe();
}

/* ================= fluxo de entrada ================= */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session; S.uid = session?.user?.id || null;
  const inviteFromUrl = new URLSearchParams(location.search).get('convite');
  if (inviteFromUrl) { store.set('invite', inviteFromUrl.toUpperCase()); history.replaceState(null, '', location.pathname); }

  if (!S.uid) { S.screen = 'login'; render(); return; }
  try {
    await loadProfile();
    if (!S.nick) { S.screen = 'nick'; render(); return; }
    const pending = store.get('invite');
    if (pending) {
      store.set('invite', null);
      const { data, error } = await sb.rpc('join_household', { p_code: pending });
      if (error) toast(errMsg(error), true); else { store.set('house', data.id); toast(`Você entrou na casa ${data.name}!`); }
    }
    await loadHouseholds();
    if (!S.households.length) { S.screen = 'house-setup'; render(); return; }
    const saved = store.get('house');
    await openHouse(S.households.find(h => h.id === saved)?.id || S.households[0].id);
  } catch (e) {
    S.screen = 'error'; S.error = errMsg(e); render();
  }
}
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' && S.screen === 'login') boot();
  if (event === 'SIGNED_OUT') { S.uid = null; S.screen = 'login'; render(); }
});

/* ================= telas ================= */
function render() {
  S.now = new Date();
  const screens = { loading: viewLoading, login: viewLogin, nick: viewNick, 'house-setup': viewHouseSetup, main: viewMain, error: viewError };
  (screens[S.screen] || viewLoading)();
}
function viewLoading() { $app.innerHTML = `<div class="splash"><div class="logo-pill" aria-label="Carregando"><i></i><i></i></div></div>`; }
function viewError() {
  $app.innerHTML = `<div class="welcome"><div class="empty"><div class="big-emoji">🙀</div><h2>Não deu para carregar</h2><p>${esc(S.error)}</p>
  <button class="btn ink" data-act="retry">Tentar de novo</button></div></div>`;
}
const LOGO = `<div class="logo"><div class="logo-pill" aria-hidden="true"><i></i><i></i></div>DoseCerta Pet</div>`;

function viewLogin() {
  applyPetTheme({ color: 'roxo' });
  const sent = !!S.authEmail;
  $app.innerHTML = `<section class="welcome">${LOGO}
    <div class="blobs" aria-hidden="true"><i style="background:#FFE0EC">🐶</i><i style="background:#FFF1C9">🐱</i><i style="background:#DDEBFF">🐦</i><i style="background:#D9F5F7">🐹</i></div>
    <h1>Nenhuma dose esquecida, nenhuma dose dobrada.</h1>
    <p class="lead">Quem cuida do pet marca a dose aqui, e todo mundo da casa vê na hora.</p>
    ${sent ? `<div class="card"><h2>Confira seu e-mail</h2><p>Mandamos um link para <b>${esc(S.authEmail)}</b>. Toque nele, ou digite aqui o código que veio no e-mail.</p>
        <form id="code-form"><label class="f" for="otp">Código</label>
        <input class="input code-input" id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>
        <button class="btn" type="submit">Entrar</button></form>
        <button class="btn ghost" data-act="change-email">Usar outro e-mail</button></div>`
      : `<form class="card" id="email-form"><label class="f" for="email" style="margin-top:0">Seu e-mail</label>
        <input class="input" id="email" type="email" autocomplete="email" required placeholder="voce@email.com">
        <button class="btn" type="submit">Receber link de acesso</button>
        <p style="font-size:14px;margin-top:10px">Sem senha: a gente manda um link para você entrar.</p></form>`}
  </section>`;
  const ef = document.getElementById('email-form');
  if (ef) ef.onsubmit = async e => {
    e.preventDefault();
    const email = ef.email.value.trim(); const b = ef.querySelector('button'); b.disabled = true; b.textContent = 'Enviando…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { toast(error.status === 429 ? 'Muitas tentativas. Espere um minuto e tente de novo.' : errMsg(error), true); b.disabled = false; b.textContent = 'Receber link de acesso'; return; }
    S.authEmail = email; render();
  };
  const cf = document.getElementById('code-form');
  if (cf) cf.onsubmit = async e => {
    e.preventDefault();
    const b = cf.querySelector('button'); b.disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: S.authEmail, token: cf.otp.value.trim(), type: 'email' });
    if (error) { toast('Código incorreto ou vencido. Peça um novo.', true); b.disabled = false; return; }
    S.authEmail = ''; boot();
  };
}

function viewNick() {
  $app.innerHTML = `<section class="welcome">${LOGO}<h1>Como a gente te chama?</h1>
    <p class="lead">Esse nome aparece quando você marca uma dose: “Ju deu às 20:05”.</p>
    <form class="card" id="nick-form"><label class="f" for="nick" style="margin-top:0">Seu nome ou apelido</label>
    <input class="input" id="nick" maxlength="30" required placeholder="ex.: Maiara">
    <button class="btn" type="submit">Continuar</button></form></section>`;
  document.getElementById('nick-form').onsubmit = async e => {
    e.preventDefault();
    const nick = e.target.nick.value.trim(); if (!nick) return;
    const { error } = await sb.from('profiles').upsert({ id: S.uid, nick });
    if (error) return toast(errMsg(error), true);
    S.nick = nick; boot();
  };
}

function viewHouseSetup() {
  const pending = store.get('invite') || '';
  $app.innerHTML = `<section class="welcome">${LOGO}<h1>Oi, ${esc(S.nick)}!</h1>
    <p class="lead">Os pets ficam numa “casa”. Todo mundo que cuida deles entra na mesma casa.</p>
    <form class="card" id="join-form"><h2>Recebi um convite</h2><p>Digite o código que mandaram para você.</p>
      <input class="input code-input" id="code" maxlength="6" required value="${esc(pending)}" placeholder="A1B2C3" style="margin-top:12px">
      <button class="btn ink" type="submit">Entrar na casa</button></form>
    <p class="or">ou</p>
    <form class="card" id="create-form"><h2>Começar uma casa nova</h2><p>Depois você convida quem ajuda a cuidar.</p>
      <label class="f" for="hname">Nome da casa</label><input class="input" id="hname" maxlength="60" required placeholder="ex.: Casa da Maiara e da Ju">
      <button class="btn" type="submit">Criar casa</button></form>
    ${S.households.length ? `<button class="btn ghost" data-act="back-main">Voltar</button>` : `<button class="btn danger" data-act="logout">Sair da conta</button>`}</section>`;
  document.getElementById('join-form').onsubmit = async e => {
    e.preventDefault();
    const { data, error } = await sb.rpc('join_household', { p_code: e.target.code.value });
    if (error) return toast(errMsg(error), true);
    await loadHouseholds(); toast(`Você entrou na casa ${data.name}!`); openHouse(data.id);
  };
  document.getElementById('create-form').onsubmit = async e => {
    e.preventDefault();
    const { data, error } = await sb.rpc('create_household', { p_name: e.target.hname.value });
    if (error) return toast(errMsg(error), true);
    await loadHouseholds(); openHouse(data.id);
  };
}

/* ---------- tela principal ---------- */
function viewMain() {
  if (S.pets.length && !S.pets.find(p => p.id === S.petId)) S.petId = S.pets[0].id;
  const pet = S.pets.find(p => p.id === S.petId);
  applyPetTheme(pet);

  let h = `<div class="top">${LOGO}<button class="house-btn" data-act="house" aria-label="Casa e convites"><span class="dot">🏠</span><span>${esc(S.house?.name)}</span></button></div>`;

  if (!pet) {
    h += `<div class="empty"><div class="big-emoji">🐾</div><h2>Quem é o primeiro paciente?</h2>
      <p>Cadastre o pet com nome e foto. Depois você adiciona os remédios e os horários.</p>
      <button class="btn" data-act="add-pet">Cadastrar pet</button>
      <button class="btn ghost" data-act="house">Convidar quem ajuda</button></div>`;
    $app.innerHTML = h; return;
  }

  h += `<nav class="pets" aria-label="Pets">${S.pets.map(p => `<button class="pet-chip ${p.id === pet.id ? 'sel' : ''}" style="${petVars(p)}" data-pet="${p.id}" aria-pressed="${p.id === pet.id}">
      <span class="av">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${emoji(p)}</span>`}</span><small>${esc(p.name)}</small></button>`).join('')}
    <button class="pet-chip add" data-act="add-pet"><span class="av">+</span><small>Novo pet</small></button></nav>`;

  const today = ymd(S.now);
  const slots = slotsOn(today, pet.id);
  const given = slots.filter(s => s.dose && !s.dose.skipped).length;
  const left = slots.filter(s => !s.dose).length;
  const summary = !slots.length ? 'Nenhuma dose hoje' : left === 0 ? 'Tudo certo por hoje!' : `${given} de ${slots.length} doses dadas hoje`;
  h += `<section class="hero"><div class="blob">${pet.photo ? `<img src="${esc(pet.photo)}" alt="">` : emoji(pet)}</div>
    <div class="txt"><h1>${esc(pet.name)}</h1><p>${summary}</p>
    ${slots.length ? `<div class="caps" aria-hidden="true">${slots.map(s => `<span class="cap ${s.dose && !s.dose.skipped ? 'on' : ''}"></span>`).join('')}</div>` : ''}</div></section>`;

  h += `<div class="tabs" role="tablist">${[['hoje', 'Hoje'], ['hist', 'Histórico'], ['meds', 'Remédios']].map(([k, l]) =>
    `<button role="tab" aria-selected="${S.view === k}" data-view="${k}">${l}</button>`).join('')}</div>`;

  h += S.view === 'hist' ? viewHist(pet) : S.view === 'meds' ? viewMeds(pet) : viewToday(pet, slots);
  $app.innerHTML = h;
}

function doseCard(s) {
  const st = statusOf(s);
  if (st === 'done') return `<article class="dose is-done"><div class="when">${s.time}</div><div class="info">
      <div class="name">${esc(s.med.name)}</div>${s.med.dose ? `<div class="amt">${esc(s.med.dose)}</div>` : ''}
      <div class="who">${esc(nameOf(s.dose.given_by))} deu às ${hm(s.dose.given_at)}${s.dose.late_entry ? ' (anotado depois)' : ''}</div>
      ${s.dose.note ? `<div class="amt">${esc(s.dose.note)}</div>` : ''}</div>
      <button class="capsule done" data-undo="${s.key}" aria-label="Dose dada. Ver detalhes"><span>✓</span></button></article>`;
  if (st === 'skip') return `<article class="dose is-skip"><div class="when">${s.time}</div><div class="info">
      <div class="name">${esc(s.med.name)}</div><div class="who muted">Não foi dada, segundo ${esc(nameOf(s.dose.given_by))}</div>
      ${s.dose.note ? `<div class="amt">${esc(s.dose.note)}</div>` : ''}</div>
      <button class="chip-btn" data-undo="${s.key}">Ver</button></article>`;
  const tag = { now: '<span class="tag now">Hora de dar</span>', late: '<span class="tag late">Atrasada</span>', later: '<span class="tag later">Mais tarde</span>' }[st] || '';
  return `<article class="dose ${st === 'late' ? 'is-late' : ''}"><div class="when">${s.time}</div><div class="info">
      <div class="name">${esc(s.med.name)}</div>${s.med.dose ? `<div class="amt">${esc(s.med.dose)}</div>` : ''}${tag}</div>
      <button class="capsule" data-give="${s.key}" aria-label="Marcar ${esc(s.med.name)} das ${s.time} como dado"><span>Dei</span><span>✓</span></button></article>`;
}

function viewToday(pet, slots) {
  let h = '';
  const missed = [];
  for (let i = 2; i >= 1; i--) slotsOn(ymd(addDays(S.now, -i)), pet.id).forEach(s => { if (!s.dose) missed.push(s); });
  if (missed.length) h += `<section class="missed"><h3>Ficou sem registro</h3>${missed.map(s => `<div class="row">
      <div><b>${esc(s.med.name)}</b><br>${dayName(s.date)} às ${s.time}</div>
      <button class="chip-btn fill" data-give="${s.key}">Foi dado</button><button class="chip-btn" data-skip="${s.key}">Não foi</button></div>`).join('')}</section>`;

  if (!medsOf(pet.id).length) return h + `<div class="empty"><div class="big-emoji">💊</div><h2>Nenhum remédio ainda</h2>
      <p>Adicione o remédio de ${esc(pet.name)} com os horários de cada dose.</p><button class="btn" data-act="add-med">Adicionar remédio</button></div>`;

  h += slots.length ? slots.map(doseCard).join('') : `<div class="empty"><div class="big-emoji">🎈</div><h2>Folga hoje</h2><p>Nenhuma dose programada para hoje.</p></div>`;
  const tmr = slotsOn(ymd(addDays(S.now, 1)), pet.id);
  if (tmr.length) h += `<h3 class="subhead">Amanhã</h3><div class="tomorrow">${tmr.map(s => `<div class="trow"><b>${s.time}</b><span>${esc(s.med.name)}</span><span class="r">${esc(s.med.dose || '')}</span></div>`).join('')}</div>`;
  return h;
}

function viewHist(pet) {
  let h = '';
  for (let i = 0; i < HIST_DAYS; i++) {
    const d = ymd(addDays(S.now, -i));
    const slots = slotsOn(d, pet.id); if (!slots.length) continue;
    const given = slots.filter(s => s.dose && !s.dose.skipped).length;
    const hasGap = slots.some(s => statusOf(s) === 'missed' || statusOf(s) === 'late');
    h += `<section class="day"><header><h3>${dayName(d)}</h3><span class="score ${given === slots.length ? 'full' : hasGap ? 'gap' : ''}">${given} de ${slots.length}</span></header>
      ${slots.map(s => {
        const st = statusOf(s);
        const r = st === 'done' ? `<span class="r ok">${esc(nameOf(s.dose.given_by))}, ${hm(s.dose.given_at)}</span>`
          : st === 'skip' ? `<span class="r">não foi dada</span>`
          : st === 'missed' || st === 'late' ? `<span class="r late">sem registro</span>` : `<span class="r">pendente</span>`;
        return `<div class="trow"><b>${s.time}</b><span>${esc(s.med.name)}</span>${r}</div>`;
      }).join('')}</section>`;
  }
  return h || `<div class="empty"><div class="big-emoji">📅</div><h2>Nada por aqui ainda</h2><p>O histórico aparece quando houver doses programadas.</p></div>`;
}

function viewMeds(pet) {
  const active = medsOf(pet.id);
  const archived = S.meds.filter(m => m.pet_id === pet.id && !m.active);
  let h = active.map(m => { const nx = nextDose(m); return `<article class="med"><span class="bar"></span><div class="info">
      <div class="name">${esc(m.name)}</div>${m.dose ? `<div class="line muted">${esc(m.dose)}</div>` : ''}
      <div class="line">${esc(scheduleText(m))}</div>${nx ? `<div class="line muted">Próxima: ${esc(nx)}</div>` : ''}
      ${m.notes ? `<div class="notes">${esc(m.notes)}</div>` : ''}</div>
      <button class="chip-btn" data-edit-med="${m.id}">Editar</button></article>`; }).join('');
  if (!active.length) h += `<div class="empty"><div class="big-emoji">💊</div><h2>Nenhum remédio ativo</h2><p>Adicione o primeiro remédio de ${esc(pet.name)}.</p></div>`;
  h += `<button class="btn" data-act="add-med">Adicionar remédio</button>`;
  if (archived.length) h += `<details class="archive"><summary>Tratamentos encerrados (${archived.length})</summary>${archived.map(m => `<article class="med"><span class="bar" style="opacity:.3"></span><div class="info"><div class="name">${esc(m.name)}</div><div class="line muted">${esc(scheduleText(m))}</div></div><button class="chip-btn" data-restore="${m.id}">Retomar</button></article>`).join('')}</details>`;
  h += `<button class="btn ghost" data-act="edit-pet">Editar ${esc(pet.name)}</button>`;
  return h;
}

/* ================= folhas (modais) ================= */
function sheet(html, bind, pet) {
  const sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" style="${pet ? petVars(pet) : ''}">${html}</div>`;
  const close = () => { sc.remove(); render(); };
  sc.addEventListener('click', e => { if (e.target === sc) close(); });
  sc.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.appendChild(sc);
  sc.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  bind?.(sc.querySelector('.sheet'), close);
  sc.querySelector('input,button')?.focus({ preventScroll: true });
}
const findSlot = key => {
  const [medId, date] = key.split('|');
  const med = S.meds.find(m => m.id === medId); if (!med) return null;
  return slotsOn(date, med.pet_id).find(s => s.key === key) || null;
};

function giveSheet(key, skip = false) {
  const s = findSlot(key); if (!s) return;
  const pet = S.pets.find(p => p.id === s.med.pet_id);
  const past = s.date < ymd(S.now);
  sheet(`<h2>${skip ? 'Essa dose não foi dada?' : 'Confirmar dose'}</h2>
    <div class="confirm-pet"><div class="blob">${pet.photo ? `<img src="${esc(pet.photo)}" alt="">` : emoji(pet)}</div>
      <div><b>${esc(s.med.name)}</b>${s.med.dose ? `${esc(s.med.dose)}<br>` : ''}${esc(pet.name)}, ${dayName(s.date).toLowerCase()} às ${s.time}</div></div>
    ${s.med.notes ? `<p class="sub">${esc(s.med.notes)}</p>` : ''}
    <label class="f" for="note">Observação (opcional)</label>
    <input class="input" id="note" maxlength="140" placeholder="${skip ? 'ex.: a veterinária mandou pular' : 'ex.: deu escondido no patê'}">
    <button class="btn" id="ok">${skip ? 'Confirmar que não foi dada' : past ? 'Sim, foi dada' : 'Sim, dei agora'}</button>
    <button class="btn ghost" data-close>Cancelar</button>`, (el, close) => {
    el.querySelector('#ok').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Salvando…';
      const { error } = await sb.from('doses').insert({
        household_id: S.hid, med_id: s.med.id, pet_id: s.med.pet_id, date: s.date, slot: s.time,
        given_by: S.uid, note: el.querySelector('#note').value.trim() || null, skipped: skip, late_entry: past && !skip,
      });
      if (error?.code === '23505') {
        await loadDoses(); close();
        const d = S.doses[key];
        return toast(d?.skipped ? `${nameOf(d.given_by)} já marcou que não foi dada.` : `Opa! ${nameOf(d?.given_by)} já deu às ${d ? hm(d.given_at) : '?'}. Não dê de novo.`, true);
      }
      if (error) { e.target.disabled = false; e.target.textContent = 'Tentar de novo'; return toast(errMsg(error), true); }
      await loadDoses(); close();
      if (!skip) document.querySelector(`[data-undo="${CSS.escape(key)}"]`)?.classList.add('pop');
      toast(skip ? 'Anotado.' : 'Dose registrada!');
    };
  }, pet);
}

function undoSheet(key) {
  const s = findSlot(key); if (!s?.dose) return;
  const pet = S.pets.find(p => p.id === s.med.pet_id); const d = s.dose;
  sheet(`<h2>${esc(s.med.name)}, ${s.time}</h2>
    <p class="sub">${d.skipped ? `${esc(nameOf(d.given_by))} marcou que essa dose não foi dada.` : `${esc(nameOf(d.given_by))} deu às ${hm(d.given_at)}.`}</p>
    ${d.note ? `<p class="sub">Observação: ${esc(d.note)}</p>` : ''}
    <button class="btn" data-close>Ok</button>
    <button class="btn danger" id="del">Desfazer, marquei por engano</button>`, (el, close) => {
    el.querySelector('#del').onclick = async () => {
      const { error } = await sb.from('doses').delete().eq('id', d.id);
      if (error) return toast(errMsg(error), true);
      await loadDoses(); close(); toast('Registro desfeito.');
    };
  }, pet);
}

async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const side = Math.min(img.width, img.height), size = 360;
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

function petSheet(pet) {
  const used = S.pets.map(p => p.color);
  const st = { photo: pet?.photo || null, species: pet?.species || 'cao', color: pet?.color || Object.keys(COLORS).find(c => !used.includes(c)) || 'roxo' };
  const draw = el => {
    el.style.cssText = petVars(st);
    el.querySelector('#pv').innerHTML = st.photo ? `<img src="${st.photo}" alt="">` : SPECIES[st.species][0];
    el.querySelectorAll('[data-sp]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sp === st.species));
    el.querySelectorAll('[data-col]').forEach(b => b.setAttribute('aria-pressed', b.dataset.col === st.color));
  };
  sheet(`<h2>${pet ? `Editar ${esc(pet.name)}` : 'Novo pet'}</h2>
    <div class="photo"><div class="blob" id="pv"></div>
      <label class="file-btn">${pet?.photo ? 'Trocar foto' : 'Escolher foto'}<input type="file" accept="image/*" id="ph" hidden></label></div>
    <label class="f" for="nm">Nome</label><input class="input" id="nm" maxlength="40" value="${esc(pet?.name || '')}" placeholder="ex.: Paçoca">
    <label class="f">Tipo</label><div class="seg">${Object.entries(SPECIES).map(([k, [e, l]]) => `<button type="button" data-sp="${k}">${e} ${l}</button>`).join('')}</div>
    <label class="f">Cor</label><div class="swatches">${Object.entries(COLORS).map(([k, [c]]) => `<button type="button" data-col="${k}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div>
    <button class="btn" id="ok">Salvar</button>
    ${pet ? `<button class="btn danger" id="rm">Remover ${esc(pet.name)}</button>` : ''}
    <button class="btn ghost" data-close>Cancelar</button>`, (el, close) => {
    draw(el);
    el.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { st.species = b.dataset.sp; draw(el); });
    el.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { st.color = b.dataset.col; draw(el); });
    el.querySelector('#ph').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { st.photo = await resizeImage(f); draw(el); } catch { toast('Não consegui abrir essa imagem. Tente outra.', true); }
    };
    el.querySelector('#ok').onclick = async () => {
      const name = el.querySelector('#nm').value.trim(); if (!name) return toast('Coloque o nome do pet.', true);
      const body = { household_id: S.hid, name, species: st.species, color: st.color, photo: st.photo };
      const { data, error } = pet ? await sb.from('pets').update(body).eq('id', pet.id).select().single()
        : await sb.from('pets').insert(body).select().single();
      if (error) return toast(errMsg(error), true);
      S.petId = data.id; store.set('pet:' + S.hid, data.id);
      await loadPets(); close(); toast(pet ? 'Pet atualizado.' : `${name} chegou!`);
    };
    const rm = el.querySelector('#rm');
    if (rm) rm.onclick = () => {
      rm.textContent = 'Toque de novo para remover, com remédios e histórico';
      rm.onclick = async () => {
        const { error } = await sb.from('pets').delete().eq('id', pet.id);
        if (error) return toast(errMsg(error), true);
        await Promise.all([loadPets(), loadMeds(), loadDoses()]); close(); toast('Pet removido.');
      };
    };
  }, st);
}

function medSheet(med) {
  const pet = S.pets.find(p => p.id === (med?.pet_id || S.petId));
  const st = { kind: med?.kind || 'daily', times: med?.times?.slice() || ['08:00'] };
  const timesHtml = () => st.times.map((t, i) => `<span class="tm"><input class="input" type="time" value="${t}" data-ti="${i}" aria-label="Horário ${i + 1}">${st.times.length > 1 ? `<button type="button" class="x" data-rt="${i}" aria-label="Remover horário">×</button>` : ''}</span>`).join('');
  sheet(`<h2>${med ? `Editar ${esc(med.name)}` : `Remédio de ${esc(pet.name)}`}</h2>
    <label class="f" for="nm">Remédio</label><input class="input" id="nm" maxlength="60" value="${esc(med?.name || '')}" placeholder="ex.: Apoquel">
    <label class="f" for="ds">Dose</label><input class="input" id="ds" maxlength="60" value="${esc(med?.dose || '')}" placeholder="ex.: 1 comprimido de 16 mg">
    <label class="f">Com que frequência?</label>
    <div class="seg"><button type="button" data-k="daily">Todo dia</button><button type="button" data-k="interval">A cada alguns dias</button></div>
    <div id="iv"><label class="f" for="ev">A cada quantos dias?</label><input class="input" id="ev" type="number" min="1" max="365" inputmode="numeric" value="${med?.kind === 'interval' ? med.every_days : 30}"></div>
    <label class="f">Horários</label><div class="times" id="tms"></div>
    <button type="button" class="chip-btn" id="addt" style="margin-top:10px">Adicionar horário</button>
    <div class="two"><div><label class="f" for="sd">Começa em</label><input class="input" id="sd" type="date" value="${med?.start_date || ymd(S.now)}"></div>
      <div><label class="f" for="ed">Termina em</label><input class="input" id="ed" type="date" value="${med?.end_date || ''}"></div></div>
    <label class="f" for="nt">Observações</label><textarea class="input" id="nt" maxlength="300" placeholder="ex.: dar junto com a comida">${esc(med?.notes || '')}</textarea>
    <button class="btn" id="ok">Salvar remédio</button>
    ${med ? `<button class="btn danger" id="arc">Encerrar tratamento</button>` : ''}
    <button class="btn ghost" data-close>Cancelar</button>`, (el, close) => {
    const tms = el.querySelector('#tms');
    const sync = () => tms.querySelectorAll('[data-ti]').forEach(i => { st.times[+i.dataset.ti] = i.value; });
    const draw = () => {
      tms.innerHTML = timesHtml();
      el.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === st.kind));
      el.querySelector('#iv').hidden = st.kind !== 'interval';
    };
    draw();
    tms.addEventListener('click', e => { const r = e.target.closest('[data-rt]'); if (r) { sync(); st.times.splice(+r.dataset.rt, 1); draw(); } });
    el.querySelector('#addt').onclick = () => { sync(); st.times.push(st.times.includes('20:00') ? '12:00' : '20:00'); draw(); };
    el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { sync(); st.kind = b.dataset.k; draw(); });
    el.querySelector('#ok').onclick = async () => {
      sync();
      const name = el.querySelector('#nm').value.trim(); if (!name) return toast('Coloque o nome do remédio.', true);
      const times = [...new Set(st.times.filter(Boolean))].sort(); if (!times.length) return toast('Coloque pelo menos um horário.', true);
      const start_date = el.querySelector('#sd').value || ymd(S.now);
      const end_date = el.querySelector('#ed').value || null;
      if (end_date && end_date < start_date) return toast('A data de término está antes do início.', true);
      const body = {
        household_id: S.hid, pet_id: pet.id, name, dose: el.querySelector('#ds').value.trim() || null, kind: st.kind,
        every_days: st.kind === 'interval' ? Math.min(365, Math.max(1, parseInt(el.querySelector('#ev').value, 10) || 1)) : 1,
        times, start_date, end_date, notes: el.querySelector('#nt').value.trim() || null, active: true, archived_on: null,
      };
      const { error } = med ? await sb.from('meds').update(body).eq('id', med.id) : await sb.from('meds').insert(body);
      if (error) return toast(errMsg(error), true);
      await loadMeds(); close(); toast('Remédio salvo.');
    };
    const arc = el.querySelector('#arc');
    if (arc) arc.onclick = async () => {
      const { error } = await sb.from('meds').update({ active: false, archived_on: ymd(addDays(S.now, 1)) }).eq('id', med.id);
      if (error) return toast(errMsg(error), true);
      await loadMeds(); close(); toast('Tratamento encerrado. O histórico continua guardado.');
    };
  }, pet);
}

function houseSheet() {
  const link = `${location.origin}/?convite=${S.house.invite_code}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`Entra na casa "${S.house.name}" no DoseCerta Pet para a gente controlar os remédios do pet: ${link}\nCódigo: ${S.house.invite_code}`)}`;
  const others = S.households.filter(h => h.id !== S.hid);
  sheet(`<h2>${esc(S.house.name)}</h2>
    <p class="sub">Quem está nesta casa vê e marca as doses de todos os pets dela.</p>
    <ul class="people">${S.members.map((m, i) => { const n = nameOf(m.user_id); const c = Object.values(COLORS)[i % 6][0];
      return `<li><span class="ini" style="background:${c}">${esc(initials(n))}</span><span>${esc(n)}${m.user_id === S.uid ? ' (você)' : ''}</span></li>`; }).join('')}</ul>
    <div class="invite"><p class="sub" style="margin:0">Código de convite</p><div class="code">${esc(S.house.invite_code)}</div>
      <a class="btn" href="${esc(wa)}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center">Convidar pelo WhatsApp</a>
      <button class="btn ghost" id="copy">Copiar link do convite</button>
      <button class="btn danger" id="reset">Gerar outro código</button></div>
    <label class="f">Seu nome</label><div class="two"><div><input class="input" id="nk" maxlength="30" value="${esc(S.nick)}"></div><div style="flex:0 0 auto"><button class="chip-btn" id="savenk" style="height:100%">Salvar</button></div></div>
    <div class="house-list"><label class="f">Outras casas</label>
      ${others.map(h => `<button data-house="${h.id}"><span>🏠 ${esc(h.name)}</span><span class="muted">Abrir</span></button>`).join('')}
      <button data-act="new-house"><span>Entrar em outra casa ou criar uma</span><span class="muted">+</span></button></div>
    <button class="btn danger" id="leave">Sair desta casa</button>
    <button class="btn danger" id="logout">Sair da conta</button>
    <button class="btn ghost" data-close>Fechar</button>`, (el, close) => {
    el.querySelector('#copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { toast(link); } };
    el.querySelector('#reset').onclick = async () => {
      const { data, error } = await sb.rpc('reset_invite_code', { hid: S.hid });
      if (error) return toast(errMsg(error), true);
      S.house.invite_code = data; el.querySelector('.code').textContent = data; toast('Código novo gerado. O antigo não funciona mais.');
    };
    el.querySelector('#savenk').onclick = async () => {
      const nick = el.querySelector('#nk').value.trim(); if (!nick) return;
      const { error } = await sb.from('profiles').upsert({ id: S.uid, nick });
      if (error) return toast(errMsg(error), true);
      S.nick = nick; S.names[S.uid] = nick; toast('Nome salvo.');
    };
    el.querySelectorAll('[data-house]').forEach(b => b.onclick = () => { el.closest('.scrim').remove(); openHouse(b.dataset.house); });
    el.querySelector('[data-act="new-house"]').onclick = () => { el.closest('.scrim').remove(); S.screen = 'house-setup'; render(); };
    const leave = el.querySelector('#leave');
    leave.onclick = () => {
      leave.textContent = 'Toque de novo para sair da casa';
      leave.onclick = async () => {
        const { error } = await sb.from('household_members').delete().eq('household_id', S.hid).eq('user_id', S.uid);
        if (error) return toast(errMsg(error), true);
        el.closest('.scrim').remove(); store.set('house', null); boot();
      };
    };
    el.querySelector('#logout').onclick = async () => { el.closest('.scrim').remove(); await sb.auth.signOut(); };
  });
}

/* ================= eventos ================= */
$app.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.pet) { S.petId = d.pet; store.set('pet:' + S.hid, d.pet); render(); }
  else if (d.view) { S.view = d.view; store.set('view', d.view); render(); }
  else if (d.give) giveSheet(d.give);
  else if (d.skip) giveSheet(d.skip, true);
  else if (d.undo) undoSheet(d.undo);
  else if (d.editMed) medSheet(S.meds.find(m => m.id === d.editMed));
  else if (d.restore) { await sb.from('meds').update({ active: true, archived_on: null }).eq('id', d.restore); await loadMeds(); render(); }
  else if (d.act === 'add-pet') petSheet(null);
  else if (d.act === 'edit-pet') petSheet(S.pets.find(p => p.id === S.petId));
  else if (d.act === 'add-med') medSheet(null);
  else if (d.act === 'house') houseSheet();
  else if (d.act === 'change-email') { S.authEmail = ''; render(); }
  else if (d.act === 'back-main') { S.screen = 'main'; render(); }
  else if (d.act === 'logout') await sb.auth.signOut();
  else if (d.act === 'retry') boot();
});

// Atualiza os status ("hora de dar", "atrasada") a cada minuto e ao voltar para o app
setInterval(() => { if (S.screen === 'main' && !document.querySelector('.scrim')) render(); }, 60000);
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || S.screen !== 'main') return;
  await Promise.all([loadDoses(), loadMeds()]);
  if (!document.querySelector('.scrim')) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
