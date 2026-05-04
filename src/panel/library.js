import { readFileSync, existsSync } from 'node:fs';
import { dataDir } from '../util.js';

export const LIBRARY_STATUSES = new Set(['claimed', 'existed', 'manual']);

const PLATFORM_FILES = {
  'epic-games':   'epic-games.json',
  'prime-gaming': 'prime-gaming.json',
  'gog':          'gog.json',
  'steam':        'steam.json',
};

function readJsonDb(file) {
  const p = dataDir(file);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')) || {}; }
  catch { return {}; }
}

export function normalizeEntry(platform, user, id, record) {
  if (!record || !LIBRARY_STATUSES.has(record.status)) return null;
  return {
    title:    record.title || id,
    platform,
    status:   record.status,
    time:     record.time  || '',
    url:      record.url   || '',
    user:     user         || '',
  };
}

export function readLibrary({ platform, status, q } = {}) {
  const games = [];
  for (const [plat, file] of Object.entries(PLATFORM_FILES)) {
    if (platform && plat !== platform) continue;
    const db = readJsonDb(file);
    for (const [id, record] of Object.entries(db)) {
      const entry = normalizeEntry(plat, '', id, record);
      if (!entry) continue;
      if (status && entry.status !== status) continue;
      if (q && !entry.title.toLowerCase().includes(q.toLowerCase())) continue;
      games.push(entry);
    }
  }
  games.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return { games, total: games.length };
}
