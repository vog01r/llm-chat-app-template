# Agents

## Cursor Cloud specific instructions

**Casus** is a Cloudflare Workers AI chat app (TTRPG/RPG assistant in French). Single Worker + static frontend, no database.

### Key commands

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Type-check | `npx tsc --noEmit` |
| Lint + dry-run deploy | `npm run check` |
| Tests | `npm test` (vitest — no test files yet) |
| Dev server | `npm run dev` (requires `CLOUDFLARE_API_TOKEN`) |
| Generate types | `npm run cf-typegen` |

### Running locally without Cloudflare credentials

The dev server requires a `CLOUDFLARE_API_TOKEN` environment variable. Without a valid token, `wrangler dev` exits immediately in non-interactive environments.

To start the server in **local-only mode** (AI binding unavailable, but frontend + `/roll`/`/help` commands work):

```sh
CLOUDFLARE_API_TOKEN=placeholder npx wrangler dev --port 8787 --local
```

The AI binding will show `not supported`; chat messages that invoke the LLM will fail, but all local commands (`/roll`, `/help`) and the static frontend work normally.

### Project structure

- `src/index.ts` — Worker entry point (API routes, dice roller, SSE streaming)
- `src/types.ts` — TypeScript interfaces (`Env`, `ChatMessage`)
- `public/index.html` — Chat UI (vanilla HTML/CSS)
- `public/chat.js` — Frontend logic (SSE client)
- `wrangler.jsonc` — Cloudflare Worker config (AI + Assets bindings)
