const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, text) => (/^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
const usd = (n) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 3)}`;

const FILTER_LABELS = { datumOd: 'Datum odluke od', datumDo: 'Datum odluke do' };
const SMJER_CLASS = { 'u prilog': 'da', protiv: 'ne', mješovito: 'djelomično' };

const state = { predmet: null, predmetId: null, rezultat: null };

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

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* nije bitno */ } }

function showError(err) {
  $('#status').hidden = false;
  $('#status').innerHTML = `<span class="greska">Greška: ${esc(err.message)}</span>`;
}

// ---------- pretraga ----------

const opis = $('#opis');
function autoGrow() { opis.style.height = 'auto'; opis.style.height = `${Math.min(opis.scrollHeight, 240)}px`; }
opis.addEventListener('input', autoGrow);
opis.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#upit').requestSubmit(); }
});
$('#primjeri').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  opis.value = chip.textContent.trim();
  autoGrow();
  opis.focus();
});

// Povratak na početni zaslon: prazno polje, primjeri upita, bez rezultata (bez ponovnog učitavanja).
function goHome() {
  clearResults();
  state.rezultat = null;
  $('#status').hidden = true;
  for (const d of document.querySelectorAll('.drawer')) d.hidden = true;
  document.body.classList.replace('results', 'landing');
  opis.value = '';
  autoGrow();
  window.scrollTo({ top: 0 });
  opis.focus();
}
$('#pocetna').addEventListener('click', goHome);
$('#brand').addEventListener('click', (e) => { e.preventDefault(); goHome(); });
document.addEventListener('keydown', (e) => { if (e.altKey && e.key === 'Home') { e.preventDefault(); goHome(); } });

function clearResults() {
  for (const id of ['#odgovor', '#upozorenja']) $(id).hidden = true;
  $('#rezultati').innerHTML = '';
  $('#ostale').innerHTML = '';
}

// ---------- opcije pretraživanja (kvadratići iznad tražilice) ----------

// Izbor se pamti u pregledniku; bez pristupa pohrani vrijede zadane vrijednosti.
const OPCIJE_KLJUC = 'praksa.opcije';
function spremiOpcije() {
  try { localStorage.setItem(OPCIJE_KLJUC, JSON.stringify({ pravoEu: $('#opc-eu').checked, lokalnaZbirka: $('#opc-lokalno').checked })); } catch { /* bez pohrane */ }
}
// 1 odluka, 2–4 odluke, 5–20 odluka, 21 odluka, 22 odluke…
const odlukaRijec = (n) => (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'odluke' : 'odluka');

function postaviOpcije(lokalnaZbirka, mapa) {
  let spremljeno = {};
  try { spremljeno = JSON.parse(localStorage.getItem(OPCIJE_KLJUC) ?? '{}') ?? {}; } catch { /* bez pohrane */ }
  if (typeof spremljeno.pravoEu === 'boolean') $('#opc-eu').checked = spremljeno.pravoEu;
  const lok = $('#opc-lokalno');
  if (lokalnaZbirka === null) {
    $('#opc-lokalno-oznaka').hidden = true; // izvor nije uključen u PRAKSA_SOURCES
    lok.checked = false;
  } else if (lokalnaZbirka === 0) {
    lok.checked = false;
    lok.disabled = true;
    $('#opc-lokalno-oznaka').classList.add('onemoguceno');
    $('#opc-lokalno-broj').textContent = mapa ? `(prazna – odluke (.txt, .html) dodajte u ${mapa})` : '(prazna – odluke dodaje administrator)';
  } else {
    if (typeof spremljeno.lokalnaZbirka === 'boolean') lok.checked = spremljeno.lokalnaZbirka;
    $('#opc-lokalno-broj').textContent = `(${lokalnaZbirka} ${odlukaRijec(lokalnaZbirka)})`;
  }
}
$('#opc-eu').addEventListener('change', spremiOpcije);
$('#opc-lokalno').addEventListener('change', spremiOpcije);

$('#upit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#trazi');
  btn.disabled = true;
  document.body.classList.replace('landing', 'results');
  clearResults();
  $('#status').hidden = false;
  $('#status').innerHTML = '<span class="spinner"></span> Šaljem upit…';
  const filters = Object.fromEntries([...document.querySelectorAll('#filteri input')].filter((i) => i.value).map((i) => [i.name, i.value]));
  try {
    const opcije = { pravoEu: $('#opc-eu').checked, lokalnaZbirka: !$('#opc-lokalno').disabled && $('#opc-lokalno').checked };
    const { id } = await api('/api/upit', { method: 'POST', body: { opis: opis.value, filters, opcije, predmetId: state.predmetId } });
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const job = await api(`/api/upit/${id}`);
      $('#status').innerHTML = `<span class="spinner"></span> ${esc(job.napredak.at(-1)?.poruka ?? 'Radim…')}`;
      if (job.status === 'gotovo') {
        $('#status').hidden = true;
        await selectPredmet(job.predmetId);
        render(job.rezultat);
        break;
      }
      if (job.status === 'greška') throw new Error(job.greska);
    }
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
  }
});

// ---------- prikaz rezultata ----------

// Stariji spremljeni rezultati imaju drukčija polja (jedan citat, sinteza umjesto odgovora).
function quotesOf(d) {
  const a = d.analiza;
  if (Array.isArray(a.citati)) return a.citati;
  return a.citat ? [{ tekst: a.citat, znacaj: '', provjeren: Boolean(d.citatProvjeren) }] : [];
}
function answerOf(r) {
  if (r.odgovor) return r.odgovor;
  const s = r.sinteza;
  return s ? { kratki_odgovor: s.pregled, vodeca_praksa: s.prevladavajuce_stajaliste, suprotna_praksa: s.razlike_u_praksi, upozorenja: [], dalje_provjeriti: s.preporuke_za_daljnje_istrazivanje ?? [], veza_s_pravom_eu: s.veza_s_pravom_eu } : null;
}

const refs = (text) => esc(text).replace(/\[(\d+)\]/g, '<a href="#odluka-$1" class="ref">[$1]</a>');

function relevanceDots(n) {
  const full = Math.round((n ?? 0) / 20);
  return `<span class="dots" title="relevantnost ${n}/100" aria-label="relevantnost ${n} od 100">${'●'.repeat(full)}${'○'.repeat(5 - full)}</span>`;
}

function headerLine(d) {
  const m = d.meta ?? {};
  const t = d.tezina ?? {};
  const pravomocnost = t.pravomocna === true ? 'pravomoćna' : t.pravomocna === false ? '<span class="warn">nije pravomoćna</span>' : '';
  return [esc(m.sud), `<strong>${esc(m.poslovniBroj ?? d.naslov)}</strong>`, esc(m.datum), esc(m.vrsta?.toLowerCase()), pravomocnost]
    .filter(Boolean).join(' · ');
}

function navodText(d) {
  const q = quotesOf(d)[0];
  return `${d.navod ?? d.meta?.poslovniBroj ?? d.naslov}${q ? ` – „${q.tekst}“` : ''}`;
}

function quoteBlock(c) {
  return `<blockquote>„${esc(c.tekst)}“</blockquote>
    <p class="meta">${c.provjeren ? '✔ provjeren u tekstu odluke' : '<span class="warn">⚠ nije pronađen doslovno – provjerite izvornik</span>'}${c.znacaj ? ` · ${esc(c.znacaj)}` : ''}</p>`;
}

function renderEu(d) {
  const rows = (d.euReference ?? []).map((r) => `<li>${r.url ? link(r.url, r.oznaka) : esc(r.oznaka)}${r.celex ? ` <span class="meta">CELEX ${esc(r.celex)}</span>` : ''}</li>`);
  if (d.ekljp) rows.push('<li>Poziva se na EKLJP / Europski sud za ljudska prava</li>');
  const hyp = (d.analiza.moguce_eu_poveznice ?? []).map((h) => `<li class="hyp">${esc(h.akt)} – ${esc(h.obrazlozenje)} <span class="meta">(pretpostavka modela)</span></li>`);
  return rows.length || hyp.length ? `<ul>${rows.join('')}${hyp.join('')}</ul>` : '';
}

function details(d) {
  const a = d.analiza;
  const t = d.tezina ?? {};
  const [, ...ostaliCitati] = quotesOf(d);
  const povezani = [
    ...(d.povezaniURezultatima ?? []).map((r) => `<li>${link(r.url, r.poslovniBroj)} – ${esc(r.odnos)}</li>`),
    ...(d.citiraniPredmeti ?? []).map((c) => `<li>${esc(c)} <span class="meta">(citiran u odluci)</span></li>`),
  ];
  const napomene = [
    t.stara && `Odluka je stara ${t.starost} godina – provjerite primjenjuje li se isti propis.`,
    a.primjenjivost?.upozorenje && `${a.primjenjivost.razlog} (procjena modela)`,
    d.skraceno && 'Odluka je preduga pa je za analizu skraćena.',
  ].filter(Boolean);
  const eu = renderEu(d);
  const row = (label, html) => (html ? `<dt>${label}</dt><dd>${html}</dd>` : '');
  return `<dl>
    ${row('Pravno pitanje', esc(a.pravno_pitanje))}
    ${row('Bitne činjenice', esc(a.bitne_cinjenice ?? a.cinjenice_predmeta))}
    ${row('Razlike u odnosu na upit', esc(a.razlike_od_upita))}
    ${row('Ishod', esc(a.ishod))}
    ${row('Primijenjeni propisi', esc((a.primijenjeni_propisi ?? []).join('; ')))}
    ${row(a.smjer === 'protiv' ? 'Kako se suprotstaviti' : 'Kako iskoristiti', esc(a.kako_iskoristiti))}
    ${row('Ostali citati', ostaliCitati.map(quoteBlock).join(''))}
    ${row('Povezani predmeti', povezani.length ? `<ul>${povezani.join('')}</ul>` : '')}
    ${row('Napomene', napomene.map((n) => `<p class="warn">${esc(n)}</p>`).join(''))}
    ${row('Pravo EU / EKLJP', eu)}
  </dl>`;
}

function saveButton(d) {
  const saved = state.predmet?.odluke?.[d.url]?.odabrano;
  return `<button type="button" class="link-btn" data-spremi="${esc(d.url)}">${saved ? '★ Spremljeno' : '☆ Spremi'}</button>`;
}

function renderCard(d) {
  const a = d.analiza;
  const [prvi] = quotesOf(d);
  const smjer = a.smjer && a.smjer !== 'neutralno' ? `<span class="badge ${SMJER_CLASS[a.smjer] ?? ''}">${esc(a.smjer)}</span>` : '';
  return `<article class="card precedent" id="odluka-${d.br}">
    <div class="card-head">
      <div class="head-line"><span class="num">[${d.br}]</span> ${headerLine(d)}</div>
      ${relevanceDots(a.relevantnost)}
    </div>
    ${a.odgovor_na_upit ? `<p class="answer-line">${esc(a.odgovor_na_upit)}</p>` : `<p class="answer-line">${esc(a.objasnjenje)}</p>`}
    <div class="ratio"><span class="label">Pravno shvaćanje</span>${esc(a.pravno_shvacanje)}</div>
    ${prvi ? quoteBlock(prvi) : ''}
    <div class="actions">
      ${smjer}
      <button type="button" class="link-btn" data-kopiraj="${esc(d.url)}">Kopiraj za podnesak</button>
      ${saveButton(d)}
      ${link(d.url, 'Izvornik ↗')}
    </div>
    <details class="more"><summary>Svi detalji</summary>${details(d)}</details>
  </article>`;
}

function render(r, saved) {
  state.rezultat = r;
  document.body.classList.replace('landing', 'results');
  if (opis.value.trim() !== r.opis) opis.value = r.opis;
  // Visina polja računa se nakon promjene rasporeda (na zaslonu s rezultatima polje je šire).
  requestAnimationFrame(autoGrow);

  const items = r.odluke ?? [];
  const glavne = items.filter((d) => d.istaknuta ?? d.analiza.podudaranje !== 'ne');
  const ostale = items.filter((d) => !glavne.includes(d));
  glavne.forEach((d, i) => { d.br ??= i + 1; });

  const odg = answerOf(r);
  const status = [
    r.pregledano ? `pregledano ${r.pregledano} odluka` : null,
    `prikazano ${glavne.length} relevantnih`,
    r.opcije?.pravoEu === false ? 'bez europskog prava' : null,
    r.trosak ? `trošak ${usd(r.trosak.usd)}${r.trosak.modeli?.length ? ` (${r.trosak.modeli.join(', ')})` : ''}` : null,
    saved ? `spremljena pretraga od ${new Date(saved.datum).toLocaleString('hr-HR')}` : null,
  ].filter(Boolean).join(' · ');
  const filt = r.primijenjeniFilteri && Object.keys(r.primijenjeniFilteri).length
    ? ` · razdoblje: ${esc([r.primijenjeniFilteri.datumOd, r.primijenjeniFilteri.datumDo].map((x) => x ?? '…').join(' – '))}` : '';

  $('#odgovor').hidden = false;
  $('#odgovor').innerHTML = `<div class="answer-box">
    ${odg ? `<h2>Odgovor</h2>
      <p class="answer-main">${refs(odg.kratki_odgovor)}</p>
      ${odg.vodeca_praksa ? `<p><strong>Vodeća praksa:</strong> ${refs(odg.vodeca_praksa)}</p>` : ''}
      ${odg.suprotna_praksa ? `<p><strong>Suprotna praksa:</strong> ${refs(odg.suprotna_praksa)}</p>` : ''}
      ${odg.upozorenja?.length ? `<ul class="warn-list">${odg.upozorenja.map((u) => `<li>${refs(u)}</li>`).join('')}</ul>` : ''}
      ${odg.veza_s_pravom_eu ? `<p class="meta"><strong>Pravo EU:</strong> ${refs(odg.veza_s_pravom_eu)}</p>` : ''}
      ${odg.dalje_provjeriti?.length ? `<details><summary>Što još provjeriti</summary><ul>${odg.dalje_provjeriti.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`
      : '<h2>Nema relevantnih odluka</h2><p>Pokušajte drukčije opisati pravno pitanje ili proširiti razdoblje.</p>'}
    <p class="meta status-line">${esc(status)}${filt}</p>
    ${r.plan?.pravno_pitanje ? `<details class="meta"><summary>Kako je upit shvaćen</summary>
      <p><strong>Pravno pitanje:</strong> ${esc(r.plan.pravno_pitanje)}</p>
      ${r.plan.trazeno_stajaliste ? `<p><strong>Traženo stajalište:</strong> ${esc(r.plan.trazeno_stajaliste)}</p>` : ''}
      <p>Upiti tražilici: ${esc(r.plan.upiti.join(' | '))}</p></details>` : ''}
  </div>`;

  $('#rezultati').innerHTML = glavne.map(renderCard).join('');
  $('#ostale').innerHTML = ostale.length ? `<details class="others"><summary>Ostale pronađene odluke (${ostale.length})</summary><ul>
    ${ostale.map((d) => `<li>${link(d.url, d.meta?.poslovniBroj ?? d.naslov)} <span class="meta">${esc([d.meta?.sud, d.meta?.datum].filter(Boolean).join(' · '))} – ${esc(d.analiza.odgovor_na_upit ?? d.analiza.objasnjenje ?? '')}</span></li>`).join('')}
  </ul></details>` : '';

  const upoz = r.upozorenja ?? [];
  $('#upozorenja').hidden = !upoz.length;
  $('#upozorenja').innerHTML = `<details><summary>Tehničke napomene (${upoz.length})</summary><ul>${upoz.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>`;
}

const findDecision = (url) => state.rezultat?.odluke?.find((d) => d.url === url);

// Clipboard API, a ako ga preglednik ne dopusti, stariji način preko skrivenog polja.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

$('main').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-kopiraj]');
  const save = e.target.closest('[data-spremi]');
  if (copy) {
    const d = findDecision(copy.dataset.kopiraj);
    copy.textContent = (await copyText(navodText(d))) ? 'Kopirano ✔' : 'Kopiranje nije uspjelo';
    setTimeout(() => { copy.textContent = 'Kopiraj za podnesak'; }, 2000);
  } else if (save) {
    await toggleSaved(save.dataset.spremi).catch(showError);
  }
});

async function toggleSaved(url) {
  if (!state.predmetId) throw new Error('Najprije pokrenite pretragu ili odaberite predmet.');
  const now = !state.predmet?.odluke?.[url]?.odabrano;
  const o = await api(`/api/predmeti/${state.predmetId}/odluke`, { method: 'POST', body: { url, odabrano: now } });
  state.predmet.odluke[url] = o;
  for (const b of document.querySelectorAll(`[data-spremi="${CSS.escape(url)}"]`)) b.textContent = now ? '★ Spremljeno' : '☆ Spremi';
  renderDrawer();
}

// ---------- predmeti i ladica "Spremljeno" ----------

async function loadPredmeti(selectId) {
  const list = await api('/api/predmeti');
  const id = selectId ?? state.predmetId ?? localGet('predmet') ?? list.find((p) => p.zadani)?.id ?? list[0]?.id ?? null;
  $('#predmet').innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(p.naziv)} (${p.brojSpremljenih} spremljeno)</option>`).join('')
    || '<option value="">— nema predmeta —</option>';
  if (id && list.some((p) => p.id === id)) { $('#predmet').value = id; await selectPredmet(id, false); }
}

async function selectPredmet(id, reloadList = true) {
  if (!id) return;
  state.predmetId = id;
  localSet('predmet', id);
  state.predmet = await api(`/api/predmeti/${id}`);
  if (reloadList) {
    const opt = [...$('#predmet').options].some((o) => o.value === id);
    if (!opt) await loadPredmeti(id); else $('#predmet').value = id;
  }
  renderDrawer();
}

// Najnovija analiza spremljene odluke iz povijesti pretraga.
function savedDecision(url) {
  for (const s of state.predmet?.pretrage ?? []) {
    const d = s.rezultat?.odluke?.find((x) => x.url === url);
    if (d) return d;
  }
  return null;
}

function renderDrawer() {
  const p = state.predmet;
  const saved = p ? Object.entries(p.odluke).filter(([, o]) => o.odabrano) : [];
  $('#broj-spremljenih').textContent = saved.length || '';
  $('#izvoz').disabled = !saved.length;
  $('#izvoz').textContent = `Izvezi spremljene u Word (${saved.length})`;
  $('#predmet-info').textContent = p ? `Pretraga: ${p.pretrage.length} · ukupni procijenjeni trošak ${usd(p.trosakUSD)}` : '';
  $('#spremljene').innerHTML = saved.length ? saved.map(([url, o]) => {
    const d = savedDecision(url);
    return `<div class="saved-item">
      <div>${link(url, d?.navod ?? d?.meta?.poslovniBroj ?? url)}</div>
      ${d ? `<p class="meta">${esc(d.analiza.pravno_shvacanje)}</p>` : ''}
      <textarea data-biljeska="${esc(url)}" rows="2" placeholder="Bilješka (sprema se automatski)">${esc(o.biljeska)}</textarea>
      <div class="row center"><span class="meta save-state"></span><button type="button" class="link-btn" data-ukloni="${esc(url)}">Ukloni</button></div>
    </div>`;
  }).join('') : '<p class="meta">Nema spremljenih odluka. Uz odluku kliknite „☆ Spremi“.</p>';
  $('#pretrage-lista').innerHTML = (p?.pretrage ?? []).map((s) => `<li>
    <a href="#" data-pretraga="${esc(s.id)}">${esc(s.opis.slice(0, 120))}${s.opis.length > 120 ? '…' : ''}</a>
    <span class="meta">${esc(new Date(s.datum).toLocaleString('hr-HR'))} · ${s.rezultat?.odluke?.length ?? 0} odluka${s.rezultat?.trosak ? ` · ${usd(s.rezultat.trosak.usd)}` : ''}</span>
    <button type="button" class="link-btn" data-obrisi="${esc(s.id)}">obriši</button></li>`).join('') || '<li class="meta">Još nema pretraga.</li>';
}

function openDrawer(id) {
  for (const d of document.querySelectorAll('.drawer')) d.hidden = d.id !== id || !d.hidden;
}
$('#otvori-spremljeno').addEventListener('click', () => { openDrawer('ladica'); renderDrawer(); });
$('#otvori-postavke').addEventListener('click', async () => {
  openDrawer('postavke');
  if (!$('#postavke').hidden && state.uloga === 'admin') await loadPostavke().catch(showError);
});

// ---------- administracija korisnika ----------

const STATUS_LABEL = { ceka: 'čeka odobrenje', odobren: 'odobren', odbijen: 'odbijen', blokiran: 'blokiran' };
const ACTIONS = {
  ceka: [['odobri', 'Odobri'], ['odbij', 'Odbij']],
  odobren: [['blokiraj', 'Blokiraj']],
  odbijen: [['odobri', 'Ipak odobri'], ['obrisi', 'Obriši']],
  blokiran: [['deblokiraj', 'Deblokiraj'], ['obrisi', 'Obriši']],
};
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('hr-HR') : '—');

async function loadKorisnici() {
  const list = await api('/api/admin/korisnici');
  const order = { ceka: 0, odobren: 1, blokiran: 2, odbijen: 3 };
  list.sort((a, b) => (a.uloga === 'admin' ? -1 : b.uloga === 'admin' ? 1 : order[a.status] - order[b.status]));
  const pending = list.filter((u) => u.status === 'ceka').length;
  $('#broj-cekanje').textContent = pending || '';
  $('#popis-korisnika').innerHTML = list.map((u) => `<div class="user-row ${u.status === 'ceka' ? 'pending' : ''}">
    <div><strong>${esc(u.ime || u.email)}</strong> ${u.uloga === 'admin' ? '<span class="badge">administrator</span>' : `<span class="badge ${u.status === 'odobren' ? 'da' : u.status === 'ceka' ? 'djelomično' : 'ne'}">${esc(STATUS_LABEL[u.status])}</span>`}</div>
    <div class="meta">${esc(u.email)} · registriran ${fmtDate(u.stvoreno)} · zadnja prijava ${fmtDate(u.zadnjaPrijava)}</div>
    <div class="meta">Ovaj mjesec: ${u.ovajMjesec.pretrage} pretraga · ${usd(u.ovajMjesec.usd)}</div>
    ${u.uloga === 'admin' ? '' : `<div class="row">${(ACTIONS[u.status] ?? []).map(([a, l]) => `<button type="button" class="${a === 'odobri' ? '' : 'secondary'}" data-korisnik="${esc(u.id)}" data-akcija="${a}">${l}</button>`).join('')}</div>`}
  </div>`).join('');
}

$('#otvori-korisnike').addEventListener('click', async () => {
  openDrawer('korisnici');
  if (!$('#korisnici').hidden) await loadKorisnici().catch(showError);
});

$('#popis-korisnika').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-akcija]');
  if (!b) return;
  if (b.dataset.akcija === 'obrisi' && !confirm('Obrisati korisnika i sve njegove predmete? Ovo se ne može poništiti.')) return;
  b.disabled = true;
  try {
    await api(`/api/admin/korisnici/${b.dataset.korisnik}`, { method: 'POST', body: { akcija: b.dataset.akcija } });
    await loadKorisnici();
  } catch (err) { showError(err); b.disabled = false; }
});
for (const b of document.querySelectorAll('[data-zatvori]')) b.addEventListener('click', () => { b.closest('.drawer').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const d of document.querySelectorAll('.drawer')) d.hidden = true; });

$('#predmet').addEventListener('change', (e) => selectPredmet(e.target.value).catch(showError));
$('#novi-predmet').addEventListener('click', () => { $('#novi-predmet-forma').hidden = false; $('#novi-predmet-naziv').focus(); });
$('#novi-predmet-forma').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await api('/api/predmeti', { method: 'POST', body: { naziv: $('#novi-predmet-naziv').value } });
    $('#novi-predmet-naziv').value = '';
    $('#novi-predmet-forma').hidden = true;
    await loadPredmeti(p.id);
  } catch (err) { showError(err); }
});
$('#izvoz').addEventListener('click', () => { if (state.predmetId) window.location.href = `/api/predmeti/${state.predmetId}/izvoz`; });

const noteTimers = {};
$('#ladica').addEventListener('input', (e) => {
  const ta = e.target.closest('textarea[data-biljeska]');
  if (!ta) return;
  const url = ta.dataset.biljeska;
  const st = ta.parentElement.querySelector('.save-state');
  st.textContent = 'sprema se…';
  clearTimeout(noteTimers[url]);
  noteTimers[url] = setTimeout(() => api(`/api/predmeti/${state.predmetId}/odluke`, { method: 'POST', body: { url, biljeska: ta.value } })
    .then((o) => { state.predmet.odluke[url] = o; st.textContent = 'spremljeno'; })
    .catch((err) => { st.textContent = `greška: ${err.message}`; }), 700);
});
$('#ladica').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-pretraga]');
  const del = e.target.closest('[data-obrisi]');
  const rm = e.target.closest('[data-ukloni]');
  if (open) {
    e.preventDefault();
    const s = state.predmet.pretrage.find((x) => x.id === open.dataset.pretraga);
    $('#status').hidden = true;
    render(s.rezultat, s);
    $('#ladica').hidden = true;
    window.scrollTo({ top: 0 });
  } else if (del && confirm('Obrisati ovu pretragu iz povijesti? Spremljene odluke i bilješke ostaju.')) {
    await api(`/api/predmeti/${state.predmetId}/pretrage/${del.dataset.obrisi}`, { method: 'DELETE' }).catch(showError);
    await selectPredmet(state.predmetId);
  } else if (rm) {
    await toggleSaved(rm.dataset.ukloni).catch(showError);
  }
});

// ---------- postavke i odjava ----------

async function loadPostavke() {
  const s = await api('/api/postavke');
  $('#kljuc-stanje').textContent = s.imaKljuc ? `Ključ je postavljen (završava s …${s.kljucZavrsava}).` : 'Ključ NIJE postavljen – pretraga neće raditi.';
  renderModeli(s);
  $('#max-odluka').value = s.maxOdluka;
  $('#kontakt').value = s.kontakt;
  renderCjenik(await api('/api/cjenik'));
  return s;
}

const cijenaModela = (p) => (p ? `$${p.ulaz} ulaz / $${p.izlaz} izlaz po MTok` : 'cijena nije u cjeniku');

function renderModeli(s) {
  const sel = $('#model');
  sel.innerHTML = s.modeli.map((m) => `<option value="${esc(m.id)}">${esc(m.naziv)} – ${esc(cijenaModela(m.cijena))}</option>`).join('');
  sel.value = s.model;
  const opis = () => { $('#model-opis').textContent = s.modeli.find((m) => m.id === sel.value)?.opis ?? ''; };
  sel.onchange = opis;
  opis();
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

$('#postavke-forma').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/postavke', { method: 'POST', body: { apiKey: $('#api-kljuc').value.trim(), model: $('#model').value, maxOdluka: $('#max-odluka').value, kontakt: $('#kontakt').value } });
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

async function init() {
  const info = await api('/api/info');
  state.uloga = info.uloga;
  $('#verzija').textContent = info.verzija ? `Praksa ${info.verzija}` : '';
  const isAdmin = info.uloga === 'admin';
  $('#korisnik').textContent = `Prijavljeni: ${info.ime ? `${info.ime} (${info.korisnik})` : info.korisnik}${isAdmin ? ' · administrator' : ''}`;
  $('#admin-postavke').hidden = !isAdmin;
  $('#otvori-korisnike').hidden = !isAdmin;
  $('#broj-cekanje').textContent = info.naCekanju || '';
  $('#filteri').innerHTML = info.filteri.map((f) =>
    `<label>${esc(FILTER_LABELS[f] ?? f)} <input name="${esc(f)}" type="date"></label>`).join('');
  postaviOpcije(info.lokalnaZbirka, info.lokalnaZbirkaMapa);
  await loadPredmeti();
  if (!info.imaKljuc && isAdmin) {
    openDrawer('postavke');
    await loadPostavke();
    $('#postavke-poruka').textContent = 'Upišite Anthropic API ključ kako bi pretraga radila.';
  } else if (!info.imaKljuc) {
    showError(new Error('Pretraga trenutačno nije dostupna: administrator još nije postavio API ključ.'));
  }
  opis.focus();
}

init().catch(showError);
