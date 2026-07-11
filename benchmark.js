import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVIDER_MAP = {
  'z-ai': 'Z.AI', 'deepseek-ai': 'DeepSeek AI', 'moonshotai': 'Moonshot AI',
  qwen: 'Alibaba Cloud', 'minimaxai': 'MiniMax', 'mistralai': 'Mistral AI',
  meta: 'Meta', '01-ai': '01.AI', bigcode: 'BigCode', ibm: 'IBM',
  google: 'Google', microsoft: 'Microsoft', nvidia: 'NVIDIA',
  'nv-mistralai': 'NVIDIA / Mistral', upstage: 'Upstage',
  databricks: 'Databricks', ai21labs: 'AI21 Labs', bytedance: 'ByteDance',
  stockmark: 'Stockmark', writer: 'Writer', baai: 'BAAI',
  snowflake: 'Snowflake', openai: 'OpenAI',
  abacusai: 'Abacus AI', adept: 'Adept', aisingapore: 'AI Singapore',
  sarvamai: 'Sarvam AI', 'stepfun-ai': 'Stepfun AI', zyphra: 'Zyphra',
};

const RESULTS_FILE = resolve(__dirname, 'results.json');
const MODELS_FILE = resolve(__dirname, 'models.json');
const RATE_LIMIT_WAIT = 12;
const CONNECT_TIMEOUT = 15;
const MAX_RETRIES = 3;

const COST_PER_1M_TOKENS = {
  'deepseek-ai/deepseek-v4-pro': { input: 2, output: 8 },
  'deepseek-ai/deepseek-v4-flash': { input: 0.35, output: 1.4 },
};

function getProvider(modelId) {
  const prefix = modelId.includes('/') ? modelId.split('/')[0] : '';
  return PROVIDER_MAP[prefix] || prefix || 'Unknown';
}

function getCostEstimate(modelId, inputTokens, outputTokens) {
  const prefix = modelId.includes('/') ? modelId.split('/')[0] : '';
  const rates = COST_PER_1M_TOKENS[modelId];
  if (!rates) return null;
  const cost = ((inputTokens || 0) * rates.input + (outputTokens || 0) * rates.output) / 1_000_000;
  return Math.round(cost * 100000) / 100000;
}

function saveResults(data) {
  const tmp = RESULTS_FILE + '.tmp.' + Date.now();
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, RESULTS_FILE);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function benchmarkModel(client, modelId, label, timeout, prompt, onProgress) {
  const start = performance.now();
  let firstTokenTime = null;
  let tokenCount = 0;
  let fullText = '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

  const requestOptions = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
    stream: true,
    stream_options: { include_usage: true },
  };

  try {
    const stream = await client.chat.completions.create(requestOptions, { signal: controller.signal });

    let inputTokens = null;

    for await (const chunk of stream) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        tokenCount = chunk.usage.completion_tokens ?? tokenCount;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        if (firstTokenTime === null) {
          firstTokenTime = performance.now();
        }
        fullText += delta;
        tokenCount++;
      }
      const elapsed = (performance.now() - start) / 1000;
      onProgress?.({ elapsed, tokenCount, waiting: !firstTokenTime });
    }

    clearTimeout(timeoutId);

    const elapsed = (performance.now() - start) / 1000;
    const ttft = firstTokenTime ? (firstTokenTime - start) / 1000 : null;
    const tps = elapsed > 0 ? tokenCount / elapsed : 0;
    const cost = getCostEstimate(modelId, inputTokens, tokenCount);

    return {
      id: modelId, label,
      provider: getProvider(modelId),
      timestamp: new Date().toISOString(),
      status: 'ok',
      total_time_s: Math.round(elapsed * 1000) / 1000,
      tokens: tokenCount,
      input_tokens: inputTokens,
      tokens_per_second: Math.round(tps * 100) / 100,
      ttft_s: ttft !== null ? Math.round(ttft * 1000) / 1000 : null,
      cost: cost,
      response_preview: fullText.slice(0, 120),
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('canceled')) {
      return {
        id: modelId, label, provider: getProvider(modelId),
        timestamp: new Date().toISOString(),
        status: 'error',
        error: `TIMEOUT: ${label} gave no response in ${timeout}s`,
        total_time_s: null, tokens: 0, input_tokens: null,
        tokens_per_second: 0, ttft_s: null, cost: null,
      };
    }
    if (err.status === 400 && requestOptions.stream_options) {
      delete requestOptions.stream_options;
      try {
        const stream = await client.chat.completions.create(requestOptions, { signal: controller.signal });
        let inputTokens = null;
        for await (const chunk of stream) {
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
            tokenCount = chunk.usage.completion_tokens ?? tokenCount;
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            if (firstTokenTime === null) firstTokenTime = performance.now();
            fullText += delta;
            tokenCount++;
          }
          const elapsed = (performance.now() - start) / 1000;
          onProgress?.({ elapsed, tokenCount, waiting: !firstTokenTime });
        }
        const elapsed = (performance.now() - start) / 1000;
        const ttft = firstTokenTime ? (firstTokenTime - start) / 1000 : null;
        const tps = elapsed > 0 ? tokenCount / elapsed : 0;
        const cost = getCostEstimate(modelId, inputTokens, tokenCount);
        return {
          id: modelId, label, provider: getProvider(modelId),
          timestamp: new Date().toISOString(),
          status: 'ok', total_time_s: Math.round(elapsed * 1000) / 1000,
          tokens: tokenCount, input_tokens: inputTokens,
          tokens_per_second: Math.round(tps * 100) / 100,
          ttft_s: ttft !== null ? Math.round(ttft * 1000) / 1000 : null,
          cost: cost, response_preview: fullText.slice(0, 120),
        };
      } catch (retryErr) {
        return {
          id: modelId, label, provider: getProvider(modelId),
          timestamp: new Date().toISOString(),
          status: 'error',
          error: (retryErr.message || 'Unknown error').slice(0, 200),
          total_time_s: null, tokens: 0, input_tokens: null,
          tokens_per_second: 0, ttft_s: null, cost: null,
        };
      }
    }
    return {
      id: modelId, label, provider: getProvider(modelId),
      timestamp: new Date().toISOString(),
      status: 'error',
      error: (err.message || 'Unknown error').slice(0, 200),
      total_time_s: null, tokens: 0, input_tokens: null,
      tokens_per_second: 0, ttft_s: null, cost: null,
    };
  }
}

async function runSingleModel(client, model, modelIndex, totalModels, timeout, prompt, onEvent, signal) {
  const mid = model.id;
  const label = model.label;

  if (signal?.aborted) return null;
  onEvent?.({ type: 'begin', modelId: mid, label, index: modelIndex, total: totalModels });

  let result;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const wait = RATE_LIMIT_WAIT * Math.pow(2, attempt);
      onEvent?.({ type: 'retry', modelId: mid, label, attempt, max: MAX_RETRIES, wait });
      for (let s = wait; s > 0; s--) {
        if (signal?.aborted) break;
        onEvent?.({ type: 'wait', seconds: s });
        await sleepAbortable(1000, signal);
        if (signal?.aborted) break;
      }
    }

    if (signal?.aborted) return null;

    result = await benchmarkModel(client, mid, label, timeout, prompt, (progress) => {
      onEvent?.({ type: 'progress', modelId: mid, label, index: modelIndex, total: totalModels, ...progress });
    });

    const isRetryable = result.status === 'error' && result.error?.includes('429');
    if (!isRetryable || attempt === MAX_RETRIES) break;
  }

  return result;
}

async function sleepAbortable(ms, signal) {
  if (signal?.aborted) return;
  await Promise.race([
    sleep(ms),
    new Promise(r => signal?.addEventListener('abort', r, { once: true })),
  ]);
}

export default async function runBenchmark({
  timeout = 30,
  restart = false,
  prompt = 'What is the capital of India? Please answer in one sentence.',
  modelIds = null,
  rerunModels = null,
  apiKey: optApiKey,
  baseURL: optBaseURL,
} = {}, onEvent, signal) {
  function isAborted() { return signal?.aborted; }

  const apiKey = optApiKey || process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    onEvent?.({ type: 'error', text: 'NVIDIA_API_KEY is not set. Add it to the .env file or in API Settings.' });
    onEvent?.({ type: 'done' });
    return;
  }

  const baseURL = optBaseURL || process.env.API_BASE_URL || 'https://integrate.api.nvidia.com/v1';
  const client = new OpenAI({ baseURL, apiKey, timeout: CONNECT_TIMEOUT * 1000 });

  let models;
  try {
    models = JSON.parse(readFileSync(MODELS_FILE, 'utf-8'));
  } catch {
    onEvent?.({ type: 'error', text: 'models.json not found or invalid.' });
    onEvent?.({ type: 'done' });
    return;
  }

  if (restart && existsSync(RESULTS_FILE)) {
    saveResults([]);
  }

  let results = [];
  let doneIds = new Set();
  if (existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
      if (rerunModels && rerunModels.length > 0) {
        results = results.filter(r => !rerunModels.includes(r.id));
        saveResults(results);
      }
      doneIds = new Set(results.map(r => r.id));
    } catch {}
  }

  let modelsToRun = modelIds && modelIds.length > 0
    ? models.filter(m => modelIds.includes(m.id))
    : models;

  modelsToRun = modelsToRun.filter(m => !doneIds.has(m.id));

  const totalModels = models.length;
  const benchStart = performance.now();
  let successCount = 0, timeoutCount = 0, errorCount = 0;

  onEvent?.({ type: 'init', total: totalModels, existing: results.length, toRun: modelsToRun.length });

  for (const model of modelsToRun) {
    if (isAborted()) break;
    const modelIndex = models.findIndex(m => m.id === model.id) + 1;

    const result = await runSingleModel(client, model, modelIndex, totalModels, timeout, prompt, onEvent, signal);
    if (!result) break;

    results.push(result);
    if (result.status === 'ok') successCount++;
    else if (result.error?.toLowerCase().includes('timeout')) timeoutCount++;
    else errorCount++;

    saveResults(results);
    onEvent?.({ type: 'result', ...result });

    if (!isAborted()) {
      for (let s = RATE_LIMIT_WAIT; s > 0; s--) {
        if (isAborted()) break;
        onEvent?.({ type: 'wait', seconds: s });
        await sleepAbortable(1000, signal);
        if (isAborted()) break;
      }
    }
  }

  if (!isAborted()) {
    const totalElapsed = (performance.now() - benchStart) / 1000;
    onEvent?.({
      type: 'summary',
      total: results.length,
      succeeded: successCount,
      timeouts: timeoutCount,
      errors: errorCount,
      elapsed: Math.round(totalElapsed * 100) / 100,
    });
  }
  onEvent?.({ type: 'done' });
}
