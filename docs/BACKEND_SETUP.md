# MuscleBuilder Live Backend Setup

This repo now includes a real backend entrypoint at `/server/index.js`.

## What it handles

- email OTP delivery and verification
- hashed passwords for login/signup before OTP
- signed session tokens for API auth
- Stripe Checkout for web billing
- RevenueCat webhook ingestion for native subscription state
- device connection state storage
- native health sync payload storage from HealthKit / Health Connect

## Required env

Use the values in [/Users/mohitunecha/gymworkoutappwebsite/.claude/worktrees/determined-benz/.env.example](/Users/mohitunecha/gymworkoutappwebsite/.claude/worktrees/determined-benz/.env.example).

Minimum secure env for local testing:

```bash
PORT=8787
APP_URL=http://localhost:5174
CORS_ORIGINS=http://localhost:5174,http://127.0.0.1:5174,capacitor://localhost,http://localhost
SESSION_SECRET=use-a-long-random-value
DATA_ENCRYPTION_SECRET=use-a-second-long-random-value
ALLOW_CONSOLE_OTP=true
```

Minimum secure env for production:

```bash
NODE_ENV=production
PORT=8787
APP_URL=https://your-app-domain.com
CORS_ORIGINS=https://your-app-domain.com,capacitor://localhost,http://localhost
SESSION_SECRET=long-random-secret
DATA_ENCRYPTION_SECRET=second-long-random-secret
MAIL_FROM=MuscleBuilder <no-reply@your-domain.com>
RESEND_API_KEY=re_xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
REVENUECAT_WEBHOOK_SECRET=your_revenuecat_webhook_secret
```

## Frontend config

The app expects all secure API calls to point at the backend base URL:

```bash
VITE_AUTH_API_BASE=https://api.your-domain.com/api
VITE_BILLING_API_BASE=https://api.your-domain.com/api
VITE_DEVICE_SYNC_API_BASE=https://api.your-domain.com/api
```

For native store billing, add public RevenueCat SDK keys in `public/runtime-config.js`:

```js
window.__MB_RUNTIME_CONFIG__ = {
  revenueCatAppleApiKey: "appl_xxx",
  revenueCatGoogleApiKey: "goog_xxx",
  revenueCatEntitlementId: "pro",
  revenueCatOfferingId: "default",
};
```

## Run locally

```bash
npm install
npm run server
npm run dev
```

If you use `ALLOW_CONSOLE_OTP=true`, the OTP code is logged by the backend for local testing only.

## Native billing split

- iOS / Android: RevenueCat SDK in the app, validated by App Store / Google Play, mirrored back to your backend by RevenueCat webhooks.
- Web: Stripe Checkout created by `/api/billing/checkout`.

## Device sync split

- iOS: `NativeHealthSyncPlugin` reads HealthKit.
- Android: `NativeHealthSyncPlugin` reads Health Connect.
- Backend: `/api/devices/health/sync` stores the synced metrics and timestamps.

## Security notes

- Passwords are stored with `scrypt`.
- Signup passwords require 8+ chars with upper, lower, and number characters.
- OTP codes are HMAC-hashed and expire quickly.
- Session tokens are stored server-side as hashes, not plaintext.
- Production startup rejects weak secrets, insecure `APP_URL`, and console OTP mode.
- Demo OTP, demo billing, and demo sync should remain disabled in production.
