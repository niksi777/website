require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const axios = require('axios');

const CLIENT_ID = '01KSJ0GNJ0CERH1HPH4GQEPVDC';
const CLIENT_SECRET = 'af5a2596218d09ac63a65038ed7a8688689c8cb55c7d31903876fa372c88282c';
const REDIRECT_URI = 'http://localhost:3000/callback';

// Generate PKCE
const codeVerifier = crypto.randomBytes(64).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const authUrl = `https://id.kick.com/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=chat%3Awrite+events%3Asubscribe&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;

console.log('\n=== KICK BOT TOKEN GENERATOR ===\n');
console.log('1. Make sure you are logged into Kick as NiksiBot in your browser');
console.log('2. Open this URL:\n');
console.log(authUrl);
console.log('\n3. Waiting for you to authorize...\n');

// Local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('No code found. Try again.');
    return;
  }

  try {
    const response = await axios.post('https://id.kick.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      code,
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const { access_token, refresh_token } = response.data;

    console.log('\n✅ SUCCESS! Add these to your .env file:\n');
    console.log(`KICK_BOT_TOKEN=${access_token}`);
    console.log(`KICK_BOT_REFRESH_TOKEN=${refresh_token}`);
    console.log('\nDone! You can close this window and stop this script (Ctrl+C)\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>✅ Token generated!</h1><p>Check your terminal for the token. You can close this tab.</p>');
  } catch (err) {
    console.error('❌ Token exchange failed:', err?.response?.data || err.message);
    res.end('Error exchanging token. Check terminal.');
  }

  server.close();
});

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000 for the OAuth callback...');
});
