const express = require('express');
const fs = require('fs');
const path = require('path');
const { fetchPreview } = require('./lib/preview');

const PORT = process.env.PORT || 3000;
const LEGACY_DB_PATH = path.join(__dirname, 'data', 'db.json');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/preview', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'url query parameter is required' });
  }
  try {
    res.json(await fetchPreview(rawUrl));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Bookmarks live in the browser (localStorage). This endpoint only exposes a
// pre-existing data/db.json from older versions so the frontend can import it once.
app.get('/api/data', (req, res) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
    res.json({
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    });
  } catch {
    res.status(404).json({ error: 'No legacy data' });
  }
});

// Public Supabase config for the browser client. The anon key is designed to be
// exposed client-side; Row Level Security is what protects the data. Empty when
// sync isn't configured, in which case the frontend stays localStorage-only.
app.get('/api/config', (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

app.listen(PORT, () => {
  console.log(`Web4webs running at http://localhost:${PORT}`);
});
