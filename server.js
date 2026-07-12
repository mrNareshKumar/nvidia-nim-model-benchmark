import express from 'express';
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import runBenchmark from './benchmark.js';
import * as db from './src/db.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RESULTS_FILE = join(__dirname, 'results.json');

let resultsCache = null;
let resultsMtime = null;
let activeBenchmark = null;

app.use(express.static(join(__dirname, 'dist')));
app.use(express.json());

async function persistResults() {
  try {
    const tmp = RESULTS_FILE + '.tmp.' + Date.now();
    writeFileSync(tmp, JSON.stringify(resultsCache, null, 2), 'utf-8');
    renameSync(tmp, RESULTS_FILE);
  } catch {}
  if (db.dbAvailable) {
    try { await db.replaceAll(resultsCache); } catch (err) { console.error('DB replaceAll failed:', err.message); }
  }
}

app.get('/api/benchmark', (req, res) => {
  if (activeBenchmark) {
    activeBenchmark.abort();
    activeBenchmark = null;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let aborted = false;
  const send = (data) => {
    if (!aborted) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'connected' });

  const abortController = new AbortController();
  activeBenchmark = abortController;

  const restart = req.query.restart === '1';

  if (restart) {
    resultsCache = [];
    resultsMtime = new Date();
    persistResults();
  }

  const onEvent = (evt) => {
    if (aborted) return;

    if (evt.type === 'result') {
      const entry = { ...evt };
      delete entry.type;
      const idx = resultsCache.findIndex(r => r.id === entry.id);
      if (idx >= 0) resultsCache[idx] = entry;
      else resultsCache.push(entry);
      resultsMtime = new Date();
      if (db.dbAvailable) {
        db.upsertResult(entry).catch(err => console.error('DB upsert failed:', err.message));
      }
    }

    send(evt);
    if (evt.type === 'done') {
      persistResults();
      aborted = true;
      res.end();
    }
  };

  const abortListener = () => {
    aborted = true;
    abortController.abort();
    try { res.end(); } catch {}
  };

  req.on('close', abortListener);

  const prompt = req.query.prompt || undefined;
  const modelIds = req.query.models ? req.query.models.split(',') : undefined;
  const rerunModels = req.query.rerun ? req.query.rerun.split(',') : undefined;
  const apiKey = req.query.api_key || undefined;
  const baseURL = req.query.api_base_url || undefined;

  runBenchmark({
    timeout: parseInt(req.query.timeout) || 30,
    restart,
    prompt,
    modelIds,
    rerunModels,
    apiKey,
    baseURL,
  }, onEvent, abortController.signal)
    .then(() => {})
    .catch(err => {
      if (!aborted) {
        send({ type: 'error', text: err.message });
        aborted = true;
        res.end();
      }
    })
    .finally(() => {
      if (activeBenchmark === abortController) activeBenchmark = null;
    });
});

app.get('/models.json', (req, res) => {
  const file = join(__dirname, 'models.json');
  if (!existsSync(file)) return res.status(404).json({ error: 'models.json not found' });
  res.set('Cache-Control', 'no-store');
  res.type('json').send(readFileSync(file, 'utf-8'));
});

app.get('/results.json', (req, res) => {
  if (!resultsCache) return res.status(404).json({ error: 'No results available' });
  try {
    res.set('Last-Modified', resultsMtime ? resultsMtime.toUTCString() : new Date().toUTCString());
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('json').send(JSON.stringify(resultsCache));
  } catch {
    res.status(500).json({ error: 'Results cache corrupted' });
  }
});

app.post('/api/results/delete', (req, res) => {
  const { modelIds } = req.body;
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: 'modelIds array required' });
  }
  try {
    const before = resultsCache.length;
    resultsCache = resultsCache.filter(r => !modelIds.includes(r.id));
    const deleted = before - resultsCache.length;
    resultsMtime = new Date();
    persistResults();
    res.json({ deleted, remaining: resultsCache.length });
  } catch {
    res.status(500).json({ error: 'Failed to update results' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

async function start() {
  await db.initDB();

  if (db.dbAvailable) {
    try { resultsCache = await db.loadResults(); } catch {}
  }

  if (!resultsCache && existsSync(RESULTS_FILE)) {
    try { resultsCache = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8')); } catch {}
  }

  if (!resultsCache) resultsCache = [];
  resultsMtime = new Date();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Storage: ${db.dbAvailable ? 'PostgreSQL' : 'File-based'}`);
  });
}

start();
