# Live Demo : <a href="https://mrnareshkumar.github.io/nvidia-nim-model-benchmark/"> NVIDIA NIM — LLM Speed Benchmark</a>  

A full-stack web application that benchmarks Large Language Models (LLMs) served through NVIDIA's [NIM](https://www.nvidia.com/en-us/ai/) (NVIDIA Inference Microservices) platform. Runs a unified prompt against 76 models across 7 categories and visualizes results with an interactive React dashboard.

## Features

- **76 models** across chat, audio, video, biology, driving, rerank, and vision categories
- **Real-time streaming** via Server-Sent Events (SSE) — watch results appear live
- **Comprehensive metrics**: tokens/second, time-to-first-token (TTFT), total time, token counts, and cost estimation (DeepSeek models)
- **Interactive charts**: sortable bar charts, TTFT chart, stacked token usage chart
- **Detail panel**: click any model to see prompt, response, timing breakdown, and errors
- **Benchmark runner sidebar**: select/deselect models, retry individual failures, set custom prompt
- **Retry logic**: automatic retry (up to 3 attempts) with exponential backoff on rate limits
- **CSV export** and **print-friendly** styles
- **Dark/light theme** persisted to localStorage
- **All JavaScript** — no Python or external services required

## Setup

```bash
npm install
```

Add your NVIDIA API key to `.env`:

```
NVIDIA_API_KEY=your_key_here
```

> Get a free API key at [build.nvidia.com](https://build.nvidia.com/explore/discover).

## Run

```bash
npm run dev
```

Starts both the Vite dev server (HMR on port 5173) and the Express backend (port 3000). Open the URL shown in the terminal.

## Build & Serve

```bash
npm start
```

Builds the React app into `dist/` and serves everything from Express on port 3000.

## Project Structure

```
├── .env                    # NVIDIA API key
├── package.json            # Project scripts & dependencies
├── vite.config.js          # Vite config with dev proxy to Express
├── index.html              # SPA entry point
├── benchmark.js            # Benchmark engine — runs models via OpenAI SDK
├── server.js               # Express server — SSE, API, static files
├── models.json             # 76 model definitions (id, label, group)
├── results.json            # Generated benchmark results (persisted)
└── src/
    ├── main.jsx            # React entry point
    ├── App.jsx             # Root component with data fetching & routing
    ├── App.css             # All styles (dark/light, responsive, print)
    ├── components/         # UI components
    │   ├── Header.jsx
    │   ├── Footer.jsx
    │   ├── SummaryCards.jsx
    │   ├── Toolbar.jsx
    │   ├── MainChart.jsx
    │   ├── TtftChart.jsx
    │   ├── TokenChart.jsx
    │   ├── ModelDetailPanel.jsx
    │   ├── Legend.jsx
    │   ├── ParticleBackground.jsx
    │   └── RunBenchmark.jsx
    ├── hooks/
    │   └── useAnimatedCounter.js
    └── utils/
        ├── providers.jsx   # Provider colors, names, SVG icons
        └── csvExport.js    # CSV export utility
```

## Architecture

| Layer       | Technology                           |
|-------------|--------------------------------------|
| Frontend    | React 18 + Vite 6 (pure CSS)         |
| Backend     | Node.js (ESM) + Express 4            |
| API Client  | OpenAI SDK (compatible with NVIDIA)  |
| Dev Tooling | concurrently (Vite + Express)        |

The frontend is a single-page application. The backend exposes:
- **`GET /api/benchmark`** — SSE endpoint to start/resume/restart a benchmark
- **`GET /api/benchmark/retry`** — SSE endpoint to retry a single model
- **`GET /models.json`** — Model definitions
- **`GET /results.json`** — Cached results with `Last-Modified` timestamp
- **`POST /api/results/delete`** — Delete results by model ID array

## Scripts

| Command          | Description                                    |
|------------------|------------------------------------------------|
| `npm run dev`    | Vite dev server + Express concurrently         |
| `npm run build`  | Build React app to `dist/`                     |
| `npm start`      | Build + serve from Express on port 3000        |

## Tech Stack

- **React 18** — function components, hooks, URL-synced state
- **Vite 6** — fast dev server with HMR
- **Express 4** — HTTP server and SSE streaming
- **OpenAI SDK** — API client for NVIDIA NIM endpoint
- **dotenv** — environment variable loading

## Models

76 models organized into 7 groups:

- **chat** (60) — Llama 3.x, Nemotron, DeepSeek V4, Mistral, Qwen 3.5, Gemma, Phi-4, and more
- **audio** (4) — Nemotron Voice Chat, Active Speaker Detection, Background Noise Removal, Magpie TTS
- **video** (4) — Cosmos3 Nano, Cosmos3 Nano Reasoner, Cosmos Transfer
- **biology** (2) — ESM2 650M, ESMFold
- **driving** (3) — StreamPETR, SparseDrive, BEVFormer
- **rerank** (1) — Rerank QA Mistral 4B
- **vision** (1) — PaliGemma

## License

MIT
