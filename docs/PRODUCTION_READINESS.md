# Production Readiness Overview

Last updated: 2026-03-28

## What is ready now

- Free calorie tracking:
  - nutrition profile
  - calorie and macro overview
  - food database logging
- Native-ready reminder flow:
  - workout reminders
  - water reminders
  - protein reminders
  - lock-screen rest alerts through local notifications
- Main gym setup:
  - save current location as main gym
  - estimate drive time inside the app
  - open Google Maps driving directions
- In-app media:
  - Spotify public playlist/album embed
  - Apple Music public playlist/album embed
- Native shells:
  - Capacitor iOS app
  - Capacitor Android app
- Protected release gates:
  - demo OTP can be disabled at build time
  - demo billing can be disabled at build time
  - fake device sync can be disabled at build time
  - seeded test account is removed from production builds
- Live-capable backend foundation:
  - Express API for OTP auth, sessions, billing checkout, and device sync
  - Resend delivery path for real OTP emails
  - Stripe Checkout session creation for web billing
  - RevenueCat webhook ingestion for native billing state
  - HealthKit and Health Connect native sync plugins compiled into iOS and Android

## Free vs Pro

### Free

- workout coach and split builder
- food database and calorie totals
- nutrition profile and macro targets
- device pairing and 30-day sync trial
- gym setup and ETA card
- in-app Spotify and Apple Music embeds
- workout and water reminders

### Pro

- AI food scan
- body-weight tracking
- water tracking history
- ongoing device sync after the trial

## Native integrations added

### Notifications

- `@capacitor/local-notifications` is installed and scheduled from app settings.
- Web still falls back to browser notifications when running outside native shells.

### Location

- `@capacitor/geolocation` is installed for iOS and Android.
- iOS `Info.plist` includes location permission copy for gym ETA and directions.

### Live Activities scaffold

- `ios/App/App/WorkoutLiveActivityManager.swift` adds an ActivityKit manager and attributes model.
- `Info.plist` now enables `NSSupportsLiveActivities`.

Important:

- This is scaffolding only.
- To ship a real Live Activity UI, Xcode still needs a Widget Extension target with an `ActivityConfiguration`.

## Provider setup still required for full launch

## Protected release mode

The app now fails closed for sensitive features when production backends are missing.

- `VITE_AUTH_API_BASE`
  - enables secure OTP request/verify calls
- `VITE_BILLING_API_BASE`
  - enables protected billing checkout calls
- `VITE_DEVICE_SYNC_API_BASE`
  - enables real device connection/sync calls
- `VITE_ENABLE_DEMO_OTP=false`
- `VITE_ENABLE_DEMO_BILLING=false`
- `VITE_ENABLE_DEMO_DEVICE_SYNC=false`
- `VITE_ENABLE_TEST_ACCOUNT=false`
- keep browser Groq keys out of Vite env
- use `public/runtime-config.js` only for local/private builds if you intentionally allow browser-side AI keys

Recommended public-release rule:

- leave all demo flags off
- keep test account off
- only turn a feature on after its backend is configured and tested

### Google Maps

Current app behavior:

- saves the user's main gym coordinates
- estimates drive time in-app
- opens real Google Maps directions links

If you want exact ETA inside the app itself instead of an estimate, add a server-side or secured Google Maps routing flow.

### Spotify

Current app behavior:

- supports in-app public embeds
- keeps users inside the workout screen for simple playback

If you want full account playback, skip, seek, current track sync, or background device handoff, you still need a proper Spotify auth flow and SDK rollout.

### Apple Music

Current app behavior:

- supports in-app public Apple Music embeds

If you want full account playback and library control, add MusicKit entitlements and an Apple Music developer token flow.

## Safe-by-default backend rules

- production server requires 32+ character `SESSION_SECRET`
- production server requires 32+ character `DATA_ENCRYPTION_SECRET`
- production server rejects `ALLOW_CONSOLE_OTP=true`
- production server rejects non-HTTPS `APP_URL`
- signup passwords must be 8+ chars with upper, lower, and number characters
- health-sync payloads are range-validated before persistence

## App Store / Play Store notes

### Better now

- native notifications are no longer browser-only
- location permission copy exists
- live activity support keys exist
- web, Android, and iOS remain buildable
- real backend hooks now exist for auth, billing, and device sync

### Provider setup still required

- Stripe still needs live keys, webhook config, and your final product/pricing setup
- Resend still needs a verified sending domain for live OTP email delivery
- RevenueCat still needs active App Store / Play products, offerings, and entitlements
- Fitbit, Garmin, and Bluetooth scale sync still need their own provider integrations
- Live Activities need the actual widget target to display on the Lock Screen and Dynamic Island

## Official references

- Apple ActivityKit: <https://developer.apple.com/documentation/activitykit>
- Apple MusicKit: <https://developer.apple.com/documentation/musickit>
- Spotify Web Playback SDK: <https://developer.spotify.com/documentation/web-playback-sdk>
- Google Maps URLs: <https://developers.google.com/maps/documentation/urls/get-started>
