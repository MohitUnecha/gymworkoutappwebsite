# Audit Overview

Last updated: 2026-03-28

## Scope

This audit covered:

- web build stability
- iOS simulator buildability
- Android debug buildability
- mobile button/touch behavior
- free vs premium gating logic
- beginner onboarding clarity
- dependency audit status

## Verified commands

Run from the project root or the clean worktree copy:

```bash
npm run build
npm audit
cd android && ./gradlew assembleDebug
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO
```

## Result

Current status:

- Web build: passing
- npm audit: 0 vulnerabilities
- Android debug build: passing
- iOS simulator build: passing

## Audit fixes applied

### Beginner UX

- Added beginner illustration cards for Coach, Split, and Workout empty states.
- Added plain-language onboarding steps so new users can understand what to do first.
- Kept clickable helper words in coach suggestions for terms like `volume`, `recovery`, and `split`.

### Mobile/touch behavior

- Increased standard button touch targets toward 44px minimum.
- Increased mobile bottom-nav height.
- Added `touch-action: manipulation` to interactive elements for more reliable taps.
- Added accessibility labels to key icon-only controls such as send, complete set, delete day, and plate calculator.
- Converted several large clickable cards to keyboard/touch-friendly pressable elements.

### Product logic

- Free users can use:
  - nutrition profile setup
  - overview
  - food database logging
  - devices tab
- Premium users additionally get:
  - AI food scan
  - water tracking
  - weight tracking
  - advanced nutrition flow

## iOS / Android compliance notes

### In good shape

- Capacitor iOS shell exists and builds.
- Capacitor Android shell exists and builds.
- Privacy manifest and Info.plist usage strings are present for iOS.
- Safe area handling exists for mobile layouts.
- Touch targets are improved for small phones.

### Still demo or mocked

- Apple Pay / Google Pay / card checkout is still app-side UI logic, not a real live billing backend.
- OTP email verification is still demo-style, not a real email delivery service.
- Wearable and scale connections are still mocked connection states, not real HealthKit / Fitbit / Garmin / Bluetooth integrations.

## Recommended launch order

1. Replace demo billing with real App Store / Play billing or a compliant backend.
2. Replace demo OTP with a real auth/email system.
3. Replace mocked device sync with real provider integrations.
4. Add end-to-end UI tests for auth, split creation, workout logging, and nutrition logging.

## Useful files

- Main app: `App.jsx`
- Platform overview: `docs/PLATFORM_STRUCTURE.md`
- iOS native helper: `ios/App/App/CoachSuggestionEngine.swift`
- Android native helper: `android/app/src/main/java/com/musclebuilder/app/CoachSuggestionEngine.java`
