const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (url, text) => (/^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

const FILTER_LABELS = { datumOd: 'Datum odluke od', datumDo: 'Datum odluke do' };

async function init() {
  const info = await fetch('/api/info').then((r) => r.json());
  $('#filteri').innerHTML = info.filteri.map((f) =>
    `<label>${esc(FILTER_LABELS[f] ?? f)} <input name="${esc(f)}" type="date"></label>`).join('');
}

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

function renderDecision(d) {
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
  return `<article class="card">
    <h3>${link(d.url, naslov)}</h3>
    <div class="meta">${esc([m.sud, m.ecli, d.izvor].filter(Boolean).join(' · '))}</div>
    <p><span class="badge ${esc(a.podudaranje)}">podudaranje: ${esc(a.podudaranje)}</span><span class="badge">relevantnost ${a.relevantnost}/100</span>
      ${d.skraceno ? '<span class="badge ne">tekst skraćen za analizu</span>' : ''}</p>
    <p>${esc(a.objasnjenje)}</p>
    ${citat}
    <dl>
      <dt>Činjenice</dt><dd>${esc(a.cinjenice_predmeta)}</dd>
      <dt>Ishod</dt><dd>${esc(a.ishod)}</dd>
      <dt>Pravno shvaćanje</dt><dd>${esc(a.pravno_shvacanje)}</dd>
      <dt>Zašto je važno</dt><dd>${esc(a.zasto_je_vazno)}</dd>
      <dt>Primijenjeni propisi</dt><dd>${esc(a.primijenjeni_propisi.join('; ') || '—')}</dd>
    </dl>
    <details><summary>Povezani predmeti (${povezani.length})</summary><ul>${povezani.join('') || '<li>—</li>'}</ul></details>
    <details open><summary>Veza s pravom EU</summary>${renderEu(d)}</details>
    <p class="meta">Pronađeno upitima: ${esc(d.upiti.join(' | '))}</p>
  </article>`;
}

function render(r) {
  const s = r.sinteza;
  $('#sinteza').hidden = !s;
  if (s) {
    $('#sinteza').innerHTML = `<div class="card"><h2>Sinteza prakse</h2>
      <p>${esc(s.pregled)}</p>
      <dl><dt>Prevladavajuće stajalište</dt><dd>${esc(s.prevladavajuce_stajaliste)}</dd>
      ${s.razlike_u_praksi ? `<dt>Razlike u praksi</dt><dd>${esc(s.razlike_u_praksi)}</dd>` : ''}
      <dt>Veza s pravom EU</dt><dd>${esc(s.veza_s_pravom_eu)}</dd>
      <dt>Za daljnje istraživanje</dt><dd><ul>${s.preporuke_za_daljnje_istrazivanje.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd></dl>
      <details><summary>Razrada upita</summary><p>${esc(r.plan.sazetak_problema)}</p>
      <p class="meta">Upiti: ${esc(r.plan.upiti.join(' | '))}</p></details></div>`;
  }
  $('#odluke').innerHTML = r.odluke.length
    ? `<h2>Odluke (${r.odluke.length})</h2>` + r.odluke.map(renderDecision).join('')
    : '<p>Nije pronađena nijedna odluka.</p>';
  $('#upozorenja').hidden = !r.upozorenja.length;
  $('#upozorenja').innerHTML = `<details><summary>Upozorenja (${r.upozorenja.length})</summary><ul>${r.upozorenja.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>`;
}

$('#upit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#upit button');
  btn.disabled = true;
  $('#status').hidden = false;
  $('#status').textContent = 'Šaljem upit…';
  $('#odluke').innerHTML = '';
  $('#sinteza').hidden = true;
  const filters = Object.fromEntries([...document.querySelectorAll('#filteri input')].filter((i) => i.value).map((i) => [i.name, i.value]));
  try {
    const res = await fetch('/api/upit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opis: $('#opis').value, filters }) });
    const { id, greska } = await res.json();
    if (!id) throw new Error(greska);
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await fetch(`/api/upit/${id}`).then((r) => r.json());
      $('#status').textContent = job.napredak.at(-1)?.poruka ?? 'Radim…';
      if (job.status === 'gotovo') { $('#status').hidden = true; render(job.rezultat); break; }
      if (job.status === 'greška') throw new Error(job.greska);
    }
  } catch (err) {
    $('#status').textContent = `Greška: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

init();
