import express from 'express';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
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

async function persistResults(snapshot) {
  const data = snapshot ?? resultsCache;
  try {
    const tmp = RESULTS_FILE + '.tmp.' + Date.now();
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmp, RESULTS_FILE);
    console.log(`File saved: ${data.length} results`);
  } catch (err) {
    console.error('File write failed:', err.message);
  }
  if (db.dbAvailable) {
    try { await db.replaceAll(data); } catch (err) { console.error('DB replaceAll failed:', err.message); }
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
    console.log('Benchmark restart requested — clearing cache and DB');
    resultsCache = [];
    resultsMtime = new Date();
    persistResults([]);
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
      console.log('Benchmark done — persisting results');
      const snapshot = [...resultsCache];
      persistResults(snapshot);
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
    const snapshot = [...resultsCache];
    persistResults(snapshot);
    res.json({ deleted, remaining: resultsCache.length });
  } catch {
    res.status(500).json({ error: 'Failed to update results' });
  }
});

app.get('/api/health', async (req, res) => {
  const dbCount = db.dbAvailable ? await db.countResults() : -1;
  res.json({
    db: db.dbAvailable ? 'postgresql' : 'file',
    dbUrlSet: !!process.env.DATABASE_URL,
    cacheSize: resultsCache?.length ?? 0,
    dbRowCount: dbCount,
    uptime: process.uptime(),
  });
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

async function start() {
  const dbUrlSet = !!process.env.DATABASE_URL;
  console.log(`Server starting... DATABASE_URL is ${dbUrlSet ? 'SET' : 'NOT SET'}`);

  await db.initDB();

  let source = 'empty';
  if (db.dbAvailable) {
    try {
      const loaded = await db.loadResults();
      if (loaded && loaded.length > 0) {
        resultsCache = loaded;
        source = `DB (${loaded.length} results)`;
      } else {
        source = 'DB empty';
      }
    } catch (err) {
      console.error('Failed to load results from DB:', err.message);
      source = 'DB error';
    }
  }

  if ((!resultsCache || resultsCache.length === 0) && existsSync(RESULTS_FILE)) {
    try {
      const fileData = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
      if (Array.isArray(fileData) && fileData.length > 0) {
        resultsCache = fileData;
        source = `file (${fileData.length} results)`;
        console.log(`Loaded ${resultsCache.length} results from file`);
        if (db.dbAvailable) {
          console.log('Syncing file data to PostgreSQL...');
          persistResults(resultsCache);
        }
      }
    } catch (err) {
      console.error('Failed to load results from file:', err.message);
    }
  }

  if (!resultsCache) resultsCache = [];
  resultsMtime = new Date();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Storage: ${db.dbAvailable ? 'PostgreSQL' : 'File-based'}`);
    console.log(`Results loaded from: ${source}`);
    console.log(`Results in cache: ${resultsCache.length}`);
  });
}

start();
