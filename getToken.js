const http = require('http');
const crypto = require('crypto');
const axios = require('axios');

const CLIENT_ID = '01KSJ34DC0Q8BD3DYQM328H81S';
const CLIENT_SECRET = '724b7105d889578107727bf454f909096a4f20d73bb1c0e2a84988c1759b1bae';
const REDIRECT_URI = 'http://niksi777.com/token-callback';

const codeVerifier = crypto.randomBytes(64).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const authUrl = `https://id.kick.com/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=chat%3Awrite&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;

console.log('\n=== KICK BOT TOKEN GENERATOR ===\n');
console.log('Open this URL in your browser (logged in as NiksiBot):\n');
console.log(authUrl);
console.log('\nWaiting...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8080');
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code.'); return; }

  console.log('Code received! Exchanging...');

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('code_verifier', codeVerifier);
    params.append('code', code);

    const { data } = await axios.post('https://id.kick.com/oauth/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    console.log('\n✅ SUCCESS!\n');
    console.log(`KICK_BOT_TOKEN=${data.access_token}`);
    if (data.refresh_token) console.log(`KICK_BOT_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('\nPress Ctrl+C to exit.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>✅ Done! Check your terminal.</h1>');
  } catch (err) {
    console.error('❌ Failed:', JSON.stringify(err?.response?.data));
    res.end('Error. Check terminal.');
  }
  server.close();
});

server.listen(8080, () => console.log('Listening on http://localhost:8080...'));
