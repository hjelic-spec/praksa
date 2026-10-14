const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, text) => (/^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

const FILTER_LABELS = { datumOd: 'Datum odluke od', datumDo: 'Datum odluke do' };
const SMJER = {
  'u prilog': ['U prilog našem stajalištu', 'da'],
  protiv: ['Protiv našeg stajališta', 'ne'],
  mješovito: ['Mješovito', 'djelomično'],
  neutralno: ['Ostale odluke', ''],
};

const state = { predmet: null, rezultat: null, anon: null, dodatni: [], iskljuceno: [], ukljuceno: [] };

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.href = '/prijava.html'; throw new Error('Potrebna je prijava.'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.greska ?? res.statusText);
  return data;
}

const usd = (n) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 3)}`;

// ---------- predmeti ----------

async function loadPredmeti(selectId) {
  const list = await api('/api/predmeti');
  const sel = $('#predmet');
  sel.innerHTML = '<option value="">— bez predmeta (pretraga se ne sprema) —</option>' +
    list.map((p) => `<option value="${esc(p.id)}">${esc(p.naziv)} (${p.brojPretraga} pretr., ${usd(p.trosakUSD)})</option>`).join('');
  const id = selectId ?? localGet('predmet');
  if (id && list.some((p) => p.id === id)) sel.value = id;
  await selectPredmet(sel.value);
}

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* nije bitno */ } }

async function selectPredmet(id) {
  localSet('predmet', id);
  state.predmet = id ? await api(`/api/predmeti/${id}`) : null;
  renderPredmet();
  if (state.rezultat) render(state.rezultat);
}

function selectedCount() {
  return state.predmet ? Object.values(state.predmet.odluke).filter((o) => o.odabrano).length : 0;
}

function renderPredmet() {
  const p = state.predmet;
  $('#pretrage').hidden = !p || !p.pretrage.length;
  $('#izvoz').hidden = !p;
  $('#predmet-info').textContent = p
    ? `Pretrage i bilješke spremaju se lokalno. Spremljenih pretraga: ${p.pretrage.length}. Ukupni procijenjeni trošak predmeta: ${usd(p.trosakUSD)}.`
    : 'Odaberite ili otvorite predmet kako bi se pretrage, bilješke i odabir odluka spremili.';
  if (!p) return;
  const n = selectedCount();
  $('#izvoz').textContent = `Izvezi odabrane u Word (${n})`;
  $('#izvoz').disabled = !n;
  $('#pretrage-lista').innerHTML = p.pretrage.map((s) => `<li>
    <a href="#" data-pretraga="${esc(s.id)}">${esc(new Date(s.datum).toLocaleString('hr-HR'))}</a>
    – ${esc(s.opis.slice(0, 110))}${s.opis.length > 110 ? '…' : ''}
    <span class="meta">(${s.rezultat?.odluke?.length ?? 0} odluka${s.rezultat?.trosak ? `, ${usd(s.rezultat.trosak.usd)}` : ''})</span>
    <button type="button" class="link" data-obrisi="${esc(s.id)}" title="Obriši pretragu">obriši</button></li>`).join('');
}

$('#predmet').addEventListener('change', (e) => selectPredmet(e.target.value).catch(showError));

// Unos naziva u obrascu (window.prompt nije dostupan u Windows aplikaciji).
$('#novi-predmet').addEventListener('click', () => {
  $('#novi-predmet-forma').hidden = false;
  $('#novi-predmet-naziv').focus();
});
$('#novi-predmet-odustani').addEventListener('click', () => { $('#novi-predmet-forma').hidden = true; });
$('#novi-predmet-forma').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await api('/api/predmeti', { method: 'POST', body: { naziv: $('#novi-predmet-naziv').value } });
    $('#novi-predmet-naziv').value = '';
    $('#novi-predmet-forma').hidden = true;
    await loadPredmeti(p.id);
  } catch (err) { showError(err); }
});

// ---------- postavke i odjava ----------

async function loadPostavke() {
  const s = await api('/api/postavke');
  $('#kljuc-stanje').textContent = s.imaKljuc ? `Ključ je postavljen (završava s …${s.kljucZavrsava}).` : 'Ključ NIJE postavljen – pretraga neće raditi.';
  $('#max-odluka').value = s.maxOdluka;
  $('#kontakt').value = s.kontakt;
  renderCjenik(await api('/api/cjenik'));
  return s;
}

function renderCjenik(c) {
  const p = c.cijenaModela;
  const kada = c.dohvaceno ? `osvježen ${new Date(c.dohvaceno).toLocaleString('hr-HR')} sa službene stranice Anthropica` : esc(c.izvor);
  $('#cjenik-stanje').innerHTML = `Cjenik ${kada}; osvježava se automatski jednom dnevno.`
    + (p ? `<br>${esc(c.model)}: ulaz $${p.ulaz}, izlaz $${p.izlaz}, čitanje iz međuspremnika $${p.citanje} po milijunu tokena.` : '')
    + (c.greska ? `<br><span class="greska">${esc(c.greska)}</span>` : '');
}

$('#osvjezi-cjenik').addEventListener('click', async () => {
  $('#osvjezi-cjenik').disabled = true;
  try { renderCjenik(await api('/api/cjenik/osvjezi', { method: 'POST' })); } catch (err) { showError(err); }
  $('#osvjezi-cjenik').disabled = false;
});

$('#otvori-postavke').addEventListener('click', async () => {
  const sec = $('#postavke');
  sec.hidden = !sec.hidden;
  if (!sec.hidden) await loadPostavke().catch(showError);
});

$('#postavke-forma').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/postavke', { method: 'POST', body: { apiKey: $('#api-kljuc').value.trim(), maxOdluka: $('#max-odluka').value, kontakt: $('#kontakt').value } });
    $('#api-kljuc').value = '';
    await loadPostavke();
    $('#postavke-poruka').textContent = 'Postavke su spremljene.';
  } catch (err) { $('#postavke-poruka').textContent = `Greška: ${err.message}`; }
});

$('#lozinka-forma').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/lozinka', { method: 'POST', body: { stara: $('#stara-lozinka').value, nova: $('#nova-lozinka').value } });
    location.href = '/prijava.html';
  } catch (err) { $('#postavke-poruka').textContent = `Greška: ${err.message}`; }
});

$('#odjava').addEventListener('click', async () => {
  await api('/api/auth/odjava', { method: 'POST' }).catch(() => {});
  location.href = '/prijava.html';
});

$('#pretrage-lista').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-pretraga]');
  const del = e.target.closest('[data-obrisi]');
  if (open) {
    e.preventDefault();
    const s = state.predmet.pretrage.find((x) => x.id === open.dataset.pretraga);
    $('#opis').value = s.opis;
    $('#stajaliste').value = s.stajaliste ?? '';
    render(s.rezultat, s);
  } else if (del && confirm('Obrisati ovu spremljenu pretragu? Bilješke uz odluke ostaju.')) {
    await api(`/api/predmeti/${state.predmet.id}/pretrage/${del.dataset.obrisi}`, { method: 'DELETE' }).catch(showError);
    await selectPredmet(state.predmet.id);
  }
});

$('#izvoz').addEventListener('click', () => {
  if (state.predmet) window.location.href = `/api/predmeti/${state.predmet.id}/izvoz`;
});

// Bilješke i odabir za izvoz
let noteTimers = {};
async function saveOdluka(url, patch) {
  if (!state.predmet) return;
  const o = await api(`/api/predmeti/${state.predmet.id}/odluke`, { method: 'POST', body: { url, ...patch } });
  state.predmet.odluke[url] = o;
  renderPredmet();
}

$('#odluke').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-izvoz]');
  if (cb) saveOdluka(cb.dataset.izvoz, { odabrano: cb.checked }).catch(showError);
});
$('#odluke').addEventListener('input', (e) => {
  const ta = e.target.closest('textarea[data-biljeska]');
  if (!ta) return;
  const url = ta.dataset.biljeska;
  clearTimeout(noteTimers[url]);
  ta.nextElementSibling.textContent = 'sprema se…';
  noteTimers[url] = setTimeout(() => saveOdluka(url, { biljeska: ta.value })
    .then(() => { ta.nextElementSibling.textContent = 'spremljeno'; })
    .catch((err) => { ta.nextElementSibling.textContent = `greška: ${err.message}`; }), 700);
});

// ---------- anonimizacija ----------

async function refreshAnon() {
  state.anon = await api('/api/anonimizacija', {
    method: 'POST',
    body: { opis: $('#opis').value, stajaliste: $('#stajaliste').value, dodatni: state.dodatni, iskljuceno: state.iskljuceno, ukljuceno: state.ukljuceno },
  });
  const a = state.anon;
  $('#stavke').innerHTML = a.stavke.length
    ? a.stavke.map((s) => `<li><label><input type="checkbox" data-oznaka="${esc(s.oznaka)}" ${s.ukljuceno ? 'checked' : ''}>
        <code>${esc(s.oznaka)}</code> ← ${s.oblici.map((o) => `„${esc(o)}“`).join(', ')} <span class="meta">(${esc(s.tip)})</span></label></li>`).join('')
    : '<li class="meta">Nije prepoznat nijedan osobni podatak. Provjerite tekst i po potrebi dodajte pojmove ručno.</li>';
  $('#anon-opis').textContent = a.opis;
  $('#anon-stajaliste').textContent = a.stajaliste;
  $('#anon-stajaliste-wrap').hidden = !a.stajaliste;
}

$('#upit').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.dodatni = []; state.iskljuceno = []; state.ukljuceno = [];
  try {
    await refreshAnon();
    $('#upit').hidden = true;
    $('#pregled').hidden = false;
    $('#pregled').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { showError(err); }
});

$('#stavke').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-oznaka]');
  if (!cb) return;
  const o = cb.dataset.oznaka;
  state.iskljuceno = state.iskljuceno.filter((x) => x !== o);
  state.ukljuceno = state.ukljuceno.filter((x) => x !== o);
  (cb.checked ? state.ukljuceno : state.iskljuceno).push(o);
  refreshAnon().catch(showError);
});

function addTerm() {
  const t = $('#dodatni').value.trim();
  if (!t) return;
  state.dodatni.push(t);
  $('#dodatni').value = '';
  refreshAnon().catch(showError);
}
$('#dodaj').addEventListener('click', addTerm);
$('#dodatni').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } });

$('#natrag').addEventListener('click', () => {
  $('#pregled').hidden = true;
  $('#upit').hidden = false;
});

$('#posalji').addEventListener('click', async () => {
  const btn = $('#posalji');
  btn.disabled = true;
  $('#pregled').hidden = true;
  $('#upit').hidden = false;
  $('#upit button[type=submit]').disabled = true;
  $('#status').hidden = false;
  $('#status').textContent = 'Šaljem upit…';
  $('#odluke').innerHTML = '';
  $('#sinteza').hidden = true;
  $('#upozorenja').hidden = true;
  const filters = Object.fromEntries([...document.querySelectorAll('#filteri input')].filter((i) => i.value).map((i) => [i.name, i.value]));
  try {
    const { id } = await api('/api/upit', {
      method: 'POST',
      body: { opis: state.anon.opis, stajaliste: state.anon.stajaliste, filters, predmetId: state.predmet?.id },
    });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/upit/${id}`);
      $('#status').textContent = job.napredak.at(-1)?.poruka ?? 'Radim…';
      if (job.status === 'gotovo') {
        $('#status').hidden = true;
        if (job.predmetId && state.predmet?.id === job.predmetId) {
          state.predmet = await api(`/api/predmeti/${job.predmetId}`);
          renderPredmet();
        }
        render(job.rezultat);
        break;
      }
      if (job.status === 'greška') throw new Error(job.greska);
    }
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
    $('#upit button[type=submit]').disabled = false;
  }
});

function showError(err) {
  $('#status').hidden = false;
  $('#status').textContent = `Greška: ${err.message}`;
}

// ---------- prikaz rezultata ----------

function renderEu(d) {
  const rows = d.euReference.map((r) => {
    const st = r.provjera ? ` <span class="meta">(${esc(r.provjera)})</span>` : '';
    return `<li>${r.url ? link(r.url, r.oznaka) : esc(r.oznaka)}${r.celex ? ` <span class="meta">CELEX ${esc(r.celex)}</span>` : ''}${st}</li>`;
  });
  const hyp = d.analiza.moguce_eu_poveznice.map((h) =>
    `<li class="hyp">${esc(h.akt)} – ${esc(h.obrazlozenje)} <span class="meta">(pretpostavka modela, nije navedeno u odluci)</span></li>`);
  if (d.ekljp) rows.push('<li>Odluka se poziva na EKLJP / Europski sud za ljudska prava (Vijeće Europe, nije pravo EU)</li>');
  if (!rows.length && !hyp.length) return '<p class="meta">Nema poveznica s pravom EU.</p>';
  return `<ul>${rows.join('')}${hyp.join('')}</ul>`;
}

function weightBadges(d) {
  const t = d.tezina ?? {};
  const a = d.analiza;
  const out = [];
  if (t.razinaOznaka) out.push(`<span class="badge">${esc(t.razinaOznaka)}</span>`);
  if (t.pravomocna === true) out.push('<span class="badge">pravomoćna</span>');
  if (t.pravomocna === false) out.push('<span class="badge djelomično">nije pravomoćna</span>');
  if (t.stara) out.push(`<span class="badge djelomično" title="Propisi i praksa su se mogli promijeniti">${t.godina}. – stara ${t.starost} god.</span>`);
  else if (t.godina) out.push(`<span class="badge">${t.godina}.</span>`);
  if (a.primjenjivost?.upozorenje) out.push('<span class="badge ne">provjerite primjenjivost</span>');
  return out.join('');
}

function renderDecision(d, hasStance) {
  const a = d.analiza;
  const m = d.meta ?? {};
  const naslov = m.poslovniBroj ?? d.naslov;
  const citat = a.citat
    ? `<blockquote>„${esc(a.citat)}“</blockquote><p class="meta">${d.citatProvjeren ? '✔ citat pronađen u tekstu odluke' : '⚠ citat NIJE pronađen doslovno u tekstu – provjerite izvornik'}</p>`
    : '';
  const povezani = [
    ...d.povezaniURezultatima.map((r) => `<li>${link(r.url, r.poslovniBroj)} – ${esc(r.odnos)}</li>`),
    ...d.citiraniPredmeti.map((c) => `<li>${esc(c)} <span class="meta">(citiran u odluci)</span></li>`),
  ];
  const smjer = a.smjer && a.smjer !== 'neutralno' && hasStance
    ? `<span class="badge ${esc(SMJER[a.smjer]?.[1])}">${esc(a.smjer)}</span>` : '';
  const o = state.predmet?.odluke[d.url] ?? { biljeska: '', odabrano: false };
  const predmetBlock = state.predmet ? `<div class="biljeska">
      <label><input type="checkbox" data-izvoz="${esc(d.url)}" ${o.odabrano ? 'checked' : ''}> uključi u izvoz</label>
      <textarea data-biljeska="${esc(d.url)}" rows="2" placeholder="Bilješka uz odluku (sprema se automatski)">${esc(o.biljeska)}</textarea><span class="meta"></span>
    </div>` : '';
  return `<article class="card">
    <h3>${link(d.url, naslov)}</h3>
    <div class="meta">${esc([m.sud, m.datum, m.vrsta, m.ecli, d.izvor].filter(Boolean).join(' · '))}</div>
    <p>${smjer}<span class="badge ${esc(a.podudaranje)}">podudaranje: ${esc(a.podudaranje)}</span><span class="badge">relevantnost ${a.relevantnost}/100</span>
      ${weightBadges(d)}${d.skraceno ? '<span class="badge ne">tekst skraćen za analizu</span>' : ''}</p>
    <p>${esc(a.objasnjenje)}</p>
    ${citat}
    <dl>
      ${hasStance && a.smjer_obrazlozenje ? `<dt>Odnos prema našem stajalištu</dt><dd>${esc(a.smjer_obrazlozenje)}</dd>` : ''}
      ${a.kako_iskoristiti ? `<dt>${a.smjer === 'protiv' ? 'Kako se suprotstaviti' : 'Kako iskoristiti'}</dt><dd>${esc(a.kako_iskoristiti)}</dd>` : ''}
      ${a.primjenjivost?.upozorenje ? `<dt>Primjenjivost danas <span class="meta">(procjena modela)</span></dt><dd class="hyp">${esc(a.primjenjivost.razlog)}</dd>` : ''}
      <dt>Činjenice</dt><dd>${esc(a.cinjenice_predmeta)}</dd>
      <dt>Ishod</dt><dd>${esc(a.ishod)}</dd>
      <dt>Pravno shvaćanje</dt><dd>${esc(a.pravno_shvacanje)}</dd>
      <dt>Zašto je važno</dt><dd>${esc(a.zasto_je_vazno)}</dd>
      <dt>Primijenjeni propisi</dt><dd>${esc(a.primijenjeni_propisi.join('; ') || '—')}</dd>
    </dl>
    <details><summary>Povezani predmeti (${povezani.length})</summary><ul>${povezani.join('') || '<li>—</li>'}</ul></details>
    <details><summary>Veza s pravom EU</summary>${renderEu(d)}</details>
    <p class="meta">Pronađeno upitima: ${esc(d.upiti.join(' | '))}</p>
    ${predmetBlock}
  </article>`;
}

// Viši sud i veća relevantnost prvo.
const byWeight = (a, b) => b.analiza.relevantnost - a.analiza.relevantnost || (a.tezina?.razina ?? 9) - (b.tezina?.razina ?? 9);

function render(r, saved) {
  state.rezultat = r;
  const s = r.sinteza;
  const hasStance = Boolean(r.stajaliste);
  $('#sinteza').hidden = !s;
  if (s) {
    $('#sinteza').innerHTML = `<div class="card"><h2>Sinteza prakse</h2>
      ${saved ? `<p class="meta">Spremljena pretraga od ${esc(new Date(saved.datum).toLocaleString('hr-HR'))}</p>` : ''}
      ${r.trosak ? `<p class="meta trosak">Procijenjeni trošak pretrage: <strong>${usd(r.trosak.usd)}</strong>
        (${r.trosak.pozivi} poziva modela, ${r.trosak.ulazniTokeni.toLocaleString('hr-HR')} ulaznih i ${r.trosak.izlazniTokeni.toLocaleString('hr-HR')} izlaznih tokena)</p>` : ''}
      <p>${esc(s.pregled)}</p>
      <dl>
      ${s.argumenti_u_prilog ? `<dt>Argumenti u prilog našem stajalištu</dt><dd>${esc(s.argumenti_u_prilog)}</dd>` : ''}
      ${s.argumenti_protiv_i_odgovor ? `<dt>Argumenti protiv i kako im se suprotstaviti</dt><dd>${esc(s.argumenti_protiv_i_odgovor)}</dd>` : ''}
      <dt>Prevladavajuće stajalište</dt><dd>${esc(s.prevladavajuce_stajaliste)}</dd>
      ${s.razlike_u_praksi ? `<dt>Razlike u praksi</dt><dd>${esc(s.razlike_u_praksi)}</dd>` : ''}
      <dt>Veza s pravom EU</dt><dd>${esc(s.veza_s_pravom_eu)}</dd>
      <dt>Za daljnje istraživanje</dt><dd><ul>${s.preporuke_za_daljnje_istrazivanje.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd></dl>
      <details><summary>Razrada i poslani tekst</summary><p>${esc(r.plan.sazetak_problema)}</p>
      <p class="meta">Upiti: ${esc(r.plan.upiti.join(' | '))}</p>
      <p class="meta">Poslani opis: ${esc(r.opis)}</p>${hasStance ? `<p class="meta">Poslano stajalište: ${esc(r.stajaliste)}</p>` : ''}</details></div>`;
  }
  if (!r.odluke.length) {
    $('#odluke').innerHTML = '<p>Nije pronađena nijedna odluka.</p>';
  } else if (hasStance) {
    $('#odluke').innerHTML = `<h2>Odluke (${r.odluke.length})</h2>` + Object.entries(SMJER).map(([key, [title]]) => {
      const group = r.odluke.filter((d) => (d.analiza.smjer ?? 'neutralno') === key).sort(byWeight);
      return group.length ? `<h3 class="group">${esc(title)} (${group.length})</h3>${group.map((d) => renderDecision(d, true)).join('')}` : '';
    }).join('');
  } else {
    $('#odluke').innerHTML = `<h2>Odluke (${r.odluke.length})</h2>` + [...r.odluke].sort(byWeight).map((d) => renderDecision(d, false)).join('');
  }
  $('#upozorenja').hidden = !r.upozorenja.length;
  $('#upozorenja').innerHTML = `<details><summary>Upozorenja (${r.upozorenja.length})</summary><ul>${r.upozorenja.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>`;
}

async function init() {
  const info = await api('/api/info');
  $('#korisnik').textContent = `Prijavljeni: ${info.korisnik}`;
  if (!info.imaKljuc) {
    $('#postavke').hidden = false;
    await loadPostavke();
    $('#postavke-poruka').textContent = 'Upišite Anthropic API ključ kako bi pretraga radila.';
  }
  $('#filteri').innerHTML = info.filteri.map((f) =>
    `<label>${esc(FILTER_LABELS[f] ?? f)} <input name="${esc(f)}" type="date"></label>`).join('');
  await loadPredmeti();
}

init().catch(showError);
