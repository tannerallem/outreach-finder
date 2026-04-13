// ── State ────────────────────────────────────────────────────────
let businessTypes = {};
let activeBizKey = '';
let activeBizLabel = '';
let activeSubFilter = '';
let biz = [];

// ── Sub-filter definitions (matches download UI) ────────────────
const SUBS = {
  'Restaurants':{lbl:'Cuisine type',tags:['Mexican','Italian','Chinese','Japanese','Thai','Indian','BBQ','Seafood','Steakhouse','Pizza','Mediterranean','American','Fast food','Vegan','Breakfast','Greek','French','Korean']},
  'Churches':{lbl:'Denomination',tags:['Non-denominational','Baptist','Catholic','Methodist','Presbyterian','Lutheran','Pentecostal','Episcopal','Evangelical','Assembly of God','SDA','Mormon']},
  'Fitness / Wellness':{lbl:'Type',tags:['CrossFit','Yoga','Pilates','Boxing','MMA','Personal training','Cycling','Swimming','24 Hour','Planet Fitness']},
  'Auto Services':{lbl:'Specialty',tags:['General repair','Body shop','Tire shop','Oil change','Transmission','Brake shop','Dealership','Electric vehicles','Diesel']},
  'Medical / Dental':{lbl:'Specialty',tags:['Dentist','Chiropractor','Physical therapy','Optometrist','Dermatology','Pediatrics','Family practice','Urgent care','Orthopedics']},
  'Legal Services':{lbl:'Practice area',tags:['Personal injury','Family law','Criminal defense','Real estate','Business law','Immigration','Estate planning','Employment']},
  'Real Estate':{lbl:'Specialty',tags:['Residential','Commercial','Property management','New construction','Luxury','Investment','Rentals']},
  'Hair Salons / Barbers':{lbl:'Type',tags:['Hair Salon','Barbershop','Natural Hair','Braiding','Nail Salon','Beauty Supply','Spa']},
  'Home Services':{lbl:'Type',tags:['Plumber','Electrician','HVAC','Roofing','Landscaping','Cleaning Service','Pest Control','Painting','Handyman']},
  'Pet Services':{lbl:'Type',tags:['Veterinarian','Pet Grooming','Pet Boarding','Dog Training','Pet Store','Dog Walking']},
};

// ── DOM helpers ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/business-types');
    businessTypes = await res.json();
  } catch { businessTypes = {}; }

  renderBizTags();
  bindEvents();
  upPrev();

  // Restore webhook URL
  const saved = localStorage.getItem('webhookUrl');
  if (saved) $('webhookUrl').value = saved;
}

function renderBizTags() {
  const container = $('bizTags');
  container.innerHTML = '';
  for (const [key, val] of Object.entries(businessTypes)) {
    const span = document.createElement('span');
    span.className = 'btag';
    span.textContent = val.label;
    span.addEventListener('click', () => {
      activeBizKey = key;
      activeBizLabel = val.label;
      activeSubFilter = '';
      $('bizInput').value = val.label;
      document.querySelectorAll('.btag').forEach(x => x.classList.remove('on'));
      span.classList.add('on');
      showSub(val.label);
      upPrev();
    });
    container.appendChild(span);
  }
}

function bindEvents() {
  $('bizInput').addEventListener('input', onBizIn);
  $('subCustom').addEventListener('input', onSubIn);
  $('city').addEventListener('input', upPrev);
  $('state').addEventListener('input', upPrev);
  $('radius').addEventListener('change', upPrev);
  $('searchBtn').addEventListener('click', startSearch);
  $('enrichBtn').addEventListener('click', enrichEmails);
  $('selAll').addEventListener('change', function() { toggleAll(this.checked); });
  $('webhookUrl').addEventListener('input', upStats);
  $('emailSubject').addEventListener('input', upPayload);
  $('sendBtn').addEventListener('click', confirmSend);
  $('confirmSendBtn').addEventListener('click', executeSend);
  $('cancelSendBtn').addEventListener('click', closeModal);
}

// ── Business type / sub-filter logic ────────────────────────────
function onBizIn() {
  const val = $('bizInput').value.trim();
  activeBizLabel = val;
  activeSubFilter = '';
  document.querySelectorAll('.btag').forEach(x => x.classList.remove('on'));

  // Try to match a server key
  activeBizKey = '';
  for (const [key, bt] of Object.entries(businessTypes)) {
    if (bt.label.toLowerCase() === val.toLowerCase()) {
      activeBizKey = key;
      break;
    }
  }

  const matchLabel = Object.values(businessTypes).find(v => v.label.toLowerCase() === val.toLowerCase());
  if (matchLabel) {
    showSub(matchLabel.label);
  } else {
    hideSub();
  }
  upPrev();
}

function showSub(label) {
  const d = SUBS[label];
  if (!d) { hideSub(); return; }
  $('subBox').style.display = 'block';
  $('subLbl').textContent = d.lbl;
  $('subCustom').value = '';
  $('subTags').innerHTML = d.tags.map(x =>
    `<span class="stag" data-val="${esc(x)}">${esc(x)}</span>`
  ).join('');
  $('subTags').querySelectorAll('.stag').forEach(el => {
    el.addEventListener('click', () => {
      activeSubFilter = el.dataset.val;
      $('subCustom').value = '';
      document.querySelectorAll('.stag').forEach(x => x.classList.remove('on'));
      el.classList.add('on');
      upPrev();
    });
  });
}

function hideSub() {
  $('subBox').style.display = 'none';
  activeSubFilter = '';
}

function onSubIn() {
  activeSubFilter = $('subCustom').value.trim();
  document.querySelectorAll('.stag').forEach(x => x.classList.remove('on'));
  upPrev();
}

function getSearchLabel() {
  const b = $('bizInput').value.trim() || activeBizLabel;
  return activeSubFilter ? activeSubFilter + ' ' + b : b;
}

function upPrev() {
  const ft = getSearchLabel();
  const city = $('city').value.trim();
  const state = $('state').value.trim();
  const r = $('radius').value;
  const loc = [city, state].filter(Boolean).join(', ');
  $('prevTxt').textContent = ft ? (ft + (loc ? ' near ' + loc + ' (' + r + ' mi)' : '')) : '—';
  upPayload();
}

function upPayload() {
  const sel = biz.find(b => b.selected && b.email);
  const subj = $('emailSubject').value;
  const name = sel ? sel.name : 'Business Name';
  const email = sel ? sel.email : 'contact@business.com';
  $('payloadBox').textContent = JSON.stringify({
    to: email,
    business_name: name,
    location: sel ? (sel.address || sel.location || '') : 'City, State',
    subject: subj.replace(/{business_name}/g, name)
  }, null, 2);
}

// ── Logging & progress ──────────────────────────────────────────
function log(m) {
  const b = $('logBox');
  const d = document.createElement('div');
  d.textContent = m;
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}

function setProg(p, l) {
  $('progFill').style.width = p + '%';
  $('progLbl').textContent = l;
  $('progPct').textContent = Math.round(p) + '%';
}

// ── Stats ────────────────────────────────────────────────────────
function upStats() {
  $('sF').textContent = biz.length;
  $('sE').textContent = biz.filter(b => b.email).length;
  $('sS').textContent = biz.filter(b => b.sent).length;
  const s = biz.filter(b => b.selected).length;
  $('selCount').textContent = s + ' selected';
  $('sendBtn').disabled = s === 0 || !$('webhookUrl').value.trim();

  // Show/hide enrich button
  const missing = biz.filter(b => !b.email).length;
  $('enrichBtn').style.display = (biz.length > 0 && missing > 0) ? 'block' : 'none';

  upPayload();
}

// ── Table ────────────────────────────────────────────────────────
function toggleAll(v) {
  biz.forEach(b => { if (b.email && !b.sent) b.selected = v; });
  renderTable();
}

function toggleRow(i) {
  if (biz[i].email && !biz[i].sent) {
    biz[i].selected = !biz[i].selected;
    renderTable();
  }
}
window.toggleRow = toggleRow;

function renderTable() {
  const tb = $('tbody');
  if (!biz.length) {
    tb.innerHTML = '<tr><td colspan="5"><div class="empty"><div style="font-size:32px;opacity:0.3">&#9906;</div><p>Search to find businesses</p></div></td></tr>';
    upStats();
    return;
  }
  tb.innerHTML = biz.map((b, i) => {
    const loc = b.address || b.location || '';
    const statusBadge = b.sent
      ? '<span class="badge bq">Queued</span>'
      : b.email
        ? '<span class="badge br">Ready</span>'
        : b.searching
          ? '<span class="badge bs">Scanning</span>'
          : '<span class="badge bn">No email</span>';
    return `<tr onclick="toggleRow(${i})">
      <td class="cc"><input type="checkbox" ${b.selected ? 'checked' : ''} ${(!b.email || b.sent) ? 'disabled' : ''} onclick="event.stopPropagation();toggleRow(${i})" /></td>
      <td style="font-weight:500" title="${esc(b.name)}">${esc(b.name)}</td>
      <td style="color:#2563eb;font-size:12px;font-family:'JetBrains Mono',monospace" title="${esc(b.email || '')}">${b.email || '<span style="color:#ddd;font-family:Inter,sans-serif">—</span>'}</td>
      <td style="color:#888" title="${esc(loc)}">${esc(loc)}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');
  upStats();
}

// ── Search (via server) ─────────────────────────────────────────
async function startSearch() {
  const city = $('city').value.trim();
  const state = $('state').value.trim();
  const radius = $('radius').value;
  const ft = getSearchLabel();

  if (!ft) { alert('Please select or type a business type.'); return; }
  if (!city) { alert('Please enter a city.'); return; }
  if (!state) { alert('Please enter a state.'); return; }

  $('searchBtn').disabled = true;
  $('searchBtn').textContent = 'Searching...';
  $('statsSec').style.display = 'block';
  $('progWrap').style.display = 'block';
  $('logBox').innerHTML = '';
  $('tableTitle').textContent = ft;
  biz = [];
  renderTable();

  log('> Searching for ' + ft + ' within ' + radius + ' miles of ' + city + ', ' + state + '...');
  setProg(15, 'Searching with AI...');

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessType: activeBizKey || ft,
        subFilter: activeSubFilter || null,
        city: city,
        state: state,
        radius: radius
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');

    const found = data.businesses || [];
    log('> Found ' + found.length + ' businesses.');
    setProg(70, 'Processing results...');

    biz = found.map(b => ({
      id: b.id,
      name: b.name || 'Unknown',
      email: b.email || null,
      address: b.address || '',
      location: b.address || (b.searchCity + ', ' + b.searchState),
      phone: b.phone || '',
      website: b.website || '',
      category: b.category || '',
      selected: !!b.email,
      sent: false,
      searching: false
    }));
    renderTable();

    const emailCount = biz.filter(b => b.email).length;
    setProg(100, 'Done! ' + emailCount + ' emails found.');
    log('> Complete. ' + emailCount + ' of ' + biz.length + ' have emails.');

  } catch (err) {
    log('! Error: ' + err.message);
    setProg(0, 'Search failed');
  }

  $('searchBtn').disabled = false;
  $('searchBtn').textContent = 'Search for businesses';
}

// ── Email enrichment (via server) ───────────────────────────────
async function enrichEmails() {
  const missing = biz.filter(b => !b.email);
  if (missing.length === 0) {
    log('> All businesses already have emails.');
    return;
  }

  $('enrichBtn').disabled = true;
  $('enrichBtn').textContent = 'Scanning...';
  $('progWrap').style.display = 'block';
  setProg(30, 'Finding missing emails...');
  log('> Searching for emails for ' + missing.length + ' businesses...');

  try {
    // Build the payload the server expects
    const payload = biz.map(b => ({
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      website: b.website,
      email: b.email || '',
      category: b.category
    }));

    const res = await fetch('/api/search/email-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businesses: payload })
    });

    const data = await res.json();
    const enriched = data.businesses || [];

    // Merge enriched emails back
    let newFound = 0;
    for (const eb of enriched) {
      const match = biz.find(b => b.id === eb.id || b.name.toLowerCase() === (eb.name || '').toLowerCase());
      if (match && !match.email && eb.email) {
        match.email = eb.email;
        match.selected = true;
        newFound++;
        log('  + ' + match.name + ': ' + eb.email);
      }
    }

    renderTable();
    setProg(100, 'Done! Found ' + newFound + ' additional emails.');
    log('> Email enrichment complete. ' + newFound + ' new emails found.');

  } catch (err) {
    log('! Email enrichment error: ' + err.message);
  }

  $('enrichBtn').disabled = false;
  $('enrichBtn').textContent = 'Find missing emails';
}

// ── Webhook ─────────────────────────────────────────────────────
function confirmSend() {
  const s = biz.filter(b => b.selected && b.email);
  if (!s.length) return;
  const wh = $('webhookUrl').value.trim();
  if (!wh) { alert('Please enter your webhook URL.'); return; }
  $('modalMsg').textContent = 'Send ' + s.length + ' lead' + (s.length > 1 ? 's' : '') + ' to your webhook to trigger outreach emails?';
  $('overlay').classList.add('on');
}

function closeModal() {
  $('overlay').classList.remove('on');
}

async function executeSend() {
  closeModal();
  const selected = biz.filter(b => b.selected && b.email && !b.sent);
  const wh = $('webhookUrl').value.trim();
  if (!selected.length || !wh) return;

  localStorage.setItem('webhookUrl', wh);
  $('sendBtn').disabled = true;
  log('> Sending ' + selected.length + ' leads to webhook...');

  try {
    const subj = $('emailSubject').value;
    const leads = selected.map(b => ({
      to: b.email,
      business_name: b.name,
      location: b.address || b.location || '',
      phone: b.phone || '',
      website: b.website || '',
      subject: subj.replace(/{business_name}/g, b.name)
    }));

    const res = await fetch('/api/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: wh, leads: leads })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Webhook failed');

    selected.forEach(b => { b.sent = true; });
    log('> All ' + selected.length + ' leads sent to webhook!');
    renderTable();

  } catch (err) {
    log('! Webhook error: ' + err.message);
  }

  $('sendBtn').disabled = false;
}

// ── Boot ─────────────────────────────────────────────────────────
init();
