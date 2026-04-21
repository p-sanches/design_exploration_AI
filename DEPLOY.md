# Deployment

## Cloudflare Pages (one-time setup)

1. Install Cloudflare CLI and log in (only once per machine):
   ```
   npx wrangler login
   ```

2. Create the Pages project (only once per project):
   ```
   npx wrangler pages project create design-exploration-ai --production-branch main
   ```

3. Set the Anthropic key as a production secret:
   ```
   npx wrangler pages secret put ANTHROPIC_KEY --project-name design-exploration-ai
   ```
   (Paste your `sk-ant-...` when prompted.)

4. Optional: gate the proxy with a workshop code so only participants with
   the code can use Claude. The same string must be set on both sides:
   - Server: `npx wrangler pages secret put WORKSHOP_CODE --project-name design-exploration-ai`
   - Client: open `.env.production.local` (already created, gitignored) and
     replace `REPLACE_ME` on the `VITE_WORKSHOP_CODE=` line with the same
     string you gave Wrangler.

   To disable the gate later, delete the Cloudflare secret (via the dashboard
   or `wrangler pages secret delete WORKSHOP_CODE`) and rebuild.

5. Optional: if you want Ollama available in production, set the Ollama URL:
   ```
   npx wrangler pages secret put OLLAMA_URL --project-name design-exploration-ai
   ```
   (e.g. `http://tokai.informatik.umu.se:11434`.)

## Deploy

```
npm run deploy
```

That builds the site (`vite build`) and uploads `dist/` plus the `functions/`
directory to Cloudflare. First deploy prints your live URL
(`https://design-exploration-ai.pages.dev`). Subsequent deploys update it.

## Local development

Two options:

- `npm run dev` — Vite only. Claude won't work locally (proxy unavailable).
  Fine if you're testing UI or Ollama-only.
- `npm run dev:proxy` — Vite + Wrangler Pages Functions. Requires
  `.dev.vars` (copy from `.dev.vars.example`, fill in `ANTHROPIC_KEY`).
  Behaves identically to production.
