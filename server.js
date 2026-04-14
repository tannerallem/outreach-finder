require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LISTS_FILE = path.join(DATA_DIR, 'lists.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LISTS_FILE)) fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists: {} }, null, 2));

function readLists() {
  try {
    const raw = fs.readFileSync(LISTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.lists || {};
  } catch {
    return {};
  }
}

function writeLists(lists) {
  fs.writeFileSync(LISTS_FILE, JSON.stringify({ lists }, null, 2));
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Business type config with sub-filters ──────────────────────────
const BUSINESS_TYPES = {
  restaurants: {
    label: 'Restaurants',
    subFilters: [
      'American', 'Mexican', 'Italian', 'Chinese', 'Japanese', 'Thai',
      'Indian', 'Mediterranean', 'BBQ', 'Seafood', 'Pizza', 'Fast Food',
      'Fine Dining', 'Vegan/Vegetarian', 'Soul Food', 'Korean', 'Vietnamese'
    ]
  },
  churches: {
    label: 'Churches',
    subFilters: [
      'Baptist', 'Methodist', 'Catholic', 'Non-Denominational', 'Pentecostal',
      'Lutheran', 'Presbyterian', 'Episcopal', 'Church of Christ',
      'Assembly of God', 'Seventh-day Adventist', 'AME', 'Evangelical'
    ]
  },
  salons: {
    label: 'Hair Salons / Barbers',
    subFilters: [
      'Hair Salon', 'Barbershop', 'Natural Hair', 'Braiding',
      'Nail Salon', 'Beauty Supply', 'Spa'
    ]
  },
  auto: {
    label: 'Auto Services',
    subFilters: [
      'Auto Repair', 'Body Shop', 'Oil Change', 'Tire Shop',
      'Car Wash', 'Auto Detailing', 'Dealership', 'Towing'
    ]
  },
  medical: {
    label: 'Medical / Dental',
    subFilters: [
      'Dentist', 'Chiropractor', 'Family Practice', 'Pediatrics',
      'Urgent Care', 'Physical Therapy', 'Optometrist', 'Dermatologist'
    ]
  },
  fitness: {
    label: 'Fitness / Wellness',
    subFilters: [
      'Gym', 'Yoga Studio', 'CrossFit', 'Martial Arts',
      'Personal Training', 'Dance Studio', 'Pilates'
    ]
  },
  realestate: {
    label: 'Real Estate',
    subFilters: [
      'Real Estate Agent', 'Property Management', 'Mortgage Broker',
      'Home Inspector', 'Title Company', 'Appraiser'
    ]
  },
  legal: {
    label: 'Legal Services',
    subFilters: [
      'Personal Injury', 'Family Law', 'Criminal Defense', 'Immigration',
      'Business Law', 'Estate Planning', 'Bankruptcy'
    ]
  },
  homeservices: {
    label: 'Home Services',
    subFilters: [
      'Plumber', 'Electrician', 'HVAC', 'Roofing', 'Landscaping',
      'Cleaning Service', 'Pest Control', 'Painting', 'Handyman'
    ]
  },
  pets: {
    label: 'Pet Services',
    subFilters: [
      'Veterinarian', 'Pet Grooming', 'Pet Boarding', 'Dog Training',
      'Pet Store', 'Dog Walking'
    ]
  }
};

// ── GET /api/business-types ────────────────────────────────────────
app.get('/api/business-types', (_req, res) => {
  res.json(BUSINESS_TYPES);
});

// ── POST /api/search ───────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { businessType, subFilter, city, state, radius } = req.body;

  if (!businessType || !city || !state) {
    return res.status(400).json({ error: 'businessType, city, and state are required' });
  }

  const typeLabel = BUSINESS_TYPES[businessType]?.label || businessType;
  const filterText = subFilter ? ` (specifically: ${subFilter})` : '';
  const radiusText = radius ? ` within ${radius} miles` : '';

  const searchPrompt = `Search the web and find ${typeLabel}${filterText} businesses in ${city}, ${state}${radiusText}.

For EACH business, do a DEEP contact-info search. You MUST try multiple sources before giving up on a field:
  1. The business's official website (check Contact, About, Footer, and Staff pages)
  2. Their Google Maps / Google Business Profile listing
  3. Their Yelp page
  4. Their Facebook / Instagram / LinkedIn business page
  5. Industry directories (Yellow Pages, BBB, Angi, chamber of commerce listings)
  6. If no email appears on the homepage, try fetching /contact, /about, /team, /staff pages
  7. If still nothing, search for "<business name> email" and "<business name> contact"

For each business collect ALL of the following (leave blank ONLY if truly unavailable after multiple attempts):
- name: Business name
- address: Full street address including city, state, and zip
- phone: Main office phone number, formatted as (XXX) XXX-XXXX
- website: Full website URL (with https://)
- email: Primary contact email (info@, contact@, hello@, or a specific person)
- email2: Secondary email if one exists (e.g. owner's direct email, sales@, support@) — leave blank if there truly is only one
- category: Business category/type

Aim for 10-20 real, currently operating businesses. Make multiple search attempts per business if the first search doesn't surface an email — try different queries and sources before giving up.

Return the results as a JSON array with this exact format:
[
  {
    "name": "Business Name",
    "address": "123 Main St, City, ST 12345",
    "phone": "(555) 123-4567",
    "website": "https://example.com",
    "email": "contact@example.com",
    "email2": "owner@example.com",
    "category": "Category Type"
  }
]

Return ONLY the JSON array, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 12000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 30 }],
      messages: [{ role: 'user', content: searchPrompt }]
    });

    // Extract the final text from the response
    let resultText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        resultText += block.text;
      }
    }

    // Parse JSON from the response
    let businesses = [];
    const jsonMatch = resultText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        businesses = JSON.parse(jsonMatch[0]);
      } catch {
        // If the model returned partial or malformed JSON, try to salvage
        businesses = [];
      }
    }

    // Normalize fields
    businesses = businesses.map((b, i) => ({
      id: `${Date.now()}-${i}`,
      name: b.name || 'Unknown',
      address: b.address || '',
      phone: b.phone || '',
      website: b.website || '',
      email: b.email || '',
      email2: b.email2 || '',
      category: b.category || typeLabel,
      businessType: typeLabel,
      subFilter: subFilter || '',
      searchCity: city,
      searchState: state,
      foundAt: new Date().toISOString()
    }));

    res.json({ businesses, total: businesses.length });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

// ── POST /api/search/email-enrich ──────────────────────────────────
// Second-pass: deep contact-info search for businesses missing fields.
// Fills in email, email2, phone, website, and address where missing.
app.post('/api/search/email-enrich', async (req, res) => {
  const { businesses } = req.body;
  const incomplete = businesses.filter(b =>
    !b.email || !b.email2 || !b.phone || !b.website || !b.address
  );

  if (incomplete.length === 0) return res.json({ businesses });

  const listing = incomplete.map(b => {
    const have = [];
    if (b.website) have.push(`website: ${b.website}`);
    if (b.phone) have.push(`phone: ${b.phone}`);
    if (b.address) have.push(`address: ${b.address}`);
    if (b.email) have.push(`email: ${b.email}`);
    return `- ${b.name}${have.length ? ' (' + have.join(', ') + ')' : ''}`;
  }).join('\n');

  const prompt = `Do a DEEP contact-info search for each of these businesses. Try MULTIPLE search attempts and sources before giving up on any field.

For each business below, I want:
- email: primary contact email
- email2: a secondary email if one exists (owner, sales@, support@, etc.)
- phone: main office phone formatted as (XXX) XXX-XXXX
- website: full website URL with https://
- address: full street address with city, state, zip

Search strategy for each business (use ALL of these until you find what you need):
1. Official website — check Contact, About, Footer, Team, Staff pages
2. Fetch /contact, /about, /team, /staff subpages if the homepage has no email
3. Google Maps / Google Business Profile
4. Yelp listing
5. Facebook / Instagram / LinkedIn business pages
6. Yellow Pages, BBB, Angi, industry directories
7. Search queries like "<business name> email", "<business name> contact", "<business name> owner"
8. If you see a "mailto:" link anywhere, use that email

Businesses to research:
${listing}

Return a JSON array with an entry for every business where you found ANY new info. Only include fields you actually found (do not echo fields that were already provided). Use the exact business name as given.

Format:
[
  {
    "name": "Business Name",
    "email": "found@email.com",
    "email2": "owner@email.com",
    "phone": "(555) 123-4567",
    "website": "https://example.com",
    "address": "123 Main St, City, ST 12345"
  }
]

Return ONLY the JSON array. If you found nothing new for anyone, return [].`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 30 }],
      messages: [{ role: 'user', content: prompt }]
    });

    let resultText = '';
    for (const block of response.content) {
      if (block.type === 'text') resultText += block.text;
    }

    let found = [];
    const jsonMatch = resultText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try { found = JSON.parse(jsonMatch[0]); } catch { found = []; }
    }

    // Merge every found field back (only fill blanks — don't overwrite existing data)
    const foundMap = new Map(found.map(f => [f.name?.toLowerCase(), f]));
    const enriched = businesses.map(b => {
      const match = foundMap.get(b.name?.toLowerCase());
      if (!match) return b;
      return {
        ...b,
        email: b.email || match.email || '',
        email2: b.email2 || match.email2 || '',
        phone: b.phone || match.phone || '',
        website: b.website || match.website || '',
        address: b.address || match.address || ''
      };
    });

    res.json({ businesses: enriched });
  } catch (err) {
    console.error('Enrichment error:', err);
    res.json({ businesses }); // Return original on failure
  }
});

// ── POST /api/webhook ──────────────────────────────────────────────
// Sends each lead as its own webhook POST, one at a time, so downstream
// tools (e.g. n8n) can process each lead individually.
app.post('/api/webhook', async (req, res) => {
  const { webhookUrl, leads } = req.body;

  if (!webhookUrl || !leads?.length) {
    return res.status(400).json({ error: 'webhookUrl and leads are required' });
  }

  const results = [];
  let sent = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lead, sentAt: new Date().toISOString() })
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      sent++;
      results.push({ lead: lead.business_name || lead.to, ok: true, status: response.status });
    } catch (err) {
      failed++;
      results.push({ lead: lead.business_name || lead.to, ok: false, error: err.message });
      console.error(`Webhook error for lead "${lead.business_name || lead.to}":`, err.message);
    }
  }

  res.json({ success: failed === 0, sent, failed, total: leads.length, results });
});

// ── POST /api/save ─────────────────────────────────────────────────
// Stores the list under its name inside a single persistent JSON file.
app.post('/api/save', (req, res) => {
  const { name, businesses } = req.body;
  if (!name || !businesses) return res.status(400).json({ error: 'name and businesses are required' });

  const lists = readLists();
  lists[name] = { savedAt: new Date().toISOString(), businesses };
  writeLists(lists);

  res.json({ success: true, name });
});

// ── GET /api/saves ─────────────────────────────────────────────────
app.get('/api/saves', (_req, res) => {
  const lists = readLists();
  const saves = Object.entries(lists).map(([name, data]) => ({
    name,
    count: data.businesses?.length || 0,
    savedAt: data.savedAt
  }));
  // Sort most recent first
  saves.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  res.json(saves);
});

// ── GET /api/load/:name ────────────────────────────────────────────
app.get('/api/load/:name', (req, res) => {
  const lists = readLists();
  const data = lists[req.params.name];
  if (!data) return res.status(404).json({ error: 'List not found' });
  res.json(data);
});

// ── DELETE /api/saves/:name ────────────────────────────────────────
app.delete('/api/saves/:name', (req, res) => {
  const lists = readLists();
  if (!lists[req.params.name]) return res.status(404).json({ error: 'List not found' });
  delete lists[req.params.name];
  writeLists(lists);
  res.json({ success: true });
});

// ── POST /api/import ───────────────────────────────────────────────
app.post('/api/import', (req, res) => {
  const { businesses, name } = req.body;
  if (!businesses?.length) return res.status(400).json({ error: 'No businesses to import' });

  const safeName = (name || `import_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(DATA_DIR, `${safeName}.json`);

  fs.writeFileSync(filePath, JSON.stringify({ savedAt: new Date().toISOString(), businesses }, null, 2));
  res.json({ success: true, file: `${safeName}.json`, count: businesses.length });
});

app.listen(PORT, () => {
  console.log(`Outreach Finder running at http://localhost:${PORT}`);
});
