import express from 'express';
import { existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import runBenchmark, { benchmarkModel } from './benchmark.js';
import OpenAI from 'openai';
import cors from 'cors';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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

app.get('/api/benchmark/retry', async (req, res) => {
  const modelId = req.query.modelId;
  const label = req.query.label;
  if (!modelId) return res.status(400).json({ error: 'modelId required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let aborted = false;
  const send = (data) => {
    if (!aborted) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  req.on('close', () => { aborted = true; });

  try {
    send({ type: 'connected' });

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      send({ type: 'error', text: 'NVIDIA_API_KEY is not set.' });
      send({ type: 'done' });
      return res.end();
    }

    const baseURL = process.env.API_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    const client = new OpenAI({ baseURL, apiKey, timeout: 15000 });

    const timeoutSec = parseInt(req.query.timeout) || 30;
    const prompt = req.query.prompt || undefined;

    send({ type: 'init', total: 1, existing: 0, toRun: 1 });

    const result = await benchmarkModel(client, modelId, label || modelId, timeoutSec, prompt || 'What is the capital of India? Please answer in one sentence.', (progress) => {
      if (!aborted) send({ type: 'progress', modelId, label, index: 1, total: 1, ...progress });
    });

    if (!aborted && result) {
      send({ type: 'result', ...result });
      send({
        type: 'summary',
        total: 1,
        succeeded: result.status === 'ok' ? 1 : 0,
        timeouts: result.status !== 'ok' && result.error?.toLowerCase().includes('timeout') ? 1 : 0,
        errors: result.status !== 'ok' && !result.error?.toLowerCase().includes('timeout') ? 1 : 0,
        elapsed: result.total_time_s || 0,
      });
    }
    send({ type: 'done' });
    res.end();
  } catch (err) {
    if (!aborted) send({ type: 'error', text: err.message });
    send({ type: 'done' });
    res.end();
  }
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
