# Design Exploration Tree

A non-linear design exploration tool for physiotherapists and occupational therapists to prototype patient-facing clinical applications. Built as a research instrument for workshop use.

## Quick start

```bash
cp .env.example .env   # add your Anthropic API key
npm install
npm run dev
```

## Using Ollama

To use a local Ollama model instead of Claude, Ollama must allow browser CORS:

```bash
OLLAMA_ORIGINS=* ollama serve
```

Then toggle to "Ollama" in the top-right of the UI. Click the model name to change it (e.g. `llama3.1`, `mistral`, `phi3`).

## Data sources

The data bar below the toolbar lets you connect live biometric data:

- **CSV file** — upload a CSV with joint position/angle columns. The file loops continuously and broadcasts to all prototypes.
- **Webcam** — uses MediaPipe Pose (loaded from CDN) to extract a 33-point skeleton in real time.
- **Connect sensor** — pairs with a BLE sensor via Web Bluetooth.

All sources broadcast a `bioframe` message to every prototype iframe every 100ms.

## Save / load / export

- **Save** — downloads the full tree (nodes, positions, conversations, generated code) as JSON
- **Load** — restores a previously saved tree
- **Export** — generates a self-contained HTML file of the full exploration tree for sharing
