import { useState, useEffect, useRef, useCallback } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";

const envFlag = (name) => String(import.meta.env[name] || "").toLowerCase() === "true";
const APP_MODE = import.meta.env.MODE || "development";
const IS_PRODUCTION_BUILD = !!import.meta.env.PROD;
const RUNTIME_CONFIG = globalThis.__MB_RUNTIME_CONFIG__ || {};
const runtimeString = (...values) => String(values.find(value => typeof value === "string" && value.trim()) || "").trim();
const runtimeApiBase = (...values) => runtimeString(...values).replace(/\/$/, "");
const RELEASE_PROTECTION = {
  allowBrowserGroqKeys: !IS_PRODUCTION_BUILD || envFlag("VITE_ALLOW_BROWSER_GROQ_KEYS"),
  allowDemoOtp: !IS_PRODUCTION_BUILD || envFlag("VITE_ENABLE_DEMO_OTP"),
  allowDemoBilling: !IS_PRODUCTION_BUILD || envFlag("VITE_ENABLE_DEMO_BILLING"),
  allowDemoDeviceSync: !IS_PRODUCTION_BUILD || envFlag("VITE_ENABLE_DEMO_DEVICE_SYNC"),
  allowSeedTestAccount: !IS_PRODUCTION_BUILD || envFlag("VITE_ENABLE_TEST_ACCOUNT"),
  authApiBase: runtimeApiBase(
    RUNTIME_CONFIG.authApiBase,
    RUNTIME_CONFIG.auth_api_base,
    import.meta.env.VITE_AUTH_API_BASE,
  ),
  billingApiBase: runtimeApiBase(
    RUNTIME_CONFIG.billingApiBase,
    RUNTIME_CONFIG.billing_api_base,
    import.meta.env.VITE_BILLING_API_BASE,
  ),
  deviceSyncApiBase: runtimeApiBase(
    RUNTIME_CONFIG.deviceSyncApiBase,
    RUNTIME_CONFIG.device_sync_api_base,
    import.meta.env.VITE_DEVICE_SYNC_API_BASE,
  ),
};
const PROTECTION_STATUS = {
  authProtected: !!RELEASE_PROTECTION.authApiBase || RELEASE_PROTECTION.allowDemoOtp,
  billingProtected: !!RELEASE_PROTECTION.billingApiBase || RELEASE_PROTECTION.allowDemoBilling,
  deviceSyncProtected: !!RELEASE_PROTECTION.deviceSyncApiBase || RELEASE_PROTECTION.allowDemoDeviceSync,
};
const IS_NATIVE_APP = Capacitor.isNativePlatform();
const NATIVE_PLATFORM = Capacitor.getPlatform();
const NativeHealthSync = registerPlugin("NativeHealthSync");
const AUTH_TOKEN_KEY = "mb_auth_token";
const BILLING_RUNTIME = {
  revenueCatAppleApiKey: String(RUNTIME_CONFIG.revenueCatAppleApiKey || RUNTIME_CONFIG.revenuecat_apple_api_key || "").trim(),
  revenueCatGoogleApiKey: String(RUNTIME_CONFIG.revenueCatGoogleApiKey || RUNTIME_CONFIG.revenuecat_google_api_key || "").trim(),
  revenueCatEntitlementId: String(RUNTIME_CONFIG.revenueCatEntitlementId || RUNTIME_CONFIG.revenuecat_entitlement_id || "pro").trim() || "pro",
  revenueCatOfferingId: String(RUNTIME_CONFIG.revenueCatOfferingId || RUNTIME_CONFIG.revenuecat_offering_id || "").trim(),
};
const APP_BRAND = "WorkoutBuddy";
const APP_INITIALS = "WB";
const APP_PRO_BRAND = `${APP_BRAND} Pro`;

// ── API Keys (loaded from env or config) ──
const GROQ_KEYS = (() => {
  const runtimeKey = String(RUNTIME_CONFIG.groqApiKey || RUNTIME_CONFIG.groq_api_key || "").trim();
  const runtimeKey2 = String(RUNTIME_CONFIG.groqApiKey2 || RUNTIME_CONFIG.groq_api_key_2 || "").trim();
  if (runtimeKey && RELEASE_PROTECTION.allowBrowserGroqKeys) return [runtimeKey, runtimeKey2].filter(Boolean);
  if (RELEASE_PROTECTION.allowBrowserGroqKeys) {
    try {
      const stored = localStorage.getItem("mb_groq_keys");
      if (stored) return JSON.parse(stored);
    } catch {}
  }
  return [];
})();

// ── Simple encryption for localStorage security ──
const cipher = {
  encode: (data, key) => {
    try {
      const str = JSON.stringify(data);
      const k = key || "mb_default_key";
      let result = "";
      for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) ^ k.charCodeAt(i % k.length));
      }
      return btoa(result);
    } catch { return null; }
  },
  decode: (encoded, key) => {
    try {
      const str = atob(encoded);
      const k = key || "mb_default_key";
      let result = "";
      for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) ^ k.charCodeAt(i % k.length));
      }
      return JSON.parse(result);
    } catch { return null; }
  },
  hash: (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h = ((h << 5) - h) + c;
      h |= 0;
    }
    return "h_" + Math.abs(h).toString(36) + "_" + str.length;
  },
};

// ── Storage (encrypted) ──
const store = {
  getUsers: () => { try { const raw = localStorage.getItem("mb_u"); if (!raw) return []; return JSON.parse(raw); } catch { return []; } },
  setUsers: u => localStorage.setItem("mb_u", JSON.stringify(u)),
  getData: u => {
    try {
      const raw = localStorage.getItem(`mb_d_${u}`);
      if (!raw) return null;
      // Try encrypted first, fall back to plain JSON for migration
      const decoded = cipher.decode(raw, u);
      if (decoded) return decoded;
      return JSON.parse(raw);
    } catch { return null; }
  },
  setData: (u, d) => {
    const encoded = cipher.encode(d, u);
    if (encoded) localStorage.setItem(`mb_d_${u}`, encoded);
    else localStorage.setItem(`mb_d_${u}`, JSON.stringify(d));
  },
  getSession: () => localStorage.getItem("mb_s"),
  setSession: u => u ? localStorage.setItem("mb_s", u) : localStorage.removeItem("mb_s"),
};
const authSession = {
  get: () => {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) || "";
    } catch {
      return "";
    }
  },
  set: (token) => {
    try {
      if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
      else localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {}
  },
  clear: () => {
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {}
  },
};

const DEFAULT_SETTINGS = {
  restTime: 90,
  unit: "lbs",
  reminderEnabled: false,
  reminderTime: "18:00",
  reminderDays: [1, 2, 3, 4, 5],
  waterReminder: false,
  proteinReminder: false,
  mainGymName: "",
  mainGymAddress: "",
  mainGymCoords: null,
  spotifyUrl: "",
  appleMusicUrl: "",
  preferredMusicProvider: "spotify",
  lockScreenRestAlerts: false,
};

const EMPTY = {
  splits: [], logs: [], chat: [],
  settings: { ...DEFAULT_SETTINGS },
  premium: false,
  premiumPlan: null, // { plan, method, date, fee }
  nutrition: { profile: null, foodLog: [], waterLog: [] },
  bodyWeight: [],
  connectedDevices: [], // [{ name, type, connectedAt }]
  devicesTrialStart: null, // ISO date string — null means never started
};

// ── Seed test account on first load ──
(() => {
  if (!RELEASE_PROTECTION.allowSeedTestAccount) {
    const users = store.getUsers();
    const nextUsers = users.filter(x => x.e !== "test@muscle.com");
    if (nextUsers.length !== users.length) {
      store.setUsers(nextUsers);
      try {
        localStorage.removeItem("mb_d_test@test.com");
        if (store.getSession() === "test@muscle.com") store.setSession(null);
      } catch {}
    }
    return;
  }
  const users = store.getUsers();
  if (!users.find(x => x.e === "test@muscle.com")) {
    users.push({ e: "test@muscle.com", ph: cipher.hash("test123"), verified: true });
    store.setUsers(users);
    store.setData("test@muscle.com", JSON.parse(JSON.stringify(EMPTY)));
  }
})();

function secureOtpCode() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(100000 + (buf[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getPasswordRequirementError(password) {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return "Password needs upper, lower, and number characters";
  }
  return "";
}

function getRevenueCatApiKey() {
  if (NATIVE_PLATFORM === "ios") return BILLING_RUNTIME.revenueCatAppleApiKey;
  if (NATIVE_PLATFORM === "android") return BILLING_RUNTIME.revenueCatGoogleApiKey;
  return "";
}

async function requestJson(url, { method = "GET", body, auth = false, headers = {} } = {}) {
  const nextHeaders = { ...headers };
  if (body !== undefined) nextHeaders["Content-Type"] = "application/json";
  if (auth) {
    const token = authSession.get();
    if (token) nextHeaders.Authorization = `Bearer ${token}`;
  }
  const r = await fetch(url, {
    method,
    headers: nextHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw new Error(data?.error || data?.message || `Request failed (${r.status})`);
  return data;
}

async function postJson(url, body, options = {}) {
  return requestJson(url, { method: "POST", body, ...options });
}

async function getJson(url, options = {}) {
  return requestJson(url, { method: "GET", ...options });
}

async function requestProtectedOtp(email, mode, password) {
  if (RELEASE_PROTECTION.authApiBase) {
    await postJson(`${RELEASE_PROTECTION.authApiBase}/auth/request-otp`, {
      email,
      password,
      mode,
      app: "musclebuilder",
    });
    return { delivered: true, demoCode: "" };
  }
  if (RELEASE_PROTECTION.allowDemoOtp) {
    return { delivered: true, demoCode: secureOtpCode() };
  }
  throw new Error("Secure email verification is not configured for this release.");
}

async function loginProtected(email, password) {
  if (RELEASE_PROTECTION.authApiBase) {
    return postJson(`${RELEASE_PROTECTION.authApiBase}/auth/login`, {
      email,
      password,
      app: "musclebuilder",
    });
  }
  throw new Error("Secure sign-in backend is not configured for this release.");
}

async function verifyProtectedOtp(email, code, mode, expectedDemoCode) {
  if (RELEASE_PROTECTION.authApiBase) {
    return postJson(`${RELEASE_PROTECTION.authApiBase}/auth/verify-otp`, {
      email,
      code,
      mode,
      app: "musclebuilder",
    });
  }
  if (RELEASE_PROTECTION.allowDemoOtp) {
    if (code !== expectedDemoCode) throw new Error("Incorrect code. Check your email.");
    return { ok: true, sessionToken: "", user: { email } };
  }
  throw new Error("Secure email verification is not configured for this release.");
}

async function fetchProtectedSession() {
  if (!RELEASE_PROTECTION.authApiBase) return null;
  return getJson(`${RELEASE_PROTECTION.authApiBase}/auth/session`, { auth: true });
}

async function logoutProtectedSession() {
  if (!RELEASE_PROTECTION.authApiBase || !authSession.get()) return;
  try {
    await postJson(`${RELEASE_PROTECTION.authApiBase}/auth/logout`, {}, { auth: true });
  } catch {}
}

async function fetchProtectedBillingStatus() {
  if (!RELEASE_PROTECTION.billingApiBase) return null;
  return getJson(`${RELEASE_PROTECTION.billingApiBase}/billing/status`, { auth: true });
}

async function fetchProtectedDeviceState() {
  if (!RELEASE_PROTECTION.deviceSyncApiBase) return null;
  return getJson(`${RELEASE_PROTECTION.deviceSyncApiBase}/devices/state`, { auth: true });
}

function getActiveEntitlement(customerInfo) {
  const active = customerInfo?.entitlements?.active || {};
  const preferred = active?.[BILLING_RUNTIME.revenueCatEntitlementId];
  if (preferred) return preferred;
  const values = Object.values(active);
  return values[0] || null;
}

async function ensureNativePurchasesConfigured(userEmail) {
  const apiKey = getRevenueCatApiKey();
  if (!IS_NATIVE_APP || !apiKey) return false;
  const configured = await Purchases.isConfigured().catch(() => ({ isConfigured: false }));
  if (!configured?.isConfigured) {
    await Purchases.configure({
      apiKey,
      appUserID: userEmail,
    });
  } else if (userEmail) {
    await Purchases.logIn({ appUserID: userEmail }).catch(() => null);
  }
  await Purchases.setEmail({ email: userEmail }).catch(() => null);
  return true;
}

async function purchaseNativePlan(plan, userEmail) {
  const configured = await ensureNativePurchasesConfigured(userEmail);
  if (!configured) {
    throw new Error("Native store billing is not configured. Add RevenueCat public SDK keys to runtime-config.js.");
  }
  const { offerings } = await Purchases.getOfferings();
  const offering = BILLING_RUNTIME.revenueCatOfferingId
    ? offerings?.all?.[BILLING_RUNTIME.revenueCatOfferingId] || offerings?.current
    : offerings?.current;
  const availablePackages = offering?.availablePackages || [];
  const typeMap = { monthly: "MONTHLY", yearly: "ANNUAL", lifetime: "LIFETIME" };
  const target = availablePackages.find(item => item.packageType === typeMap[plan])
    || availablePackages.find(item => item.identifier?.toLowerCase().includes(plan === "yearly" ? "annual" : plan));
  if (!target) {
    throw new Error("No live store product is configured for this plan in RevenueCat.");
  }
  const purchase = await Purchases.purchasePackage({
    aPackage: target,
    googleProductChangeInfo: null,
    googleIsPersonalizedPrice: false,
  });
  const customerInfo = purchase?.customerInfo || (await Purchases.getCustomerInfo()).customerInfo;
  const entitlement = getActiveEntitlement(customerInfo);
  if (!entitlement) {
    throw new Error("Purchase completed but no active entitlement was found.");
  }
  return {
    ok: true,
    mode: "revenuecat",
    reference: purchase?.productIdentifier || target.identifier || plan,
    customerInfo,
    entitlement,
  };
}

async function checkoutProtectedPayment(payload) {
  if (IS_NATIVE_APP && getRevenueCatApiKey()) {
    return purchaseNativePlan(payload.plan, payload.email);
  }
  if (RELEASE_PROTECTION.billingApiBase) {
    return postJson(`${RELEASE_PROTECTION.billingApiBase}/billing/checkout`, payload, {
      auth: true,
      headers: { "X-Native-Platform": NATIVE_PLATFORM || "web" },
    });
  }
  if (RELEASE_PROTECTION.allowDemoBilling) {
    await new Promise(r => setTimeout(r, payload.method === "card" ? 2000 : 1500));
    return {
      ok: true,
      reference: `demo_${Date.now()}`,
      receiptEmail: payload.email || null,
      mode: "demo",
    };
  }
  throw new Error("Protected billing is enabled. Connect a real billing backend before charging users.");
}

async function syncProtectedDevice(payload) {
  if (RELEASE_PROTECTION.deviceSyncApiBase) {
    return postJson(`${RELEASE_PROTECTION.deviceSyncApiBase}/devices/${payload.action}`, payload, {
      auth: true,
      headers: { "X-Native-Platform": NATIVE_PLATFORM || "web" },
    });
  }
  if (RELEASE_PROTECTION.allowDemoDeviceSync) {
    return {
      ok: true,
      status: "preview",
      mode: "demo",
    };
  }
  throw new Error("Device sync is protected until a real provider backend is configured.");
}

async function syncProtectedHealthData(payload) {
  if (RELEASE_PROTECTION.deviceSyncApiBase) {
    return postJson(`${RELEASE_PROTECTION.deviceSyncApiBase}/devices/health/sync`, payload, {
      auth: true,
      headers: { "X-Native-Platform": NATIVE_PLATFORM || "web" },
    });
  }
  if (RELEASE_PROTECTION.allowDemoDeviceSync) {
    return { ok: true, syncedAt: new Date().toISOString(), mode: "demo" };
  }
  throw new Error("Device health sync is protected until a real provider backend is configured.");
}

async function performNativeHealthSync(deviceName) {
  if (!IS_NATIVE_APP) {
    throw new Error("Native health sync only works inside the iOS or Android app.");
  }
  const availability = await NativeHealthSync.isAvailable?.().catch(() => ({ available: false }));
  if (!availability?.available) {
    throw new Error("Health sync is not available on this device.");
  }
  const permissionResult = await NativeHealthSync.requestPermissions?.().catch((error) => {
    throw new Error(error?.message || "Health permissions were not granted.");
  });
  const summary = await NativeHealthSync.syncSummary?.({ days: 30 }).catch((error) => {
    throw new Error(error?.message || "Could not read health data.");
  });
  return {
    provider: deviceName.toLowerCase().replace(/\s+/g, "_"),
    deviceName,
    source: NATIVE_PLATFORM === "ios" ? "healthkit" : "healthconnect",
    permissionsGranted: !!permissionResult?.granted,
    metrics: {
      bodyWeightLbs: summary?.bodyWeightLbs,
      stepsToday: summary?.stepsToday,
      restingHeartRate: summary?.restingHeartRate,
      workoutsLast30Days: summary?.workoutsLast30Days,
      lastWorkoutAt: summary?.lastWorkoutAt || "",
    },
  };
}

// ── Groq API ──
async function groq(messages, maxTokens = 2048) {
  if (RELEASE_PROTECTION.authApiBase && authSession.get()) {
    try {
      const result = await postJson(`${RELEASE_PROTECTION.authApiBase}/ai/chat`, {
        messages,
        maxTokens,
        temperature: 0.7,
      }, { auth: true });
      if (result?.content) return result.content;
    } catch (error) {
      if (!RELEASE_PROTECTION.allowBrowserGroqKeys) {
        return `AI unavailable: ${error.message || "secure AI proxy failed"}. Please try again.`;
      }
    }
  }
  if (!GROQ_KEYS.length) {
    return RELEASE_PROTECTION.allowBrowserGroqKeys
      ? "AI features require API keys. Add your Groq API key in Settings or set VITE_GROQ_API_KEY in your .env file."
      : "Protected AI mode is enabled, but the secure AI proxy is not configured yet.";
  }
  let lastError = "";
  for (const key of GROQ_KEYS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature: 0.7 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (r.status === 429) { lastError = "Rate limited"; continue; }
      if (r.status === 401) { lastError = "Invalid API key"; continue; }
      if (r.status === 503 || r.status === 500) { lastError = "Server error"; continue; }
      if (!r.ok) { lastError = `HTTP ${r.status}`; continue; }
      const d = await r.json();
      if (d.choices?.[0]?.message?.content) return d.choices[0].message.content;
      if (d.error?.message) { lastError = d.error.message; continue; }
    } catch (e) {
      if (e.name === "AbortError") { lastError = "Request timed out"; }
      else if (!navigator.onLine) { lastError = "You're offline. Check your connection."; break; }
      else { lastError = "Network error"; }
      continue;
    }
  }
  return lastError ? `AI unavailable: ${lastError}. Please try again.` : "AI is busy. Please try again in a moment.";
}

const SPLIT_RE = /\b(create|make|build|generate|give|design|set\s*up|plan|want|need|get|change|update|add|switch|modify|redo)\b.*\b(split|routine|program|plan|workout|schedule|ppl|push\s*pull|upper\s*lower|bro\s*split|full\s*body|day\s*split|to\s*my\s*split)\b/i;
const SPLIT_EDIT_RE = /\b(change|update|add|switch|modify|redo|fix|improve|replace|remove|cut|simplify|balance|adjust|edit)\b/i;

function tryParseJsonSplit(text) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    if (!arr[0].exercises && !arr[0].name) return null;
    return arr.map((d, i) => ({
      day: d.day || i + 1,
      name: d.name || `Day ${i + 1}`,
      type: d.type || "custom",
      exercises: (d.exercises || []).map(e => ({
        name: e.name || "Exercise",
        sets: Number(e.sets) || 3,
        reps: String(e.reps || "10"),
        muscle: e.muscle || "",
      })),
    }));
  } catch { return null; }
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSplitDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map((d, i) => ({
    day: Number(d?.day) || i + 1,
    name: String(d?.name || `Day ${i + 1}`).trim(),
    type: String(d?.type || "custom").trim().toLowerCase(),
    exercises: Array.isArray(d?.exercises)
      ? d.exercises.map((e) => ({
        name: String(e?.name || "Exercise").trim(),
        sets: Math.max(1, Number(e?.sets) || 3),
        reps: String(e?.reps || "10").trim(),
        muscle: String(e?.muscle || "").trim(),
      }))
      : [],
  })).sort((a, b) => a.day - b.day);
}

function splitSignature(days) {
  return JSON.stringify(
    normalizeSplitDays(days).map((day) => ({
      day: day.day,
      name: normalizeName(day.name),
      type: normalizeName(day.type),
      exercises: day.exercises.map((ex) => ({
        name: normalizeName(ex.name),
        sets: Number(ex.sets) || 0,
        reps: String(ex.reps || "").trim(),
        muscle: normalizeName(ex.muscle),
      })),
    }))
  );
}

function findMatchingDayIndex(existingDays, candidate) {
  const normalizedExisting = normalizeSplitDays(existingDays);
  const candidateDay = Number(candidate?.day) || 0;
  if (candidateDay) {
    const dayMatch = normalizedExisting.findIndex((day) => Number(day.day) === candidateDay);
    if (dayMatch !== -1) return dayMatch;
  }
  const candidateName = normalizeName(candidate?.name);
  if (candidateName) {
    const exactNameMatch = normalizedExisting.findIndex((day) => normalizeName(day.name) === candidateName);
    if (exactNameMatch !== -1) return exactNameMatch;
    const looseNameMatch = normalizedExisting.findIndex((day) => {
      const existingName = normalizeName(day.name);
      return existingName.includes(candidateName) || candidateName.includes(existingName);
    });
    if (looseNameMatch !== -1) return looseNameMatch;
  }
  const candidateType = normalizeName(candidate?.type);
  if (candidateType) {
    const typeMatches = normalizedExisting
      .map((day, index) => ({ day, index }))
      .filter(({ day }) => normalizeName(day.type) === candidateType);
    if (typeMatches.length === 1) return typeMatches[0].index;
  }
  return -1;
}

function resolveSplitUpdate(existingSplits, generatedSplits) {
  const base = normalizeSplitDays(existingSplits);
  const incoming = normalizeSplitDays(generatedSplits);
  if (!incoming.length) return null;
  if (!base.length) return incoming;

  const overlapCount = incoming.reduce((count, day) => {
    return count + (findMatchingDayIndex(base, day) !== -1 ? 1 : 0);
  }, 0);
  const looksLikeFullReplacement =
    incoming.length >= base.length ||
    (incoming.length >= Math.max(3, Math.ceil(base.length * 0.7)) && overlapCount >= Math.max(2, Math.floor(base.length * 0.6)));

  if (looksLikeFullReplacement) return incoming;

  const merged = base.map((day) => ({ ...day, exercises: [...day.exercises] }));
  incoming.forEach((day) => {
    const matchIndex = findMatchingDayIndex(merged, day);
    if (matchIndex === -1) {
      merged.push(day);
      return;
    }
    merged[matchIndex] = {
      ...merged[matchIndex],
      ...day,
      exercises: day.exercises?.length ? day.exercises : merged[matchIndex].exercises,
    };
  });

  return merged.sort((a, b) => a.day - b.day);
}

const TYPE_COLORS = {
  push: "#3B82F6", pull: "#A855F7", legs: "#22C55E", upper: "#3B82F6",
  lower: "#22C55E", chest: "#EF4444", back: "#A855F7", shoulders: "#F59E0B",
  arms: "#6366F1", core: "#EAB308", cardio: "#EC4899", rest: "#525252", custom: "#F59E0B",
};

const GOOGLE_MAPS_URL_BASE = "https://www.google.com/maps/dir/?api=1";
const REST_NOTIFICATION_ID = 9401;
const REMINDER_IDS = {
  workoutBase: 2000,
  waterBase: 2100,
  proteinBase: 2200,
};

function isNativePlatform() {
  try { return !!window?.Capacitor?.isNativePlatform?.(); } catch { return false; }
}

async function getLocalNotificationsPlugin() {
  try {
    const mod = await import("@capacitor/local-notifications");
    return mod.LocalNotifications;
  } catch {
    return null;
  }
}

async function getGeolocationPlugin() {
  try {
    const mod = await import("@capacitor/geolocation");
    return mod.Geolocation;
  } catch {
    return null;
  }
}

async function getNotificationPermissionState() {
  if (isNativePlatform()) {
    const LocalNotifications = await getLocalNotificationsPlugin();
    if (LocalNotifications) {
      try {
        const perm = await LocalNotifications.checkPermissions();
        return perm?.display || "prompt";
      } catch {}
    }
  }
  if (typeof Notification !== "undefined") return Notification.permission;
  return "denied";
}

async function requestNotificationPermission() {
  if (isNativePlatform()) {
    const LocalNotifications = await getLocalNotificationsPlugin();
    if (LocalNotifications) {
      try {
        const perm = await LocalNotifications.requestPermissions();
        return perm?.display || "denied";
      } catch {
        return "denied";
      }
    }
  }
  if (typeof Notification !== "undefined") return Notification.requestPermission();
  return "denied";
}

async function ensureReminderChannels() {
  if (!isNativePlatform()) return;
  const LocalNotifications = await getLocalNotificationsPlugin();
  if (!LocalNotifications) return;
  try {
    await LocalNotifications.createChannel({
      id: "mb-reminders",
      name: `${APP_BRAND} reminders`,
      description: "Gym, water, and protein nudges",
      importance: 4,
      vibration: true,
    });
    await LocalNotifications.createChannel({
      id: "mb-workout-timer",
      name: `${APP_BRAND} timer alerts`,
      description: "Rest timer and next-set alerts",
      importance: 4,
      vibration: true,
    });
  } catch {}
}

async function cancelReminderNotifications() {
  if (!isNativePlatform()) return;
  const LocalNotifications = await getLocalNotificationsPlugin();
  if (!LocalNotifications) return;
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push({ id: REMINDER_IDS.workoutBase + i });
  for (let i = 0; i < 7; i++) ids.push({ id: REMINDER_IDS.waterBase + i });
  for (let i = 0; i < 4; i++) ids.push({ id: REMINDER_IDS.proteinBase + i });
  try {
    await LocalNotifications.cancel({ notifications: ids });
  } catch {}
}

async function syncReminderNotifications(settings) {
  if (!isNativePlatform()) return;
  const LocalNotifications = await getLocalNotificationsPlugin();
  if (!LocalNotifications) return;
  await ensureReminderChannels();
  await cancelReminderNotifications();

  const notifications = [];
  const [hour, minute] = String(settings.reminderTime || "18:00").split(":").map(Number);
  if (settings.reminderEnabled) {
    (settings.reminderDays || []).forEach(day => {
      notifications.push({
        id: REMINDER_IDS.workoutBase + day,
        title: `${APP_BRAND} • Gym check-in`,
        body: settings.mainGymName
          ? `${settings.mainGymName} is on deck. Open ${APP_BRAND} and get your session started.`
          : "Your workout is lined up. Open WorkoutBuddy and get after it.",
        schedule: { on: { weekday: day + 1, hour, minute }, repeats: true },
        channelId: "mb-reminders",
      });
    });
  }
  if (settings.waterReminder) {
    [8, 10, 12, 14, 16, 18, 20].forEach((h, idx) => {
      notifications.push({
        id: REMINDER_IDS.waterBase + idx,
        title: `${APP_BRAND} • Water break`,
        body: "Take a quick water break so your energy and recovery stay steady.",
        schedule: { on: { hour: h, minute: 0 }, repeats: true },
        channelId: "mb-reminders",
      });
    });
  }
  if (settings.proteinReminder) {
    [8, 12, 16, 20].forEach((h, idx) => {
      notifications.push({
        id: REMINDER_IDS.proteinBase + idx,
        title: `${APP_BRAND} • Protein check`,
        body: "Log your next meal and stay on pace for today's protein target.",
        schedule: { on: { hour: h, minute: 0 }, repeats: true },
        channelId: "mb-reminders",
      });
    });
  }

  if (notifications.length) {
    try {
      await LocalNotifications.schedule({ notifications });
    } catch {}
  }
}

async function cancelRestNotification() {
  if (!isNativePlatform()) return;
  const LocalNotifications = await getLocalNotificationsPlugin();
  if (!LocalNotifications) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  } catch {}
}

async function scheduleRestNotification(seconds, title) {
  if (!isNativePlatform() || !seconds || seconds < 1) return;
  const LocalNotifications = await getLocalNotificationsPlugin();
  if (!LocalNotifications) return;
  await ensureReminderChannels();
  await cancelRestNotification();
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: REST_NOTIFICATION_ID,
        title: `${APP_BRAND} • Next set`,
        body: `${title} is ready. Lock in and start the next working set.`,
        schedule: { at: new Date(Date.now() + seconds * 1000), allowWhileIdle: true },
        channelId: "mb-workout-timer",
      }],
    });
  } catch {}
}

async function getCurrentCoords() {
  if (isNativePlatform()) {
    const Geolocation = await getGeolocationPlugin();
    if (Geolocation) {
      const perm = await Geolocation.requestPermissions();
      if (perm?.location === "denied") throw new Error("Location permission denied");
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    }
  }
  if (!navigator.geolocation) throw new Error("Location is not available on this device");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

function toRad(v) { return (v * Math.PI) / 180; }

function haversineMiles(a, b) {
  if (!a || !b) return null;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function estimateDriveMinutes(miles) {
  if (!miles || miles <= 0) return 0;
  const mph = miles < 3 ? 18 : miles < 8 ? 24 : miles < 20 ? 34 : 46;
  return Math.max(3, Math.round((miles / mph) * 60 + 2));
}

function formatMiles(miles) {
  if (miles === null || miles === undefined) return "";
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

function getGoogleMapsDirectionsUrl(settings) {
  const destCoords = settings?.mainGymCoords;
  if (destCoords?.lat && destCoords?.lng) {
    return `${GOOGLE_MAPS_URL_BASE}&destination=${encodeURIComponent(`${destCoords.lat},${destCoords.lng}`)}&travelmode=driving`;
  }
  if (settings?.mainGymAddress) {
    return `${GOOGLE_MAPS_URL_BASE}&destination=${encodeURIComponent(settings.mainGymAddress)}&travelmode=driving`;
  }
  return "";
}

function normalizeSpotifyEmbed(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (!u.hostname.includes("spotify.com")) return "";
    if (u.hostname.startsWith("open.") || u.hostname.startsWith("play.")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const type = parts[0] === "embed" ? parts[1] : parts[0];
      const id = parts[0] === "embed" ? parts[2] : parts[1];
      if (!type || !id) return "";
      return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
    }
    return "";
  } catch {
    return "";
  }
}

function normalizeAppleMusicEmbed(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (!u.hostname.includes("music.apple.com") && !u.hostname.includes("embed.music.apple.com")) return "";
    const host = u.hostname.startsWith("embed.") ? u.hostname : `embed.${u.hostname}`;
    return `${u.protocol}//${host}${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}

// ── Food Database (multi-cuisine, per 1 serving) ──
const FOOD_DB = [
  // ── American / Western ──
  { name: "Grilled Chicken Breast (6oz)", cal: 280, p: 53, c: 0, f: 6, cat: "American" },
  { name: "Scrambled Eggs (3 large)", cal: 300, p: 21, c: 3, f: 23, cat: "American" },
  { name: "Oatmeal with Banana", cal: 310, p: 8, c: 58, f: 6, cat: "American" },
  { name: "Grilled Salmon Fillet (6oz)", cal: 350, p: 39, c: 0, f: 20, cat: "American" },
  { name: "Turkey Sandwich on Wheat", cal: 380, p: 28, c: 36, f: 12, cat: "American" },
  { name: "Steak (8oz Sirloin)", cal: 480, p: 62, c: 0, f: 24, cat: "American" },
  { name: "Protein Shake (whey + milk)", cal: 280, p: 40, c: 20, f: 5, cat: "American" },
  { name: "Greek Yogurt with Berries", cal: 180, p: 18, c: 20, f: 3, cat: "American" },
  { name: "Avocado Toast (2 slices)", cal: 340, p: 10, c: 32, f: 20, cat: "American" },
  { name: "Peanut Butter & Jelly Sandwich", cal: 390, p: 14, c: 48, f: 18, cat: "American" },
  { name: "Caesar Salad with Chicken", cal: 360, p: 32, c: 14, f: 20, cat: "American" },
  { name: "Cheeseburger", cal: 550, p: 30, c: 36, f: 32, cat: "American" },
  { name: "Protein Bar", cal: 220, p: 20, c: 24, f: 8, cat: "American" },
  { name: "Cottage Cheese (1 cup)", cal: 220, p: 28, c: 8, f: 10, cat: "American" },
  { name: "Tuna Salad", cal: 290, p: 30, c: 8, f: 16, cat: "American" },
  { name: "Rice & Chicken Bowl", cal: 450, p: 40, c: 50, f: 8, cat: "American" },
  { name: "Overnight Oats with Protein", cal: 380, p: 28, c: 48, f: 10, cat: "American" },
  // ── Indian ──
  { name: "Chicken Tikka Masala + Rice", cal: 550, p: 32, c: 52, f: 22, cat: "Indian" },
  { name: "Dal Tadka (Lentil Curry)", cal: 220, p: 14, c: 32, f: 5, cat: "Indian" },
  { name: "Paneer Butter Masala + Naan", cal: 620, p: 22, c: 54, f: 36, cat: "Indian" },
  { name: "Tandoori Chicken (2 pieces)", cal: 320, p: 42, c: 4, f: 14, cat: "Indian" },
  { name: "Chole (Chickpea Curry)", cal: 280, p: 12, c: 40, f: 8, cat: "Indian" },
  { name: "Roti / Chapati (2 pieces)", cal: 200, p: 6, c: 36, f: 4, cat: "Indian" },
  { name: "Biryani (Chicken)", cal: 500, p: 28, c: 60, f: 16, cat: "Indian" },
  { name: "Rajma (Kidney Bean Curry)", cal: 260, p: 14, c: 38, f: 6, cat: "Indian" },
  { name: "Palak Paneer", cal: 340, p: 18, c: 12, f: 26, cat: "Indian" },
  { name: "Masala Dosa + Chutney", cal: 380, p: 8, c: 52, f: 16, cat: "Indian" },
  { name: "Aloo Gobi (Potato Cauliflower)", cal: 200, p: 5, c: 28, f: 8, cat: "Indian" },
  { name: "Egg Bhurji (Indian Scrambled)", cal: 250, p: 16, c: 6, f: 18, cat: "Indian" },
  { name: "Samosa (2 pieces)", cal: 320, p: 6, c: 36, f: 18, cat: "Indian" },
  { name: "Lassi (Sweet Yogurt Drink)", cal: 180, p: 8, c: 28, f: 4, cat: "Indian" },
  { name: "Idli + Sambar (4 pieces)", cal: 280, p: 10, c: 48, f: 4, cat: "Indian" },
  { name: "Butter Chicken + Rice", cal: 580, p: 34, c: 50, f: 26, cat: "Indian" },
  { name: "Upma (Semolina Porridge)", cal: 220, p: 6, c: 34, f: 8, cat: "Indian" },
  // ── Italian ──
  { name: "Spaghetti Bolognese", cal: 520, p: 28, c: 58, f: 18, cat: "Italian" },
  { name: "Margherita Pizza (2 slices)", cal: 440, p: 18, c: 48, f: 18, cat: "Italian" },
  { name: "Chicken Parmigiana", cal: 560, p: 42, c: 30, f: 30, cat: "Italian" },
  { name: "Penne Alfredo", cal: 580, p: 18, c: 54, f: 32, cat: "Italian" },
  { name: "Caprese Salad", cal: 220, p: 14, c: 6, f: 16, cat: "Italian" },
  { name: "Risotto (Mushroom)", cal: 420, p: 10, c: 56, f: 16, cat: "Italian" },
  { name: "Bruschetta (3 pieces)", cal: 240, p: 6, c: 28, f: 12, cat: "Italian" },
  { name: "Lasagna (1 serving)", cal: 550, p: 30, c: 40, f: 28, cat: "Italian" },
  { name: "Minestrone Soup", cal: 180, p: 8, c: 28, f: 4, cat: "Italian" },
  { name: "Prosciutto & Mozzarella", cal: 320, p: 24, c: 2, f: 24, cat: "Italian" },
  { name: "Gnocchi with Pesto", cal: 460, p: 12, c: 52, f: 22, cat: "Italian" },
  { name: "Tiramisu (1 slice)", cal: 380, p: 6, c: 42, f: 22, cat: "Italian" },
  // ── Mexican ──
  { name: "Chicken Burrito Bowl", cal: 520, p: 38, c: 52, f: 16, cat: "Mexican" },
  { name: "Steak Tacos (3)", cal: 480, p: 32, c: 36, f: 22, cat: "Mexican" },
  { name: "Chicken Quesadilla", cal: 460, p: 28, c: 32, f: 24, cat: "Mexican" },
  { name: "Guacamole + Chips", cal: 360, p: 5, c: 32, f: 24, cat: "Mexican" },
  { name: "Black Bean Burrito", cal: 420, p: 18, c: 56, f: 14, cat: "Mexican" },
  { name: "Enchiladas (Chicken, 2)", cal: 480, p: 28, c: 36, f: 24, cat: "Mexican" },
  { name: "Mexican Rice & Beans", cal: 340, p: 12, c: 56, f: 6, cat: "Mexican" },
  { name: "Carnitas Bowl", cal: 540, p: 34, c: 48, f: 22, cat: "Mexican" },
  // ── Japanese / Asian ──
  { name: "Chicken Teriyaki + Rice", cal: 480, p: 32, c: 56, f: 10, cat: "Japanese" },
  { name: "Salmon Sushi Roll (8 pcs)", cal: 340, p: 18, c: 42, f: 10, cat: "Japanese" },
  { name: "Ramen (Tonkotsu)", cal: 580, p: 28, c: 60, f: 24, cat: "Japanese" },
  { name: "Edamame (1 cup)", cal: 190, p: 18, c: 14, f: 8, cat: "Japanese" },
  { name: "Miso Soup", cal: 60, p: 4, c: 6, f: 2, cat: "Japanese" },
  { name: "Tofu Stir-Fry + Rice", cal: 420, p: 22, c: 52, f: 14, cat: "Japanese" },
  { name: "Pad Thai (Chicken)", cal: 500, p: 24, c: 56, f: 20, cat: "Asian" },
  { name: "Fried Rice (Chicken)", cal: 460, p: 22, c: 54, f: 16, cat: "Asian" },
  { name: "Spring Rolls (4 pcs)", cal: 280, p: 8, c: 32, f: 14, cat: "Asian" },
  { name: "Pho (Beef Noodle Soup)", cal: 420, p: 28, c: 48, f: 10, cat: "Asian" },
  // ── Mediterranean / Middle Eastern ──
  { name: "Chicken Shawarma Wrap", cal: 480, p: 32, c: 38, f: 22, cat: "Mediterranean" },
  { name: "Falafel Plate (4 pcs)", cal: 440, p: 16, c: 48, f: 20, cat: "Mediterranean" },
  { name: "Hummus + Pita (1 cup)", cal: 340, p: 12, c: 38, f: 16, cat: "Mediterranean" },
  { name: "Greek Salad", cal: 260, p: 8, c: 12, f: 20, cat: "Mediterranean" },
  { name: "Grilled Lamb Kebab (2)", cal: 380, p: 36, c: 4, f: 24, cat: "Mediterranean" },
  // ── Snacks / Quick ──
  { name: "Banana", cal: 105, p: 1, c: 27, f: 0, cat: "Snack" },
  { name: "Apple", cal: 95, p: 0, c: 25, f: 0, cat: "Snack" },
  { name: "Almonds (1/4 cup)", cal: 210, p: 8, c: 7, f: 18, cat: "Snack" },
  { name: "Rice Cakes (2) + PB", cal: 200, p: 6, c: 22, f: 10, cat: "Snack" },
  { name: "Trail Mix (1/3 cup)", cal: 260, p: 8, c: 24, f: 16, cat: "Snack" },
  { name: "Boiled Eggs (2)", cal: 140, p: 12, c: 1, f: 10, cat: "Snack" },
  { name: "String Cheese (2 sticks)", cal: 160, p: 14, c: 2, f: 10, cat: "Snack" },
  { name: "Protein Smoothie (berries)", cal: 320, p: 30, c: 36, f: 6, cat: "Snack" },
  { name: "Dark Chocolate (1oz)", cal: 170, p: 2, c: 13, f: 12, cat: "Snack" },
];

const FOOD_CATEGORIES = ["All", "American", "Indian", "Italian", "Mexican", "Japanese", "Asian", "Mediterranean", "Snack"];

// ── Haptic Feedback (native feel) ──
const haptic = {
  light: () => { try { navigator.vibrate?.(10); } catch {} },
  medium: () => { try { navigator.vibrate?.(25); } catch {} },
  heavy: () => { try { navigator.vibrate?.([30, 20, 30]); } catch {} },
  success: () => { try { navigator.vibrate?.([15, 50, 15]); } catch {} },
  error: () => { try { navigator.vibrate?.([50, 30, 50, 30, 50]); } catch {} },
};

// ── Exercise Database (movement patterns, muscles, equipment, substitutions) ──
const EXERCISE_DB = {
  "Bench Press": { pattern: "horizontal push", primary: ["Chest"], secondary: ["Shoulders", "Arms"], equipment: "barbell", compound: true, subs: ["Dumbbell Bench Press", "Push-ups", "Machine Chest Press"] },
  "Incline Bench Press": { pattern: "incline push", primary: ["Chest"], secondary: ["Shoulders", "Arms"], equipment: "barbell", compound: true, subs: ["Incline Dumbbell Press", "Incline Machine Press"] },
  "Incline Dumbbell Press": { pattern: "incline push", primary: ["Chest"], secondary: ["Shoulders", "Arms"], equipment: "dumbbell", compound: true, subs: ["Incline Bench Press", "Incline Machine Press"] },
  "Dumbbell Bench Press": { pattern: "horizontal push", primary: ["Chest"], secondary: ["Shoulders", "Arms"], equipment: "dumbbell", compound: true, subs: ["Bench Press", "Machine Chest Press"] },
  "Overhead Press": { pattern: "vertical push", primary: ["Shoulders"], secondary: ["Arms", "Core"], equipment: "barbell", compound: true, subs: ["Dumbbell Shoulder Press", "Machine Shoulder Press", "Arnold Press"] },
  "Dumbbell Shoulder Press": { pattern: "vertical push", primary: ["Shoulders"], secondary: ["Arms"], equipment: "dumbbell", compound: true, subs: ["Overhead Press", "Machine Shoulder Press"] },
  "Squats": { pattern: "squat", primary: ["Legs"], secondary: ["Core", "Back"], equipment: "barbell", compound: true, subs: ["Leg Press", "Goblet Squat", "Hack Squat"] },
  "Front Squats": { pattern: "squat", primary: ["Legs"], secondary: ["Core"], equipment: "barbell", compound: true, subs: ["Goblet Squat", "Leg Press"] },
  "Deadlifts": { pattern: "hip hinge", primary: ["Back", "Legs"], secondary: ["Core", "Arms"], equipment: "barbell", compound: true, subs: ["Romanian Deadlifts", "Trap Bar Deadlift", "Rack Pulls"] },
  "Romanian Deadlifts": { pattern: "hip hinge", primary: ["Legs"], secondary: ["Back", "Core"], equipment: "barbell", compound: true, subs: ["Stiff-Leg Deadlifts", "Good Mornings", "Leg Curls"] },
  "Barbell Rows": { pattern: "horizontal pull", primary: ["Back"], secondary: ["Arms", "Core"], equipment: "barbell", compound: true, subs: ["Dumbbell Rows", "Cable Rows", "T-Bar Rows"] },
  "Dumbbell Rows": { pattern: "horizontal pull", primary: ["Back"], secondary: ["Arms"], equipment: "dumbbell", compound: true, subs: ["Barbell Rows", "Cable Rows"] },
  "Pull-ups": { pattern: "vertical pull", primary: ["Back"], secondary: ["Arms"], equipment: "bodyweight", compound: true, subs: ["Lat Pulldowns", "Chin-ups", "Assisted Pull-ups"] },
  "Lat Pulldowns": { pattern: "vertical pull", primary: ["Back"], secondary: ["Arms"], equipment: "cable", compound: true, subs: ["Pull-ups", "Chin-ups"] },
  "Leg Press": { pattern: "squat", primary: ["Legs"], secondary: [], equipment: "machine", compound: true, subs: ["Squats", "Hack Squat"] },
  "Leg Curls": { pattern: "knee flexion", primary: ["Legs"], secondary: [], equipment: "machine", compound: false, subs: ["Romanian Deadlifts", "Nordic Curls"] },
  "Leg Extensions": { pattern: "knee extension", primary: ["Legs"], secondary: [], equipment: "machine", compound: false, subs: ["Sissy Squats", "Bulgarian Split Squats"] },
  "Calf Raises": { pattern: "ankle extension", primary: ["Legs"], secondary: [], equipment: "machine", compound: false, subs: ["Seated Calf Raises", "Donkey Calf Raises"] },
  "Lateral Raises": { pattern: "shoulder abduction", primary: ["Shoulders"], secondary: [], equipment: "dumbbell", compound: false, subs: ["Cable Lateral Raises", "Machine Lateral Raises"] },
  "Face Pulls": { pattern: "horizontal pull", primary: ["Shoulders"], secondary: ["Back"], equipment: "cable", compound: false, subs: ["Reverse Flyes", "Band Pull-aparts"] },
  "Tricep Pushdowns": { pattern: "elbow extension", primary: ["Arms"], secondary: [], equipment: "cable", compound: false, subs: ["Overhead Tricep Extension", "Skull Crushers", "Dips"] },
  "Barbell Curls": { pattern: "elbow flexion", primary: ["Arms"], secondary: [], equipment: "barbell", compound: false, subs: ["Dumbbell Curls", "Cable Curls", "EZ Bar Curls"] },
  "Hammer Curls": { pattern: "elbow flexion", primary: ["Arms"], secondary: [], equipment: "dumbbell", compound: false, subs: ["Reverse Curls", "Cross-body Curls"] },
  "Cable Rows": { pattern: "horizontal pull", primary: ["Back"], secondary: ["Arms"], equipment: "cable", compound: true, subs: ["Barbell Rows", "Dumbbell Rows"] },
  "Dips": { pattern: "vertical push", primary: ["Chest", "Arms"], secondary: ["Shoulders"], equipment: "bodyweight", compound: true, subs: ["Tricep Pushdowns", "Close-grip Bench Press"] },
  "Hip Thrusts": { pattern: "hip extension", primary: ["Legs"], secondary: ["Core"], equipment: "barbell", compound: true, subs: ["Glute Bridges", "Cable Pull-throughs"] },
};

function getExerciseInfo(name) {
  if (EXERCISE_DB[name]) return EXERCISE_DB[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(EXERCISE_DB)) {
    if (k.toLowerCase() === lower) return v;
  }
  return { pattern: "unknown", primary: [], secondary: [], equipment: "unknown", compound: lower.includes("press") || lower.includes("squat") || lower.includes("dead") || lower.includes("row") || lower.includes("pull"), subs: [] };
}

function getSmartRestTime(exerciseName, rpe, baseRestTime) {
  const info = getExerciseInfo(exerciseName);
  if (info.compound) {
    if (rpe >= 9) return Math.max(baseRestTime, 180);
    if (rpe >= 7) return Math.max(baseRestTime, 120);
    return Math.max(baseRestTime, 90);
  } else {
    if (rpe >= 9) return Math.min(baseRestTime, 120);
    if (rpe >= 7) return Math.min(baseRestTime, 90);
    return Math.min(baseRestTime, 60);
  }
}

function generateWarmupSets(workingWeight, reps) {
  if (!workingWeight || workingWeight <= 45) return [];
  const sets = [];
  const barWeight = 45;
  sets.push({ weight: barWeight, reps: Math.min(12, parseInt(reps) + 4), label: "Bar only" });
  const pcts = [0.4, 0.6, 0.8];
  for (const pct of pcts) {
    const w = Math.round(workingWeight * pct / 5) * 5;
    if (w > barWeight && w < workingWeight) {
      const r = pct <= 0.5 ? 8 : pct <= 0.7 ? 5 : 3;
      sets.push({ weight: w, reps: r, label: `${Math.round(pct * 100)}%` });
    }
  }
  return sets;
}

// ── Utilities ──
function beep() {
  haptic.heavy();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 830; o.type = "sine";
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.5);
    setTimeout(() => {
      try {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.connect(g2); g2.connect(ctx.destination);
        o2.frequency.value = 1046; o2.type = "sine";
        g2.gain.setValueAtTime(0.3, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        o2.start(ctx.currentTime); o2.stop(ctx.currentTime + 0.5);
      } catch {}
    }, 200);
  } catch {}
}

function calcPlates(totalWeight, barWeight = 45) {
  const plates = [45, 35, 25, 10, 5, 2.5];
  let perSide = (totalWeight - barWeight) / 2;
  if (perSide <= 0) return [];
  const result = [];
  for (const p of plates) { while (perSide >= p) { result.push(p); perSide -= p; } }
  return result;
}

function useWakeLock(active) {
  const lock = useRef(null);
  useEffect(() => {
    if (active && navigator.wakeLock) {
      navigator.wakeLock.request("screen").then(l => { lock.current = l; }).catch(() => {});
    }
    return () => { if (lock.current) { lock.current.release(); lock.current = null; } };
  }, [active]);
}

function fmtTime(s) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }

function est1RM(weight, reps) {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const CLICKABLE_WORDS = {
  volume: "Volume means how much total work you do, usually counted as hard sets per muscle per week.",
  recovery: "Recovery is the time your muscles and joints need before you hit the same area hard again.",
  overlap: "Overlap means two exercises train almost the same pattern, so one may be redundant.",
  balance: "Balance means your split covers push, pull, legs, and enough rest across the full week.",
  split: "A split is how your training week is organized, like upper/lower, push-pull-legs, or full body.",
  premium: "Premium unlocks advanced tools like AI nutrition, water and weight tracking, and device sync after the free trial.",
};

function ClickableWord({ term }) {
  const [open, setOpen] = useState(false);
  const text = CLICKABLE_WORDS[term] || term;
  return (
    <span className="inline-term-wrap">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-term-button ${open ? "inline-term-button-open" : ""}`}
      >
        {term}
      </button>
      {open && (
        <div className="inline-term-popover">
          {text}
        </div>
      )}
    </span>
  );
}

function pressableProps(onPress) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPress();
      }
    },
  };
}

function BeginnerGuideCard({ image, title, text, bullets = [], actionLabel, onAction, secondaryLabel, onSecondary }) {
  return (
    <div className="card beginner-guide">
      {image && <img src={image} alt="" className="guide-img" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 13, color: "#A3A3A3", lineHeight: 1.55, marginBottom: bullets.length ? 10 : 12 }}>{text}</p>
        {bullets.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {bullets.map((bullet, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "#22C55E", fontSize: 12, fontWeight: 900, marginTop: 2 }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.5 }}>{bullet}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actionLabel && <button className="btn-accent" type="button" onClick={onAction} style={{ width: "auto", minWidth: 140 }}>{actionLabel}</button>}
          {secondaryLabel && <button className="btn-ghost" type="button" onClick={onSecondary} style={{ width: "auto", minWidth: 120 }}>{secondaryLabel}</button>}
        </div>
      </div>
    </div>
  );
}

function analyzeCoachSuggestions(splits) {
  if (!splits?.length) {
    return [{
      id: "start-split",
      title: "Start with a simple split",
      plain: "You do not have a plan yet. Start with 3 or 4 training days so the coach can balance your week for you.",
      terms: ["split", "balance"],
      prompt: "Create me a simple 4 day split with balanced push, pull, legs, and recovery.",
    }];
  }

  const suggestions = [];
  const trainingDays = splits.filter(day => day.type !== "rest" && day.exercises?.length);
  const weeklySets = {};

  trainingDays.forEach((day, dayIndex) => {
    const byName = {};
    const byPattern = {};
    const byMuscle = {};
    let compoundCount = 0;
    let isolationCount = 0;

    day.exercises.forEach((ex, exIdx) => {
      const info = getExerciseInfo(ex.name);
      const key = ex.name.trim().toLowerCase();
      byName[key] = byName[key] || { count: 0, indices: [], exercise: ex };
      byName[key].count += 1;
      byName[key].indices.push(exIdx);

      byPattern[info.pattern] = (byPattern[info.pattern] || 0) + 1;
      const primary = info.primary?.[0] || ex.muscle || "Other";
      byMuscle[primary] = (byMuscle[primary] || 0) + (Number(ex.sets) || 0);
      weeklySets[primary] = (weeklySets[primary] || 0) + (Number(ex.sets) || 0);

      if (info.compound) compoundCount += 1;
      else isolationCount += 1;
    });

    Object.values(byName).forEach(entry => {
      if (entry.count > 1) {
        suggestions.push({
          id: `combine-${dayIndex}-${entry.exercise.name}`,
          title: "Combine duplicate exercises",
          plain: `${day.name} has ${entry.exercise.name} more than once. Keep one line and add the sets together so the workout is easier to follow.`,
          terms: ["overlap", "volume"],
          action: { type: "combine-duplicate", dayIndex, exerciseName: entry.exercise.name },
          prompt: `Explain in plain language why I should combine duplicate ${entry.exercise.name} entries on ${day.name}.`,
        });
      }
    });

    const overloadedMuscle = Object.entries(byMuscle).sort((a, b) => b[1] - a[1])[0];
    if (overloadedMuscle && overloadedMuscle[1] >= 16) {
      suggestions.push({
        id: `overload-${dayIndex}-${overloadedMuscle[0]}`,
        title: "This day may be too crowded",
        plain: `${day.name} puts ${overloadedMuscle[1]} sets on ${overloadedMuscle[0]}. Spread part of that work to another day so performance stays higher.`,
        terms: ["volume", "recovery"],
        prompt: `Rewrite ${day.name} so ${overloadedMuscle[0]} is not overloaded in one session.`,
      });
    }

    const repeatedPattern = Object.entries(byPattern).find(([, count]) => count >= 3 && count !== undefined);
    if (repeatedPattern && repeatedPattern[0] !== "unknown") {
      suggestions.push({
        id: `pattern-${dayIndex}-${repeatedPattern[0]}`,
        title: "Too many similar movement angles",
        plain: `${day.name} repeats the ${repeatedPattern[0]} pattern a lot. Swap one exercise so the day trains more than one angle and feels less repetitive.`,
        terms: ["overlap", "balance"],
        prompt: `Suggest one better replacement for a repeated ${repeatedPattern[0]} exercise on ${day.name}.`,
      });
    }

    if (isolationCount >= 4 && compoundCount <= 1) {
      suggestions.push({
        id: `compound-${dayIndex}`,
        title: "This day needs a stronger base lift",
        plain: `${day.name} leans heavily on smaller isolation work. Start with 1 or 2 compound lifts so the session is more efficient.`,
        terms: ["balance", "volume"],
        prompt: `Improve ${day.name} by adding better compound exercises first and keeping it simple.`,
      });
    }
  });

  if (!splits.some(day => day.type === "rest")) {
    suggestions.push({
      id: "add-rest",
      title: "Add one recovery day",
      plain: "Your week has no true rest day. Add one recovery day so strength, joints, and energy stay more consistent.",
      terms: ["recovery", "split"],
      prompt: "Show me the best place to add a rest day in my current split.",
    });
  }

  [["Chest", 8], ["Back", 8], ["Legs", 8]].forEach(([muscle, minSets]) => {
    if ((weeklySets[muscle] || 0) < minSets) {
      suggestions.push({
        id: `under-${muscle}`,
        title: `${muscle} looks undertrained`,
        plain: `You only have ${(weeklySets[muscle] || 0)} weekly sets for ${muscle}. Add a little more work so the split feels more balanced.`,
        terms: ["volume", "balance"],
        prompt: `Add enough ${muscle.toLowerCase()} work to my split without making it too long.`,
      });
    }
  });

  return suggestions.slice(0, 5);
}

// ── Countdown Hook (drift-free, adjustable) ──
function useCountdown(totalSeconds) {
  const [left, setLeft] = useState(totalSeconds);
  const endTimeRef = useRef(Date.now() + totalSeconds * 1000);
  const adjust = useCallback((delta) => {
    endTimeRef.current = Math.max(Date.now(), endTimeRef.current + delta * 1000);
    const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
    setLeft(remaining);
  }, []);
  useEffect(() => {
    endTimeRef.current = Date.now() + totalSeconds * 1000;
    setLeft(totalSeconds);
    const iv = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
      setLeft(remaining);
    }, 250);
    return () => clearInterval(iv);
  }, [totalSeconds]);
  return [left, adjust];
}

// ── Generate sample data for testing ──
function generateSampleData() {
  const exercises = {
    "Push Day": [
      { name: "Bench Press", muscle: "Chest", sets: 4, reps: "8" },
      { name: "Overhead Press", muscle: "Shoulders", sets: 3, reps: "10" },
      { name: "Incline Dumbbell Press", muscle: "Chest", sets: 3, reps: "10" },
      { name: "Lateral Raises", muscle: "Shoulders", sets: 3, reps: "15" },
      { name: "Tricep Pushdowns", muscle: "Arms", sets: 3, reps: "12" },
    ],
    "Pull Day": [
      { name: "Barbell Rows", muscle: "Back", sets: 4, reps: "8" },
      { name: "Pull-ups", muscle: "Back", sets: 3, reps: "8" },
      { name: "Face Pulls", muscle: "Shoulders", sets: 3, reps: "15" },
      { name: "Barbell Curls", muscle: "Arms", sets: 3, reps: "10" },
      { name: "Hammer Curls", muscle: "Arms", sets: 3, reps: "12" },
    ],
    "Leg Day": [
      { name: "Squats", muscle: "Legs", sets: 4, reps: "8" },
      { name: "Romanian Deadlifts", muscle: "Legs", sets: 3, reps: "10" },
      { name: "Leg Press", muscle: "Legs", sets: 3, reps: "12" },
      { name: "Leg Curls", muscle: "Legs", sets: 3, reps: "12" },
      { name: "Calf Raises", muscle: "Legs", sets: 4, reps: "15" },
    ],
  };

  const splits = [
    { day: 1, name: "Push Day", type: "push", exercises: exercises["Push Day"] },
    { day: 2, name: "Pull Day", type: "pull", exercises: exercises["Pull Day"] },
    { day: 3, name: "Leg Day", type: "legs", exercises: exercises["Leg Day"] },
    { day: 4, name: "Push Day", type: "push", exercises: exercises["Push Day"] },
    { day: 5, name: "Pull Day", type: "pull", exercises: exercises["Pull Day"] },
    { day: 6, name: "Leg Day", type: "legs", exercises: exercises["Leg Day"] },
    { day: 7, name: "Rest", type: "rest", exercises: [] },
  ];

  const logs = [];
  const now = Date.now();
  const baseWeights = { "Bench Press": 135, "Overhead Press": 85, "Incline Dumbbell Press": 50, "Lateral Raises": 15, "Tricep Pushdowns": 40, "Barbell Rows": 135, "Pull-ups": 0, "Face Pulls": 30, "Barbell Curls": 65, "Hammer Curls": 30, "Squats": 185, "Romanian Deadlifts": 155, "Leg Press": 270, "Leg Curls": 80, "Calf Raises": 135 };

  const dayNames = ["Push Day", "Pull Day", "Leg Day"];
  for (let week = 5; week >= 0; week--) {
    for (let d = 0; d < 3; d++) {
      const dayName = dayNames[d];
      const dayType = ["push", "pull", "legs"][d];
      const dateOffset = week * 7 + (d * 2);
      const date = new Date(now - dateOffset * 864e5);
      const progression = (5 - week) * 5;

      logs.push({
        date: date.toISOString(),
        dayName,
        dayType,
        duration: 2400 + Math.floor(Math.random() * 1200),
        notes: [],
        exercises: exercises[dayName].map(ex => ({
          name: ex.name,
          muscle: ex.muscle,
          sets: ex.sets,
          reps: ex.reps,
          logged: Array.from({ length: ex.sets }, (_, si) => ({
            weight: (baseWeights[ex.name] || 50) + progression - (si * 5),
            reps: parseInt(ex.reps) + (si === 0 ? 1 : 0) - (si === ex.sets - 1 ? 1 : 0),
          })),
        })),
      });
    }
  }

  return {
    splits,
    logs,
    chat: [],
    settings: { ...DEFAULT_SETTINGS },
    premium: false,
    premiumPlan: null,
    nutrition: { profile: null, foodLog: [], waterLog: [] },
    bodyWeight: [],
    connectedDevices: [],
    devicesTrialStart: null,
  };
}

// ── Toast ──
function Toast({ message, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const tone = type === "pr"
    ? { bg: "#854D0E", fg: "#FDE047", icon: "🏆", label: "PR" }
    : type === "error"
      ? { bg: "#7F1D1D", fg: "#FCA5A5", icon: "!", label: "Issue" }
      : { bg: "#14532D", fg: "#86EFAC", icon: "✓", label: "Saved" };
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: isMobile ? "calc(env(safe-area-inset-bottom,0px) + 86px)" : 24,
        top: isMobile ? "auto" : 24,
        width: isMobile ? "calc(100% - 24px)" : "min(420px, calc(100vw - 48px))",
        maxWidth: 420,
        padding: "12px 14px",
        borderRadius: 16,
        fontSize: 13,
        fontWeight: 600,
        zIndex: 9999,
        background: tone.bg,
        color: tone.fg,
        animation: "fadeUp .22s ease",
        boxShadow: "0 18px 36px rgba(0,0,0,.34)",
        border: "1px solid rgba(255,255,255,.08)",
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 999, background: "rgba(0,0,0,.16)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: tone.icon === "✓" ? 13 : 12, fontWeight: 800, flexShrink: 0
        }}>
          {tone.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", opacity: .85, marginBottom: 3 }}>
            {tone.label}
          </div>
          <div style={{ lineHeight: 1.45, color: "#F5F5F5" }}>{message}</div>
        </div>
      </div>
    </div>
  );
}

// ── AUTH ──
function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [verifyStep, setVerifyStep] = useState(false);
  const [sentCode, setSentCode] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [sending, setSending] = useState(false);
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const usingBackendAuth = !!RELEASE_PROTECTION.authApiBase;
  const authLocked = IS_PRODUCTION_BUILD && !RELEASE_PROTECTION.authApiBase && !RELEASE_PROTECTION.allowDemoOtp;
  const isSignupVerify = verifyStep && mode === "signup";

  const go = async (e) => {
    e.preventDefault(); setErr("");
    if (authLocked) return setErr("Secure auth backend is required for this production build.");
    if (!email.trim() || !pass.trim()) return setErr("Fill in all fields");
    if (!validEmail(email)) return setErr("Enter a valid email");
    if (mode === "signup") {
      const passwordError = getPasswordRequirementError(pass);
      if (passwordError) return setErr(passwordError);
    }
    const users = store.getUsers();
    if (mode === "login") {
      if (usingBackendAuth) {
        setSending(true);
        try {
          const nextEmail = email.toLowerCase();
          const result = await loginProtected(nextEmail, pass);
          if (result?.sessionToken) authSession.set(result.sessionToken);
          const nextUsers = store.getUsers();
          if (!nextUsers.find(x => x.e === nextEmail)) {
            nextUsers.push({ e: nextEmail, verified: true, remote: true });
            store.setUsers(nextUsers);
          }
          if (!store.getData(nextEmail)) {
            store.setData(nextEmail, JSON.parse(JSON.stringify(EMPTY)));
          }
          onLogin(nextEmail);
        } catch (error) {
          setErr(error.message || "Could not sign in.");
        } finally {
          setSending(false);
        }
        return;
      }
      const user = users.find(x => x.e === email.toLowerCase());
      if (!user) return setErr("No account found");
      if (user.ph !== cipher.hash(pass) && user.p !== pass) return setErr("Wrong password");
      if (user.ph && user.p) {
        const idx = users.findIndex(x => x.e === email.toLowerCase());
        if (idx >= 0) {
          users[idx] = { ...users[idx], verified: true };
          delete users[idx].p;
          store.setUsers(users);
        }
      }
      onLogin(email.toLowerCase());
    } else {
      if (usingBackendAuth) {
        setSending(true);
        try {
          const otp = await requestProtectedOtp(email.toLowerCase(), "signup", pass);
          setSentCode(otp.demoCode || "");
          if (otp.demoCode) console.log(`[${APP_BRAND}] Verification code for ${email}: ${otp.demoCode}`);
          setVerifyStep(true);
        } catch (error) {
          setErr(error.message || "Could not send verification code.");
        } finally {
          setSending(false);
        }
        return;
      }
      if (users.find(x => x.e === email.toLowerCase())) return setErr("Account exists already");
      setSending(true);
      try {
        const otp = await requestProtectedOtp(email.toLowerCase(), "signup", pass);
        setSentCode(otp.demoCode || "");
        if (otp.demoCode) console.log(`[${APP_BRAND}] Verification code for ${email}: ${otp.demoCode}`);
        setVerifyStep(true);
      } catch (error) {
        setErr(error.message || "Could not send verification code.");
      } finally {
        setSending(false);
      }
    }
  };

  const verifyOTP = async () => {
    setErr("");
    try {
      const result = await verifyProtectedOtp(email.toLowerCase(), otpInput, "signup", sentCode);
      if (usingBackendAuth) {
        if (result?.sessionToken) authSession.set(result.sessionToken);
        const users = store.getUsers();
        if (!users.find(x => x.e === email.toLowerCase())) {
          users.push({ e: email.toLowerCase(), verified: true, remote: true });
          store.setUsers(users);
        }
        if (!store.getData(email.toLowerCase())) {
          store.setData(email.toLowerCase(), JSON.parse(JSON.stringify(EMPTY)));
        }
        onLogin(email.toLowerCase());
        return;
      }
      const users = store.getUsers();
      if (mode === "signup") {
        users.push({ e: email.toLowerCase(), ph: cipher.hash(pass), verified: true });
        store.setUsers(users);
        store.setData(email.toLowerCase(), JSON.parse(JSON.stringify(EMPTY)));
      } else {
        const idx = users.findIndex(x => x.e === email.toLowerCase());
        if (idx >= 0 && users[idx].p && !users[idx].ph) {
          users[idx].ph = cipher.hash(users[idx].p);
          delete users[idx].p;
          users[idx].verified = true;
          store.setUsers(users);
        }
      }
      onLogin(email.toLowerCase());
    } catch (error) {
      setErr(error.message || "Verification failed.");
    }
  };

  const resendCode = async () => {
    setSending(true);
    try {
      const otp = await requestProtectedOtp(email.toLowerCase(), "signup", pass);
      setSentCode(otp.demoCode || "");
      if (otp.demoCode) console.log(`[${APP_BRAND}] New verification code for ${email}: ${otp.demoCode}`);
      setErr("");
    } catch (error) {
      setErr(error.message || "Could not resend code.");
    } finally {
      setSending(false);
    }
  };

  if (isSignupVerify) {
    return (
      <div className="auth-page">
        <div className="auth-box">
          <div className="auth-logo" style={{ background: "linear-gradient(135deg,#3B82F6,#6366F1)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>
          </div>
          <h1 className="auth-h1">Verify Email</h1>
          <p className="auth-p" style={{ marginBottom: 6 }}>We sent a 6-digit code to</p>
          <p style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: "#22C55E", marginBottom: 16 }}>{email}</p>
          {err && <div className="auth-err">{err}</div>}

          {!!sentCode && RELEASE_PROTECTION.allowDemoOtp && (
            <div style={{ background: "#0A1F0A", border: "1px solid #14532D", borderRadius: 10, padding: 12, marginBottom: 14, textAlign: "center" }}>
              <p style={{ fontSize: 10, color: "#525252", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Your Code (demo)</p>
              <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: 8, color: "#22C55E", fontVariantNumeric: "tabular-nums" }}>{sentCode}</p>
              <p style={{ fontSize: 10, color: "#404040", marginTop: 4 }}>Disable demo OTP before public release</p>
            </div>
          )}

          <input className="input" type="text" inputMode="numeric" placeholder="Enter 6-digit code" value={otpInput}
            onChange={e => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{ textAlign: "center", fontSize: 22, fontWeight: 800, letterSpacing: 8 }} />
          <button className="btn-accent" type="button" onClick={verifyOTP} disabled={otpInput.length !== 6}
            style={{ opacity: otpInput.length !== 6 ? 0.5 : 1 }}>Verify & Continue</button>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>
            <button type="button" onClick={resendCode} disabled={sending}
              style={{ background: "none", border: "none", color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: sending ? "wait" : "pointer" }}>
              {sending ? "Sending..." : "Resend Code"}
            </button>
            <button type="button" onClick={() => { setVerifyStep(false); setOtpInput(""); setErr(""); }}
              style={{ background: "none", border: "none", color: "#525252", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-logo">{APP_INITIALS}</div>
        <h1 className="auth-h1">{APP_BRAND}</h1>
        <p className="auth-p">{mode === "login" ? "Sign in to continue" : "Create your account"}</p>
        {authLocked && <div className="auth-err">Protected mode is on. Configure `VITE_AUTH_API_BASE` before public release.</div>}
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={go}>
          <input className="input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <input className="input" type="password" placeholder="Password" value={pass} onChange={e => setPass(e.target.value)} />
          {mode === "signup" && (
            <p style={{ fontSize: 11, color: "#737373", margin: "-6px 2px 12px" }}>
              Use at least 8 characters with upper, lower, and a number.
            </p>
          )}
          <button className="btn-accent" type="submit" disabled={sending || authLocked}
            style={{ opacity: sending || authLocked ? 0.7 : 1 }}>
            {sending ? (mode === "login" ? "Signing in..." : "Sending code...") : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "No account? " : "Already have one? "}
          <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}
            style={{ background: "none", border: "none", color: "#22C55E", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: "inherit" }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
        {RELEASE_PROTECTION.allowSeedTestAccount && (
          <div className="auth-test">
            Test account: <strong>test@muscle.com</strong> / <strong>test123</strong>
          </div>
        )}
        <p style={{ fontSize: 10, color: "#333", textAlign: "center", marginTop: 10 }}>
          🔒 Email is verified once at signup. Future sign-ins use your password.
        </p>
      </div>
    </div>
  );
}

// ── FLOATING MINI TIMER (uses useCountdown) ──
function FloatingTimer({ seconds, onDone, onExpand }) {
  const [left] = useCountdown(seconds);
  const doneRef = useRef(false);
  useEffect(() => {
    if (left <= 0 && !doneRef.current) {
      doneRef.current = true;
      beep();
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      onDone();
    }
  }, [left, onDone]);
  const pct = ((seconds - left) / seconds) * 100;
  return (
    <div className="float-timer" {...pressableProps(onExpand)} aria-label="Open full rest timer">
      <div style={{ height: 3, background: "#262626" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: left <= 5 ? "#EF4444" : "#22C55E", transition: "width 0.2s linear" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#A3A3A3" }}>Rest</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: left <= 5 ? "#EF4444" : "#22C55E", fontVariantNumeric: "tabular-nums" }}>{fmtTime(left)}</span>
        <button type="button" onClick={e => { e.stopPropagation(); onDone(); }} style={{ background: "#262626", border: "none", color: "#A3A3A3", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Skip</button>
      </div>
    </div>
  );
}

// ── REST TIMER (full screen, uses useCountdown) ──
function RestTimer({ seconds, onDone, onCancel }) {
  const [left, adjust] = useCountdown(seconds);
  const doneRef = useRef(false);
  useEffect(() => {
    if (left <= 0 && !doneRef.current) {
      doneRef.current = true;
      beep();
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      onDone();
    }
  }, [left, onDone]);
  const pct = ((seconds - left) / seconds) * 100;
  const r = 58; const circ = 2 * Math.PI * r; const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <div className="overlay-bg" style={{ alignItems: "center" }} onClick={onCancel}>
      <div className="timer-modal" onClick={e => e.stopPropagation()}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#A3A3A3", marginBottom: 20 }}>Rest Timer</p>
        <div style={{ position: "relative", width: 160, height: 160, margin: "0 auto 24px" }}>
          <svg width="160" height="160" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={r} fill="none" stroke="#262626" strokeWidth="8" />
            <circle cx="64" cy="64" r={r} fill="none" stroke={left <= 5 ? "#EF4444" : "#22C55E"} strokeWidth="8"
              strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 64 64)"
              style={{ transition: "stroke-dashoffset 0.2s linear, stroke 0.3s" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: left <= 5 ? "#EF4444" : "#E5E5E5" }}>
              {Math.floor(left / 60)}:{(left % 60).toString().padStart(2, "0")}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn-ghost" onClick={onCancel}>Skip</button>
          <button className="btn-ghost" onClick={() => { adjust(-15); haptic.light(); }}>-15s</button>
          <button className="btn-ghost" onClick={() => { adjust(15); haptic.light(); }}>+15s</button>
        </div>
      </div>
    </div>
  );
}

// ── PLATE CALCULATOR ──
function PlateCalc({ weight, onClose }) {
  const plates = calcPlates(Number(weight) || 0);
  return (
    <div className="overlay-bg" onClick={onClose}>
      <div className="plate-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Plate Calculator</h3>
        <p style={{ fontSize: 13, color: "#737373", marginBottom: 14 }}>{weight} lbs (45lb bar)</p>
        {plates.length === 0 ? <p style={{ color: "#525252" }}>Just the bar</p> : (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#525252", marginBottom: 8 }}>EACH SIDE:</p>
            {plates.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ width: Math.max(20, p), height: 24, borderRadius: 3, background: p >= 45 ? "#3B82F6" : p >= 25 ? "#22C55E" : p >= 10 ? "#F59E0B" : "#A855F7" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p} lbs</span>
              </div>
            ))}
          </div>
        )}
        <button className="btn-ghost" onClick={onClose} style={{ marginTop: 12, width: "100%" }}>Close</button>
      </div>
    </div>
  );
}

// ── DAY EDITOR SHEET ──
function DaySheet({ day, onClose, onSave }) {
  const [d, setD] = useState(JSON.parse(JSON.stringify(day)));
  const [nex, setNex] = useState({ name: "", sets: "3", reps: "10", muscle: "" });
  const [aiL, setAiL] = useState(false);

  const add = () => {
    if (!nex.name.trim()) return;
    setD(p => ({ ...p, exercises: [...p.exercises, { ...nex, sets: Number(nex.sets) }] }));
    setNex({ name: "", sets: "3", reps: "10", muscle: "" });
  };

  const aiGen = async () => {
    setAiL(true);
    const r = await groq([{
      role: "system",
      content: "You generate gym workouts. Return ONLY a JSON array. Each element: {\"name\":string,\"sets\":number,\"reps\":string,\"muscle\":string}. 5-7 exercises. No text outside JSON."
    }, { role: "user", content: `Generate exercises for a ${d.type} day called "${d.name}".` }], 1024);
    try { const m = r.match(/\[[\s\S]*?\]/); if (m) setD(p => ({ ...p, exercises: JSON.parse(m[0]) })); } catch {}
    setAiL(false);
  };

  const moveEx = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= d.exercises.length) return;
    const exs = [...d.exercises];
    [exs[i], exs[j]] = [exs[j], exs[i]];
    setD(p => ({ ...p, exercises: exs }));
  };

  return (
    <div className="overlay-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}><div style={{ width: 32, height: 4, borderRadius: 2, background: "#333" }} /></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 12px", borderBottom: "1px solid #1E1E1E" }}>
          <input value={d.name} onChange={e => setD(p => ({ ...p, name: e.target.value }))} placeholder="Day name"
            style={{ background: "none", border: "none", color: "#E5E5E5", fontSize: 18, fontWeight: 700, outline: "none", flex: 1 }} />
          <button onClick={() => { onSave(d); onClose(); }} style={{ background: "none", border: "none", color: "#22C55E", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>

        <div style={{ padding: "12px 16px 0" }}>
          <p className="label">Type</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.keys(TYPE_COLORS).map(t => (
              <button key={t} onClick={() => setD(p => ({ ...p, type: t }))}
                style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${d.type === t ? TYPE_COLORS[t] : "#262626"}`,
                  background: d.type === t ? TYPE_COLORS[t] + "18" : "transparent",
                  color: d.type === t ? TYPE_COLORS[t] : "#737373", fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <button onClick={aiGen} disabled={aiL}
          style={{ margin: "12px 16px 0", width: "calc(100% - 32px)", padding: 11, background: "#1A1A2E", border: "1px solid #262650",
            borderRadius: 8, color: "#818CF8", fontSize: 13, fontWeight: 600, cursor: aiL ? "wait" : "pointer", opacity: aiL ? 0.5 : 1 }}>
          {aiL ? "Generating..." : "Auto-fill exercises"}
        </button>

        <div style={{ padding: 16 }}>
          <p className="label">Exercises ({d.exercises.length})</p>
          {d.exercises.length === 0 && <p style={{ color: "#404040", fontSize: 13, textAlign: "center", padding: 16 }}>No exercises yet</p>}
          {d.exercises.map((ex, i) => (
            <div key={i} className="ex-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <button className="move-btn" onClick={() => moveEx(i, -1)} disabled={i === 0}>&#9650;</button>
                <button className="move-btn" onClick={() => moveEx(i, 1)} disabled={i === d.exercises.length - 1}>&#9660;</button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{ex.name}</div>
                <div style={{ fontSize: 12, color: "#737373" }}>{ex.sets} sets / {ex.reps} reps{ex.muscle ? ` / ${ex.muscle}` : ""}</div>
              </div>
              <button onClick={() => setD(p => ({ ...p, exercises: p.exercises.filter((_, j) => j !== i) }))}
                style={{ background: "none", border: "none", color: "#525252", cursor: "pointer", fontSize: 16, padding: "2px 6px" }}>x</button>
            </div>
          ))}
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <p className="label">Add Exercise</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
            <input className="input sm" placeholder="Exercise name" value={nex.name} onChange={e => setNex(p => ({ ...p, name: e.target.value }))} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <input className="input sm" placeholder="Sets" type="number" value={nex.sets} onChange={e => setNex(p => ({ ...p, sets: e.target.value }))} />
              <input className="input sm" placeholder="Reps" value={nex.reps} onChange={e => setNex(p => ({ ...p, reps: e.target.value }))} />
              <input className="input sm" placeholder="Muscle" value={nex.muscle} onChange={e => setNex(p => ({ ...p, muscle: e.target.value }))} />
            </div>
            <button className="btn-ghost" onClick={add} style={{ width: "100%" }}>+ Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SPLIT PAGE (enhanced) ──
function SplitPage({ splits, onUpdate, onSetSplits, onNav }) {
  const [ed, setEd] = useState(null);

  const addDay = () => {
    onSetSplits([...splits, { day: splits.length + 1, name: `Day ${splits.length + 1}`, type: "custom", exercises: [] }]);
  };

  const removeDay = (i) => {
    onSetSplits(splits.filter((_, j) => j !== i).map((d, j) => ({ ...d, day: j + 1 })));
  };

  const totalExercises = splits.reduce((s, d) => s + d.exercises.length, 0);
  const totalSets = splits.reduce((s, d) => s + d.exercises.reduce((ss, ex) => ss + ex.sets, 0), 0);
  const trainingDays = splits.filter(d => d.type !== "rest").length;
  const muscleGroups = {};
  splits.forEach(d => d.exercises.forEach(ex => {
    if (ex.muscle) muscleGroups[ex.muscle] = (muscleGroups[ex.muscle] || 0) + ex.sets;
  }));
  const muscleList = Object.entries(muscleGroups).sort((a, b) => b[1] - a[1]);
  const maxSets = muscleList[0]?.[1] || 1;

  return (
    <div className="fade-in">
      <h1 className="page-h1">My Split</h1>
      {splits.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>&#128203;</p>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No split yet</h3>
          <p style={{ color: "#737373", fontSize: 14, marginBottom: 24, maxWidth: 300, margin: "0 auto 24px" }}>
            Ask the AI Coach to build one, or add days manually
          </p>
          <div style={{ maxWidth: 460, margin: "0 auto 16px", textAlign: "left" }}>
            <BeginnerGuideCard
              image="/guide-split-beginner.svg"
              title="How beginners should set up a split"
              text="Start with fewer days and repeat the basics. That is easier to recover from and easier to understand."
              bullets={[
                "3 days: full body, full body, full body.",
                "4 days: upper, lower, upper, lower.",
                "Keep 4 to 6 exercises per day until the routine feels natural."
              ]}
              actionLabel="Ask AI Coach"
              onAction={() => onNav("coach")}
              secondaryLabel="Add 1 day"
              onSecondary={addDay}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <button className="btn-accent" type="button" onClick={() => onNav("coach")} style={{ maxWidth: 280 }}>Ask AI Coach</button>
            <button className="btn-ghost" type="button" onClick={addDay} style={{ maxWidth: 280, width: "100%" }}>+ Add day manually</button>
          </div>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="split-stats">
            <div className="split-stat"><span className="split-stat-num">{splits.length}</span><span className="split-stat-label">Days</span></div>
            <div className="split-stat"><span className="split-stat-num">{trainingDays}</span><span className="split-stat-label">Training</span></div>
            <div className="split-stat"><span className="split-stat-num">{totalExercises}</span><span className="split-stat-label">Exercises</span></div>
            <div className="split-stat"><span className="split-stat-num">{totalSets}</span><span className="split-stat-label">Sets/Week</span></div>
          </div>

          {/* Weekly schedule bar */}
          <div className="week-bar">
            {splits.slice(0, 7).map((d, i) => {
              const c = TYPE_COLORS[d.type] || "#F59E0B";
              return (
                <div key={i} className="week-day" {...pressableProps(() => setEd(i))}>
                  <div className="week-day-num" style={{ background: d.type === "rest" ? "#1C1C1C" : c + "22", color: d.type === "rest" ? "#525252" : c }}>
                    {d.day}
                  </div>
                  <span className="week-day-name">{d.name.length > 6 ? d.name.slice(0, 6) + ".." : d.name}</span>
                </div>
              );
            })}
          </div>

          {/* Muscle coverage */}
          {muscleList.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <p className="label" style={{ marginBottom: 10 }}>Muscle Coverage (sets/week)</p>
              {muscleList.map(([name, sets], i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 72, textAlign: "right", color: "#A3A3A3" }}>{name}</span>
                  <div style={{ flex: 1, height: 6, background: "#1C1C1C", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(sets / maxSets) * 100}%`, background: "#22C55E", borderRadius: 3, transition: "width .4s" }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#525252", width: 24 }}>{sets}</span>
                </div>
              ))}
            </div>
          )}

          {/* Day cards */}
          <div className="day-grid">
            {splits.map((day, i) => {
              const c = TYPE_COLORS[day.type] || "#F59E0B";
              const isRest = day.type === "rest";
              return (
                <div key={i} className="day-card" {...pressableProps(() => setEd(i))}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", background: c + "15", borderRadius: 4 }}>{day.type}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#525252", fontWeight: 600 }}>Day {day.day}</span>
                      <button type="button" aria-label={`Delete ${day.name}`} onClick={(e) => { e.stopPropagation(); removeDay(i); }} style={{ background: "none", border: "none", color: "#404040", cursor: "pointer", fontSize: 14, minWidth: 32, minHeight: 32 }}>x</button>
                    </div>
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{day.name}</h3>
                  {isRest ? <p style={{ color: "#404040", fontSize: 13 }}>Recovery day</p> : (
                    <>
                      {day.exercises.slice(0, 4).map((ex, j) => (
                        <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, borderBottom: j < Math.min(day.exercises.length, 4) - 1 ? "1px solid #1C1C1C" : "none" }}>
                          <span style={{ fontWeight: 500 }}>{ex.name}</span>
                          <span style={{ color: "#525252", fontWeight: 600, fontSize: 12 }}>{ex.sets}x{ex.reps}</span>
                        </div>
                      ))}
                      {day.exercises.length > 4 && <p style={{ fontSize: 12, color: "#525252", marginTop: 4 }}>+{day.exercises.length - 4} more</p>}
                      {day.exercises.length === 0 && <p style={{ color: "#404040", fontSize: 13 }}>Tap to add exercises</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn-ghost" type="button" onClick={addDay} style={{ flex: 1 }}>+ Add Day</button>
            <button className="btn-danger-sm" type="button" onClick={() => { if (window.confirm("Clear entire split?")) onSetSplits([]); }}>Clear All</button>
          </div>
        </>
      )}
      {ed !== null && <DaySheet day={splits[ed]} onClose={() => setEd(null)} onSave={u => onUpdate(ed, u)} />}
    </div>
  );
}

// ── WORKOUT SUMMARY ──
function WorkoutSummary({ log, onClose }) {
  const totalSets = log.exercises.reduce((s, ex) => s + (ex.logged?.length || 0), 0);
  const totalVol = log.exercises.reduce((s, ex) => s + (ex.logged || []).reduce((v, set) => v + set.weight * set.reps, 0), 0);
  const mins = Math.floor(log.duration / 60);
  return (
    <div className="overlay-bg" style={{ alignItems: "center" }} onClick={onClose}>
      <div className="summary-modal" onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 48, textAlign: "center", marginBottom: 8 }}>&#127942;</div>
        <h2 style={{ textAlign: "center", fontSize: 22, fontWeight: 800, marginBottom: 2 }}>Workout Done</h2>
        <p style={{ textAlign: "center", fontSize: 14, color: "#737373", marginBottom: 20 }}>{log.dayName}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 20, background: "#141414", borderRadius: 8, padding: 14 }}>
          <div style={{ flex: 1, textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800 }}>{mins}</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700, marginTop: 2 }}>MIN</div></div>
          <div style={{ width: 1, background: "#262626" }} />
          <div style={{ flex: 1, textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800 }}>{totalSets}</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700, marginTop: 2 }}>SETS</div></div>
          <div style={{ width: 1, background: "#262626" }} />
          <div style={{ flex: 1, textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800 }}>{totalVol > 1000 ? `${(totalVol / 1000).toFixed(1)}k` : totalVol}</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700, marginTop: 2 }}>LBS</div></div>
        </div>
        {log.exercises.filter(ex => ex.logged?.length > 0).map((ex, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "1px solid #1C1C1C" }}>
            <span>{ex.name}</span>
            <span style={{ color: "#525252", fontSize: 12 }}>{ex.logged.map(s => `${s.weight}x${s.reps}`).join(", ")}</span>
          </div>
        ))}
        <button className="btn-accent" onClick={onClose} style={{ marginTop: 20 }}>Done</button>
      </div>
    </div>
  );
}

// ── ACTIVE WORKOUT ──
function WorkoutPage({ splits, logs, onLogWorkout, restTime, onToast, settings }) {
  const [active, setActive] = useState(null);
  const [floatTimer, setFloatTimer] = useState(false);
  const [fullTimer, setFullTimer] = useState(false);
  const [summary, setSummary] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [plateCalc, setPlateCalc] = useState(null);
  const [notes, setNotes] = useState({});
  const [smartRestSeconds, setSmartRestSeconds] = useState(restTime);
  const [warmupEx, setWarmupEx] = useState(null);
  const workDays = splits.filter(d => d.type !== "rest" && d.exercises.length > 0);
  const lastWorkout = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const workoutsThisWeek = logs.filter(l => new Date(l.date).getTime() >= weekAgo).length;
  useWakeLock(!!active);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - active.startTime) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [active]);

  const getLastSession = (dayName) => {
    const prev = [...logs].reverse().find(l => l.dayName === dayName);
    if (!prev) return {};
    const map = {};
    prev.exercises.forEach(ex => { if (ex.logged?.length > 0) map[ex.name] = ex.logged; });
    return map;
  };

  const startWorkout = (dayIdx) => {
    const day = splits[dayIdx];
    const lastSession = getLastSession(day.name);
    const sets = {};
    day.exercises.forEach((ex, i) => {
      const prev = lastSession[ex.name];
      sets[i] = Array.from({ length: ex.sets }, (_, si) => ({
        weight: prev?.[si]?.weight?.toString() || "",
        reps: prev?.[si]?.reps?.toString() || "",
        rpe: "",
        done: false,
      }));
    });
    setActive({ dayIdx, startTime: Date.now(), sets, lastSession });
    setElapsed(0);
  };

  const updateSet = (exIdx, setIdx, field, value) => {
    setActive(prev => {
      const ns = { ...prev.sets }; ns[exIdx] = [...ns[exIdx]]; ns[exIdx][setIdx] = { ...ns[exIdx][setIdx], [field]: value };
      return { ...prev, sets: ns };
    });
  };

  const completeSet = (exIdx, setIdx) => {
    haptic.medium();
    setActive(prev => {
      const ns = { ...prev.sets }; ns[exIdx] = [...ns[exIdx]]; ns[exIdx][setIdx] = { ...ns[exIdx][setIdx], done: true };
      return { ...prev, sets: ns };
    });
    if (active) {
      const exName = splits[active.dayIdx].exercises[exIdx].name;
      const setData = active.sets[exIdx][setIdx];
      const w = Number(setData.weight) || 0;
      if (w > 0) {
        const prevMax = logs.reduce((max, l) => { l.exercises.forEach(ex => { if (ex.name === exName) (ex.logged || []).forEach(s => { if (s.weight > max) max = s.weight; }); }); return max; }, 0);
        if (w > prevMax && prevMax > 0) { onToast(`New PR! ${exName}: ${w} lbs`, "pr"); haptic.success(); }
      }
      const rpe = Number(setData.rpe) || 7;
      const smartRest = getSmartRestTime(exName, rpe, restTime);
      setSmartRestSeconds(smartRest);
      if (settings?.lockScreenRestAlerts) {
        scheduleRestNotification(smartRest, exName);
      }
    }
    setFloatTimer(true);
  };

  const addSet = (exIdx) => {
    setActive(prev => {
      const ns = { ...prev.sets }; ns[exIdx] = [...ns[exIdx], { weight: "", reps: "", done: false }];
      return { ...prev, sets: ns };
    });
  };

  const finishWorkout = () => {
    if (!active) return;
    cancelRestNotification();
    const day = splits[active.dayIdx];
    const log = {
      date: new Date().toISOString(), dayName: day.name, dayType: day.type, duration: elapsed,
      notes: Object.entries(notes).map(([k, v]) => ({ exercise: k, note: v })).filter(n => n.note),
      exercises: day.exercises.map((ex, i) => ({
        name: ex.name, muscle: ex.muscle, sets: ex.sets, reps: ex.reps,
        logged: (active.sets[i] || []).filter(s => s.done).map(s => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, rpe: Number(s.rpe) || 0 })),
      })),
    };
    onLogWorkout(log); setSummary(log); setActive(null); setFloatTimer(false); setFullTimer(false); setNotes({});
  };

  if (summary) return <WorkoutSummary log={summary} onClose={() => setSummary(null)} />;

  if (active) {
    const day = splits[active.dayIdx];
    const totalSets = Object.values(active.sets).flat().length;
    const doneSets = Object.values(active.sets).flat().filter(s => s.done).length;
    const progressPct = totalSets ? (doneSets / totalSets) * 100 : 0;
    return (<>
      <div className="fade-in workout-page workout-page-active">
        <div className="workout-header workout-session-hero">
          <div style={{ flex: 1 }}>
            <p className="workout-kicker">{day.type} day</p>
            <h1 className="workout-active-title">{day.name}</h1>
            <div className="workout-header-badges">
              <span className="badge badge-orange">{fmtTime(elapsed)}</span>
              <span className="badge badge-green">{doneSets}/{totalSets} sets</span>
            </div>
          </div>
          <div className="workout-header-actions">
            <button type="button" onClick={() => setFullTimer(true)} className="btn-ghost" style={{ padding: "8px 12px" }}>Timer</button>
            <button type="button" onClick={finishWorkout} className="btn-accent" style={{ padding: "8px 20px" }}>Finish</button>
          </div>
        </div>
        <div className="workout-progress-track">
          <div className="workout-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <GymEtaCard settings={settings} onToast={onToast} compact />
        <WorkoutMediaCard settings={settings} compact />

        {day.exercises.map((ex, exIdx) => {
          const exDone = (active.sets[exIdx] || []).filter(s => s.done).length;
          const exTotal = (active.sets[exIdx] || []).length;
          const allDone = exDone === exTotal;
          const lastSets = active.lastSession?.[ex.name];
          return (
            <div key={exIdx} className={`card workout-exercise-card ${allDone ? "workout-exercise-card-done" : ""}`} style={{ marginBottom: 10, borderColor: allDone ? "#166534" : "#1C1C1C" }}>
              <div className="workout-exercise-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="workout-exercise-meta">
                    <span className="workout-muscle-chip">{ex.muscle}</span>
                    {getExerciseInfo(ex.name).compound && <span className="workout-compound-chip">Compound</span>}
                  </div>
                  <h3 className="workout-exercise-name">{ex.name}</h3>
                  <p className="workout-exercise-copy">
                    {ex.sets} planned sets • {ex.reps} reps
                    {lastSets && <span style={{ color: "#666", fontStyle: "italic" }}> • prev: {lastSets.slice(0, 2).map(s => `${s.weight}x${s.reps}${s.rpe ? ` @${s.rpe}` : ""}`).join(", ")}</span>}
                  </p>
                </div>
                <span className={`workout-exercise-counter ${allDone ? "workout-exercise-counter-done" : ""}`}>
                  {allDone ? "\u2713" : `${exDone}/${exTotal}`}
                </span>
              </div>
              {!allDone && exDone === 0 && (
                <div className="workout-inline-actions">
                  {getExerciseInfo(ex.name).compound && (active.sets[exIdx]?.[0]?.weight) && Number(active.sets[exIdx][0].weight) > 45 && (
                    <button type="button" className="workout-mini-chip workout-mini-chip-warm" onClick={() => setWarmupEx({ name: ex.name, weight: Number(active.sets[exIdx][0].weight), reps: ex.reps })}>
                      Warm-up sets
                    </button>
                  )}
                  {getExerciseInfo(ex.name).subs.length > 0 && (
                    <button type="button" className="workout-mini-chip" onClick={() => onToast(`Subs: ${getExerciseInfo(ex.name).subs.slice(0, 3).join(", ")}`, "success")}>
                      Swap exercise
                    </button>
                  )}
                </div>
              )}
              <div className="workout-set-head">
                <span>SET</span><span>LBS</span><span>REPS</span><span>RPE</span><span></span>
              </div>
              {(active.sets[exIdx] || []).map((s, si) => (
                <div key={si} className={`workout-set-row ${s.done ? "workout-set-row-done" : ""}`}>
                  <span className="workout-set-index">{si + 1}</span>
                  <div style={{ position: "relative" }}>
                    <input className="set-inp" type="number" inputMode="decimal" placeholder={lastSets?.[si]?.weight?.toString() || "0"}
                      value={s.weight} onChange={e => updateSet(exIdx, si, "weight", e.target.value)} disabled={s.done} />
                    {!s.done && s.weight && Number(s.weight) >= 45 && (
                      <button type="button" aria-label={`Show plate calculator for ${ex.name} set ${si + 1}`} onClick={() => setPlateCalc(s.weight)} className="workout-plate-link">Plates</button>
                    )}
                  </div>
                  <input className="set-inp" type="number" inputMode="numeric" placeholder={lastSets?.[si]?.reps?.toString() || "0"}
                    value={s.reps} onChange={e => updateSet(exIdx, si, "reps", e.target.value)} disabled={s.done} />
                  <select value={s.rpe || ""} onChange={e => updateSet(exIdx, si, "rpe", e.target.value)} disabled={s.done}
                    className="workout-rpe-select"
                    style={{ color: s.rpe ? (Number(s.rpe) >= 9 ? "#EF4444" : Number(s.rpe) >= 7 ? "#F59E0B" : "#22C55E") : "#404040" }}>
                    <option value="">RPE</option>
                    <option value="6">6</option><option value="6.5">6.5</option>
                    <option value="7">7</option><option value="7.5">7.5</option>
                    <option value="8">8</option><option value="8.5">8.5</option>
                    <option value="9">9</option><option value="9.5">9.5</option>
                    <option value="10">10</option>
                  </select>
                  <button type="button" aria-label={`Complete ${ex.name} set ${si + 1}`} onClick={() => !s.done && completeSet(exIdx, si)} disabled={s.done}
                    className={`workout-set-complete ${s.done ? "workout-set-complete-done" : ""}`}>
                    {s.done ? "\u2713" : "\u2713"}
                  </button>
                </div>
              ))}
              <div className="workout-note-row">
                <button type="button" aria-label={`Add set to ${ex.name}`} onClick={() => addSet(exIdx)} className="workout-add-set">+ Set</button>
                <input placeholder="How did this feel?" value={notes[ex.name] || ""} onChange={e => setNotes(p => ({ ...p, [ex.name]: e.target.value }))}
                  className="workout-note-input" />
              </div>
            </div>
          );
        })}
        <div style={{ height: 100 }} />
      </div>
      {floatTimer && !fullTimer && <FloatingTimer seconds={smartRestSeconds} onDone={() => { setFloatTimer(false); cancelRestNotification(); }} onExpand={() => { setFloatTimer(false); setFullTimer(true); }} />}
      {fullTimer && <RestTimer seconds={smartRestSeconds} onDone={() => { setFullTimer(false); cancelRestNotification(); }} onCancel={() => { setFullTimer(false); cancelRestNotification(); }} />}
      {plateCalc && <PlateCalc weight={plateCalc} onClose={() => setPlateCalc(null)} />}
      {warmupEx && (
        <div className="overlay-bg" style={{ alignItems: "center" }} onClick={() => setWarmupEx(null)}>
          <div className="plate-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Warm-up Sets</h3>
            <p style={{ fontSize: 13, color: "#737373", marginBottom: 12 }}>{warmupEx.name} — working at {warmupEx.weight} lbs</p>
            {generateWarmupSets(warmupEx.weight, warmupEx.reps).map((ws, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1C1C1C" }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{ws.weight} lbs</span>
                  <span style={{ fontSize: 12, color: "#525252", marginLeft: 6 }}>x {ws.reps}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", padding: "2px 6px", background: "#1A1500", borderRadius: 4 }}>{ws.label}</span>
              </div>
            ))}
            <p style={{ fontSize: 11, color: "#525252", marginTop: 10, lineHeight: 1.4 }}>Perform these before your working sets. Rest 60-90s between warm-up sets.</p>
            <button className="btn-ghost" onClick={() => setWarmupEx(null)} style={{ marginTop: 12, width: "100%" }}>Got it</button>
          </div>
        </div>
      )}
    </>);
  }

  return (
    <div className="fade-in workout-page">
      <h1 className="page-h1">Workout</h1>
      <div className="card workout-overview-card">
        <div>
          <div className="workout-kicker">Ready To Train</div>
          <h2 className="workout-overview-title">{workDays.length ? "Pick a day and keep the session simple." : "Build a split and your workout flow unlocks here."}</h2>
          <p className="workout-overview-copy">
            {workDays.length
              ? "Track your sets, use the rest timer, and let the app remember your last performance."
              : "Once your split is saved, this screen becomes your day-by-day workout launcher."}
          </p>
        </div>
        <div className="workout-overview-stats">
          <div className="workout-overview-stat">
            <span className="workout-overview-label">Ready days</span>
            <strong className="workout-overview-value">{workDays.length}</strong>
          </div>
          <div className="workout-overview-stat">
            <span className="workout-overview-label">This week</span>
            <strong className="workout-overview-value">{workoutsThisWeek}</strong>
          </div>
          <div className="workout-overview-stat">
            <span className="workout-overview-label">Last log</span>
            <strong className="workout-overview-value workout-overview-value-sm">{lastWorkout ? new Date(lastWorkout.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "None"}</strong>
          </div>
        </div>
      </div>
      <GymEtaCard settings={settings} onToast={onToast} />
      <WorkoutMediaCard settings={settings} />
      {workDays.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: 48 }}>&#128170;</p>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No workouts</h3>
          <p style={{ color: "#737373", fontSize: 14 }}>Create a split first to start training</p>
          <div style={{ maxWidth: 460, margin: "16px auto 0", textAlign: "left" }}>
            <BeginnerGuideCard
              image="/guide-workout-beginner.svg"
              title="How your first workout should feel"
              text="Keep the first week simple. Learn the exercise names, record your sets, and leave a little energy in reserve."
              bullets={[
                "Start with a weight you can control for all planned reps.",
                "Use the rest timer after each set so the workout feels steady.",
                "Finish the session and let the app log the progress for you."
              ]}
              actionLabel="Need a plan?"
              onAction={() => onToast("Use the Coach or Split tab first to build your first workout.", "success")}
            />
          </div>
        </div>
      ) : (
        <div className="day-grid">
          {workDays.map((day) => {
            const origIdx = splits.indexOf(day);
            const c = TYPE_COLORS[day.type] || "#F59E0B";
            const lastLog = [...logs].reverse().find(l => l.dayName === day.name);
            return (
              <div key={origIdx} className="day-card day-card-start workout-start-card" {...pressableProps(() => startWorkout(origIdx))}>
                <div className="workout-start-top">
                  <span style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", background: c + "15", borderRadius: 999 }}>{day.type}</span>
                  <span style={{ fontSize: 12, color: "#525252" }}>Day {day.day}</span>
                </div>
                <h3 className="workout-start-title">{day.name}</h3>
                <p className="workout-start-copy">{day.exercises.length} exercises lined up. Tap in and log the session cleanly.</p>
                {day.exercises.slice(0, 3).map((ex, j) => (
                  <div key={j} className="workout-start-row">
                    <span style={{ fontWeight: 500 }}>{ex.name}</span>
                    <span style={{ color: "#525252", fontSize: 12, fontWeight: 600 }}>{ex.sets}x{ex.reps}</span>
                  </div>
                ))}
                {day.exercises.length > 3 && <p style={{ fontSize: 12, color: "#525252", marginTop: 4 }}>+{day.exercises.length - 3} more</p>}
                <div className="workout-start-footer">
                  {lastLog && <p style={{ fontSize: 11, color: "#525252" }}>Last: {new Date(lastLog.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>}
                  <div className="workout-start-cta">Start Workout</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SVG MINI LINE CHART ──
function MiniChart({ points, width = 200, height = 60, color = "#22C55E" }) {
  if (points.length < 2) return <p style={{ fontSize: 12, color: "#525252" }}>Need 2+ sessions</p>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * (width - 8) + 4;
    const y = height - 6 - ((v - min) / range) * (height - 12);
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((v, i) => {
        const x = (i / (points.length - 1)) * (width - 8) + 4;
        const y = height - 6 - ((v - min) / range) * (height - 12);
        return <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? color : color + "80"} />;
      })}
      <text x={4} y={height - 1} fontSize={9} fill="#525252">{min}</text>
      <text x={width - 4} y={10} fontSize={9} fill="#525252" textAnchor="end">{max}</text>
    </svg>
  );
}

function WorkoutMediaCard({ settings, compact = false }) {
  const spotifyEmbed = normalizeSpotifyEmbed(settings?.spotifyUrl);
  const appleEmbed = normalizeAppleMusicEmbed(settings?.appleMusicUrl);
  const available = [
    ...(spotifyEmbed ? [{ id: "spotify", label: "Spotify", embed: spotifyEmbed, source: settings.spotifyUrl }] : []),
    ...(appleEmbed ? [{ id: "apple", label: "Apple Music", embed: appleEmbed, source: settings.appleMusicUrl }] : []),
  ];
  const [provider, setProvider] = useState(settings?.preferredMusicProvider || available[0]?.id || "spotify");

  useEffect(() => {
    if (!available.find(item => item.id === provider)) setProvider(available[0]?.id || "spotify");
  }, [provider, available]);

  if (!available.length) return null;
  const active = available.find(item => item.id === provider) || available[0];

  return (
    <div className="card" style={{ marginBottom: 12, padding: compact ? 12 : 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>In-app music</p>
          <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.45 }}>Keep your workout running without leaving the app.</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {available.map(item => (
            <button
              key={item.id}
              className="btn-ghost"
              onClick={() => setProvider(item.id)}
              style={{
                width: "auto",
                minWidth: 90,
                padding: "8px 12px",
                borderColor: provider === item.id ? "#22C55E" : "#262626",
                color: provider === item.id ? "#22C55E" : "#737373",
                background: provider === item.id ? "#0A1F0A" : "#141414",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #1F1F1F", background: "#0A0A0A" }}>
        <iframe
          title={`${active.label} player`}
          src={active.embed}
          width="100%"
          height={active.id === "spotify" ? (compact ? "152" : "176") : (compact ? "175" : "220")}
          frameBorder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          style={{ display: "block", width: "100%" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, color: "#525252", lineHeight: 1.5 }}>
          Public playlists and albums work best here. Full account-based playback still needs provider credentials for production rollout.
        </p>
        <button className="btn-ghost" onClick={() => window.open(active.source, "_blank", "noopener,noreferrer")} style={{ width: "auto", minWidth: 92 }}>
          Open Full
        </button>
      </div>
    </div>
  );
}

function GymEtaCard({ settings, onToast, compact = false }) {
  const [travel, setTravel] = useState({ loading: false, miles: null, minutes: null, error: "", checked: false });
  const coordsKey = settings?.mainGymCoords ? `${settings.mainGymCoords.lat}:${settings.mainGymCoords.lng}` : "";
  const hasGym = Boolean(settings?.mainGymName || settings?.mainGymAddress || settings?.mainGymCoords);

  const refreshEta = useCallback(async (quiet = false) => {
    if (!settings?.mainGymCoords) {
      const message = "Save your main gym location in Settings to get a travel estimate.";
      setTravel({ loading: false, miles: null, minutes: null, error: message, checked: true });
      if (!quiet) onToast(message, "error");
      return;
    }
    setTravel(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const current = await getCurrentCoords();
      const miles = haversineMiles(current, settings.mainGymCoords);
      const minutes = estimateDriveMinutes(miles);
      setTravel({ loading: false, miles, minutes, error: "", checked: true });
    } catch (e) {
      const message = e?.message || "Could not read your current location.";
      setTravel({ loading: false, miles: null, minutes: null, error: message, checked: true });
      if (!quiet) onToast(message, "error");
    }
  }, [onToast, settings]);

  useEffect(() => {
    if (!coordsKey) return;
    refreshEta(true);
  }, [coordsKey, refreshEta]);

  if (!hasGym) return null;
  const directionsUrl = getGoogleMapsDirectionsUrl(settings);

  return (
    <div className="card" style={{ marginBottom: 12, padding: compact ? 12 : 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>{settings.mainGymName || "Main gym"}</p>
          <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.5 }}>
            {travel.minutes
              ? `${settings.mainGymName || "Your gym"} is about ${travel.minutes} min away (${formatMiles(travel.miles)} estimate).`
              : travel.error
                ? travel.error
                : "Check your current drive estimate and jump straight into Google Maps directions."}
          </p>
          {settings.mainGymAddress && (
            <p style={{ fontSize: 11, color: "#525252", marginTop: 4, lineHeight: 1.45 }}>{settings.mainGymAddress}</p>
          )}
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#22C55E", background: "#0A1F0A", border: "1px solid #14532D", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>
          {travel.minutes ? `${travel.minutes} min` : "Gym ETA"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn-ghost" onClick={() => refreshEta(false)} style={{ width: "auto", minWidth: 100 }}>
          {travel.loading ? "Checking..." : "Refresh ETA"}
        </button>
        {directionsUrl && (
          <button className="btn-accent" onClick={() => window.open(directionsUrl, "_blank", "noopener,noreferrer")} style={{ width: "auto", minWidth: 118 }}>
            Open Directions
          </button>
        )}
      </div>
      <p style={{ fontSize: 10, color: "#404040", marginTop: 8, lineHeight: 1.5 }}>
        ETA uses your current location plus a simple driving estimate inside the app. Open Google Maps for the exact route and live traffic time.
      </p>
    </div>
  );
}

// ── ANALYTICS PAGE ──
function AnalyticsPage({ logs }) {
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedLog, setSelectedLog] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState("");

  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const logsByDate = {};
  logs.forEach(l => { const d = new Date(l.date).toLocaleDateString("en-CA"); if (!logsByDate[d]) logsByDate[d] = []; logsByDate[d].push(l); });

  const total = logs.length;
  const thisWeek = logs.filter(l => new Date(l.date) > new Date(Date.now() - 7 * 864e5)).length;
  let streak = 0;
  const sorted = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length) {
    let c = new Date(); c.setHours(0, 0, 0, 0);
    for (const l of sorted) { const ld = new Date(l.date); ld.setHours(0, 0, 0, 0); if (Math.round((c - ld) / 864e5) <= 1) { streak++; c = ld; } else break; }
  }
  const totalVol = logs.reduce((sum, l) => sum + l.exercises.reduce((s, ex) => s + (ex.logged || []).reduce((v, set) => v + set.weight * set.reps, 0), 0), 0);

  // All exercises ever logged
  const allExercises = {};
  logs.forEach(l => l.exercises.forEach(ex => { if (ex.logged?.length > 0) allExercises[ex.name] = true; }));
  const exerciseNames = Object.keys(allExercises).sort();
  const currentEx = selectedExercise || exerciseNames[0] || "";

  // Exercise progression data
  const exProgression = [];
  if (currentEx) {
    logs.forEach(l => {
      l.exercises.forEach(ex => {
        if (ex.name === currentEx && ex.logged?.length > 0) {
          const maxW = Math.max(...ex.logged.map(s => s.weight));
          const maxVol = ex.logged.reduce((s, set) => s + set.weight * set.reps, 0);
          const best1RM = Math.max(...ex.logged.map(s => est1RM(s.weight, s.reps)));
          exProgression.push({ date: l.date, maxWeight: maxW, volume: maxVol, est1RM: best1RM });
        }
      });
    });
  }

  // Then vs Now comparison
  const thenVsNow = [];
  exerciseNames.forEach(name => {
    const sessions = [];
    logs.forEach(l => {
      l.exercises.forEach(ex => {
        if (ex.name === name && ex.logged?.length > 0) {
          const maxW = Math.max(...ex.logged.map(s => s.weight));
          sessions.push({ date: l.date, weight: maxW, reps: ex.logged[0].reps });
        }
      });
    });
    if (sessions.length >= 2) {
      const first = sessions[0];
      const last = sessions[sessions.length - 1];
      const change = last.weight - first.weight;
      if (change !== 0) thenVsNow.push({ name, first, last, change });
    }
  });
  thenVsNow.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  // Weekly volume trend (last 8 weeks)
  const weeklyVol = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(Date.now() - (w + 1) * 7 * 864e5);
    const end = new Date(Date.now() - w * 7 * 864e5);
    const vol = logs.filter(l => { const d = new Date(l.date); return d >= start && d < end; })
      .reduce((s, l) => s + l.exercises.reduce((ss, ex) => ss + (ex.logged || []).reduce((v, set) => v + set.weight * set.reps, 0), 0), 0);
    weeklyVol.push(vol);
  }
  const maxWeekVol = Math.max(...weeklyVol, 1);

  // PRs
  const prs = {};
  logs.forEach(l => { l.exercises.forEach(ex => { (ex.logged || []).forEach(set => { const k = ex.name; if (!prs[k] || set.weight > prs[k].weight) prs[k] = { weight: set.weight, reps: set.reps, date: l.date }; }); }); });
  const prList = Object.entries(prs).filter(([, v]) => v.weight > 0).sort((a, b) => b[1].weight - a[1].weight).slice(0, 8);

  // Muscle volume this week
  const weekLogs = logs.filter(l => new Date(l.date) > new Date(Date.now() - 7 * 864e5));
  const muscleVol = {};
  weekLogs.forEach(l => { l.exercises.forEach(ex => { const m = ex.muscle || "Other"; const vol = (ex.logged || []).reduce((s, set) => s + set.weight * set.reps, 0); muscleVol[m] = (muscleVol[m] || 0) + vol; }); });
  const muscleList = Object.entries(muscleVol).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxMuscleVol = muscleList[0]?.[1] || 1;

  // Hard sets per muscle group this week (science-based metric)
  const hardSetsPerMuscle = {};
  const OPTIMAL_SETS = { Chest: [10, 20], Back: [10, 20], Shoulders: [8, 16], Arms: [6, 14], Legs: [10, 20], Core: [6, 12], Other: [6, 14] };
  weekLogs.forEach(l => {
    l.exercises.forEach(ex => {
      const muscles = [];
      const info = getExerciseInfo(ex.name);
      if (info.primary.length > 0) muscles.push(...info.primary);
      else if (ex.muscle) muscles.push(ex.muscle);
      else muscles.push("Other");
      const hardSets = (ex.logged || []).filter(s => !s.rpe || Number(s.rpe) >= 6).length;
      muscles.forEach(m => { hardSetsPerMuscle[m] = (hardSetsPerMuscle[m] || 0) + hardSets; });
      if (info.secondary) info.secondary.forEach(m => { hardSetsPerMuscle[m] = (hardSetsPerMuscle[m] || 0) + Math.ceil(hardSets * 0.5); });
    });
  });
  const hardSetsList = Object.entries(hardSetsPerMuscle).sort((a, b) => b[1] - a[1]);
  const maxHardSets = Math.max(...hardSetsList.map(([, v]) => v), 1);

  // Average RPE this week
  let rpeSum = 0, rpeCount = 0;
  weekLogs.forEach(l => { l.exercises.forEach(ex => { (ex.logged || []).forEach(s => { if (s.rpe && Number(s.rpe) > 0) { rpeSum += Number(s.rpe); rpeCount++; } }); }); });
  const avgRpe = rpeCount > 0 ? (rpeSum / rpeCount).toFixed(1) : null;

  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calDays.push(i);

  return (
    <div className="fade-in">
      <h1 className="page-h1">Analytics</h1>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-box"><div className="stat-num" style={{ color: "#3B82F6" }}>{total}</div><div className="stat-label">Workouts</div></div>
        <div className="stat-box"><div className="stat-num" style={{ color: "#22C55E" }}>{thisWeek}</div><div className="stat-label">This Week</div></div>
        <div className="stat-box"><div className="stat-num" style={{ color: "#F59E0B" }}>{streak}</div><div className="stat-label">Streak</div></div>
        {avgRpe && <div className="stat-box"><div className="stat-num" style={{ color: Number(avgRpe) >= 9 ? "#EF4444" : Number(avgRpe) >= 7 ? "#F59E0B" : "#22C55E" }}>{avgRpe}</div><div className="stat-label">Avg RPE</div></div>}
        {!avgRpe && <div className="stat-box"><div className="stat-num sv-sm" style={{ color: "#A855F7" }}>{totalVol > 1000 ? `${(totalVol / 1000).toFixed(0)}k` : totalVol}</div><div className="stat-label">Total Lbs</div></div>}
      </div>

      {/* Calendar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button className="btn-ghost" style={{ padding: "4px 12px" }} onClick={() => setViewDate(new Date(year, month - 1, 1))}>&lt;</button>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{monthName}</h3>
          <button className="btn-ghost" style={{ padding: "4px 12px" }} onClick={() => setViewDate(new Date(year, month + 1, 1))}>&gt;</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#525252", fontWeight: 700, padding: 4 }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
          {calDays.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const hasLog = logsByDate[ds];
            const isToday = new Date().toLocaleDateString("en-CA") === ds;
            return (
              <div key={i} onClick={() => hasLog && setSelectedLog(logsByDate[ds])}
                style={{ aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  borderRadius: 6, fontSize: 13, fontWeight: hasLog ? 700 : 400, cursor: hasLog ? "pointer" : "default",
                  color: hasLog ? "#22C55E" : "#525252", background: hasLog ? "#0A1F0A" : "transparent",
                  boxShadow: isToday ? "inset 0 0 0 1.5px #22C55E" : "none" }}>
                <span>{d}</span>
                {hasLog && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#22C55E", marginTop: 1 }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Exercise Progression */}
      {exerciseNames.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="label" style={{ marginBottom: 8 }}>Exercise Progression</p>
          <select value={currentEx} onChange={e => setSelectedExercise(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", background: "#141414", border: "1px solid #262626", borderRadius: 6, color: "#E5E5E5", fontSize: 14, outline: "none", marginBottom: 12 }}>
            {exerciseNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {exProgression.length >= 2 ? (
            <div>
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: "#737373", marginBottom: 4 }}>Max Weight (lbs)</p>
                <MiniChart points={exProgression.map(p => p.maxWeight)} width={280} height={50} color="#22C55E" />
              </div>
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: "#737373", marginBottom: 4 }}>Est. 1RM (lbs)</p>
                <MiniChart points={exProgression.map(p => p.est1RM)} width={280} height={50} color="#3B82F6" />
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#737373", marginBottom: 4 }}>Session Volume (lbs)</p>
                <MiniChart points={exProgression.map(p => p.volume)} width={280} height={50} color="#A855F7" />
              </div>
            </div>
          ) : <p style={{ fontSize: 13, color: "#525252" }}>Need 2+ sessions to show chart</p>}
        </div>
      )}

      {/* Then vs Now */}
      {thenVsNow.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h2 className="section-h2">Then vs Now</h2>
          <div className="day-grid">
            {thenVsNow.slice(0, 6).map((item, i) => (
              <div key={i} className="card" style={{ padding: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{item.name}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 11, color: "#525252", fontWeight: 600 }}>FIRST</p>
                    <p style={{ fontSize: 18, fontWeight: 800 }}>{item.first.weight}<span style={{ fontSize: 12, color: "#525252" }}> lbs</span></p>
                  </div>
                  <div style={{ fontSize: 20, color: item.change > 0 ? "#22C55E" : "#EF4444" }}>
                    {item.change > 0 ? "\u2191" : "\u2193"}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 11, color: "#525252", fontWeight: 600 }}>NOW</p>
                    <p style={{ fontSize: 18, fontWeight: 800 }}>{item.last.weight}<span style={{ fontSize: 12, color: "#525252" }}> lbs</span></p>
                  </div>
                </div>
                <p style={{ fontSize: 12, fontWeight: 700, color: item.change > 0 ? "#22C55E" : "#EF4444", marginTop: 4 }}>
                  {item.change > 0 ? "+" : ""}{item.change} lbs
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Volume Trend */}
      {weeklyVol.some(v => v > 0) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="label" style={{ marginBottom: 10 }}>Weekly Volume (8 weeks)</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
            {weeklyVol.map((vol, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: "100%", height: Math.max(2, (vol / maxWeekVol) * 50), background: i === weeklyVol.length - 1 ? "#22C55E" : "#1C3A2A", borderRadius: 3, transition: "height .4s" }} />
                <span style={{ fontSize: 8, color: "#525252", marginTop: 3 }}>W{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Muscle Volume */}
      {muscleList.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="label" style={{ marginBottom: 10 }}>Weekly Volume by Muscle</p>
          {muscleList.map(([name, vol], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, width: 72, textAlign: "right", color: "#A3A3A3" }}>{name}</span>
              <div style={{ flex: 1, height: 6, background: "#1C1C1C", borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${(vol / maxMuscleVol) * 100}%`, background: "#22C55E", borderRadius: 3, minWidth: 4 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#525252", width: 36 }}>{vol > 1000 ? `${(vol / 1000).toFixed(1)}k` : vol}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hard Sets Per Muscle (Science-based) */}
      {hardSetsList.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="label" style={{ marginBottom: 4 }}>Weekly Hard Sets by Muscle</p>
          <p style={{ fontSize: 11, color: "#404040", marginBottom: 10 }}>Optimal: 10-20 sets/muscle/week for growth</p>
          {hardSetsList.map(([name, sets], i) => {
            const [optMin, optMax] = OPTIMAL_SETS[name] || [6, 14];
            const status = sets < optMin ? "low" : sets > optMax ? "high" : "good";
            const statusColor = status === "low" ? "#EF4444" : status === "high" ? "#F59E0B" : "#22C55E";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, width: 72, textAlign: "right", color: "#A3A3A3" }}>{name}</span>
                <div style={{ flex: 1, height: 10, background: "#1C1C1C", borderRadius: 5, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: `${(optMin / maxHardSets) * 100}%`, width: `${((optMax - optMin) / maxHardSets) * 100}%`, height: "100%", background: "#22C55E08", borderLeft: "1px dashed #22C55E30", borderRight: "1px dashed #22C55E30" }} />
                  <div style={{ height: "100%", width: `${(sets / maxHardSets) * 100}%`, background: statusColor, borderRadius: 5, minWidth: 4, position: "relative", zIndex: 1 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, width: 28, textAlign: "right" }}>{sets}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* PRs */}
      {prList.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h2 className="section-h2">Personal Records</h2>
          <div className="day-grid">
            {prList.map(([name, pr], i) => (
              <div key={i} className="card" style={{ padding: 14, borderColor: "#3B2F00" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{name}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#EAB308" }}>{pr.weight} lbs x {pr.reps}</div>
                <div style={{ fontSize: 11, color: "#525252", marginTop: 2 }}>{new Date(pr.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent logs */}
      {logs.length > 0 && (
        <div>
          <h2 className="section-h2">Recent Workouts</h2>
          {[...logs].reverse().slice(0, 8).map((l, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{l.dayName}</span>
                <span style={{ fontSize: 11, color: "#525252", fontWeight: 600 }}>{new Date(l.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{l.duration ? ` / ${Math.floor(l.duration / 60)}m` : ""}</span>
              </div>
              {l.exercises.filter(ex => ex.logged?.length > 0).slice(0, 3).map((ex, j) => (
                <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, borderTop: "1px solid #1C1C1C" }}>
                  <span>{ex.name}</span>
                  <span style={{ color: "#525252", fontSize: 12 }}>{ex.logged.map(s => `${s.weight}x${s.reps}`).join(", ")}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {logs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>&#128200;</p>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No data yet</h3>
          <p style={{ color: "#737373", fontSize: 14 }}>Complete some workouts to see your analytics</p>
        </div>
      )}

      {/* Day detail popup */}
      {selectedLog && (
        <div className="overlay-bg" onClick={() => setSelectedLog(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: "75vh" }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}><div style={{ width: 32, height: 4, borderRadius: 2, background: "#333" }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px 12px", borderBottom: "1px solid #1E1E1E" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{new Date(selectedLog[0].date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h3>
              <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", color: "#22C55E", fontWeight: 700, cursor: "pointer" }}>Close</button>
            </div>
            {selectedLog.map((log, li) => (
              <div key={li} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <p className="label" style={{ margin: 0 }}>{log.dayName}</p>
                  {log.duration > 0 && <span style={{ fontSize: 12, color: "#525252" }}>{Math.floor(log.duration / 60)} min</span>}
                </div>
                {log.exercises.map((ex, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "1px solid #1C1C1C" }}>
                    <span>{ex.name}</span>
                    <span style={{ color: "#525252", fontSize: 12 }}>{ex.logged?.length > 0 ? ex.logged.map(s => `${s.weight}x${s.reps}`).join(", ") : `${ex.sets}x${ex.reps}`}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI COACH ──
function CoachPage({ chat, splits, onUpdate }) {
  const [inp, setInp] = useState("");
  const [ld, setLd] = useState(false);
  const [pendingSplit, setPendingSplit] = useState(null);
  const end = useRef(null);
  const autoSuggestions = analyzeCoachSuggestions(splits);
  const splitCount = splits.length;
  const activeTrainingDays = splits.filter(day => (day.exercises || []).length > 0 && day.type !== "rest").length;
  const totalExercises = splits.reduce((sum, day) => sum + (day.exercises?.length || 0), 0);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, ld, pendingSplit]);

  const applySuggestion = (suggestion) => {
    if (!suggestion) return;
    if (suggestion.action?.type === "combine-duplicate") {
      onUpdate(prev => {
        const nextSplits = (prev.splits || []).map((day, idx) => {
          if (idx !== suggestion.action.dayIndex) return day;
          const merged = [];
          (day.exercises || []).forEach(ex => {
            const key = ex.name.trim().toLowerCase();
            const found = merged.find(m => m.name.trim().toLowerCase() === key);
            if (found) {
              found.sets = (Number(found.sets) || 0) + (Number(ex.sets) || 0);
            } else {
              merged.push({ ...ex, sets: Number(ex.sets) || 0 });
            }
          });
          return { ...day, exercises: merged };
        });
        return {
          ...prev,
          splits: nextSplits,
          chat: [...prev.chat, { role: "assistant", content: `I cleaned up ${suggestion.action.exerciseName} on ${prev.splits?.[suggestion.action.dayIndex]?.name || "that day"} so the workout is simpler to follow.` }],
        };
      });
      return;
    }
    if (suggestion.prompt) setInp(suggestion.prompt);
  };

  const send = async () => {
    if (!inp.trim() || ld) return;
    const msg = inp.trim(); setInp("");
    setPendingSplit(null);
    onUpdate(prev => ({ ...prev, chat: [...prev.chat, { role: "user", content: msg }] }));
    setLd(true);
    const splitInfo = splits.length > 0
      ? `User's current split:\n${splits.map(d => `Day ${d.day}: ${d.name} (${d.type}) - ${d.exercises.map(e => e.name).join(", ") || "empty"}`).join("\n")}`
      : "User has NO split yet.";
    const isSplitReq = SPLIT_RE.test(msg);
    const isSplitEditReq = splits.length > 0 && SPLIT_EDIT_RE.test(msg);
    const sysMsg = `You are a fitness coach called ${APP_BRAND} Coach. Be concise, direct, and science-backed. Keep responses short (2-4 sentences max unless explaining exercises).

EVIDENCE-BASED PRINCIPLES YOU FOLLOW:
- Volume: 10-20 hard sets per muscle per week for hypertrophy (beginners: 10-12, intermediate: 14-18, advanced: 16-20+)
- Frequency: Train each muscle 2x/week minimum for optimal growth
- Progressive overload: Add weight, reps, or sets over time — this is the #1 driver of gains
- RPE/RIR: Recommend training 1-3 reps from failure (RPE 7-9) for most sets. RPE 10 only on last set of an exercise
- Rest periods: 2-3 min for compounds (strength), 60-90s for isolation (hypertrophy)
- Rep ranges: 6-12 for hypertrophy, 3-5 for strength, 12-20 for endurance/pump work. All ranges build muscle if taken close to failure
- Compound movements first in a session, isolation after
- Deload every 4-6 weeks (reduce volume 40-50%)
- Each muscle needs adequate recovery (48-72 hours between sessions)

${splitInfo}${isSplitReq ? "\n\nThe user wants a workout split created or changed. Briefly describe what split you'll make (e.g. '3-day PPL with 5-6 exercises each day'). Keep it to 2-3 sentences. Do NOT include JSON or exercise lists - the system will generate the actual split separately." : ""}`;
    const chatHistory = [...chat, { role: "user", content: msg }].slice(-10);
    const reply = await groq([{ role: "system", content: sysMsg }, ...chatHistory.map(m => ({ role: m.role, content: m.content }))]);
    let splitData = null;
    if (isSplitReq) {
      const currentSplitJson = JSON.stringify(normalizeSplitDays(splits), null, 2);
      const jsonReply = await groq([{
        role: "system",
        content: `${isSplitEditReq ? `You are editing an EXISTING workout split. Return ONLY a valid JSON array representing the FULL UPDATED split, not just the changed day.

Current split JSON:
${currentSplitJson}

Edit rules:
- Keep the current split structure unless the user explicitly asks to add/remove/reorder days
- Preserve unchanged days
- When the user asks for more work on one muscle, make the smallest useful change instead of bloating the whole split
- If you replace exercises, keep the day balanced and readable
- Return the FULL updated array only

` : ""}You are a science-based workout generator. Return ONLY a valid JSON array. Each element: {"day":number,"name":"string","type":"string","exercises":[{"name":"string","sets":number,"reps":"string","muscle":"string"}]}.
Rules:
- type must be one of: push/pull/legs/upper/lower/chest/back/shoulders/arms/core/cardio/rest/custom
- 5-7 exercises per training day. Compounds first, isolation after.
- Use proven exercises (bench press, squats, deadlifts, rows, overhead press, pull-ups, etc.)
- Each muscle should get 10-20 sets/week across the split
- Rep ranges: compounds 6-10, isolation 10-15, small muscles 12-20
- Include at least one vertical push, vertical pull, horizontal push, horizontal pull, hip hinge, and squat pattern per week
- Rest days: type "rest", empty exercises array
- ONLY JSON, no other text.`
      }, { role: "user", content: msg }], 2048);
      splitData = tryParseJsonSplit(jsonReply);
    }
    const resolvedSplit = splitData
      ? (isSplitEditReq ? resolveSplitUpdate(splits, splitData) : normalizeSplitDays(splitData))
      : null;
    const splitChanged = resolvedSplit ? splitSignature(resolvedSplit) !== splitSignature(splits) : false;

    if (resolvedSplit && isSplitEditReq && splitChanged) {
      onUpdate(prev => ({
        ...prev,
        splits: resolvedSplit,
        chat: [
          ...prev.chat,
          { role: "assistant", content: reply },
          { role: "assistant", content: "I updated your split and saved the changes. Check the Split tab to review it, or go to Workout to train it." },
        ],
      }));
      setPendingSplit(null);
    } else {
      onUpdate(prev => ({
        ...prev,
        chat: [
          ...prev.chat,
          { role: "assistant", content: reply },
          ...(isSplitReq && !splitChanged ? [{ role: "assistant", content: "I did not save a split change yet. If you want a real update, ask for the exact day or muscle to change and I’ll rebuild the split." }] : []),
        ],
      }));
      if (resolvedSplit && splitChanged) setPendingSplit(resolvedSplit);
    }
    setLd(false);
  };

  const saveSplit = () => {
    if (!pendingSplit) return;
    onUpdate(prev => ({
      ...prev, splits: pendingSplit,
      chat: [...prev.chat, { role: "assistant", content: "Split saved. Check the Split tab to see it, or go to Workout to start training." }],
    }));
    setPendingSplit(null);
  };

  const quickPrompts = ["Create a 4 day push/pull/legs split", "Make a 3 day full body routine", "Build a 5 day bro split", "6 day PPL program"];
  const statCards = [
    { label: "Suggestions", value: autoSuggestions.length, tone: autoSuggestions.length ? "good" : "muted" },
    { label: "Training Days", value: activeTrainingDays, tone: activeTrainingDays >= 3 ? "good" : "muted" },
    { label: "Exercises", value: totalExercises, tone: totalExercises >= 12 ? "good" : "muted" },
  ];

  return (
    <div className="fade-in coach-page">
      <h1 className="page-h1">AI Coach</h1>
      <div className="coach-hero">
        <div className="coach-hero-card">
          <div className="coach-kicker">Adaptive Training Coach</div>
          <div className="coach-hero-head">
            <div>
              <h2 className="coach-hero-title">Build the week, clean up weak spots, and keep moving without guesswork.</h2>
              <p className="coach-hero-copy">
                The coach is proactive now. It looks for overlap, recovery issues, and awkward split balance on its own, then gives you plain-language fixes you can apply fast.
              </p>
            </div>
            <div className="coach-bot-mark" aria-hidden="true">AI</div>
          </div>
          <div className="coach-stat-row">
            {statCards.map(card => (
              <div key={card.label} className={`coach-stat-card coach-stat-${card.tone}`}>
                <span className="coach-stat-label">{card.label}</span>
                <strong className="coach-stat-value">{card.value}</strong>
              </div>
            ))}
          </div>
          <div className="coach-chip-row">
            {quickPrompts.map((q, i) => (
              <button key={i} type="button" className="coach-chip" onClick={() => setInp(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="coach-summary-card">
          <p className="coach-summary-label">Current Plan</p>
          <p className="coach-summary-value">{splitCount ? `${splitCount} day split loaded` : "No split saved yet"}</p>
          <p className="coach-summary-copy">
            {splitCount
              ? "Use auto suggestions to tighten the plan before you log the next session."
              : "Start with a 3-day or 4-day plan and let the coach fill in the exercises for you."}
          </p>
          <div className="coach-summary-pills">
            <span className="coach-summary-pill coach-summary-pill-good">{autoSuggestions.length} fixes ready</span>
            <span className="coach-summary-pill">{splitCount ? `${activeTrainingDays} active days` : "beginner friendly"}</span>
          </div>
          <div className="coach-summary-note">
            Tap words like <ClickableWord term="volume" /> or <ClickableWord term="recovery" /> when you want the quick version.
          </div>
        </div>
      </div>

      <div className="coach-workspace">
        <div className="chat-container chat-container-coach">
          <div className="chat-messages">
            {chat.length === 0 && (
              <div className="coach-empty">
                <div className="coach-empty-top">
                  <div className="coach-empty-badge">Coach</div>
                  <h3 className="coach-empty-title">Start with what you want, not gym jargon.</h3>
                  <p className="coach-empty-copy">Say what you need in plain English and the coach will build, explain, or fix the plan for you.</p>
                </div>
                <div className="coach-empty-grid">
                  <BeginnerGuideCard
                    image="/guide-coach-beginner.svg"
                    title="New lifter? Start simple"
                    text="Use the coach like a plain-language gym partner. It can build your first split and explain confusing words."
                    bullets={[
                      "Ask for a simple 3-day or 4-day beginner split.",
                      "Use the auto suggestions to clean up overlap or poor balance.",
                      "Tap words like volume or recovery when you want a quick explanation."
                    ]}
                    actionLabel="Make beginner split"
                    onAction={() => setInp("Create me a simple beginner 3 day full body split with easy exercise names.")}
                    secondaryLabel="Explain split"
                    onSecondary={() => setInp("Explain in plain language what a workout split is for a beginner.")}
                  />
                  <div className="coach-launch-card">
                    <p className="coach-launch-label">Fast starts</p>
                    <div className="coach-launch-list">
                      {quickPrompts.map((q, i) => (
                        <button key={i} type="button" className="coach-launch-item" onClick={() => setInp(q)}>
                          <span className="coach-launch-index">0{i + 1}</span>
                          <span>{q}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.role === "user" ? "chat-msg chat-msg-user" : "chat-msg chat-msg-bot"}>
                {m.role === "assistant" && <div style={{ fontSize: 11, fontWeight: 700, color: "#22C55E", marginBottom: 3 }}>Coach</div>}
                <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            ))}
            {pendingSplit && !ld && (
              <div className="coach-split-ready">
                <p className="coach-split-title">Split Ready</p>
                <p className="coach-split-copy">{pendingSplit.length} days built and ready to save.</p>
                {pendingSplit.map((d, i) => {
                  const c = TYPE_COLORS[d.type] || "#F59E0B";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #1A3A1A" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#525252", width: 36 }}>Day {d.day}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c, padding: "2px 6px", background: c + "15", borderRadius: 999 }}>{d.type}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{d.name}</span>
                      <span style={{ fontSize: 11, color: "#737373" }}>{d.exercises.length} ex</span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn-accent" type="button" onClick={saveSplit} style={{ flex: 1, padding: "10px 16px", minWidth: 170 }}>Save to My Split</button>
                  <button className="btn-ghost" type="button" onClick={() => setPendingSplit(null)}>Dismiss</button>
                </div>
              </div>
            )}
            {ld && (
              <div className="chat-msg chat-msg-bot">
                <div style={{ fontSize: 11, fontWeight: 700, color: "#22C55E", marginBottom: 3 }}>Coach</div>
                <div style={{ display: "flex", gap: 4, padding: "4px 0" }}>
                  <span className="dot" /><span className="dot d2" /><span className="dot d3" />
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="chat-input-bar chat-input-bar-coach">
            <input value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask your coach to build, explain, or fix something..."
              style={{ flex: 1, padding: "12px 14px", background: "#141414", border: "1px solid #262626", borderRadius: 12, color: "#E5E5E5", fontSize: 14, outline: "none" }} />
            <button type="button" onClick={send} disabled={ld || !inp.trim()} aria-label="Send message to coach"
              style={{ width: 44, height: 44, borderRadius: 12, background: "#22C55E", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: ld || !inp.trim() ? "not-allowed" : "pointer", opacity: ld || !inp.trim() ? 0.3 : 1, boxShadow: "0 8px 18px rgba(34,197,94,.22)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </div>
        </div>

        <div className="coach-side-stack">
          <div className="coach-side-card coach-side-card-fixes">
            <div className="coach-side-card-header coach-fixes-header">
              <div>
                <div className="coach-kicker">Auto Coach</div>
                <p className="coach-fixes-title">Smart Fixes</p>
                <p className="coach-fixes-copy">Quick cleanup ideas for overlap, recovery gaps, and split balance.</p>
              </div>
              <span className="coach-fixes-pill">
                <span className="coach-fixes-pill-dot" />
                {autoSuggestions.length} active
              </span>
            </div>
            <div className="coach-fixes-stack">
              {autoSuggestions.map((s, i) => (
                <div key={s.id || i} className="coach-suggestion-card coach-suggestion-card-upgraded">
                  <div className="coach-suggestion-topline">
                    <span className="coach-suggestion-badge">{s.action ? "Easy Win" : "Heads Up"}</span>
                    <span className="coach-suggestion-rank">Fix {String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="coach-suggestion-head">
                    <div className="coach-suggestion-icon">{s.action ? "↺" : "i"}</div>
                    <div style={{ minWidth: 0 }}>
                      <p className="coach-suggestion-title">{s.title}</p>
                      <p className="coach-suggestion-copy">{s.plain}</p>
                    </div>
                  </div>
                  {s.terms?.length > 0 && (
                    <div className="coach-suggestion-terms">
                      {s.terms.map(term => (
                        <div key={`${s.id}-${term}`} className="coach-term-chip">
                          <ClickableWord term={term} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="coach-suggestion-actions coach-suggestion-actions-upgraded">
                    {s.action && (
                      <button className="btn-accent coach-fix-cta" onClick={() => applySuggestion(s)}>
                        Apply Fix
                      </button>
                    )}
                    <button className="btn-ghost coach-fix-secondary" onClick={() => setInp(s.prompt)}>
                      Ask Coach
                    </button>
                  </div>
                </div>
              ))}
              {!autoSuggestions.length && (
                <div className="coach-suggestion-card coach-suggestion-card-upgraded coach-suggestion-card-clean">
                  <div className="coach-suggestion-topline">
                    <span className="coach-suggestion-badge">All Clear</span>
                  </div>
                  <div className="coach-suggestion-head">
                    <div className="coach-suggestion-icon">✓</div>
                    <div>
                      <p className="coach-suggestion-title">Your split looks clean</p>
                      <p className="coach-suggestion-copy">No urgent fixes right now. Ask for progressions, substitutions, or a new phase when you want one.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="coach-side-card coach-side-card-muted">
            <p className="coach-summary-label">How to ask better</p>
            <div className="coach-mini-list">
              <div className="coach-mini-item">
                <span className="coach-mini-index">1</span>
                <p>Start with schedule: <strong>"4 days"</strong>.</p>
              </div>
              <div className="coach-mini-item">
                <span className="coach-mini-index">2</span>
                <p>Add limits: <strong>"home gym"</strong> or <strong>"bad shoulder"</strong>.</p>
              </div>
              <div className="coach-mini-item">
                <span className="coach-mini-index">3</span>
                <p>Ask for a fix: <strong>"clean up overlap"</strong>.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── REMINDER SYSTEM (workout, water, protein) ──
function useReminders(settings) {
  const [notifPerm, setNotifPerm] = useState("prompt");
  const timerRef = useRef(null);
  const waterTimerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getNotificationPermissionState().then(perm => { if (alive) setNotifPerm(perm); });
    return () => { alive = false; };
  }, []);

  const requestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    return perm;
  };

  useEffect(() => {
    if (notifPerm !== "granted") return;
    syncReminderNotifications(settings);
  }, [
    notifPerm,
    settings.reminderEnabled,
    settings.reminderTime,
    JSON.stringify(settings.reminderDays || []),
    settings.waterReminder,
    settings.proteinReminder,
    settings.mainGymName,
  ]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isNativePlatform()) return;
    if (!settings.reminderEnabled || notifPerm !== "granted") return;

    const checkReminder = () => {
      const now = new Date();
      const days = settings.reminderDays || [1, 2, 3, 4, 5];
      if (!days.includes(now.getDay())) return;

      const [h, m] = (settings.reminderTime || "18:00").split(":").map(Number);
      if (now.getHours() === h && now.getMinutes() === m) {
        new Notification(`${APP_BRAND} • Gym check-in`, {
          body: "Time to hit the gym. Your next session is ready to go.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "workout-reminder",
        });
      }
    };

    timerRef.current = setInterval(checkReminder, 60000);
    return () => clearInterval(timerRef.current);
  }, [settings.reminderEnabled, settings.reminderTime, settings.reminderDays, notifPerm]);

  // Water & protein reminders (every 2 hours from 8am-8pm)
  useEffect(() => {
    if (waterTimerRef.current) clearInterval(waterTimerRef.current);
    if (isNativePlatform()) return;
    if (!settings.waterReminder || notifPerm !== "granted") return;

    const checkWaterReminder = () => {
      const now = new Date();
      const hour = now.getHours();
      if (hour >= 8 && hour <= 20 && hour % 2 === 0 && now.getMinutes() === 0) {
        new Notification(`${APP_BRAND} • Water break`, {
          body: "Take a quick water break and keep performance high.",
          icon: "/icon-192.png",
          tag: "water-reminder",
        });
      }
      if (settings.proteinReminder && hour >= 8 && hour <= 20 && hour % 4 === 0 && now.getMinutes() === 0) {
        new Notification(`${APP_BRAND} • Protein check`, {
          body: "Stay on pace for today's protein goal with your next meal.",
          icon: "/icon-192.png",
          tag: "protein-reminder",
        });
      }
    };

    waterTimerRef.current = setInterval(checkWaterReminder, 60000);
    return () => clearInterval(waterTimerRef.current);
  }, [settings.waterReminder, settings.proteinReminder, notifPerm]);

  return { notifPerm, requestPermission };
}

// ── PREMIUM CHECKOUT PAGE ──
function PremiumCheckout({ onUpgrade, userEmail }) {
  const [plan, setPlan] = useState("yearly");
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [payError, setPayError] = useState("");
  const [step, setStep] = useState("plans"); // plans | payment | success
  const [payMethod, setPayMethod] = useState(null); // apple | google | card
  const [paidDetails, setPaidDetails] = useState(null);
  const billingLocked = IS_PRODUCTION_BUILD && !RELEASE_PROTECTION.billingApiBase && !RELEASE_PROTECTION.allowDemoBilling;
  const hasNativeStoreBilling = IS_NATIVE_APP && !!getRevenueCatApiKey();
  const hasServerCheckout = !!RELEASE_PROTECTION.billingApiBase;

  const PLANS = {
    monthly: { id: "monthly", label: "Monthly", displayAmount: 8.99, chargeAmount: 8.99, displayPeriod: "/month", billingNote: "$8.99 billed monthly", save: null },
    yearly: { id: "yearly", label: "Yearly", displayAmount: 4.99, chargeAmount: 59.88, displayPeriod: "/month", billingNote: "$59.88 billed yearly", save: "Save 44%" },
    lifetime: { id: "lifetime", label: "Lifetime", displayAmount: 120, chargeAmount: 120, displayPeriod: "one-time", billingNote: "$120 one-time purchase", save: "Best Value" },
  };
  const plans = Object.values(PLANS);
  const WALLET_FEE = 0.02; // 2% processing fee for Apple Pay / Google Pay

  const features = [
    { icon: "🍽", title: "AI Nutrition Tracker", desc: "80+ foods from Indian, Italian, Mexican, Japanese & more cuisines" },
    { icon: "🔥", title: "Calorie & Macro Calculator", desc: "TDEE calculator with personalized targets" },
    { icon: "⌚", title: "Wearable Sync", desc: "Connect Apple Watch, Fitbit, Garmin for live data" },
    { icon: "⚖️", title: "Smart Scale Market", desc: "Connect Bluetooth scales for auto weight logging" },
    { icon: "🤖", title: "AI Meal Planning", desc: "Describe any food — AI scans calories instantly" },
    { icon: "📊", title: "Advanced Analytics", desc: "Muscle volume, hard sets, and RPE tracking" },
  ];

  // Price calculation with 2% fee for wallets
  const getPrice = (method) => {
    const base = PLANS[plan].chargeAmount;
    if (method === "apple" || method === "google") return Math.round((base * (1 + WALLET_FEE)) * 100) / 100;
    return base;
  };
  const formatPrice = (amt) => `$${amt.toFixed(2)}`;

  const formatCard = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  };

  const formatExp = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return digits.slice(0, 2) + "/" + digits.slice(2);
    return digits;
  };

  // Luhn algorithm for card number validation
  const luhnCheck = (num) => {
    const digits = num.replace(/\s/g, "");
    if (digits.length < 13 || digits.length > 19 || !/^\d+$/.test(digits)) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  };

  // Expiry validation
  const isExpValid = (exp) => {
    if (!/^\d{2}\/\d{2}$/.test(exp)) return false;
    const [mm, yy] = exp.split("/").map(Number);
    if (mm < 1 || mm > 12) return false;
    const now = new Date();
    const expDate = new Date(2000 + yy, mm); // first of month after expiry
    return expDate > now;
  };

  // CVC validation (3-4 digits)
  const isCvcValid = (cvc) => /^\d{3,4}$/.test(cvc);

  const validateCard = () => {
    if (!cardName.trim()) return "Enter the cardholder name";
    if (!luhnCheck(cardNum)) return "Invalid card number";
    if (!isExpValid(cardExp)) return "Invalid or expired date";
    if (!isCvcValid(cardCvc)) return "Invalid CVC code";
    return null;
  };

  const handlePay = async (method) => {
    setPayError("");
    setPayMethod(method);
    if (billingLocked) {
      setPayError("Protected billing is enabled. Configure VITE_BILLING_API_BASE or native store billing before public release.");
      setPayMethod(null);
      return;
    }

    if (method === "card" && !hasNativeStoreBilling && !hasServerCheckout) {
      const err = validateCard();
      if (err) { setPayError(err); setPayMethod(null); return; }
    }

    setProcessing(true);
    const finalPrice = getPrice(method);
    const fee = method === "card" ? 0 : Math.round(PLANS[plan].chargeAmount * WALLET_FEE * 100) / 100;
    try {
      const receipt = await checkoutProtectedPayment({
        plan,
        method,
        total: finalPrice,
        fee,
        email: userEmail,
        platform: IS_NATIVE_APP ? NATIVE_PLATFORM : "web",
        cardholderName: method === "card" ? cardName.trim() : "",
      });
      if (receipt?.checkoutUrl) {
        window.location.assign(receipt.checkoutUrl);
        return;
      }
      setPaidDetails({
        plan: PLANS[plan].label,
        method,
        total: finalPrice,
        fee,
        date: new Date().toISOString(),
        reference: receipt?.reference || "",
        secureMode: receipt?.mode === "demo" ? "demo" : receipt?.mode || "live",
      });
      onUpgrade({
        plan,
        method,
        total: finalPrice,
        fee,
        reference: receipt?.reference || "",
        source: receipt?.mode || "live",
        date: new Date().toISOString(),
      });
      setStep("success");
      haptic.success();
    } catch (error) {
      setPayError(error.message || "Payment could not be completed.");
      setPayMethod(null);
      haptic.error();
    } finally {
      setProcessing(false);
    }
  };

  if (step === "success") {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#22C55E,#16A34A)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 36, boxShadow: "0 8px 32px rgba(34,197,94,.3)" }}>✓</div>
        <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Welcome to Pro!</h2>
        <p style={{ color: "#737373", fontSize: 14, marginBottom: 8, maxWidth: 300, margin: "0 auto 8px" }}>
          Your premium features are now unlocked. Time to level up your nutrition game.
        </p>
        {paidDetails && (
          <div style={{ background: "#111", border: "1px solid #1A1A1A", borderRadius: 10, padding: 14, margin: "0 auto 20px", maxWidth: 300, textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "#525252", marginBottom: 6, fontWeight: 700 }}>RECEIPT</p>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: "#A3A3A3" }}>Plan</span>
              <span style={{ fontWeight: 700 }}>{paidDetails.plan}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: "#A3A3A3" }}>Method</span>
              <span style={{ fontWeight: 700 }}>{paidDetails.method === "apple" ? "Apple Pay" : paidDetails.method === "google" ? "Google Pay" : "Credit Card"}</span>
            </div>
            {paidDetails.fee > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "#A3A3A3" }}>Processing fee (2%)</span>
                <span style={{ fontWeight: 700, color: "#F59E0B" }}>+${paidDetails.fee.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 6, paddingTop: 6, borderTop: "1px solid #1A1A1A" }}>
              <span style={{ fontWeight: 800 }}>Total</span>
              <span style={{ fontWeight: 900, color: "#22C55E" }}>${paidDetails.total.toFixed(2)}</span>
            </div>
            {!!paidDetails.reference && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#525252" }}>
                Ref: {paidDetails.reference}
              </div>
            )}
            <div style={{ marginTop: 4, fontSize: 11, color: paidDetails.secureMode === "live" ? "#22C55E" : "#F59E0B" }}>
              {paidDetails.secureMode === "live" ? "Protected live billing confirmed" : "Demo billing mode is enabled"}
            </div>
          </div>
        )}
        <button className="btn-accent" onClick={() => onUpgrade(paidDetails)} style={{ maxWidth: 280 }}>Start Using Pro Features</button>
      </div>
    );
  }

  if (step === "payment") {
    const selectedPlan = PLANS[plan];
    const applePrice = getPrice("apple");
    const googlePrice = getPrice("google");
    const cardPrice = getPrice("card");
    return (
      <div className="fade-in">
        <button onClick={() => { setStep("plans"); setPayError(""); }} style={{ background: "none", border: "none", color: "#737373", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          ← Back to plans
        </button>
        {billingLocked && (
          <div style={{ background: "#1C1111", border: "1px solid #7F1D1D", color: "#FCA5A5", padding: "10px 12px", borderRadius: 10, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
            Protected billing is enabled. Wire `VITE_BILLING_API_BASE` or native App Store / Play billing before taking real payments.
          </div>
        )}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #1A1A1A" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{APP_PRO_BRAND} ({selectedPlan.label})</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: "#22C55E" }}>${selectedPlan.chargeAmount.toFixed(2)}<span style={{ fontSize: 12, color: "#525252", fontWeight: 600 }}>{selectedPlan.id === "monthly" ? "/month" : selectedPlan.id === "yearly" ? "/year" : ""}</span></span>
          </div>
          <p style={{ fontSize: 11, color: "#525252", marginBottom: 14 }}>{selectedPlan.billingNote}</p>

          {hasNativeStoreBilling ? (
            <div style={{ background: "#0A1F0A", border: "1px solid #14532D", borderRadius: 12, padding: 14 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "#22C55E", marginBottom: 6 }}>
                {NATIVE_PLATFORM === "ios" ? "App Store billing" : "Google Play billing"}
              </p>
              <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.5, marginBottom: 12 }}>
                This device uses secure native store billing through RevenueCat. Your payment method is handled by the store, not by {APP_BRAND}.
              </p>
              {payError && (
                <div style={{ background: "#1C1111", border: "1px solid #7F1D1D", color: "#FCA5A5", padding: "8px 12px", borderRadius: 8, fontSize: 13, textAlign: "center", marginBottom: 10 }}>
                  {payError}
                </div>
              )}
              <button
                className="btn-accent"
                onClick={() => handlePay(NATIVE_PLATFORM === "ios" ? "apple" : "google")}
                disabled={processing || billingLocked}
                style={{ opacity: processing ? 0.7 : billingLocked ? 0.55 : 1 }}
              >
                {processing
                  ? `Opening ${NATIVE_PLATFORM === "ios" ? "App Store" : "Google Play"}…`
                  : `Continue with ${NATIVE_PLATFORM === "ios" ? "App Store" : "Google Play"}`}
              </button>
            </div>
          ) : (
            <>
              {/* Apple Pay button */}
              <button onClick={() => handlePay("apple")} disabled={processing || billingLocked}
                style={{ width: "100%", padding: 14, background: "#000", border: "1px solid #333", borderRadius: 10, cursor: "pointer", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: processing && payMethod === "apple" ? 0.7 : 1 }}>
                {processing && payMethod === "apple" ? (
                  <span style={{ color: "#A3A3A3", fontSize: 14, fontWeight: 600 }}>Authorizing...</span>
                ) : (
                  <svg width="50" height="20" viewBox="0 0 50 20" fill="none">
                    <path d="M9.4 3.3c-.6.7-1.5 1.2-2.4 1.1-.1-1 .4-2 .9-2.6C8.5 1.1 9.5.6 10.3.5c.1 1-.3 2-.9 2.8zM10.3 4.6c-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7C2.9 4.7 1.5 5.7.8 7.2c-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2 2.5 2 1-.1 1.4-.6 2.6-.6 1.2 0 1.5.6 2.6.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.2-.8-2.2-3.3 0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.6-1.6-3.1-1.7l.7.7z" fill="#fff"/>
                    <path d="M20.3 2.2c3.1 0 5.3 2.1 5.3 5.3 0 3.2-2.2 5.3-5.4 5.3h-3.4v5.5h-2.5V2.2h6zm-3.5 8.5h2.8c2.2 0 3.4-1.2 3.4-3.2 0-2-1.2-3.2-3.4-3.2h-2.8v6.4zM26.5 14.3c0-2.1 1.6-3.3 4.4-3.5l3.2-.2v-.9c0-1.3-.9-2.1-2.4-2.1-1.4 0-2.3.7-2.5 1.7h-2.3c.1-2.2 2-3.8 4.9-3.8 2.9 0 4.7 1.5 4.7 3.9v8.2h-2.3v-2h-.1c-.7 1.3-2.1 2.2-3.7 2.2-2.3 0-3.9-1.4-3.9-3.5zm7.6-1.1v-.9l-2.9.2c-1.5.1-2.3.7-2.3 1.7 0 1 .9 1.7 2.2 1.7 1.7 0 3-1.2 3-2.7zM38 21.3v-1.9c.2 0 .6.1.9.1 1.3 0 2-.5 2.4-1.9l.3-.9-4.5-12.4h2.6l3.1 10.1h.1l3.1-10.1h2.5l-4.6 13c-1.1 3-2.3 3.9-4.8 3.9-.3.1-.8.1-1.1.1z" fill="#fff"/>
                  </svg>
                )}
              </button>
              <p style={{ fontSize: 10, color: "#404040", textAlign: "center", marginBottom: 8 }}>
                {formatPrice(applePrice)}{selectedPlan.id === "monthly" ? "/month" : selectedPlan.id === "yearly" ? "/year" : ""} (includes 2% processing fee)
              </p>

              {/* Google Pay button */}
              <button onClick={() => handlePay("google")} disabled={processing || billingLocked}
                style={{ width: "100%", padding: 14, background: "#fff", border: "1px solid #ddd", borderRadius: 10, cursor: "pointer", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: processing && payMethod === "google" ? 0.7 : 1 }}>
                {processing && payMethod === "google" ? (
                  <span style={{ color: "#666", fontSize: 14, fontWeight: 600 }}>Authorizing...</span>
                ) : (
                  <svg width="60" height="24" viewBox="0 0 60 24" fill="none">
                    <path d="M28.2 12.2c0-.7-.1-1.3-.2-1.9h-8v3.6h4.6c-.2 1-.8 1.9-1.6 2.4v2h2.6c1.5-1.4 2.4-3.5 2.4-6.1z" fill="#4285F4"/>
                    <path d="M20 18.7c2.2 0 4-.7 5.4-2l-2.6-2c-.7.5-1.6.8-2.8.8-2.1 0-3.9-1.4-4.6-3.4H12.7v2.1c1.3 2.6 4 4.5 7.3 4.5z" fill="#34A853"/>
                    <path d="M15.4 12.1c-.3-.8-.3-1.7 0-2.5V7.5h-2.7c-1 2-1 4.3 0 6.3l2.7-1.7z" fill="#FBBC04"/>
                    <path d="M20 6.2c1.2 0 2.3.4 3.1 1.2l2.3-2.3C24 3.8 22.2 3 20 3c-3.3 0-6 1.9-7.3 4.5l2.7 2.1c.7-2 2.5-3.4 4.6-3.4z" fill="#EA4335"/>
                    <text x="31" y="16" fill="#5F6368" fontSize="10" fontFamily="Arial" fontWeight="500">Pay</text>
                  </svg>
                )}
              </button>
              <p style={{ fontSize: 10, color: "#404040", textAlign: "center", marginBottom: 12 }}>
                {formatPrice(googlePrice)}{selectedPlan.id === "monthly" ? "/month" : selectedPlan.id === "yearly" ? "/year" : ""} (includes 2% processing fee)
              </p>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: "#262626" }} />
                <span style={{ fontSize: 11, color: "#404040", fontWeight: 600 }}>or pay with card (no fee)</span>
                <div style={{ flex: 1, height: 1, background: "#262626" }} />
              </div>

              {payError && (
                <div style={{ background: "#1C1111", border: "1px solid #7F1D1D", color: "#FCA5A5", padding: "8px 12px", borderRadius: 8, fontSize: 13, textAlign: "center", marginBottom: 10 }}>
                  {payError}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <svg width="38" height="24" viewBox="0 0 38 24" fill="none"><rect width="38" height="24" rx="4" fill="#1A1F36"/><circle cx="15" cy="12" r="7" fill="#EB001B" opacity=".8"/><circle cx="23" cy="12" r="7" fill="#F79E1B" opacity=".8"/></svg>
                <svg width="38" height="24" viewBox="0 0 38 24" fill="none"><rect width="38" height="24" rx="4" fill="#1A1F36"/><path d="M13 7l-2 10h3l2-10h-3zm10 0l-4 10h3l1-2h3l.5 2h3L27 7h-4zm1 6l1.5-4 .8 4h-2.3zM9 7L6 17h3l3-10H9z" fill="#fff"/></svg>
                <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 600 }}>No processing fee</span>
              </div>

              <p className="label" style={{ marginBottom: 6 }}>Cardholder Name</p>
              <input className="input" placeholder="John Doe" value={cardName}
                onChange={e => { setCardName(e.target.value); setPayError(""); }} autoComplete="cc-name" />

              <p className="label" style={{ marginBottom: 6 }}>Card Number</p>
              <input className="input" placeholder="4242 4242 4242 4242" value={cardNum}
                onChange={e => { setCardNum(formatCard(e.target.value)); setPayError(""); }} inputMode="numeric" autoComplete="cc-number"
                style={{ borderColor: payError && payError.includes("card number") ? "#EF4444" : undefined }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <p className="label" style={{ marginBottom: 6 }}>Expiry</p>
                  <input className="input" placeholder="MM/YY" value={cardExp}
                    onChange={e => { setCardExp(formatExp(e.target.value)); setPayError(""); }} inputMode="numeric" autoComplete="cc-exp"
                    style={{ borderColor: payError && payError.includes("expired") ? "#EF4444" : undefined }} />
                </div>
                <div>
                  <p className="label" style={{ marginBottom: 6 }}>CVC</p>
                  <input className="input" placeholder="123" value={cardCvc} type="password"
                    onChange={e => { setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4)); setPayError(""); }} inputMode="numeric" autoComplete="cc-csc"
                    style={{ borderColor: payError && payError.includes("CVC") ? "#EF4444" : undefined }} />
                </div>
              </div>

              <button className="btn-accent" onClick={() => handlePay("card")} disabled={processing || billingLocked}
                style={{ marginTop: 8, background: processing && payMethod === "card" ? "#1C1C1C" : "linear-gradient(135deg,#22C55E,#16A34A)", opacity: processing && payMethod === "card" ? 0.7 : billingLocked ? 0.55 : 1 }}>
                {processing && payMethod === "card" ? (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#A3A3A3" }}>
                    <span className="dot" style={{ width: 6, height: 6 }} /><span className="dot d2" style={{ width: 6, height: 6 }} /><span className="dot d3" style={{ width: 6, height: 6 }} />
                    <span style={{ marginLeft: 4 }}>Processing...</span>
                  </span>
                ) : `Pay ${formatPrice(cardPrice)}${selectedPlan.id === "monthly" ? "/month" : selectedPlan.id === "yearly" ? "/year" : ""}`}
              </button>
            </>
          )}

          <p style={{ fontSize: 11, color: "#404040", textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
            🔒 256-bit SSL encrypted. Cancel anytime.{plan !== "lifetime" ? " 7-day free trial included." : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h1 className="page-h1">Nutrition</h1>

      {/* Hero */}
      <div style={{ background: "linear-gradient(135deg, #0F172A, #1E1B4B, #0F172A)", border: "1px solid #312E81", borderRadius: 16, padding: "28px 20px", textAlign: "center", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,.15), transparent)", pointerEvents: "none" }} />
        <div style={{ fontSize: 42, marginBottom: 8 }}>⭐</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4, background: "linear-gradient(135deg, #E5E5E5, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{APP_PRO_BRAND}</h2>
        <p style={{ fontSize: 13, color: "#8B8B9E", marginBottom: 20, lineHeight: 1.5 }}>
          Unlock the full nutrition suite with AI-powered food tracking
        </p>

        {/* Plan selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          {plans.map(p => (
            <button key={p.id} onClick={() => setPlan(p.id)}
              style={{ flex: 1, padding: "14px 8px", borderRadius: 12, border: `2px solid ${plan === p.id ? "#6366F1" : "#262640"}`,
                background: plan === p.id ? "linear-gradient(135deg, #1E1B4B, #312E81)" : "#111128", cursor: "pointer", textAlign: "center", transition: "all .15s", position: "relative" }}>
              {p.save && <span style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: "#6366F1", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{p.save}</span>}
              <div style={{ fontSize: 18, fontWeight: 900, color: plan === p.id ? "#A78BFA" : "#525260" }}>${p.displayAmount % 1 === 0 ? p.displayAmount : p.displayAmount.toFixed(2)}</div>
              <div style={{ fontSize: 10, color: "#525260", fontWeight: 600 }}>{p.displayPeriod}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: plan === p.id ? "#E5E5E5" : "#404050", marginTop: 4 }}>{p.label}</div>
              <div style={{ fontSize: 9, color: "#525260", marginTop: 3 }}>{p.billingNote}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Features grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
        {features.map((f, i) => (
          <div key={i} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{f.icon}</div>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{f.title}</p>
            <p style={{ fontSize: 11, color: "#525252", lineHeight: 1.4 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      {billingLocked && (
        <div style={{ background: "#1C1111", border: "1px solid #7F1D1D", color: "#FCA5A5", padding: "10px 12px", borderRadius: 10, fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          Public charging is blocked in this build until a secure billing backend is configured.
        </div>
      )}
      <button className="btn-accent" onClick={() => setStep("payment")} disabled={billingLocked}
        style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", marginBottom: 8, boxShadow: "0 4px 16px rgba(99,102,241,.3)", opacity: billingLocked ? 0.6 : 1 }}>
        Start 7-Day Free Trial
      </button>
      <p style={{ fontSize: 11, color: "#404040", textAlign: "center", marginBottom: 20 }}>
        {billingLocked ? "Billing is blocked until a secure backend is configured." : "No charge today. Cancel anytime before trial ends."}
      </p>

      {/* Testimonials */}
      <div className="card" style={{ marginBottom: 12, borderColor: "#1A1A2E" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>{"★★★★★".split("").map((s, i) => <span key={i} style={{ color: "#F59E0B", fontSize: 14 }}>{s}</span>)}</div>
        <p style={{ fontSize: 13, fontStyle: "italic", color: "#A3A3A3", lineHeight: 1.5, marginBottom: 6 }}>"The food database is amazing. I can log my Indian meals without guessing calories. Game changer for tracking nutrition while bulking."</p>
        <p style={{ fontSize: 11, color: "#525252", fontWeight: 600 }}>— Rahul S., Pro member</p>
      </div>
      <div className="card" style={{ marginBottom: 12, borderColor: "#1A1A2E" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>{"★★★★★".split("").map((s, i) => <span key={i} style={{ color: "#F59E0B", fontSize: 14 }}>{s}</span>)}</div>
        <p style={{ fontSize: 13, fontStyle: "italic", color: "#A3A3A3", lineHeight: 1.5, marginBottom: 6 }}>"Water reminders keep me on track. The AI food scanner is crazy accurate — just type what you ate and it figures out the macros."</p>
        <p style={{ fontSize: 11, color: "#525252", fontWeight: 600 }}>— Sarah M., Pro member</p>
      </div>
    </div>
  );
}

// ── NUTRITION PAGE ──
function NutritionPage({ nutrition, bodyWeight, onUpdate, onToast, connectedDevices, devicesTrialStart, premium, onUpgradePremium, userEmail }) {
  const [tab, setTab] = useState("overview");
  const [foodInput, setFoodInput] = useState("");
  const [foodLoading, setFoodLoading] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [foodSearch, setFoodSearch] = useState("");
  const [foodCat, setFoodCat] = useState("All");
  const [deviceBusy, setDeviceBusy] = useState("");

  // Profile setup state
  const [profileForm, setProfileForm] = useState({
    sex: "male", age: "", weight: "", heightFt: "", heightIn: "", activity: "moderate", goal: "maintain",
  });

  const today = todayStr();
  const goUpgrade = () => setTab("upgrade");

  // Get today's food items
  const todayFood = nutrition.foodLog.find(d => d.date === today);
  const todayItems = todayFood?.items || [];

  // Get today's water
  const todayWater = nutrition.waterLog.find(d => d.date === today);
  const todayGlasses = todayWater?.glasses || 0;

  // Get today's body weight
  const todayWeight = bodyWeight.find(d => d.date === today);

  // Calculate daily totals
  const dailyCals = todayItems.reduce((s, i) => s + (i.calories || 0), 0);
  const dailyProtein = todayItems.reduce((s, i) => s + (i.protein || 0), 0);
  const dailyCarbs = todayItems.reduce((s, i) => s + (i.carbs || 0), 0);
  const dailyFat = todayItems.reduce((s, i) => s + (i.fat || 0), 0);

  // Targets from profile
  const profile = nutrition.profile;
  const calTarget = profile?.calories || 2000;
  const proteinTarget = profile?.protein || 150;
  const carbsTarget = profile?.carbs || 200;
  const fatTarget = profile?.fat || 65;

  // Save profile
  const saveProfile = () => {
    const age = Number(profileForm.age);
    const weightLbs = Number(profileForm.weight);
    const heightFt = Number(profileForm.heightFt);
    const heightIn = Number(profileForm.heightIn);
    if (!age || !weightLbs || !heightFt) { onToast("Fill in all fields", "error"); return; }
    if (age < 13 || age > 120) { onToast("Age must be between 13 and 120", "error"); return; }
    if (weightLbs < 60 || weightLbs > 700) { onToast("Weight must be between 60 and 700 lbs", "error"); return; }
    if (heightFt < 3 || heightFt > 8) { onToast("Height must be between 3 and 8 feet", "error"); return; }
    if (heightIn < 0 || heightIn > 11) { onToast("Inches must be between 0 and 11", "error"); return; }

    const weightKg = weightLbs * 0.453592;
    const heightCm = (heightFt * 12 + (heightIn || 0)) * 2.54;

    let bmr;
    if (profileForm.sex === "male") {
      bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
    } else {
      bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;
    }

    const activityMult = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extreme: 1.9 };
    const tdee = Math.round(bmr * (activityMult[profileForm.activity] || 1.55));

    const goalAdj = { lose: -500, maintain: 0, build: 300 };
    const calories = tdee + (goalAdj[profileForm.goal] || 0);

    const proteinG = Math.round(weightLbs * 1);
    const fatCals = Math.round(calories * 0.25);
    const fatG = Math.round(fatCals / 9);
    const proteinCals = proteinG * 4;
    const carbCals = calories - proteinCals - fatCals;
    const carbG = Math.round(carbCals / 4);

    const newProfile = {
      sex: profileForm.sex, age, weightLbs, heightFt, heightIn: heightIn || 0,
      activity: profileForm.activity, goal: profileForm.goal,
      bmr: Math.round(bmr), tdee, calories, protein: proteinG, carbs: carbG, fat: fatG,
    };

    onUpdate(prev => ({ ...prev, nutrition: { ...prev.nutrition, profile: newProfile } }));
    onToast("Profile saved!");
  };

  // Log food via AI
  const logFood = async () => {
    if (!premium) { onToast("AI food scanning is part of Pro. Basic calorie logging is still free below.", "error"); setTab("upgrade"); return; }
    if (!foodInput.trim()) { onToast("Type what you ate first", "error"); return; }
    if (foodLoading) return;
    if (!navigator.onLine) { onToast("You're offline. Use the food database instead.", "error"); return; }
    setFoodLoading(true);
    let response;
    try {
      response = await groq([{
        role: "system",
        content: 'Estimate the nutrition for this food. Return ONLY valid JSON: {"name":"food description","calories":number,"protein":number,"carbs":number,"fat":number}. Be accurate. Calories and macros must be positive numbers. No text outside JSON.'
      }, { role: "user", content: foodInput.trim() }], 512);
    } catch {
      onToast("Could not reach AI. Try again or use the food database.", "error");
      setFoodLoading(false);
      return;
    }

    if (!response || response.startsWith("AI unavailable") || response.startsWith("AI features require")) {
      onToast(response || "AI unavailable. Use the food database instead.", "error");
      setFoodLoading(false);
      return;
    }

    try {
      const m = response.match(/\{[\s\S]*?\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        const calories = Math.round(Math.max(0, Number(parsed.calories) || 0));
        const protein = Math.round(Math.max(0, Number(parsed.protein) || 0));
        const carbs = Math.round(Math.max(0, Number(parsed.carbs) || 0));
        const fat = Math.round(Math.max(0, Number(parsed.fat) || 0));

        // Sanity check: reject obviously wrong data
        if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) {
          onToast("AI couldn't estimate this food. Try being more specific.", "error");
          setFoodLoading(false);
          return;
        }
        if (calories > 10000) {
          onToast("Calorie estimate seems too high. Try specifying a smaller portion.", "error");
          setFoodLoading(false);
          return;
        }

        const item = {
          name: (parsed.name || foodInput.trim()).slice(0, 100), // limit name length
          calories, protein, carbs, fat,
          time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        };

        onUpdate(prev => {
          const fl = [...prev.nutrition.foodLog];
          const idx = fl.findIndex(d => d.date === today);
          if (idx >= 0) {
            fl[idx] = { ...fl[idx], items: [...fl[idx].items, item] };
          } else {
            fl.push({ date: today, items: [item] });
          }
          return { ...prev, nutrition: { ...prev.nutrition, foodLog: fl } };
        });
        onToast(`Logged: ${item.name} (${item.calories} cal)`);
        setFoodInput("");
      } else {
        onToast("Could not parse food data. Try again or use the database.", "error");
      }
    } catch {
      onToast("Could not parse food data. Try describing the food differently.", "error");
    }
    setFoodLoading(false);
  };

  // Delete food item
  const deleteFood = (itemIdx) => {
    onUpdate(prev => {
      const fl = [...prev.nutrition.foodLog];
      const idx = fl.findIndex(d => d.date === today);
      if (idx >= 0) {
        const items = fl[idx].items.filter((_, i) => i !== itemIdx);
        fl[idx] = { ...fl[idx], items };
      }
      return { ...prev, nutrition: { ...prev.nutrition, foodLog: fl } };
    });
  };

  // Add water glass
  const addWater = () => {
    haptic.light();
    onUpdate(prev => {
      const wl = [...prev.nutrition.waterLog];
      const idx = wl.findIndex(d => d.date === today);
      if (idx >= 0) {
        wl[idx] = { ...wl[idx], glasses: wl[idx].glasses + 1 };
      } else {
        wl.push({ date: today, glasses: 1 });
      }
      return { ...prev, nutrition: { ...prev.nutrition, waterLog: wl } };
    });
  };

  // Log body weight
  const logWeight = () => {
    const w = Number(weightInput);
    if (!w || w < 50 || w > 500) { onToast("Enter a valid weight", "error"); return; }
    onUpdate(prev => {
      const bw = [...prev.bodyWeight];
      const idx = bw.findIndex(d => d.date === today);
      if (idx >= 0) {
        bw[idx] = { ...bw[idx], weight: w };
      } else {
        bw.push({ date: today, weight: w });
      }
      return { ...prev, bodyWeight: bw };
    });
    setWeightInput("");
    onToast(`Weight logged: ${w} lbs`);
  };

  // Body weight trend
  const recentWeights = bodyWeight.slice(-30);
  const weightTrend = recentWeights.length >= 2
    ? recentWeights[recentWeights.length - 1].weight - recentWeights[0].weight
    : 0;

  // Tabs: always show devices, show premium upsell if not premium, show nutrition tabs if premium
  const nutTabs = [
    ...(!profile ? [{ id: "setup", label: "Setup" }] : []),
    { id: "overview", label: "Overview" },
    { id: "food", label: "Food Log" },
    ...(premium ? [{ id: "water", label: "Water" }, { id: "weight", label: "Weight" }] : []),
    { id: "devices", label: "Devices" },
    ...(!premium ? [{ id: "upgrade", label: "Go Pro" }] : []),
  ];

  // Reset tab if current tab is not available
  const validTabIds = nutTabs.map(t => t.id);
  const activeTab = validTabIds.includes(tab) ? tab : nutTabs[0].id;

  const calPct = Math.min(100, (dailyCals / calTarget) * 100);

  return (
    <div className="fade-in">
      <h1 className="page-h1">Nutrition</h1>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto" }}>
        {nutTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${activeTab === t.id ? "#22C55E" : "#262626"}`,
              background: activeTab === t.id ? "#0A1F0A" : "#141414", color: activeTab === t.id ? (t.id === "upgrade" ? "#A78BFA" : "#22C55E") : "#737373",
              fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>

      {/* SETUP TAB — profile setup for premium users without profile */}
      {activeTab === "setup" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Set Up Your Nutrition Profile</h3>
            <p style={{ fontSize: 13, color: "#737373", marginBottom: 8 }}>Basic calorie and macro targets are free. Pro adds AI food scan, water tracking, and body-weight trends.</p>
            {!premium && (
              <div style={{ background: "#111111", border: "1px solid #1F1F1F", borderRadius: 10, padding: 10, marginBottom: 16 }}>
                <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.5 }}>
                  Free plan: profile setup, simple calorie totals, food database, and device connections.
                </p>
              </div>
            )}

            <p className="label" style={{ marginBottom: 6 }}>Sex</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["male", "female"].map(s => (
                <button key={s} onClick={() => setProfileForm(p => ({ ...p, sex: s }))}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${profileForm.sex === s ? "#22C55E" : "#262626"}`,
                    background: profileForm.sex === s ? "#0A1F0A" : "#141414", color: profileForm.sex === s ? "#22C55E" : "#737373",
                    fontSize: 14, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{s}</button>
              ))}
            </div>

            <p className="label" style={{ marginBottom: 6 }}>Age</p>
            <input className="input" type="number" placeholder="25" value={profileForm.age}
              onChange={e => setProfileForm(p => ({ ...p, age: e.target.value }))} />

            <p className="label" style={{ marginBottom: 6 }}>Weight (lbs)</p>
            <input className="input" type="number" placeholder="170" value={profileForm.weight}
              onChange={e => setProfileForm(p => ({ ...p, weight: e.target.value }))} />

            <p className="label" style={{ marginBottom: 6 }}>Height</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="number" placeholder="ft" value={profileForm.heightFt} style={{ flex: 1 }}
                onChange={e => setProfileForm(p => ({ ...p, heightFt: e.target.value }))} />
              <input className="input" type="number" placeholder="in" value={profileForm.heightIn} style={{ flex: 1 }}
                onChange={e => setProfileForm(p => ({ ...p, heightIn: e.target.value }))} />
            </div>

            <p className="label" style={{ marginBottom: 6 }}>Activity Level</p>
            <select value={profileForm.activity} onChange={e => setProfileForm(p => ({ ...p, activity: e.target.value }))}
              style={{ width: "100%", padding: 12, background: "#0A0A0A", border: "1px solid #262626", borderRadius: 8, color: "#E5E5E5", fontSize: 14, outline: "none", marginBottom: 10 }}>
              <option value="sedentary">Sedentary (desk job)</option>
              <option value="light">Lightly Active (1-3 days/week)</option>
              <option value="moderate">Moderately Active (3-5 days/week)</option>
              <option value="very">Very Active (6-7 days/week)</option>
              <option value="extreme">Extremely Active (athlete)</option>
            </select>

            <p className="label" style={{ marginBottom: 6 }}>Goal</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[["lose", "Lose Fat"], ["maintain", "Maintain"], ["build", "Build Muscle"]].map(([v, l]) => (
                <button key={v} onClick={() => setProfileForm(p => ({ ...p, goal: v }))}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${profileForm.goal === v ? "#22C55E" : "#262626"}`,
                    background: profileForm.goal === v ? "#0A1F0A" : "#141414", color: profileForm.goal === v ? "#22C55E" : "#737373",
                    fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
              ))}
            </div>

            <button className="btn-accent" onClick={saveProfile}>Calculate & Save</button>
          </div>
        </div>
      )}

      {/* UPGRADE TAB — premium checkout for free users */}
      {activeTab === "upgrade" && (
        <PremiumCheckout onUpgrade={onUpgradePremium} userEmail={userEmail} />
      )}

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div>
          {!profile && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>Finish setup for better targets</p>
                  <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.5 }}>You can still log food now, but setup gives you personalized calories and macros.</p>
                </div>
                <button className="btn-ghost" onClick={() => setTab("setup")} style={{ width: "auto", minWidth: 88 }}>Set Up</button>
              </div>
            </div>
          )}

          {/* Calorie ring */}
          <div className="card" style={{ marginBottom: 12, textAlign: "center" }}>
            <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 12px" }}>
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#1C1C1C" strokeWidth="10" />
                <circle cx="60" cy="60" r="52" fill="none"
                  stroke={calPct > 100 ? "#EF4444" : "#22C55E"} strokeWidth="10"
                  strokeDasharray={2 * Math.PI * 52}
                  strokeDashoffset={2 * Math.PI * 52 * (1 - Math.min(calPct, 100) / 100)}
                  strokeLinecap="round" transform="rotate(-90 60 60)"
                  style={{ transition: "stroke-dashoffset 0.4s" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{dailyCals}</span>
                <span style={{ fontSize: 10, color: "#525252", fontWeight: 700 }}>/ {calTarget}</span>
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#737373", fontWeight: 600 }}>Calories</p>
            <p style={{ fontSize: 11, color: "#525252" }}>{Math.max(0, calTarget - dailyCals)} remaining</p>
          </div>

          {/* Macro bars */}
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="label" style={{ marginBottom: 10 }}>Macros</p>
            {[
              { label: "Protein", current: dailyProtein, target: proteinTarget, color: "#3B82F6", unit: "g" },
              { label: "Carbs", current: dailyCarbs, target: carbsTarget, color: "#F59E0B", unit: "g" },
              { label: "Fat", current: dailyFat, target: fatTarget, color: "#EF4444", unit: "g" },
            ].map((m, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: "#737373" }}>{m.current}{m.unit} / {m.target}{m.unit}</span>
                </div>
                <div style={{ height: 8, background: "#1C1C1C", borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (m.current / m.target) * 100)}%`, background: m.color, borderRadius: 4, transition: "width .4s" }} />
                </div>
              </div>
            ))}
          </div>

          {premium ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700 }}>Water</p>
                  <p style={{ fontSize: 12, color: "#737373" }}>{todayGlasses}/8 glasses</p>
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: i < todayGlasses ? "#3B82F6" : "#262626", transition: "background .2s" }} />
                  ))}
                </div>
                <button onClick={addWater} style={{ width: 36, height: 36, borderRadius: "50%", background: "#0A1F3A", border: "1px solid #1E3A5F", color: "#3B82F6", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 6 }}>Free vs Pro</p>
              <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.55, marginBottom: 10 }}>
                Free gives you food logging and basic calorie totals. Pro adds AI food scan, water reminders, weight trends, and deeper nutrition insights.
              </p>
              <button className="btn-ghost" onClick={goUpgrade}>See Pro Nutrition</button>
            </div>
          )}

          {/* Meal breakdown */}
          {todayItems.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 10 }}>Today's Meals</p>
              {todayItems.slice(-5).map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < Math.min(todayItems.length, 5) - 1 ? "1px solid #1A1A1A" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</p>
                    <p style={{ fontSize: 10, color: "#525252" }}>{item.time || ""}</p>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>{item.calories} cal</span>
                </div>
              ))}
              {todayItems.length > 5 && <p style={{ fontSize: 11, color: "#404040", textAlign: "center", marginTop: 6 }}>+{todayItems.length - 5} more items</p>}
            </div>
          )}

          {/* Profile summary */}
          <div className="card" style={{ marginBottom: 12 }}>
            {profile ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p className="label" style={{ marginBottom: 4 }}>Your Targets</p>
                  <p style={{ fontSize: 12, color: "#737373" }}>TDEE: {profile.tdee} cal | Goal: {profile.goal}</p>
                </div>
                <button onClick={() => onUpdate(prev => ({ ...prev, nutrition: { ...prev.nutrition, profile: null } }))}
                  style={{ background: "none", border: "1px solid #262626", borderRadius: 6, padding: "4px 10px", color: "#737373", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Edit
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <p className="label" style={{ marginBottom: 4 }}>Default Targets</p>
                  <p style={{ fontSize: 12, color: "#737373" }}>Using simple defaults until you save your profile.</p>
                </div>
                <button className="btn-ghost" onClick={() => setTab("setup")} style={{ width: "auto", minWidth: 88 }}>Set Up</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* FOOD LOG TAB */}
      {activeTab === "food" && (
        <div>
          {/* Food search & quick add from database */}
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="label" style={{ marginBottom: 8 }}>Quick Add from Database</p>
            <input className="input" placeholder="Search foods... (chicken, biryani, pasta...)" value={foodSearch}
              onChange={e => setFoodSearch(e.target.value)} style={{ marginBottom: 8 }} />
            {/* Cuisine filter pills */}
            <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8, paddingBottom: 4 }}>
              {FOOD_CATEGORIES.map(c => (
                <button key={c} onClick={() => setFoodCat(c)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${foodCat === c ? "#22C55E" : "#262626"}`,
                    background: foodCat === c ? "#0A1F0A" : "#141414", color: foodCat === c ? "#22C55E" : "#737373",
                    fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s" }}>{c}</button>
              ))}
            </div>
            {/* Food results */}
            <div style={{ maxHeight: foodSearch || foodCat !== "All" ? 220 : 0, overflowY: "auto", transition: "max-height .2s" }}>
              {FOOD_DB
                .filter(f => (foodCat === "All" || f.cat === foodCat) && (!foodSearch || f.name.toLowerCase().includes(foodSearch.toLowerCase())))
                .slice(0, 12)
                .map((f, i) => (
                  <div key={i} onClick={() => {
                    const item = { name: f.name, calories: f.cal, protein: f.p, carbs: f.c, fat: f.f, time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) };
                    onUpdate(prev => {
                      const fl = [...prev.nutrition.foodLog];
                      const idx = fl.findIndex(d => d.date === today);
                      if (idx >= 0) fl[idx] = { ...fl[idx], items: [...fl[idx].items, item] };
                      else fl.push({ date: today, items: [item] });
                      return { ...prev, nutrition: { ...prev.nutrition, foodLog: fl } };
                    });
                    onToast(`Logged: ${f.name} (${f.cal} cal)`);
                    haptic.light();
                    setFoodSearch("");
                  }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 8px", borderBottom: "1px solid #1A1A1A", cursor: "pointer", borderRadius: 6, transition: "background .1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#1A1A1A"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 1 }}>{f.name}</p>
                      <p style={{ fontSize: 11, color: "#525252" }}>P: {f.p}g | C: {f.c}g | F: {f.f}g</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#22C55E" }}>{f.cal}</span>
                      <span style={{ fontSize: 10, color: "#525252", display: "block" }}>cal</span>
                    </div>
                  </div>
                ))}
              {foodSearch && FOOD_DB.filter(f => f.name.toLowerCase().includes(foodSearch.toLowerCase())).length === 0 && (
                <p style={{ fontSize: 12, color: "#404040", textAlign: "center", padding: 12 }}>No matches found</p>
              )}
            </div>
          </div>

          {premium ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 8 }}>AI Food Scanner</p>
              <p style={{ fontSize: 11, color: "#404040", marginBottom: 8 }}>Describe anything and the coach estimates calories and macros.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" placeholder="e.g. 2 samosas with green chutney" value={foodInput}
                  onChange={e => setFoodInput(e.target.value)} onKeyDown={e => e.key === "Enter" && logFood()}
                  style={{ flex: 1, marginBottom: 0 }} />
                <button className="btn-accent" onClick={logFood} disabled={foodLoading || !foodInput.trim()}
                  style={{ width: 80, opacity: foodLoading || !foodInput.trim() ? 0.5 : 1 }}>
                  {foodLoading ? "..." : "Scan"}
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 8 }}>AI Food Scanner</p>
              <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.55, marginBottom: 10 }}>
                Free plan includes the food database and calorie totals. Pro unlocks AI food scan for custom meals and restaurant dishes.
              </p>
              <button className="btn-ghost" onClick={goUpgrade}>Unlock AI Scanner</button>
            </div>
          )}

          {/* Daily totals */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, textAlign: "center" }}>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: "#22C55E" }}>{dailyCals}</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700 }}>CAL</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: "#3B82F6" }}>{dailyProtein}g</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700 }}>PROTEIN</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: "#F59E0B" }}>{dailyCarbs}g</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700 }}>CARBS</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 800, color: "#EF4444" }}>{dailyFat}g</div><div style={{ fontSize: 10, color: "#525252", fontWeight: 700 }}>FAT</div></div>
            </div>
          </div>

          {/* Food list */}
          {todayItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <p style={{ fontSize: 36, marginBottom: 8 }}>&#127869;</p>
              <p style={{ color: "#525252", fontSize: 14 }}>No food logged today</p>
              <p style={{ color: "#404040", fontSize: 12, marginTop: 4 }}>Search above or describe food for AI</p>
            </div>
          ) : (
            todayItems.map((item, i) => (
              <div key={i} className="card" style={{ marginBottom: 6, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{item.name}</p>
                    <p style={{ fontSize: 12, color: "#737373" }}>
                      {item.calories} cal | P: {item.protein}g | C: {item.carbs}g | F: {item.fat}g
                      {item.time && <span style={{ color: "#404040" }}> | {item.time}</span>}
                    </p>
                  </div>
                  <button onClick={() => deleteFood(i)}
                    style={{ background: "none", border: "none", color: "#404040", cursor: "pointer", fontSize: 16, padding: "4px 8px" }}>x</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* WATER TAB */}
      {activeTab === "water" && (
        <div>
          <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Today's Water Intake</p>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: i < todayGlasses ? "#3B82F6" : "#1C1C1C",
                  border: `2px solid ${i < todayGlasses ? "#3B82F6" : "#262626"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: i < todayGlasses ? "#fff" : "#404040",
                  transition: "all .2s",
                }}>{i + 1}</div>
              ))}
            </div>
            <p style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>{todayGlasses} <span style={{ fontSize: 16, color: "#525252" }}>/ 8</span></p>
            <p style={{ fontSize: 12, color: "#737373", marginBottom: 16 }}>{todayGlasses * 8} oz of 64 oz goal</p>
            <button onClick={addWater}
              style={{ width: 64, height: 64, borderRadius: "50%", background: "#0A1F3A", border: "2px solid #1E3A5F",
                color: "#3B82F6", fontSize: 32, fontWeight: 700, cursor: "pointer", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
              +
            </button>
            <p style={{ fontSize: 12, color: "#525252", marginTop: 8 }}>Tap to add a glass (8 oz)</p>
          </div>

          {/* Water history */}
          {nutrition.waterLog.length > 0 && (
            <div className="card">
              <p className="label" style={{ marginBottom: 8 }}>Recent Days</p>
              {[...nutrition.waterLog].reverse().slice(0, 7).map((d, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1C1C1C" }}>
                  <span style={{ fontSize: 13, color: "#A3A3A3" }}>{d.date}</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: 8 }, (_, j) => (
                      <div key={j} style={{ width: 8, height: 8, borderRadius: "50%", background: j < d.glasses ? "#3B82F6" : "#262626" }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: d.glasses >= 8 ? "#22C55E" : "#525252" }}>{d.glasses}/8</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* WEIGHT TAB */}
      {activeTab === "weight" && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="label" style={{ marginBottom: 8 }}>Log Today's Weight</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" type="number" placeholder={todayWeight ? String(todayWeight.weight) : "170"} value={weightInput}
                onChange={e => setWeightInput(e.target.value)} onKeyDown={e => e.key === "Enter" && logWeight()}
                style={{ flex: 1, marginBottom: 0 }} />
              <button className="btn-accent" onClick={logWeight} style={{ width: 80 }}>Log</button>
            </div>
            {todayWeight && <p style={{ fontSize: 12, color: "#22C55E", marginTop: 6 }}>Today: {todayWeight.weight} lbs</p>}
          </div>

          {/* Trend */}
          {recentWeights.length >= 2 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 8 }}>Weight Trend (Last {recentWeights.length} entries)</p>
              <MiniChart points={recentWeights.map(w => w.weight)} width={280} height={80} color={weightTrend > 0 ? "#EF4444" : weightTrend < 0 ? "#22C55E" : "#3B82F6"} />
              <p style={{ fontSize: 13, fontWeight: 700, marginTop: 8, color: weightTrend > 0 ? "#EF4444" : weightTrend < 0 ? "#22C55E" : "#3B82F6" }}>
                {weightTrend > 0 ? `+${weightTrend.toFixed(1)} lbs (gaining)` : weightTrend < 0 ? `${weightTrend.toFixed(1)} lbs (losing)` : "Stable"}
              </p>
            </div>
          )}

          {/* Weight history */}
          {bodyWeight.length > 0 && (
            <div className="card">
              <p className="label" style={{ marginBottom: 8 }}>History</p>
              {[...bodyWeight].reverse().slice(0, 14).map((d, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1C1C1C" }}>
                  <span style={{ fontSize: 13, color: "#A3A3A3" }}>{d.date}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{d.weight} lbs</span>
                </div>
              ))}
            </div>
          )}

          {bodyWeight.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <p style={{ fontSize: 36, marginBottom: 8 }}>&#9878;</p>
              <p style={{ color: "#525252", fontSize: 14 }}>No weight entries yet. Log your first one above.</p>
            </div>
          )}
        </div>
      )}

      {/* DEVICES TAB */}
      {activeTab === "devices" && (() => {
        const trialStart = devicesTrialStart;
        const now = new Date();
        const trialDays = trialStart ? Math.floor((now - new Date(trialStart)) / (1000 * 60 * 60 * 24)) : 0;
        const trialRemaining = trialStart ? Math.max(0, 30 - trialDays) : 30;
        const trialExpired = trialStart && trialDays >= 30;
        const devicesLocked = trialExpired && !premium;
        const deviceBackendReady = !!RELEASE_PROTECTION.deviceSyncApiBase;
        const previewMode = !deviceBackendReady && RELEASE_PROTECTION.allowDemoDeviceSync;
        const deviceProtectionLocked = IS_PRODUCTION_BUILD && !deviceBackendReady && !RELEASE_PROTECTION.allowDemoDeviceSync;
        const getConnectedDevice = (name) => (connectedDevices || []).find(d => d.name === name);
        const isConnected = (name) => !!getConnectedDevice(name);
        const hydrateDeviceState = async () => {
          if (!deviceBackendReady || !authSession.get()) return null;
          try {
            return await fetchProtectedDeviceState();
          } catch {
              return null;
          }
        };
        const getActionLabels = (deviceType, connected) => {
          if (deviceType === "scale") {
            return connected ? { label: "Unpair", success: "paired" } : { label: "Pair", success: "paired" };
          }
          if (IS_NATIVE_APP) {
            return connected ? { label: "Disconnect", success: "connected" } : { label: "Connect", success: "connected" };
          }
          return connected ? { label: "Unlink", success: "linked" } : { label: "Link", success: "linked" };
        };
        const getDeviceStatusMeta = (device) => {
          if (devicesLocked) return { dot: "#EF4444", label: "Paused", detail: "Trial expired" };
          if (!device) return { dot: "#525252", label: "Ready", detail: "Not linked yet" };
          if (device.type === "scale" && (device.status === "paired" || device.status === "linked")) {
            return { dot: "#38BDF8", label: "Paired", detail: "Paired to your account" };
          }
          if (device.status === "permission-needed") return { dot: "#F59E0B", label: "Needs permission", detail: "Open the app to allow health access" };
          if (device.status === "linked") return { dot: "#60A5FA", label: "Linked", detail: "Linked to your account" };
          if (device.status === "preview") return { dot: "#F59E0B", label: "Preview", detail: "Demo sync mode" };
          if (device.status === "connected") return { dot: "#22C55E", label: "Connected", detail: "Ready for live sync" };
          return { dot: "#22C55E", label: "Syncing", detail: "Live sync available" };
        };

        const startTrial = () => {
          if (!devicesTrialStart) {
            onUpdate(prev => ({ ...prev, devicesTrialStart: new Date().toISOString() }));
          }
        };

        const syncDeviceNow = async (deviceName, deviceType) => {
          if (deviceProtectionLocked) {
            onToast("Protected sync mode is on. Configure the backend before public sync.", "error");
            return;
          }
          if (devicesLocked) {
            onToast("Trial expired. Upgrade to Pro to continue syncing devices.", "error");
            return;
          }
          try {
            const nativePayload = await performNativeHealthSync(deviceName);
            const result = await syncProtectedHealthData(nativePayload);
            const remoteState = await hydrateDeviceState();
            onUpdate(prev => ({
              ...prev,
              connectedDevices: remoteState?.connectedDevices || (prev.connectedDevices || []).map(d => d.name === deviceName
                ? {
                    ...d,
                    type: deviceType,
                    status: "syncing",
                    source: nativePayload.source,
                    lastSyncAt: result?.syncedAt || new Date().toISOString(),
                  }
                : d),
              devicesTrialStart: remoteState?.trialStartedAt ?? prev.devicesTrialStart,
            }));
            onToast(`${deviceName} synced from ${nativePayload.source === "healthkit" ? "Apple Health" : "Health Connect"}`);
            haptic.success();
          } catch (error) {
            onToast(error.message || "Could not sync live health data on this device.", "error");
          }
        };

        const connectDevice = async (deviceName, deviceType) => {
          if (deviceBusy === deviceName) return;
          if (deviceProtectionLocked) {
            onToast("Protected sync mode is on. Configure a real device backend before enabling public sync.", "error");
            return;
          }
          if (devicesLocked) { onToast("Trial expired. Upgrade to Pro to use device sync.", "error"); return; }
          setDeviceBusy(deviceName);
          if (!devicesTrialStart) startTrial();
          const labels = getActionLabels(deviceType, isConnected(deviceName));
          if (isConnected(deviceName)) {
            try {
              await syncProtectedDevice({ action: "disconnect", deviceName, deviceType });
            } catch (error) {
              setDeviceBusy("");
              onToast(error.message || "Could not disconnect device.", "error");
              return;
            }
            const remoteState = await hydrateDeviceState();
            onUpdate(prev => ({
              ...prev,
              connectedDevices: remoteState?.connectedDevices || (prev.connectedDevices || []).filter(d => d.name !== deviceName),
              devicesTrialStart: remoteState?.trialStartedAt ?? prev.devicesTrialStart,
            }));
            onToast(`${deviceName} removed from your account.`);
            haptic.light();
            setDeviceBusy("");
            return;
          }
          try {
            const result = await syncProtectedDevice({ action: "connect", deviceName, deviceType });
            const remoteState = await hydrateDeviceState();
            onUpdate(prev => ({
              ...prev,
              devicesTrialStart: remoteState?.trialStartedAt || prev.devicesTrialStart || result?.trialStartedAt || prev.devicesTrialStart,
              connectedDevices: remoteState?.connectedDevices || [
                ...(prev.connectedDevices || []),
                {
                  name: deviceName,
                  type: deviceType,
                  connectedAt: new Date().toISOString(),
                  status: result?.status || (deviceBackendReady ? (IS_NATIVE_APP ? "connected" : deviceType === "scale" ? "paired" : "linked") : "preview"),
                  source: deviceBackendReady ? (IS_NATIVE_APP ? NATIVE_PLATFORM || "native" : "web") : "preview",
                },
              ],
            }));
            if (deviceBackendReady && !IS_NATIVE_APP) {
              onToast(deviceType === "scale"
                ? `${deviceName} paired to your account.`
                : `${deviceName} linked to your account.`);
            } else {
              onToast(deviceBackendReady ? `${deviceName} ${labels.success}.` : `${deviceName} linked in preview mode.`);
            }
            haptic.success();
            if (deviceBackendReady && IS_NATIVE_APP) {
              await syncDeviceNow(deviceName, deviceType);
            }
          } catch (error) {
            onToast(error.message || "Could not connect device.", "error");
          } finally {
            setDeviceBusy("");
          }
        };

        const WEARABLES = [
          { name: "Apple Watch", icon: "🍎", desc: "Sync via Apple HealthKit — workouts, heart rate, steps, calories", type: "wearable" },
          { name: "Fitbit", icon: "💚", desc: "Steps, heart rate, sleep quality, active zone minutes", type: "wearable" },
          { name: "Garmin", icon: "🔵", desc: "Training load, recovery advisor, VO2 max estimate", type: "wearable" },
          { name: "Samsung Galaxy Watch", icon: "💜", desc: "Samsung Health sync — body composition, ECG, SpO2", type: "wearable" },
          { name: "Whoop", icon: "🟡", desc: "Strain score, recovery score, sleep performance", type: "wearable" },
        ];
        const SCALES = [
          { name: "Withings Body+", desc: "Weight, BMI, body fat, muscle mass, bone mass", rating: "4.6" },
          { name: "Renpho ES-CS20M", desc: "13 body metrics via Bluetooth, unlimited users", rating: "4.5" },
          { name: "Eufy Smart Scale P2", desc: "Wi-Fi body comp, Apple Health & Google Fit sync", rating: "4.7" },
          { name: "Garmin Index S2", desc: "Wi-Fi smart scale, multi-user, Garmin Connect", rating: "4.4" },
          { name: "Wyze Scale X", desc: "12 body metrics, heart rate on scale", rating: "4.3" },
        ];

        return (
        <div>
          {/* Trial banner */}
          <div className="card" style={{ marginBottom: 12, background: devicesLocked ? "#1C1111" : "#0A1F0A", borderColor: devicesLocked ? "#7F1D1D" : "#14532D" }}>
            {deviceProtectionLocked ? (
              <>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#EF4444", marginBottom: 4 }}>Protected Sync Locked</p>
                <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.5 }}>
                  This production build blocks pretend device sync. Add `VITE_DEVICE_SYNC_API_BASE` before letting users connect wearables or scales.
                </p>
              </>
            ) : devicesLocked ? (
              <>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#EF4444", marginBottom: 4 }}>Device Trial Expired</p>
                <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.5 }}>
                  Your 30-day free trial has ended. Upgrade to Pro to continue syncing your wearable devices and smart scales.
                </p>
              </>
            ) : trialStart ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#22C55E" }}>Free Trial Active</p>
                  <span style={{ fontSize: 12, fontWeight: 800, color: trialRemaining <= 7 ? "#F59E0B" : "#22C55E", background: trialRemaining <= 7 ? "#1A1500" : "#0A1F0A", padding: "3px 10px", borderRadius: 6 }}>
                    {trialRemaining} days left
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "#737373", marginTop: 4 }}>
                  Connect any device for free. After trial, device sync requires Pro.
                  {trialRemaining <= 7 && " Your trial is ending soon!"}
                </p>
                {previewMode && <p style={{ fontSize: 11, color: "#F59E0B", marginTop: 6 }}>Preview mode is active until a real sync backend is configured.</p>}
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#22C55E", marginBottom: 4 }}>Free for 30 Days</p>
                <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.5 }}>
                  Connect any wearable device or smart scale free for 30 days. No credit card needed. After the trial, device sync becomes a Pro feature.
                </p>
                {previewMode && <p style={{ fontSize: 11, color: "#F59E0B", marginTop: 6 }}>Preview mode is active until a real sync backend is configured.</p>}
              </>
            )}
          </div>

          {/* Connected devices summary */}
          {(connectedDevices || []).length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <p className="label" style={{ marginBottom: 8 }}>Devices On This Account ({connectedDevices.length})</p>
              {connectedDevices.map((d, i) => {
                const meta = getDeviceStatusMeta(d);
                return (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < connectedDevices.length - 1 ? "1px solid #1A1A1A" : "none" }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</p>
                    <p style={{ fontSize: 10, color: "#525252" }}>
                      Since {new Date(d.connectedAt).toLocaleDateString()}
                      {d.lastSyncAt ? ` • Last sync ${new Date(d.lastSyncAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot, display: "inline-block" }} />
                    <span style={{ fontSize: 11, color: meta.dot, fontWeight: 700 }}>
                      {meta.label}
                    </span>
                    {IS_NATIVE_APP && (
                      <button
                        onClick={() => syncDeviceNow(d.name, d.type)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #14532D", background: "#0A1F0A", color: "#22C55E", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                      >
                        Sync Now
                      </button>
                    )}
                  </div>
                </div>
              )})}
            </div>
          )}

          {/* Wearable Devices */}
          <div className="card" style={{ marginBottom: 12, opacity: devicesLocked || deviceProtectionLocked ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1E1E1E,#2A2A2A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⌚</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>Wearable Devices</p>
                <p style={{ fontSize: 12, color: "#737373" }}>Sync workouts, heart rate & calories — free to connect</p>
              </div>
            </div>
            {WEARABLES.map((device, i) => {
              const connected = isConnected(device.name);
              const meta = getDeviceStatusMeta(getConnectedDevice(device.name));
              return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i > 0 ? "1px solid #1A1A1A" : "none" }}>
                <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{device.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{device.name}</p>
                  <p style={{ fontSize: 11, color: "#525252" }}>{device.desc}</p>
                  {connected && <p style={{ fontSize: 11, color: meta.dot, marginTop: 4 }}>{meta.detail}</p>}
                </div>
                <button onClick={() => connectDevice(device.name, device.type)} disabled={deviceProtectionLocked || deviceBusy === device.name}
                  style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${connected ? "#22C55E" : "#262626"}`,
                    background: connected ? "#0A1F0A" : "#141414", color: connected ? "#22C55E" : "#737373",
                    fontSize: 12, fontWeight: 700, cursor: deviceProtectionLocked || deviceBusy === device.name ? "not-allowed" : "pointer", minWidth: 85, textAlign: "center", opacity: deviceBusy === device.name ? 0.65 : 1 }}>
                  {deviceBusy === device.name ? "Working..." : getActionLabels(device.type, connected).label}
                </button>
              </div>
              );
            })}
          </div>

          {/* Smart Scales */}
          <div className="card" style={{ marginBottom: 12, opacity: devicesLocked || deviceProtectionLocked ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1E1E1E,#2A2A2A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⚖️</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>Smart Scales</p>
                <p style={{ fontSize: 12, color: "#737373" }}>Auto-log weight & body composition — free to pair</p>
              </div>
            </div>
            {SCALES.map((scale, i) => {
              const connected = isConnected(scale.name);
              const meta = getDeviceStatusMeta(getConnectedDevice(scale.name));
              return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i > 0 ? "1px solid #1A1A1A" : "none" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 20 }}>⚖️</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{scale.name}</p>
                  <p style={{ fontSize: 11, color: "#525252" }}>{scale.desc}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700 }}>★ {scale.rating}</span>
                  </div>
                  {connected && <p style={{ fontSize: 11, color: meta.dot, marginTop: 4 }}>{meta.detail}</p>}
                </div>
                <button onClick={() => connectDevice(scale.name, "scale")} disabled={deviceProtectionLocked || deviceBusy === scale.name}
                  style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${connected ? "#3B82F6" : "#262626"}`,
                    background: connected ? "#0A1F3A" : "#141414", color: connected ? "#3B82F6" : "#737373",
                    fontSize: 12, fontWeight: 700, cursor: deviceProtectionLocked || deviceBusy === scale.name ? "not-allowed" : "pointer", whiteSpace: "nowrap", minWidth: 75, textAlign: "center", opacity: deviceBusy === scale.name ? 0.65 : 1 }}>
                  {deviceBusy === scale.name ? "Working..." : getActionLabels("scale", connected).label}
                </button>
              </div>
              );
            })}
          </div>

          {/* Info card */}
          <div className="card" style={{ padding: 16, background: "#0A1F0A", borderColor: "#14532D" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#22C55E", marginBottom: 4 }}>How it works</p>
            <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.6, marginBottom: 8 }}>
              Wearables and scales now save real link and pair state to your account. On the web app, wearables are linked and scales are paired.
              Live health data still comes from the native iPhone or Android app, where HealthKit or Health Connect permissions can be granted.
            </p>
            <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.6 }}>
              Connecting and pairing devices is always free. The 30-day trial covers ongoing data syncing.
              After the trial period, an active Pro subscription is needed for continuous sync.
            </p>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// ── SETTINGS ──
function SettingsPage({ settings, reminders, onUpdate, onLogout, user, onClearData, onLoadSample, premium, onTogglePremium }) {
  const restOpts = [30, 45, 60, 90, 120, 180, 300];
  const { notifPerm, requestPermission } = reminders;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const [locLoading, setLocLoading] = useState(false);
  const [locStatus, setLocStatus] = useState("");
  const [gymDraft, setGymDraft] = useState({
    name: settings.mainGymName || "",
    address: settings.mainGymAddress || "",
  });
  const showTestingTools = !IS_PRODUCTION_BUILD || RELEASE_PROTECTION.allowSeedTestAccount;
  const patchSettings = useCallback((patch) => onUpdate({ ...DEFAULT_SETTINGS, ...settings, ...patch }), [onUpdate, settings]);
  useEffect(() => {
    setGymDraft({
      name: settings.mainGymName || "",
      address: settings.mainGymAddress || "",
    });
  }, [settings.mainGymName, settings.mainGymAddress]);

  const exportData = () => {
    const d = store.getData(user);
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `workoutbuddy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importData = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.splits && data.logs) {
          store.setData(user, data);
          window.location.reload();
        }
      } catch { alert("Invalid backup file"); }
    };
    input.click();
  };

  const saveCurrentSpotAsGym = async () => {
    setLocStatus("");
    setLocLoading(true);
    try {
      const pos = await getCurrentCoords();
      patchSettings({
        mainGymName: gymDraft.name.trim(),
        mainGymCoords: { lat: pos.lat, lng: pos.lng },
        mainGymAddress: gymDraft.address.trim() || `Saved from current location (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`,
      });
      setLocStatus(`Saved your current location with ±${Math.round(pos.accuracy || 0)}m accuracy.`);
    } catch (e) {
      setLocStatus(e?.message || "Could not save your current location.");
    }
    setLocLoading(false);
  };

  const saveGymDetails = () => {
    const nextName = gymDraft.name.trim();
    const nextAddress = gymDraft.address.trim();
    if (!nextName && !nextAddress) {
      setLocStatus("Add a gym name or address first.");
      return;
    }
    patchSettings({
      mainGymName: nextName,
      mainGymAddress: nextAddress,
    });
    setLocStatus("Saved your main gym details.");
  };

  const gymIsDirty = gymDraft.name !== (settings.mainGymName || "") || gymDraft.address !== (settings.mainGymAddress || "");
  const directionsUrl = getGoogleMapsDirectionsUrl({
    ...settings,
    mainGymName: gymDraft.name.trim() || settings.mainGymName,
    mainGymAddress: gymDraft.address.trim() || settings.mainGymAddress,
  });

  return (
    <div className="fade-in">
      <h1 className="page-h1">Settings</h1>

      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p className="label">Account</p>
            <p style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{user}</p>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#22C55E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#000" }}>{user[0].toUpperCase()}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 10, borderColor: "#1A3A1A" }}>
        <p className="label" style={{ marginBottom: 8 }}>Protection</p>
        <p style={{ fontSize: 12, color: "#737373", marginBottom: 8 }}>
          Build mode: <strong style={{ color: "#E5E5E5" }}>{APP_MODE}</strong>
        </p>
        <div style={{ display: "grid", gap: 6 }}>
          {[
            ["Email OTP", PROTECTION_STATUS.authProtected, RELEASE_PROTECTION.authApiBase ? "backend configured" : RELEASE_PROTECTION.allowDemoOtp ? "demo mode allowed" : "locked"],
            ["Billing", PROTECTION_STATUS.billingProtected, RELEASE_PROTECTION.billingApiBase ? "backend configured" : RELEASE_PROTECTION.allowDemoBilling ? "demo mode allowed" : "locked"],
            ["Device Sync", PROTECTION_STATUS.deviceSyncProtected, RELEASE_PROTECTION.deviceSyncApiBase ? "backend configured" : RELEASE_PROTECTION.allowDemoDeviceSync ? "preview mode allowed" : "locked"],
          ].map(([label, ready, status]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#A3A3A3" }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: ready ? "#22C55E" : "#F59E0B" }}>{status}</span>
            </div>
          ))}
        </div>
      </div>

      {!isStandalone && (
        <div className="card" style={{ marginBottom: 10, borderColor: "#1A3A1A" }}>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Install as App</p>
          {isIOS ? (
            <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.5 }}>
              Tap <strong>Share</strong> (bottom bar) then <strong>Add to Home Screen</strong>. This gives you a full-screen app with no browser bar.
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.5 }}>Open in Chrome/Safari and add to home screen for the full app experience.</p>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 10 }}>Rest Timer</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {restOpts.map(s => (
            <button key={s} onClick={() => patchSettings({ restTime: s })}
              style={{ padding: "8px 14px", background: settings.restTime === s ? "#0A1F0A" : "#141414", border: `1px solid ${settings.restTime === s ? "#22C55E" : "#262626"}`,
                borderRadius: 6, color: settings.restTime === s ? "#22C55E" : "#737373", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              {s >= 60 ? `${s / 60}m` : `${s}s`}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 8 }}>Main Gym</p>
        <p style={{ fontSize: 12, color: "#737373", marginBottom: 10, lineHeight: 1.55 }}>
          Save your main gym once so the app can estimate travel time and jump into Google Maps directions from the Workout tab.
        </p>
        <p className="label" style={{ marginBottom: 6 }}>Gym Name</p>
        <input className="input" placeholder="Downtown Barbell Club" value={gymDraft.name} onChange={e => setGymDraft(prev => ({ ...prev, name: e.target.value }))} />
        <p className="label" style={{ marginBottom: 6 }}>Gym Address or note</p>
        <input className="input" placeholder="123 Main St, New York, NY" value={gymDraft.address} onChange={e => setGymDraft(prev => ({ ...prev, address: e.target.value }))} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button className="btn-accent" onClick={saveGymDetails} disabled={!gymIsDirty} style={{ width: "auto", minWidth: 138, opacity: gymIsDirty ? 1 : 0.55 }}>
            {gymIsDirty ? "Save Gym" : "Gym Saved"}
          </button>
          <button className="btn-ghost" onClick={saveCurrentSpotAsGym} style={{ width: "auto", minWidth: 168 }}>
            {locLoading ? "Saving..." : "Use current spot as gym"}
          </button>
          {directionsUrl && (
            <button className="btn-accent" onClick={() => window.open(directionsUrl, "_blank", "noopener,noreferrer")} style={{ width: "auto", minWidth: 146 }}>
              Open Google Maps
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#111111", border: "1px solid #1F1F1F" }}>
          <p style={{ fontSize: 12, color: "#A3A3A3", lineHeight: 1.55 }}>
            {settings.mainGymCoords
              ? `Saved gym location: ${settings.mainGymCoords.lat.toFixed(4)}, ${settings.mainGymCoords.lng.toFixed(4)}`
              : "Tip: if you are standing at your gym, tap the button above and the app will save that spot for ETA checks."}
          </p>
          {locStatus && <p style={{ fontSize: 11, color: locStatus.includes("Saved") ? "#22C55E" : "#F59E0B", marginTop: 6 }}>{locStatus}</p>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 8 }}>Music</p>
        <p style={{ fontSize: 12, color: "#737373", marginBottom: 10, lineHeight: 1.55 }}>
          Paste a public Spotify or Apple Music playlist or album link. The Workout tab will show an in-app player so you do not need to leave the app.
        </p>
        <p className="label" style={{ marginBottom: 6 }}>Spotify URL</p>
        <input className="input" placeholder="https://open.spotify.com/playlist/..." value={settings.spotifyUrl || ""} onChange={e => patchSettings({ spotifyUrl: e.target.value.trim() })} />
        <p className="label" style={{ marginBottom: 6 }}>Apple Music URL</p>
        <input className="input" placeholder="https://music.apple.com/playlist/..." value={settings.appleMusicUrl || ""} onChange={e => patchSettings({ appleMusicUrl: e.target.value.trim() })} />
        <p className="label" style={{ marginBottom: 6 }}>Default player</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["spotify", "Spotify"],
            ["apple", "Apple Music"],
          ].map(([id, label]) => (
            <button
              key={id}
              className="btn-ghost"
              onClick={() => patchSettings({ preferredMusicProvider: id })}
              style={{
                width: "auto",
                minWidth: 110,
                borderColor: settings.preferredMusicProvider === id ? "#22C55E" : "#262626",
                color: settings.preferredMusicProvider === id ? "#22C55E" : "#737373",
                background: settings.preferredMusicProvider === id ? "#0A1F0A" : "#141414",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 10 }}>Workout Reminders</p>
        {notifPerm !== "granted" ? (
          <div>
            <p style={{ fontSize: 13, color: "#737373", marginBottom: 8 }}>Get notified when it's time to train</p>
            <button className="btn-accent" onClick={async () => {
              const perm = await requestPermission();
              if (perm === "granted") patchSettings({ reminderEnabled: true, reminderTime: "18:00", reminderDays: [1, 2, 3, 4, 5] });
            }} style={{ padding: "10px 16px" }}>Enable Notifications</button>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Reminders</span>
              <button onClick={() => patchSettings({ reminderEnabled: !settings.reminderEnabled })}
                style={{ width: 44, height: 24, borderRadius: 12, background: settings.reminderEnabled ? "#22C55E" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.reminderEnabled ? 22 : 2, transition: "left .2s" }} />
              </button>
            </div>
            {settings.reminderEnabled && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#737373" }}>Time: </span>
                  <input type="time" value={settings.reminderTime || "18:00"}
                    onChange={e => patchSettings({ reminderTime: e.target.value })}
                    style={{ background: "#141414", border: "1px solid #262626", borderRadius: 6, color: "#E5E5E5", padding: "4px 8px", fontSize: 14, outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => {
                    const days = settings.reminderDays || [1, 2, 3, 4, 5];
                    const active = days.includes(i);
                    return (
                      <button key={i} onClick={() => {
                        const nd = active ? days.filter(x => x !== i) : [...days, i];
                        patchSettings({ reminderDays: nd });
                      }} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${active ? "#22C55E" : "#262626"}`,
                        background: active ? "#0A1F0A" : "#141414", color: active ? "#22C55E" : "#525252",
                        fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{d}</button>
                    );
                  })}
                </div>
                {/* Water & protein reminders */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1C1C1C" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Water Reminders (every 2h)</span>
                    <button onClick={() => patchSettings({ waterReminder: !settings.waterReminder })}
                      style={{ width: 44, height: 24, borderRadius: 12, background: settings.waterReminder ? "#3B82F6" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.waterReminder ? 22 : 2, transition: "left .2s" }} />
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Protein Reminders (every 4h)</span>
                    <button onClick={() => patchSettings({ proteinReminder: !settings.proteinReminder })}
                      style={{ width: 44, height: 24, borderRadius: 12, background: settings.proteinReminder ? "#A855F7" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.proteinReminder ? 22 : 2, transition: "left .2s" }} />
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Lock-screen rest alerts</span>
                      <p style={{ fontSize: 11, color: "#525252", marginTop: 2 }}>Schedules a native timer alert when you lock your phone between sets.</p>
                    </div>
                    <button onClick={() => patchSettings({ lockScreenRestAlerts: !settings.lockScreenRestAlerts })}
                      style={{ width: 44, height: 24, borderRadius: 12, background: settings.lockScreenRestAlerts ? "#F59E0B" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.lockScreenRestAlerts ? 22 : 2, transition: "left .2s" }} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 8 }}>Data</p>
        <p style={{ fontSize: 12, color: "#525252", marginBottom: 10 }}>All data is stored on this device in your browser. Export to keep a backup.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={exportData} style={{ flex: 1 }}>Export Backup</button>
          <button className="btn-ghost" onClick={importData} style={{ flex: 1 }}>Import Backup</button>
        </div>
      </div>

      {showTestingTools && (
        <div className="card" style={{ marginBottom: 10 }}>
          <p className="label" style={{ marginBottom: 8 }}>Testing</p>
          <button className="btn-ghost" onClick={() => { if (window.confirm("Load 6 weeks of sample workout data?")) onLoadSample(); }} style={{ width: "100%", marginBottom: 8 }}>
            Load Sample Data (for testing)
          </button>
          <button className="btn-ghost" onClick={onTogglePremium} style={{ width: "100%", borderColor: premium ? "#F59E0B" : "#262626", color: premium ? "#F59E0B" : "#A3A3A3" }}>
            {premium ? "Disable Premium (testing)" : "Enable Premium (testing)"}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 4 }}>App</p>
        <p style={{ fontSize: 13, color: "#737373" }}>{APP_BRAND} v7.1{premium ? " Pro" : ""}</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>AI Coach powered by Groq (Llama 3.3 70B)</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Science-based training with RPE tracking and proactive coach fixes</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Free calorie tracking, gym ETA, water reminders, and in-app music embeds</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Apple Watch, Fitbit, Garmin, Google Maps, Spotify, and Apple Music ready</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Data encrypted & stored locally on your device</p>
        <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
          <button onClick={() => window.open("https://musclebuilder.app/privacy", "_blank")}
            style={{ background: "none", border: "none", color: "#404040", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>Privacy Policy</button>
          <button onClick={() => window.open("https://musclebuilder.app/terms", "_blank")}
            style={{ background: "none", border: "none", color: "#404040", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>Terms of Service</button>
        </div>
      </div>

      <button className="btn-danger-sm" onClick={() => { if (window.confirm("Clear all workout data?")) onClearData(); }} style={{ width: "100%", marginBottom: 8 }}>Clear All Data</button>
      <button style={{ width: "100%", padding: 14, background: "#1C1C1C", border: "1px solid #262626", borderRadius: 8, color: "#EF4444", fontSize: 15, fontWeight: 600, cursor: "pointer" }} onClick={onLogout}>Sign Out</button>
    </div>
  );
}

// ── MAIN APP ──
export default function App() {
  const [user, setUser] = useState(() => store.getSession());
  const [pg, setPg] = useState("coach");
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [booting, setBooting] = useState(() => !!store.getSession());
  const reminders = useReminders(data?.settings || DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (!user) {
        if (!cancelled) {
          setData(null);
          setBooting(false);
        }
        return;
      }

      setBooting(true);
      let resolvedUser = user;

      if (RELEASE_PROTECTION.authApiBase) {
        if (!authSession.get()) {
          store.setSession(null);
          if (!cancelled) {
            setUser(null);
            setData(null);
            setBooting(false);
          }
          return;
        }
        try {
          const session = await fetchProtectedSession();
          const remoteEmail = session?.user?.email ? session.user.email.toLowerCase() : resolvedUser;
          if (remoteEmail !== resolvedUser) {
            resolvedUser = remoteEmail;
            store.setSession(remoteEmail);
          }
        } catch {
          authSession.clear();
          store.setSession(null);
          if (!cancelled) {
            setUser(null);
            setData(null);
            setPg("coach");
            setBooting(false);
          }
          return;
        }
      }

      const d = store.getData(resolvedUser) || JSON.parse(JSON.stringify(EMPTY));
      d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      if (!d.chat) d.chat = [];
      if (!d.splits) d.splits = [];
      if (!d.logs) d.logs = [];
      if (!d.nutrition) d.nutrition = { profile: null, foodLog: [], waterLog: [] };
      if (!d.bodyWeight) d.bodyWeight = [];
      if (d.premium === undefined) d.premium = false;
      if (!d.premiumPlan) d.premiumPlan = null;
      if (!d.connectedDevices) d.connectedDevices = [];
      if (d.devicesTrialStart === undefined) d.devicesTrialStart = null;

      if (RELEASE_PROTECTION.billingApiBase) {
        try {
          const billing = await fetchProtectedBillingStatus();
          if (billing) {
            d.premium = !!billing.premium;
            d.premiumPlan = billing.plan ? {
              ...(d.premiumPlan || {}),
              plan: billing.plan,
              source: billing.source || "server",
              updatedAt: billing.updatedAt || new Date().toISOString(),
            } : null;
          }
        } catch {}
      } else if (IS_NATIVE_APP && getRevenueCatApiKey()) {
        try {
          await ensureNativePurchasesConfigured(resolvedUser);
          const nativeInfo = await Purchases.getCustomerInfo();
          const entitlement = getActiveEntitlement(nativeInfo?.customerInfo);
          d.premium = !!entitlement;
          d.premiumPlan = entitlement ? {
            ...(d.premiumPlan || {}),
            plan: d.premiumPlan?.plan || "native",
            source: "revenuecat",
            updatedAt: new Date().toISOString(),
          } : d.premiumPlan;
        } catch {}
      }

      if (RELEASE_PROTECTION.deviceSyncApiBase) {
        try {
          const deviceState = await fetchProtectedDeviceState();
          if (deviceState) {
            d.connectedDevices = deviceState.connectedDevices || d.connectedDevices;
            d.devicesTrialStart = deviceState.trialStartedAt ?? d.devicesTrialStart;
          }
        } catch {}
      }

      store.setData(resolvedUser, d);
      if (!cancelled) {
        if (resolvedUser !== user) setUser(resolvedUser);
        setData(d);
        setBooting(false);
      }
    };

    hydrate();
    return () => { cancelled = true; };
  }, [user]);

  const save = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (user) store.setData(user, next);
      return next;
    });
  }, [user]);

  const showToast = useCallback((msg, type = "success") => setToast({ msg, type }), []);
  const login = u => { store.setSession(u); setUser(u); setBooting(true); };
  const logout = async () => {
    await logoutProtectedSession();
    authSession.clear();
    store.setSession(null);
    setUser(null);
    setData(null);
    setPg("coach");
  };

  if (!user) return <><style>{CSS}</style><Auth onLogin={login} /></>;
  if (booting || !data) return <><style>{CSS}</style><div className="auth-page"><div className="auth-box"><div className="auth-logo">{APP_INITIALS}</div><h1 className="auth-h1">Securing session</h1><p className="auth-p">Loading your encrypted account and sync state…</p></div></div></>;

  const TAB_ICONS = {
    coach: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 9a7 7 0 0 1-7 7 7 7 0 0 1-7-7"/><path d="M12 16v6"/><path d="M8 22h8"/></svg>,
    split: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    workout: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M12 2v20"/><path d="M2 12h3"/><path d="M19 12h3"/><rect x="5" y="4" width="3" height="16" rx="1"/><rect x="16" y="4" width="3" height="16" rx="1"/></svg>,
    nutrition: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    analytics: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-8"/></svg>,
    settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  };
  const tabs = [
    { id: "coach", label: "Coach" },
    { id: "split", label: "Split" },
    { id: "workout", label: "Workout" },
    { id: "nutrition", label: "Nutrition" },
    { id: "analytics", label: "Analytics" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <>
      <style>{CSS}</style>
      {toast && <Toast message={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      <div className="app-shell">
        {/* Desktop sidebar */}
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="logo-mark">{APP_INITIALS}</div>
            <span className="logo-text">{APP_BRAND}</span>
          </div>
          <nav className="sidebar-nav">
            {tabs.map(t => (
              <div key={t.id} className={`nav-item ${pg === t.id ? "nav-item-active" : ""}`} onClick={() => setPg(t.id)}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {TAB_ICONS[t.id]}
                  {t.label}
                </span>
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="sidebar-user">{user[0].toUpperCase()}</div>
            <span className="sidebar-email">{user}</span>
          </div>
        </aside>

        {/* Content */}
        <main className="main-content">
          {pg === "coach" && <CoachPage chat={data.chat} splits={data.splits} onUpdate={save} />}
          {pg === "split" && (
            <SplitPage splits={data.splits}
              onUpdate={(i, d2) => save(prev => { const s = [...prev.splits]; s[i] = d2; return { ...prev, splits: s }; })}
              onSetSplits={s => save(prev => ({ ...prev, splits: s }))}
              onNav={setPg} />
          )}
          {pg === "workout" && (
            <WorkoutPage splits={data.splits} logs={data.logs} restTime={data.settings?.restTime || 90} settings={data.settings}
              onLogWorkout={l => { save(prev => ({ ...prev, logs: [...prev.logs, l] })); showToast("Workout logged"); }}
              onToast={showToast} />
          )}
          {pg === "nutrition" && (
            <NutritionPage nutrition={data.nutrition} bodyWeight={data.bodyWeight} onUpdate={save} onToast={showToast}
              connectedDevices={data.connectedDevices} devicesTrialStart={data.devicesTrialStart} premium={data.premium}
              onUpgradePremium={(details) => save(prev => ({ ...prev, premium: true, premiumPlan: details || null }))}
              userEmail={user} />
          )}
          {pg === "analytics" && <AnalyticsPage logs={data.logs} />}
          {pg === "settings" && (
            <SettingsPage settings={data.settings || { ...DEFAULT_SETTINGS }}
              reminders={reminders}
              onUpdate={s => save(prev => ({ ...prev, settings: s }))}
              onLogout={logout} user={user}
              premium={data.premium}
              onTogglePremium={() => save(prev => ({ ...prev, premium: !prev.premium }))}
              onClearData={() => { save(JSON.parse(JSON.stringify(EMPTY))); showToast("Data cleared"); }}
              onLoadSample={() => {
                const sample = generateSampleData();
                save(prev => ({
                  ...sample,
                  settings: { ...DEFAULT_SETTINGS, ...(prev.settings || {}) },
                  premium: prev.premium,
                  premiumPlan: prev.premiumPlan,
                  connectedDevices: prev.connectedDevices || [],
                  devicesTrialStart: prev.devicesTrialStart || null,
                }));
                showToast("Sample data loaded");
              }} />
          )}
        </main>

        {/* Mobile bottom nav */}
        <div className="mobile-nav">
          {tabs.map(t => (
            <button key={t.id} className={`mob-tab ${pg === t.id ? "mob-tab-active" : ""}`} onClick={() => { haptic.light(); setPg(t.id); }}>
              <span style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>{TAB_ICONS[t.id]}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body,#root{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#0A0A0A;color:#E5E5E5;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
input,button,select,textarea{font-family:inherit}
button,[role="button"],input,select,textarea{touch-action:manipulation}
::selection{background:rgba(34,197,94,.3)}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#262626;border-radius:2px}
input[type="number"]::-webkit-inner-spin-button,input[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type="number"]{-moz-appearance:textfield}

/* Animation */
.fade-in{animation:fadeUp .3s cubic-bezier(.16,1,.3,1) both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* Layout */
.app-shell{display:flex;min-height:100vh;min-height:100dvh;width:100%;overflow-x:hidden}
.sidebar{width:220px;background:#0C0C0C;border-right:1px solid #1A1A1A;padding:20px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
.sidebar-head{display:flex;align-items:center;gap:10px;padding:0 16px;margin-bottom:32px}
.logo-mark{width:34px;height:34px;border-radius:12px;background:radial-gradient(circle at top left,rgba(255,255,255,.22),transparent 42%),linear-gradient(135deg,#34D399,#22C55E 55%,#16A34A);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#04110A;box-shadow:0 10px 24px rgba(34,197,94,.22),inset 0 1px 0 rgba(255,255,255,.3)}
.logo-text{font-size:15px;font-weight:800;letter-spacing:-.2px}
.sidebar-nav{flex:1}
.nav-item{padding:10px 16px;color:#737373;cursor:pointer;font-size:13px;font-weight:600;border-left:2px solid transparent;transition:all .15s;margin:1px 0}
.nav-item:hover{color:#E5E5E5;background:#141414}
.nav-item-active{color:#22C55E;border-left-color:#22C55E;background:linear-gradient(90deg,#0A1F0A,transparent)}
.sidebar-foot{padding:14px 16px;border-top:1px solid #1A1A1A;display:flex;align-items:center;gap:10px}
.sidebar-user{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#22C55E,#16A34A);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;flex-shrink:0}
.sidebar-email{font-size:11px;color:#525252;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main-content{flex:1;margin-left:220px;padding:28px 36px 80px;width:min(1180px,calc(100vw - 220px));max-width:1180px;min-width:0}
.mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:linear-gradient(180deg,rgba(18,18,18,.84),rgba(10,10,10,.96));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid rgba(255,255,255,.06);padding:8px 8px calc(env(safe-area-inset-bottom,8px) + 8px);z-index:200;justify-content:space-between;gap:6px;box-shadow:0 -18px 38px rgba(0,0,0,.42)}
.mob-tab{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;padding:7px 4px 6px;background:none;border:none;border-radius:16px;color:#6A6A6A;cursor:pointer;font-size:10px;font-weight:800;min-width:0;min-height:60px;transition:all .15s;letter-spacing:.15px}
.mob-tab svg{width:18px;height:18px}
.mob-tab-active{color:#86EFAC;background:radial-gradient(circle at top,rgba(52,211,153,.18),transparent 70%),linear-gradient(180deg,rgba(34,197,94,.16),rgba(34,197,94,.06));box-shadow:inset 0 0 0 1px rgba(74,222,128,.2),0 8px 18px rgba(34,197,94,.12)}
@media(max-width:768px){
  .sidebar{display:none}
  .main-content{margin-left:0;padding:14px 14px calc(env(safe-area-inset-bottom,0px) + 92px);padding-top:env(safe-area-inset-top,14px);max-width:100%;width:100%}
  .mobile-nav{display:flex}
}
@media(max-width:380px){
  .main-content{padding:12px 12px calc(env(safe-area-inset-bottom,0px) + 88px);padding-top:env(safe-area-inset-top,12px)}
  .page-h1{font-size:23px;margin-bottom:14px}
  .mob-tab{font-size:8px;padding:6px 2px 5px;min-height:58px}
  .card{padding:12px}
  .input{padding:10px 12px;font-size:14px}
  .btn-accent{padding:11px;font-size:14px}
}
@media(max-width:320px){
  .main-content{padding:10px 8px 84px}
  .page-h1{font-size:22px}
  .mob-tab{font-size:7px;min-height:56px}
  .mob-tab svg{width:16px;height:16px}
}
@media(min-width:769px) and (max-width:1024px){
  .main-content{padding:24px 28px 40px;width:min(920px,calc(100vw - 220px));max-width:920px}
}

/* Typography */
.page-h1{font-size:28px;font-weight:900;margin-bottom:18px;letter-spacing:-.5px;line-height:1.05}
.section-h2{font-size:16px;font-weight:700;margin:0 0 10px}
.label{font-size:10px;font-weight:800;color:#525252;text-transform:uppercase;letter-spacing:.8px}

/* Cards */
.card{background:#111111;border:1px solid #1A1A1A;border-radius:16px;padding:16px;transition:border-color .15s,transform .15s;box-shadow:0 10px 24px rgba(0,0,0,.12)}
.beginner-guide{display:flex;gap:14px;align-items:center}
.guide-img{width:120px;max-width:34vw;height:auto;flex-shrink:0;border-radius:12px;border:1px solid #1F1F1F;background:#0D0D0D}
.day-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.day-card{background:#111111;border:1px solid #1A1A1A;border-radius:16px;padding:14px 16px;cursor:pointer;transition:all .15s;box-shadow:0 10px 24px rgba(0,0,0,.10)}
.day-card:hover{border-color:#333;transform:translateY(-1px)}
.day-card-start:hover{border-color:#22C55E;box-shadow:0 4px 12px rgba(34,197,94,.08)}

/* Coach */
.coach-page{display:flex;flex-direction:column;gap:18px}
.coach-hero,.coach-workspace{display:grid;grid-template-columns:minmax(0,1.5fr) 320px;gap:16px}
.coach-hero-card,.coach-summary-card,.coach-side-card{background:linear-gradient(180deg,rgba(20,20,20,.98) 0%,rgba(13,13,13,.98) 100%);border:1px solid rgba(255,255,255,.06);border-radius:22px;padding:20px;position:relative;overflow:hidden;box-shadow:0 18px 42px rgba(0,0,0,.18)}
.coach-hero-card::before{content:"";position:absolute;inset:auto -40px -40px auto;width:180px;height:180px;border-radius:999px;background:radial-gradient(circle,rgba(52,211,153,.16),transparent 68%);pointer-events:none}
.coach-hero-card::after{content:"";position:absolute;top:18px;right:18px;width:82px;height:82px;border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.06),transparent 68%);pointer-events:none}
.coach-kicker{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:linear-gradient(180deg,#102115,#0C140E);border:1px solid #255634;color:#9AF7BF;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.coach-hero-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:18px}
.coach-hero-title{font-size:34px;line-height:1.05;font-weight:900;letter-spacing:-1.2px;max-width:720px;margin-bottom:10px}
.coach-hero-copy{font-size:14px;line-height:1.7;color:#A3A3A3;max-width:700px}
.coach-bot-mark{width:58px;height:58px;border-radius:18px;background:radial-gradient(circle at top left,rgba(255,255,255,.2),transparent 34%),linear-gradient(145deg,#203426,#101010);border:1px solid #2B6A3C;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#B9FFD2;box-shadow:0 12px 26px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.1);flex-shrink:0}
.coach-stat-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
.coach-stat-card{padding:14px 16px;border-radius:16px;background:#0E0E0E;border:1px solid #1A1A1A}
.coach-stat-good{border-color:#1E3C24;background:linear-gradient(180deg,#101610,#0D0D0D)}
.coach-stat-label{display:block;font-size:10px;font-weight:800;color:#5F5F5F;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.coach-stat-value{display:block;font-size:28px;font-weight:900;letter-spacing:-.06em}
.coach-chip-row{display:flex;flex-wrap:wrap;gap:10px}
.coach-chip{padding:10px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#151515,#101010);color:#E5E5E5;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.coach-chip:hover{border-color:#4D9B64;color:#fff;transform:translateY(-1px);background:linear-gradient(180deg,#171F18,#101010)}
.coach-summary-label,.coach-launch-label{font-size:11px;font-weight:800;color:#6E6E6E;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.coach-summary-value{font-size:24px;font-weight:900;letter-spacing:-.04em;margin-bottom:8px}
.coach-summary-copy{font-size:13px;line-height:1.65;color:#A3A3A3;margin-bottom:14px}
.coach-summary-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.coach-summary-pill{padding:7px 10px;border-radius:999px;border:1px solid #2B2B2B;background:#101010;color:#D4D4D4;font-size:11px;font-weight:700}
.coach-summary-pill-good{background:#0B1B0F;border-color:#1B4B2A;color:#86EFAC}
.coach-summary-note{font-size:12px;line-height:1.6;color:#8A8A8A;padding-top:12px;border-top:1px solid #1A1A1A}
.coach-side-stack{display:grid;gap:16px;align-self:start}
.coach-side-card-muted{background:linear-gradient(180deg,#101010 0%,#0B0B0B 100%)}
.coach-side-card-header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
.coach-side-card-fixes{background:radial-gradient(circle at top right,rgba(74,222,128,.18),transparent 26%),linear-gradient(180deg,#141815 0%,#0F110F 100%);border-color:#233127;box-shadow:0 18px 40px rgba(0,0,0,.28)}
.coach-fixes-header{align-items:flex-start;gap:14px;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid #1D1D1D}
.coach-fixes-title{font-size:20px;font-weight:900;letter-spacing:-.03em;margin-bottom:4px}
.coach-fixes-copy{font-size:13px;color:#8A8A8A;line-height:1.55;max-width:240px}
.coach-fixes-pill{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:900;color:#7FF0A4;background:linear-gradient(180deg,#12311A,#0B1B10);border:1px solid #2D7A46;border-radius:999px;padding:7px 12px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(74,222,128,.1)}
.coach-fixes-pill-dot{width:8px;height:8px;border-radius:999px;background:#4ADE80;box-shadow:0 0 0 4px rgba(74,222,128,.12)}
.coach-fixes-stack{display:grid;gap:12px}
.coach-suggestion-card{background:linear-gradient(180deg,#111111 0%,#0D0D0D 100%);border:1px solid #202020;border-radius:16px;padding:14px}
.coach-suggestion-card-upgraded{padding:16px;background:radial-gradient(circle at top right,rgba(59,130,246,.08),transparent 34%),linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,0)),linear-gradient(180deg,#111111 0%,#0C0C0C 100%);border-color:#282B31;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.coach-suggestion-topline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.coach-suggestion-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:#101A12;border:1px solid #214328;color:#86EFAC;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
.coach-suggestion-rank{font-size:11px;font-weight:800;color:#5F5F5F;letter-spacing:.12em;text-transform:uppercase}
.coach-suggestion-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px}
.coach-suggestion-icon{width:34px;height:34px;border-radius:12px;background:linear-gradient(180deg,#102114,#0C1510);border:1px solid #214328;color:#86EFAC;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;flex-shrink:0;box-shadow:0 8px 18px rgba(0,0,0,.25)}
.coach-suggestion-title{font-size:15px;font-weight:850;line-height:1.25;letter-spacing:-.02em;margin-bottom:5px}
.coach-suggestion-copy{font-size:13px;color:#A3A3A3;line-height:1.62}
.coach-suggestion-terms{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.coach-term-chip{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:linear-gradient(180deg,#11161D,#0D1117);border:1px solid #2E445A;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.coach-term-chip:hover{border-color:#4B78A1;background:linear-gradient(180deg,#141B24,#0E131A)}
.coach-term-chip button{font-size:12px !important}
.coach-suggestion-actions{display:flex;gap:8px;flex-wrap:wrap}
.coach-suggestion-actions-upgraded{padding-top:2px}
.coach-fix-cta{width:auto;min-width:116px;padding:10px 14px !important;border-radius:12px !important;box-shadow:0 10px 20px rgba(34,197,94,.18)}
.coach-fix-secondary{width:auto;min-width:104px;border-radius:12px !important;background:#161616}
.coach-suggestion-card-clean .coach-suggestion-icon{background:linear-gradient(180deg,#122115,#0C130E);border-color:#1D4D29}
.inline-term-wrap{position:relative;display:inline-flex;align-items:center}
.inline-term-button{background:linear-gradient(180deg,#111923,#0D131B);border:1px solid #233549;border-radius:999px;padding:4px 10px;color:#A5D8FF;font-size:12px;font-weight:800;cursor:pointer;transition:all .15s;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.inline-term-button:hover,.inline-term-button-open{border-color:#3B82F6;color:#E7F3FF;background:linear-gradient(180deg,#122133,#0E1723)}
.inline-term-popover{position:absolute;top:calc(100% + 8px);left:0;width:min(240px,70vw);padding:11px 12px;background:#111111;border:1px solid #262626;border-radius:12px;color:#A3A3A3;font-size:12px;line-height:1.55;z-index:30;box-shadow:0 16px 36px rgba(0,0,0,.42)}
.coach-mini-list{display:grid;gap:12px}
.coach-mini-item{display:flex;gap:10px;align-items:flex-start}
.coach-mini-index{width:24px;height:24px;border-radius:999px;background:#101810;border:1px solid #214328;color:#86EFAC;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0}
.coach-mini-item p{font-size:12px;line-height:1.6;color:#B4B4B4}
.chat-container-coach{height:min(760px,calc(100vh - 210px));height:min(760px,calc(100dvh - 210px));border-radius:20px;background:linear-gradient(180deg,#0E0E0E 0%,#0A0A0A 100%)}
.chat-input-bar-coach{padding:14px 16px;background:rgba(12,12,12,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.coach-empty{display:flex;flex-direction:column;gap:18px;justify-content:center;min-height:100%}
.coach-empty-top{text-align:left;max-width:720px}
.coach-empty-badge{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#121212;border:1px solid #2A2A2A;color:#8FF0AF;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}
.coach-empty-title{font-size:30px;line-height:1.08;font-weight:900;letter-spacing:-.06em;margin-bottom:10px}
.coach-empty-copy{font-size:14px;line-height:1.7;color:#A3A3A3;max-width:620px}
.coach-empty-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.9fr);gap:14px;align-items:start}
.coach-launch-card{background:linear-gradient(180deg,#121212 0%,#0F0F0F 100%);border:1px solid #1F1F1F;border-radius:18px;padding:16px}
.coach-launch-list{display:grid;gap:10px}
.coach-launch-item{display:flex;gap:10px;align-items:center;padding:12px;border-radius:14px;background:#101010;border:1px solid #232323;color:#E5E5E5;text-align:left;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s}
.coach-launch-item:hover{border-color:#335D3E;transform:translateY(-1px)}
.coach-launch-index{color:#22C55E;font-size:10px;font-weight:900;letter-spacing:.1em}
.coach-split-ready{align-self:flex-start;background:linear-gradient(180deg,#0C180E 0%,#09120B 100%);border:1px solid #166534;border-radius:16px;padding:16px;max-width:88%}
.coach-split-title{font-size:15px;font-weight:900;margin-bottom:4px}
.coach-split-copy{font-size:12px;color:#A7F3D0;line-height:1.6;margin-bottom:10px}
@media(max-width:1100px){
  .coach-hero,.coach-workspace{grid-template-columns:1fr}
  .coach-side-stack{grid-template-columns:1fr 1fr}
}
@media(max-width:768px){
  .coach-page{gap:14px}
  .coach-hero-card,.coach-summary-card,.coach-side-card{padding:16px}
  .coach-hero-head{flex-direction:column}
  .coach-hero-title{font-size:26px}
  .coach-stat-row{grid-template-columns:repeat(3,minmax(0,1fr))}
  .coach-empty-title{font-size:24px}
  .coach-empty-grid,.coach-side-stack{grid-template-columns:1fr}
  .chat-container-coach{height:auto;min-height:68vh}
  .coach-fixes-header{padding-bottom:12px;margin-bottom:12px}
  .coach-fixes-title{font-size:18px}
  .coach-fixes-copy{max-width:none}
  .coach-suggestion-card-upgraded{padding:14px}
  .coach-suggestion-topline{margin-bottom:10px}
  .coach-suggestion-actions-upgraded{display:grid;grid-template-columns:1fr 1fr}
  .coach-fix-cta,.coach-fix-secondary{width:100%;min-width:0}
  .workout-header{flex-direction:column;align-items:stretch;padding:10px 0 12px}
  .chat-container{height:auto;min-height:72vh;border-radius:18px}
  .chat-messages{padding:14px 14px 12px}
  .chat-msg{max-width:92%}
  .chat-input-bar{padding:12px;gap:10px;position:sticky;bottom:0}
  .stats-row,.split-stats{gap:8px}
  .day-grid{grid-template-columns:1fr}
  .day-card{padding:16px}
  .sheet{max-width:100%}
  .timer-modal{padding:24px 18px}
  .summary-modal{padding:24px 18px}
  .plate-modal{padding:18px}
  .week-bar::-webkit-scrollbar{display:none}
  .inline-term-popover{width:min(220px,72vw)}
  .workout-overview-card{grid-template-columns:1fr}
  .workout-overview-title{font-size:24px}
  .workout-header-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}
  .workout-header-actions .btn-accent,.workout-header-actions .btn-ghost{width:100%}
  .workout-active-title{font-size:24px}
  .auth-page{padding:14px}
  .auth-box{max-width:420px;padding:30px 20px 22px;border-radius:18px}
}
@media(max-width:560px){
  .coach-hero-card,.coach-summary-card,.coach-side-card,.coach-launch-card{padding:14px}
  .coach-summary-card{display:none}
  .coach-hero-title{font-size:22px;line-height:1}
  .coach-hero-copy{font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .coach-bot-mark{width:46px;height:46px;border-radius:14px;font-size:13px}
  .coach-stat-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .coach-stat-card{padding:12px 10px;border-radius:14px}
  .coach-stat-label{font-size:9px;margin-bottom:6px}
  .coach-stat-value{font-size:22px}
  .coach-chip-row{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:8px;padding-bottom:4px;scrollbar-width:none;-ms-overflow-style:none}
  .coach-chip-row::-webkit-scrollbar{display:none}
  .coach-chip{flex:0 0 auto;width:auto;justify-content:center;padding:9px 12px;line-height:1.3;white-space:nowrap}
  .coach-workspace{gap:12px}
  .coach-side-stack{gap:10px}
  .coach-split-ready{max-width:100%}
  .coach-suggestion-head{gap:10px}
  .coach-side-card-header{flex-direction:column}
  .coach-suggestion-actions-upgraded{grid-template-columns:1fr}
  .coach-fixes-title{font-size:18px}
  .coach-fixes-copy{display:none}
  .coach-suggestion-card-upgraded{padding:12px}
  .coach-suggestion-title{font-size:14px}
  .coach-suggestion-copy{font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .coach-empty-title{font-size:22px}
  .coach-empty-copy{font-size:13px;line-height:1.6}
  .coach-side-card-fixes{border-radius:18px}
  .coach-fixes-header{gap:10px;padding-bottom:10px;margin-bottom:10px}
  .coach-fixes-pill{padding:6px 10px;font-size:11px}
  .coach-suggestion-topline{margin-bottom:8px}
  .coach-suggestion-rank{font-size:10px}
  .coach-suggestion-icon{width:30px;height:30px;border-radius:10px;font-size:13px}
  .coach-suggestion-terms{gap:6px;margin-bottom:10px}
  .coach-term-chip{padding:4px 8px}
  .coach-fix-cta,.coach-fix-secondary{min-height:38px;padding:9px 12px !important;font-size:12px}
  .coach-mini-list{gap:8px}
  .coach-mini-item p{font-size:11px;line-height:1.45}
  .coach-mini-index{width:20px;height:20px;font-size:10px}
  .chat-container-coach{min-height:60vh}
  .chat-input-bar-coach{padding:10px 10px 12px}
  .chat-input-bar-coach input{font-size:13px !important;padding:10px 12px !important;border-radius:10px !important}
  .split-stat,.stat-box{padding:14px 10px}
  .split-stat-num,.stat-num{font-size:20px}
  .week-day{min-width:64px}
  .week-day-name{font-size:9px}
  .ex-row{padding:12px 10px}
  .workout-session-hero{padding:14px 14px 12px;border-radius:18px}
  .workout-kicker{margin-bottom:8px}
  .workout-active-title{font-size:20px}
  .workout-header-badges .badge{font-size:11px;padding:3px 8px}
  .workout-progress-track{margin-bottom:12px}
  .workout-exercise-card{padding:14px 12px 12px}
  .workout-exercise-head{gap:10px}
  .workout-exercise-name{font-size:16px}
  .workout-exercise-copy{font-size:11px}
  .workout-set-head,.workout-set-row{grid-template-columns:24px minmax(0,1fr) minmax(0,1fr) 48px 34px;gap:5px}
  .workout-set-head{font-size:9px}
  .workout-rpe-select{padding:9px 2px;font-size:11px}
  .workout-note-row{gap:6px}
  .workout-note-input{padding:8px 9px;font-size:11px}
  .workout-start-footer{flex-direction:column;align-items:stretch}
  .workout-start-cta{text-align:center}
  .inline-term-button{font-size:11px;padding:4px 9px}
}
@media(max-width:400px){
  .page-h1{font-size:26px}
  .coach-chip{font-size:11px}
  .workout-set-head,.workout-set-row{grid-template-columns:22px minmax(0,1fr) minmax(0,1fr) 42px 32px}
  .set-inp{padding:7px 4px;font-size:13px}
  .workout-set-complete{width:30px;height:30px}
  .workout-plate-link{font-size:9px;min-width:30px}
}

/* Auth */
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0A0A;padding:20px}
.auth-box{width:100%;max-width:360px;background:#111111;border:1px solid #1A1A1A;border-radius:16px;padding:40px 28px 28px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.auth-logo{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#22C55E,#16A34A);display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:900;color:#000;margin:0 auto 18px;box-shadow:0 4px 16px rgba(34,197,94,.3)}
.auth-h1{text-align:center;font-size:24px;font-weight:900;margin-bottom:2px;letter-spacing:-.3px}
.auth-p{text-align:center;color:#737373;font-size:14px;margin-bottom:22px}
.auth-err{background:#1C1111;border:1px solid #7F1D1D;color:#FCA5A5;padding:8px 12px;border-radius:8px;font-size:13px;text-align:center;margin-bottom:12px}
.auth-switch{text-align:center;margin-top:18px;color:#737373;font-size:13px}
.auth-switch span{color:#22C55E;cursor:pointer;font-weight:600}
.auth-test{margin-top:16px;padding:12px;background:#0A0A0A;border:1px solid #1A1A1A;border-radius:10px;font-size:12px;color:#525252;text-align:center}
.auth-test strong{color:#A3A3A3}

/* Inputs */
.input{width:100%;min-height:44px;padding:12px 14px;background:#0A0A0A;border:1px solid #262626;border-radius:10px;color:#E5E5E5;font-size:15px;outline:none;margin-bottom:10px;transition:border-color .15s}
.input:focus{border-color:#22C55E50;box-shadow:0 0 0 3px rgba(34,197,94,.08)}
.input::placeholder{color:#404040}
.input.sm{padding:9px 10px;font-size:14px;margin-bottom:0}
.set-inp{padding:8px;background:#141414;border:1px solid #1C1C1C;border-radius:8px;color:#E5E5E5;font-size:14px;font-weight:600;outline:none;text-align:center;width:100%;transition:border-color .15s}
.set-inp:focus{border-color:#22C55E50;box-shadow:0 0 0 2px rgba(34,197,94,.06)}
.set-inp:disabled{opacity:.4;color:#525252}

/* Buttons */
.btn-accent{width:100%;min-height:44px;padding:12px;background:linear-gradient(135deg,#22C55E,#16A34A);color:#000;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s;box-shadow:0 2px 8px rgba(34,197,94,.2)}
.btn-accent:hover{opacity:.92;transform:translateY(-1px);box-shadow:0 4px 12px rgba(34,197,94,.3)}
.btn-accent:active{opacity:.85;transform:translateY(0)}
.btn-ghost{min-height:44px;padding:10px 16px;background:#141414;border:1px solid #262626;border-radius:10px;color:#A3A3A3;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-ghost:hover{border-color:#404040;color:#E5E5E5;background:#1A1A1A}
.btn-danger-sm{min-height:44px;padding:10px 16px;background:transparent;border:1px solid #7F1D1D;border-radius:10px;color:#737373;font-size:13px;font-weight:600;cursor:pointer;transition:all .12s}
.btn-danger-sm:hover{color:#EF4444;border-color:#EF4444}
.move-btn{background:none;border:none;color:#404040;cursor:pointer;font-size:9px;padding:4px 8px;line-height:1;min-width:32px;min-height:32px}
.move-btn:hover:not(:disabled){color:#22C55E}
.move-btn:disabled{opacity:.2}

/* Badges */
.badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;border:1px solid #1C1C1C}
.badge-orange{color:#F59E0B;background:#1A1500;border-color:#3B2F00}
.badge-green{color:#22C55E;background:#0A1F0A;border-color:#14532D}

/* Stats */
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
@media(max-width:500px){.stats-row{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.beginner-guide{flex-direction:column;align-items:stretch}.guide-img{width:100%;max-width:none}}
.stat-box{background:#111111;border:1px solid #1A1A1A;border-radius:12px;padding:16px 10px;text-align:center}
.stat-num{font-size:26px;font-weight:900;letter-spacing:-.5px}
.sv-sm{font-size:18px!important}
.stat-label{font-size:9px;color:#525252;text-transform:uppercase;letter-spacing:.8px;margin-top:4px;font-weight:800}

/* Split stats */
.split-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
@media(max-width:500px){.split-stats{grid-template-columns:repeat(2,1fr)}}
.split-stat{background:#111111;border:1px solid #1A1A1A;border-radius:10px;padding:14px 8px;text-align:center}
.split-stat-num{font-size:22px;font-weight:900;display:block;letter-spacing:-.3px}
.split-stat-label{font-size:9px;color:#525252;text-transform:uppercase;font-weight:800;display:block;margin-top:2px;letter-spacing:.5px}

/* Workout */
.workout-page{display:flex;flex-direction:column;gap:12px}
.workout-kicker{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;background:#101810;border:1px solid #1F3B24;color:#7FE5A3;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
.workout-overview-card{display:grid;grid-template-columns:minmax(0,1.2fr) 300px;gap:18px;align-items:stretch;background:radial-gradient(circle at top right,rgba(34,197,94,.12),transparent 26%),linear-gradient(180deg,#121212,#0E0E0E)}
.workout-overview-title{font-size:28px;font-weight:900;line-height:1.02;letter-spacing:-.06em;max-width:620px;margin-bottom:10px}
.workout-overview-copy{font-size:14px;line-height:1.7;color:#A3A3A3;max-width:560px}
.workout-overview-stats{display:grid;gap:10px}
.workout-overview-stat{padding:14px 16px;border-radius:16px;background:#0F0F0F;border:1px solid #1B1B1B}
.workout-overview-label{display:block;font-size:10px;font-weight:800;color:#5F5F5F;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.workout-overview-value{display:block;font-size:26px;font-weight:900;letter-spacing:-.05em}
.workout-overview-value-sm{font-size:20px}
.workout-session-hero{border-radius:22px;padding:16px 18px 14px;background:radial-gradient(circle at top right,rgba(52,211,153,.16),transparent 24%),linear-gradient(180deg,#121412,#0E0F0E);border:1px solid #223527;box-shadow:0 16px 34px rgba(0,0,0,.16)}
.workout-active-title{font-size:28px;font-weight:900;line-height:1.02;letter-spacing:-.06em;margin-bottom:8px}
.workout-header-badges{display:flex;gap:8px;flex-wrap:wrap}
.workout-header-actions{display:flex;gap:8px;align-items:center}
.workout-progress-track{height:5px;background:#1C1C1C;border-radius:999px;margin-bottom:16px;overflow:hidden}
.workout-progress-fill{height:100%;background:linear-gradient(90deg,#22C55E,#4ADE80);border-radius:999px;transition:width .4s}
.workout-exercise-card{padding:16px 16px 14px}
.workout-exercise-card-done{background:linear-gradient(180deg,#101610,#0D0D0D)}
.workout-exercise-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
.workout-exercise-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.workout-muscle-chip,.workout-compound-chip{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.workout-muscle-chip{background:#141414;border:1px solid #2A2A2A;color:#D4D4D4}
.workout-compound-chip{background:#0D1930;border:1px solid #23406D;color:#8FC5FF}
.workout-exercise-name{font-size:18px;font-weight:850;line-height:1.18;letter-spacing:-.03em;margin-bottom:4px}
.workout-exercise-copy{font-size:12px;color:#8A8A8A;line-height:1.6}
.workout-exercise-counter{min-width:42px;height:42px;border-radius:14px;background:#171717;border:1px solid #262626;color:#737373;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.workout-exercise-counter-done{background:#0E2311;border-color:#14532D;color:#86EFAC}
.workout-inline-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.workout-mini-chip{padding:7px 10px;border-radius:999px;border:1px solid #2A2A2A;background:#141414;color:#B5B5B5;font-size:11px;font-weight:700;cursor:pointer}
.workout-mini-chip-warm{background:#1A1500;border-color:#3B2F00;color:#F59E0B}
.workout-set-head,.workout-set-row{display:grid;grid-template-columns:30px minmax(0,1fr) minmax(0,1fr) 52px 38px;gap:6px;align-items:center}
.workout-set-head{font-size:10px;font-weight:800;color:#585858;margin-bottom:8px;padding:0 2px}
.workout-set-row{padding:6px 2px;border-radius:10px}
.workout-set-row-done{background:#0A1F0A}
.workout-set-index{font-size:13px;font-weight:800;color:#5F5F5F;text-align:center}
.workout-rpe-select{padding:9px 4px;background:#141414;border:1px solid #1C1C1C;border-radius:8px;font-size:12px;font-weight:700;outline:none;text-align:center;appearance:none;-webkit-appearance:none}
.workout-set-complete{width:34px;height:34px;border-radius:999px;border:2px solid #333;background:transparent;color:#404040;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
.workout-set-complete-done{border:none;background:#22C55E;color:#fff;cursor:default}
.workout-plate-link{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:#6B7280;font-size:10px;font-weight:800;cursor:pointer;min-width:34px;min-height:32px}
.workout-note-row{display:flex;align-items:center;gap:8px;margin-top:10px}
.workout-add-set{background:none;border:none;color:#7FE5A3;font-size:12px;font-weight:800;cursor:pointer;min-height:36px;padding:0 4px}
.workout-note-input{flex:1;padding:9px 10px;background:#0A0A0A;border:1px solid #1C1C1C;border-radius:10px;color:#9CA3AF;font-size:12px;outline:none}
.workout-start-card{background:linear-gradient(180deg,#121212,#0F0F0F)}
.workout-start-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.workout-start-title{font-size:18px;font-weight:850;line-height:1.15;letter-spacing:-.03em;margin-bottom:8px}
.workout-start-copy{font-size:13px;line-height:1.6;color:#8A8A8A;margin-bottom:12px}
.workout-start-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #1C1C1C}
.workout-start-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px}
.workout-start-cta{padding:10px 12px;border-radius:12px;background:#22C55E12;color:#7FE5A3;border:1px solid #14532D;font-size:13px;font-weight:800}

/* Week bar */
.week-bar{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto;padding:0 2px 6px;scroll-snap-type:x proximity}
.week-day{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:58px;cursor:pointer;transition:transform .1s;scroll-snap-align:start}
.week-day:active{transform:scale(.95)}
.week-day-num{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;transition:all .15s}
.week-day-name{font-size:10px;color:#525252;font-weight:600;white-space:nowrap}

/* Exercise row */
.ex-row{display:flex;align-items:center;padding:10px 12px;background:#141414;border-radius:12px;margin-bottom:6px;gap:10px;transition:background .1s}

/* Overlays */
.overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:300;display:flex;align-items:flex-end;justify-content:center;animation:overlayIn .2s ease}
@keyframes overlayIn{from{opacity:0}to{opacity:1}}
.sheet{background:#111111;border-radius:22px 22px 0 0;width:100%;max-width:500px;max-height:88vh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom,28px);animation:sheetUp .3s cubic-bezier(.16,1,.3,1)}
@keyframes sheetUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
.timer-modal{background:#111111;border:1px solid #1A1A1A;border-radius:20px;padding:32px 40px;text-align:center;animation:scaleIn .25s cubic-bezier(.16,1,.3,1);box-shadow:0 16px 48px rgba(0,0,0,.5);width:min(92vw,440px)}
@keyframes scaleIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
.plate-modal{background:#111111;border:1px solid #1A1A1A;border-radius:18px;padding:20px;max-width:280px;width:90%;animation:scaleIn .2s cubic-bezier(.16,1,.3,1)}
.summary-modal{background:#111111;border:1px solid #1A1A1A;border-radius:18px;padding:28px 24px;max-width:380px;width:90%;animation:scaleIn .3s cubic-bezier(.16,1,.3,1);box-shadow:0 16px 48px rgba(0,0,0,.5)}

/* Float timer */
.float-timer{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 76px);left:50%;transform:translateX(-50%);width:calc(100% - 20px);max-width:460px;background:rgba(17,17,17,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid #1A1A1A;border-radius:16px;overflow:hidden;z-index:250;cursor:pointer;animation:slideUp .25s cubic-bezier(.16,1,.3,1);box-shadow:0 4px 20px rgba(0,0,0,.4)}
@media(min-width:769px){.float-timer{bottom:16px;left:calc(220px + 50%);transform:translateX(calc(-50% - 110px))}}
@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* Workout header */
.workout-header{position:sticky;top:0;z-index:50;background:rgba(10,10,10,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 0;margin-bottom:4px}
@media(max-width:768px){.workout-header{padding-top:env(safe-area-inset-top,8px)}}

/* Chat */
.chat-container{display:flex;flex-direction:column;height:calc(100vh - 120px);height:calc(100dvh - 120px);background:#0C0C0C;border:1px solid #1A1A1A;border-radius:18px;overflow:hidden}
.chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
.chat-msg{max-width:82%;padding:11px 14px;font-size:14px;line-height:1.6;animation:fadeUp .2s ease}
.chat-msg-user{align-self:flex-end;background:linear-gradient(135deg,#22C55E,#16A34A);color:#000;border-radius:16px 16px 4px 16px;font-weight:500}
.chat-msg-bot{align-self:flex-start;background:#141414;border:1px solid #1A1A1A;border-radius:16px 16px 16px 4px;box-shadow:0 10px 24px rgba(0,0,0,.14)}
.chat-input-bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #1A1A1A;background:#0C0C0C}

/* Typing dots */
.dot{width:6px;height:6px;border-radius:50%;background:#525252;animation:bounce 1.2s infinite}
.d2{animation-delay:.2s}
.d3{animation-delay:.4s}
@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
`;
