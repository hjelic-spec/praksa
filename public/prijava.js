const $ = (s) => document.querySelector(s);

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.greska ?? res.statusText);
  return data;
}

function show(msg) {
  $('#poruka').hidden = !msg;
  $('#poruka').textContent = msg ?? '';
}

async function init() {
  const s = await fetch('/api/auth/stanje').then((r) => r.json());
  if (s.prijavljen) { location.href = '/'; return; }
  const form = s.postoji ? $('#prijava') : $('#postavljanje');
  form.hidden = false;
  form.querySelector('input').focus();
}

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
