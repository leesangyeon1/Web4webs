const { fetchPreview } = require('../lib/preview');

module.exports = async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'url query parameter is required' });
  }
  try {
    res.json(await fetchPreview(rawUrl));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
