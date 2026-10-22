const $ = (s) => document.querySelector(s);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.greska ?? res.statusText);
  return data;
}

function show(msg, ok = false) {
  $('#poruka').hidden = !msg;
  $('#poruka').className = ok ? 'card uspjeh' : 'greska';
  $('#poruka').textContent = msg ?? '';
}

function showForm(id) {
  for (const f of document.querySelectorAll('form')) f.hidden = f.id !== id;
  $(`#${id}`).querySelector('input').focus();
}

// Poveznica iz e-pošte: /prijava.html#reset=<token>. Token se odmah uklanja iz adrese.
const resetToken = /^#reset=([\w-]+)$/.exec(location.hash)?.[1] ?? null;
if (resetToken) history.replaceState(null, '', location.pathname);

async function init() {
  const s = await fetch('/api/auth/stanje').then((r) => r.json());
  $('#reset-poveznica').hidden = !s.resetLozinke;
  if (resetToken) { showForm('nova-lozinka'); return; }
  if (s.prijavljen) { location.href = '/'; return; }
  showForm(s.postoji ? 'prijava' : 'postavljanje');
}

$('#na-registraciju').addEventListener('click', (e) => { e.preventDefault(); show(); showForm('registracija'); });
for (const a of document.querySelectorAll('.na-prijavu')) a.addEventListener('click', (e) => { e.preventDefault(); show(); showForm('prijava'); });
$('#na-zaboravljenu').addEventListener('click', (e) => {
  e.preventDefault();
  show();
  $('#z-email').value = $('#p-korisnik').value.trim();
  showForm('zaboravljena');
});

$('#zaboravljena').addEventListener('submit', async (e) => {
  e.preventDefault();
  show();
  try {
    const r = await post('/api/auth/zaboravljena', { email: $('#z-email').value.trim() });
    showForm('prijava');
    show(r.poruka, true);
  } catch (err) {
    show(err.message);
  }
});

$('#nova-lozinka').addEventListener('submit', async (e) => {
  e.preventDefault();
  show();
  if ($('#n-lozinka').value !== $('#n-lozinka2').value) return show('Lozinke se ne podudaraju.');
  try {
    const r = await post('/api/auth/nova-lozinka', { token: resetToken, lozinka: $('#n-lozinka').value });
    $('#nova-lozinka').reset();
    showForm('prijava');
    show(r.poruka, true);
  } catch (err) {
    show(err.message);
  }
});

$('#prijava').addEventListener('submit', async (e) => {
  e.preventDefault();
  show();
  try {
    await post('/api/auth/prijava', { korisnik: $('#p-korisnik').value.trim(), lozinka: $('#p-lozinka').value });
    location.href = '/';
  } catch (err) {
    show(err.message);
    $('#p-lozinka').select();
  }
});

$('#registracija').addEventListener('submit', async (e) => {
  e.preventDefault();
  show();
  if ($('#r-lozinka').value !== $('#r-lozinka2').value) return show('Lozinke se ne podudaraju.');
  try {
    const r = await post('/api/auth/registracija', { ime: $('#r-ime').value.trim(), email: $('#r-email').value.trim(), lozinka: $('#r-lozinka').value });
    $('#p-korisnik').value = $('#r-email').value.trim();
    $('#registracija').reset();
    showForm('prijava');
    show(r.poruka, true);
  } catch (err) {
    show(err.message);
  }
});

$('#postavljanje').addEventListener('submit', async (e) => {
  e.preventDefault();
  show();
  if ($('#s-lozinka').value !== $('#s-lozinka2').value) return show('Lozinke se ne podudaraju.');
  try {
    await post('/api/auth/postavljanje', {
      korisnik: $('#s-korisnik').value.trim(),
      lozinka: $('#s-lozinka').value,
      apiKey: $('#s-kljuc').value.trim(),
    });
    location.href = '/';
  } catch (err) {
    show(err.message);
  }
});

init().catch((e) => show(e.message));
