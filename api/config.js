// Public Supabase config for the browser client (Vercel function). The anon key
// is meant to be public; RLS protects the data. Empty => sync stays off.
module.exports = (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  });
};
