const supabase = require('../supabase_client');

// Reads a claim out of an already-verified access token. Safe to decode without
// re-checking the signature *only* because supabase.auth.getUser() below has
// already validated this exact token against GoTrue — never call this on an
// unvalidated token.
function decodeClaims(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// Validates Supabase JWT and attaches req.user + req.userId
module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  req.userId = user.id;
  // Authenticator Assurance Level: 'aal1' = password only, 'aal2' = a second
  // factor was verified in this session. Used by middleware/admin.js.
  req.authAal = decodeClaims(token).aal ?? 'aal1';
  next();
};
