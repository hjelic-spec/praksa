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

async function init() {
  const s = await fetch('/api/auth/stanje').then((r) => r.json());
  if (s.prijavljen) { location.href = '/'; return; }
  showForm(s.postoji ? 'prijava' : 'postavljanje');
}

$('#na-registraciju').addEventListener('click', (e) => { e.preventDefault(); show(); showForm('registracija'); });
$('#na-prijavu').addEventListener('click', (e) => { e.preventDefault(); show(); showForm('prijava'); });

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
