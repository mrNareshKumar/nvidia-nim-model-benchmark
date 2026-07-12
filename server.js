import express from 'express';
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import runBenchmark from './benchmark.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'dist')));
app.use(express.json());

let activeBenchmark = null;

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

  const onEvent = (evt) => {
    if (aborted) return;
    send(evt);
    if (evt.type === 'done') {
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

  const restart = req.query.restart === '1';
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
  const file = join(__dirname, 'results.json');
  if (!existsSync(file)) return res.status(404).json({ error: 'results.json not found' });
  try {
    const raw = readFileSync(file, 'utf-8');
    JSON.parse(raw);
    const mtime = statSync(file).mtime;
    res.set('Last-Modified', mtime.toUTCString());
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('json').send(raw);
  } catch {
    res.status(500).json({ error: 'results.json is corrupted. Run benchmark with --restart to reset.' });
  }
});

app.post('/api/results/delete', (req, res) => {
  const { modelIds } = req.body;
  if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
    return res.status(400).json({ error: 'modelIds array required' });
  }
  const file = join(__dirname, 'results.json');
  if (!existsSync(file)) return res.status(404).json({ error: 'results.json not found' });
  try {
    let results = JSON.parse(readFileSync(file, 'utf-8'));
    const before = results.length;
    results = results.filter(r => !modelIds.includes(r.id));
    const deleted = before - results.length;
    const tmp = file + '.tmp.' + Date.now();
    writeFileSync(tmp, JSON.stringify(results, null, 2), 'utf-8');
    renameSync(tmp, file);
    res.json({ deleted, remaining: results.length });
  } catch {
    res.status(500).json({ error: 'Failed to update results.json' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
