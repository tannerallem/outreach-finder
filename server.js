require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

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

For each business you find, provide:
- Business name
- Address
- Main office phone number (the primary contact number listed on their website, Google Maps, or Yelp — format as (XXX) XXX-XXXX)
- Website URL (if available)
- Email address (if available — look on their website, Google Maps listing, Facebook page, or Yelp page)
- Category/type

Find as many real, currently operating businesses as possible (aim for 10-20).
Focus on finding REAL businesses with REAL contact information.
Look for phone numbers and email addresses on business websites, social media pages, and directory listings.

Return the results as a JSON array with this exact format:
[
  {
    "name": "Business Name",
    "address": "123 Main St, City, ST 12345",
    "phone": "(555) 123-4567",
    "website": "https://example.com",
    "email": "contact@example.com",
    "category": "Category Type"
  }
]

Return ONLY the JSON array, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
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
// Second-pass: try to find emails for businesses that are missing them
app.post('/api/search/email-enrich', async (req, res) => {
  const { businesses } = req.body;
  const missing = businesses.filter(b => !b.email);

  if (missing.length === 0) return res.json({ businesses });

  const names = missing.map(b => `- ${b.name}, ${b.address} (website: ${b.website || 'unknown'})`).join('\n');

  const prompt = `Search the web for contact email addresses for these businesses:
${names}

Look on their official websites, Facebook pages, Yelp listings, Google Maps, and any directory sites.

Return a JSON array with ONLY the businesses where you found an email:
[{"name": "Business Name", "email": "found@email.com"}]

Return ONLY the JSON array. If you found no emails, return [].`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
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

    // Merge found emails back
    const emailMap = new Map(found.map(f => [f.name?.toLowerCase(), f.email]));
    const enriched = businesses.map(b => {
      const foundEmail = emailMap.get(b.name?.toLowerCase());
      return foundEmail ? { ...b, email: foundEmail } : b;
    });

    res.json({ businesses: enriched });
  } catch (err) {
    console.error('Email enrichment error:', err);
    res.json({ businesses }); // Return original on failure
  }
});

// ── POST /api/webhook ──────────────────────────────────────────────
app.post('/api/webhook', async (req, res) => {
  const { webhookUrl, leads } = req.body;

  if (!webhookUrl || !leads?.length) {
    return res.status(400).json({ error: 'webhookUrl and leads are required' });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads, sentAt: new Date().toISOString(), total: leads.length })
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    }

    res.json({ success: true, status: response.status });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/save ─────────────────────────────────────────────────
app.post('/api/save', (req, res) => {
  const { name, businesses } = req.body;
  const safeName = (name || 'results').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(DATA_DIR, `${safeName}.json`);

  fs.writeFileSync(filePath, JSON.stringify({ savedAt: new Date().toISOString(), businesses }, null, 2));
  res.json({ success: true, file: `${safeName}.json` });
});

// ── GET /api/saves ─────────────────────────────────────────────────
app.get('/api/saves', (_req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const saves = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    return { name: f.replace('.json', ''), file: f, count: data.businesses?.length || 0, savedAt: data.savedAt };
  });
  res.json(saves);
});

// ── GET /api/load/:name ────────────────────────────────────────────
app.get('/api/load/:name', (req, res) => {
  const safeName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(DATA_DIR, `${safeName}.json`);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  res.json(data);
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
