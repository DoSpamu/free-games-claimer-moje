/**
 * Discord webhook notifications.
 * Set env var DISCORD_WEBHOOK=https://discord.com/api/webhooks/ID/TOKEN
 */

import https from 'node:https';
import http from 'node:http';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

const post = async (payload, retries = 3) => {
  if (!WEBHOOK_URL) return;
  const body = JSON.stringify(payload);
  const url = new URL(WEBHOOK_URL);
  const lib = url.protocol === 'https:' ? https : http;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = lib.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'free-games-claimer/1.0' },
          timeout: 10_000,
        }, res => {
          if (res.statusCode >= 200 && res.statusCode < 300) { res.resume(); resolve(); }
          else { let d = ''; res.on('data', c => (d += c)); res.on('end', () => reject(new Error(`Discord HTTP ${res.statusCode}: ${d.slice(0, 200)}`))); }
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Discord request timed out')); });
        req.write(body); req.end();
      });
      return;
    } catch (err) {
      if (attempt === retries) { console.warn(`Discord notification failed after ${retries} attempts: ${err.message}`); return; }
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
};

const ts = () => new Date().toISOString();

/** Convert HTML game-list string to Discord markdown embed. Called by notify(). */
export const notifyFromHtml = async (title, html) => {
  if (!WEBHOOK_URL) return;
  const text = html
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();

  await post({
    embeds: [{
      title: title ? `✅ ${title}` : '✅ Free Games Claimer',
      color: 0x57F287,
      description: text.slice(0, 2000) || '(brak szczegółów)',
      timestamp: ts(),
      footer: { text: 'free-games-claimer' },
    }],
  });
};

export const notifyError = async (platform, error) => {
  const message = error?.message || String(error);
  const stack = (error?.stack || String(error)).split('\n').slice(0, 6).join('\n').slice(0, 800);
  await post({
    embeds: [{
      title: `❌ Błąd – ${platform}`,
      color: 0xED4245,
      description: `**Komunikat:**\n\`\`\`\n${message.slice(0, 300)}\n\`\`\`` + (stack ? `\n**Stack:**\n\`\`\`\n${stack}\n\`\`\`` : ''),
      timestamp: ts(),
      footer: { text: 'free-games-claimer' },
    }],
  });
};

export const notifyOnline = async () => {
  await post({
    embeds: [{
      title: '🟢 Claimer online',
      color: 0x57F287,
      description: 'Panel uruchomiony i gotowy.',
      timestamp: ts(),
      footer: { text: 'free-games-claimer' },
    }],
  });
};
