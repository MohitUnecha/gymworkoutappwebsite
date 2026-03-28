# Platform Structure

MuscleBuilder is organized as a shared web app plus native platform folders.

## Web

- Main UI and app logic: `App.jsx`
- Vite web build: `package.json`, `vite.config.js`
- Shared coach behavior for the web UI:
  - proactive suggestions
  - clickable helper terms
  - free vs premium nutrition gating
  - gym ETA card and Google Maps directions
  - in-app Spotify / Apple Music embeds
  - native-ready reminder scheduling through Capacitor plugins

## iOS

- Capacitor iOS shell: `ios/App`
- Native app entry: `ios/App/App/AppDelegate.swift`
- Native coach helper file: `ios/App/App/CoachSuggestionEngine.swift`
- Native Live Activity scaffold: `ios/App/App/WorkoutLiveActivityManager.swift`
- App Store privacy manifest: `ios/App/App/PrivacyInfo.xcprivacy`

## Android

- Capacitor Android shell: `android/app`
- Native app entry: `android/app/src/main/java/com/musclebuilder/app/MainActivity.java`
- Native coach helper file: `android/app/src/main/java/com/musclebuilder/app/CoachSuggestionEngine.java`

## Product split

- Free:
  - split coaching
  - proactive coach suggestions
  - basic calorie targets
  - food database logging
  - workout reminders
  - gym ETA and directions
  - in-app music embeds
  - device pairing and 30-day sync trial
- Premium:
  - AI food scanner
  - water tracking
  - body-weight trend tracking
  - ongoing device sync after the free trial
