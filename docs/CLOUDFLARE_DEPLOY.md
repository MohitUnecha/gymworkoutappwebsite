# Cloudflare Deploy Steps

## What is live on Cloudflare in this repo

- Static frontend can be deployed to Cloudflare Pages.
- Backend API can be deployed to Cloudflare Workers.
- Auth/session/device state is stored in Cloudflare D1.

## Commands

Create D1 database:

```bash
npx wrangler d1 create musclebuilder-prod
```

Apply schema:

```bash
npx wrangler d1 execute musclebuilder-prod --file=cloudflare/schema.sql
```

Set backend secrets:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_SECRET
npx wrangler secret put RESEND_API_KEY
```

Deploy Worker API:

```bash
npx wrangler deploy
```

Deploy frontend to Pages:

```bash
npx wrangler pages project create gymworkoutappwebsite
npm run build
npx wrangler pages deploy dist --project-name gymworkoutappwebsite
```

## Frontend env after Pages deploy

Once you have the live Worker URL, set these in the frontend environment:

```bash
VITE_AUTH_API_BASE=https://your-worker.your-subdomain.workers.dev/api
VITE_BILLING_API_BASE=https://your-worker.your-subdomain.workers.dev/api
VITE_DEVICE_SYNC_API_BASE=https://your-worker.your-subdomain.workers.dev/api
```

## Temporary note

Billing is intentionally left unconfigured in the Cloudflare Worker until Stripe is set up next.
