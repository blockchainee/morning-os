/**
 * Morning OS — Google OAuth Token Helper
 *
 * Run this locally to obtain a GOOGLE_REFRESH_TOKEN for Gmail + Calendar access.
 *
 * Prerequisites:
 *   1. Go to console.cloud.google.com
 *   2. Create a project (or use an existing one)
 *   3. Enable "Gmail API" and "Google Calendar API"
 *   4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
 *   5. Application type: "Web application"
 *   6. Add Authorized redirect URI: http://localhost:3456/callback
 *   7. Copy the Client ID and Client Secret
 *
 * Usage:
 *   node scripts/get-google-token.js <CLIENT_ID> <CLIENT_SECRET>
 *
 * Then open the URL it prints, sign in, and it will display your refresh token.
 */

import { createServer } from 'http';

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const REDIRECT_URI = 'http://localhost:3456/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Morning OS — Google OAuth Token Helper                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Usage:                                                      ║
║    node scripts/get-google-token.js <CLIENT_ID> <SECRET>     ║
║                                                              ║
║  Steps:                                                      ║
║   1. Go to console.cloud.google.com                          ║
║   2. Create or select a project                              ║
║   3. APIs & Services → Enable:                               ║
║      • Gmail API                                             ║
║      • Google Calendar API                                   ║
║   4. Credentials → Create → OAuth 2.0 Client ID             ║
║      • Type: Web application                                 ║
║      • Redirect URI: http://localhost:3456/callback           ║
║   5. Copy Client ID + Client Secret                          ║
║   6. Run this script with those values                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log(`\n🔑 Open this URL in your browser:\n`);
console.log(authUrl);
console.log(`\n⏳ Waiting for callback on http://localhost:3456 ...\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3456');

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${error}</p><p>Please try again.</p>`);
    console.error(`\n❌ OAuth error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Missing authorization code</h1>');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenResp.json();

    if (data.error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h1>Token Error</h1><pre>${JSON.stringify(data, null, 2)}</pre>`);
      console.error(`\n❌ Token exchange failed:`, data);
      server.close();
      process.exit(1);
    }

    const refreshToken = data.refresh_token;

    if (!refreshToken) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h1>No refresh token received</h1>
        <p>This usually means you've already authorized this app before.</p>
        <p>Go to <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>,
        remove "Morning OS", then try again.</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>`);
      console.error(`\n❌ No refresh_token in response. Revoke access at https://myaccount.google.com/permissions and retry.`);
      server.close();
      process.exit(1);
    }

    // Success!
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
        <h1>✅ Success!</h1>
        <p>Your refresh token has been generated. Copy it from the terminal.</p>
        <p>Add it as a GitHub Secret named <code>GOOGLE_REFRESH_TOKEN</code></p>
        <p>You can close this tab.</p>
      </body></html>
    `);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ✅ SUCCESS — Here are your tokens:`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`\n  GOOGLE_REFRESH_TOKEN (add as GitHub Secret):\n`);
    console.log(`  ${refreshToken}`);
    console.log(`\n  GOOGLE_CLIENT_ID:     ${CLIENT_ID}`);
    console.log(`  GOOGLE_CLIENT_SECRET: ${CLIENT_SECRET}`);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`\n  Next steps:`);
    console.log(`  1. Go to your GitHub repo → Settings → Secrets`);
    console.log(`  2. Add secret: GOOGLE_REFRESH_TOKEN = ${refreshToken.slice(0, 20)}...`);
    console.log(`  3. Add secret: GOOGLE_CLIENT_ID = ${CLIENT_ID.slice(0, 20)}...`);
    console.log(`  4. Add secret: GOOGLE_CLIENT_SECRET = ${CLIENT_SECRET.slice(0, 20)}...`);
    console.log(`  5. Run the workflow: Actions → Morning OS → Run workflow`);
    console.log(`\n`);

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
    console.error(`\n❌ Error:`, err.message);
  }

  server.close();
});

server.listen(3456, () => {
  // Try to open the browser automatically
  import('child_process').then(({ exec }) => {
    const cmd = process.platform === 'darwin' ? 'open' :
                process.platform === 'win32' ? 'start' : 'xdg-open';
    try { exec(`${cmd} "${authUrl}"`); } catch {}
  }).catch(() => {});
});
