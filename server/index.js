import "dotenv/config";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { Resend } from "resend";
import Stripe from "stripe";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 8787);
const APP_NAME = "WorkoutBuddy";
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 10 * 60 * 1000);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const APP_URL = String(process.env.APP_URL || "http://localhost:5174").trim();
const CORS_ORIGINS = String(
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,capacitor://localhost,http://localhost"
).split(",").map(v => v.trim()).filter(Boolean);
const ALLOW_CONSOLE_OTP = String(process.env.ALLOW_CONSOLE_OTP || "").toLowerCase() === "true";
const MAIL_FROM = String(process.env.MAIL_FROM || "WorkoutBuddy <no-reply@musclebuilder.app>").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || "").trim();
const GROQ_API_KEY_2 = String(process.env.GROQ_API_KEY_2 || process.env.VITE_GROQ_API_KEY_2 || "").trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const DATA_ENCRYPTION_SECRET = String(process.env.DATA_ENCRYPTION_SECRET || "").trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const REVENUECAT_WEBHOOK_SECRET = String(process.env.REVENUECAT_WEBHOOK_SECRET || "").trim();
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION_SERVER = NODE_ENV === "production";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required for the server.");
}
if (!DATA_ENCRYPTION_SECRET) {
  throw new Error("DATA_ENCRYPTION_SECRET is required for the server.");
}
if (SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters.");
}
if (DATA_ENCRYPTION_SECRET.length < 32) {
  throw new Error("DATA_ENCRYPTION_SECRET must be at least 32 characters.");
}
if (IS_PRODUCTION_SERVER && ALLOW_CONSOLE_OTP) {
  throw new Error("ALLOW_CONSOLE_OTP must remain false in production.");
}
if (IS_PRODUCTION_SERVER && !APP_URL.startsWith("https://")) {
  throw new Error("APP_URL must use https in production.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultDb = () => ({
  users: [],
  otpChallenges: [],
  sessions: [],
  billingEvents: [],
  revenueCatEvents: [],
});

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return { ...defaultDb(), ...JSON.parse(raw) };
  } catch (error) {
    console.error("[server] Failed to read db.json, rebuilding empty store.", error);
    const initial = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

let db = readDb();

function writeDb() {
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

function pruneDb() {
  const now = Date.now();
  db.otpChallenges = db.otpChallenges.filter(item => !item.usedAt && item.expiresAt > now);
  db.sessions = db.sessions.filter(item => item.expiresAt > now);
}

const limiter = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const state = limiter.get(key);
  if (!state || state.resetAt <= now) {
    limiter.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (state.count >= limit) {
    const retryIn = Math.ceil((state.resetAt - now) / 1000);
    const error = new Error(`Too many requests. Try again in ${retryIn}s.`);
    error.status = 429;
    throw error;
  }
  state.count += 1;
}

function sanitizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, storedHash] = String(encoded || "").split(":");
  if (!salt || !storedHash) return false;
  const computed = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

function hashOtp(email, code) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`${email}:${code}`).digest("hex");
}

function hashToken(token) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
}

function issueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function encryptSecret(value) {
  if (!value) return null;
  const key = deriveKey(DATA_ENCRYPTION_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function getUserByEmail(email) {
  return db.users.find(user => user.email === sanitizeEmail(email));
}

function validateAiMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    const error = new Error("Messages are required.");
    error.status = 400;
    throw error;
  }
  if (messages.length > 24) {
    const error = new Error("Too many messages.");
    error.status = 400;
    throw error;
  }
  return messages.map((item, index) => {
    const role = String(item?.role || "").trim();
    const content = String(item?.content || "");
    if (!["system", "user", "assistant"].includes(role)) {
      const error = new Error(`Invalid role at message ${index + 1}.`);
      error.status = 400;
      throw error;
    }
    if (!content.trim()) {
      const error = new Error(`Message ${index + 1} is empty.`);
      error.status = 400;
      throw error;
    }
    if (content.length > 12000) {
      const error = new Error(`Message ${index + 1} is too long.`);
      error.status = 400;
      throw error;
    }
    return { role, content };
  });
}

function getPlanConfig(plan, method) {
  const wallet = method === "apple" || method === "google";
  const multiplier = wallet ? 1.02 : 1;
  const base = {
    monthly: { cents: 899, mode: "subscription", interval: "month", label: "Pro Monthly" },
    yearly: { cents: 5988, mode: "subscription", interval: "year", label: "Pro Yearly" },
    lifetime: { cents: 12000, mode: "payment", interval: null, label: "Pro Lifetime" },
  }[plan];
  if (!base) throw new Error("Unknown plan.");
  return {
    ...base,
    cents: Math.round(base.cents * multiplier),
  };
}

async function sendOtpEmail(email, code, mode) {
  const subject = mode === "signup" ? `Finish creating your ${APP_NAME} account` : `Your ${APP_NAME} sign-in code`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#0b0b0b;color:#e5e5e5;padding:24px">
      <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:24px">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#22c55e;font-weight:700;margin:0 0 10px">${APP_NAME}</p>
        <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px">${subject}</h1>
        <p style="font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 16px">Use this secure one-time code to continue. It expires in 10 minutes.</p>
        <div style="font-size:32px;font-weight:900;letter-spacing:.35em;text-align:center;background:#0a1f0a;color:#22c55e;padding:16px 20px;border-radius:14px;border:1px solid #14532d">${code}</div>
        <p style="font-size:12px;color:#737373;line-height:1.6;margin:16px 0 0">If you didn’t request this, you can ignore this email.</p>
      </div>
    </div>
  `;
  if (resend) {
    await resend.emails.send({
      from: MAIL_FROM,
      to: email,
      subject,
      html,
    });
    return "email";
  }
  if (ALLOW_CONSOLE_OTP) {
    console.log(`[server] OTP for ${email}: ${code}`);
    return "console";
  }
  const error = new Error("Email delivery is not configured. Add RESEND_API_KEY or enable ALLOW_CONSOLE_OTP for local development.");
  error.status = 503;
  throw error;
}

async function callGroq(messages, maxTokens = 2048, temperature = 0.7) {
  const keys = [GROQ_API_KEY, GROQ_API_KEY_2].filter(Boolean);
  if (!keys.length) {
    const error = new Error("AI is not configured on the server.");
    error.status = 503;
    throw error;
  }
  let lastError = "";
  for (const key of keys) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL || "llama-3.3-70b-versatile",
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 401) {
        lastError = "server Groq key is invalid";
        continue;
      }
      if (response.status === 429) {
        lastError = "rate limited";
        continue;
      }
      if (!response.ok) {
        lastError = await response.text() || `HTTP ${response.status}`;
        continue;
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return content;
      lastError = data?.error?.message || "empty response from AI";
    } catch (error) {
      if (error?.name === "AbortError") lastError = "request timed out";
      else lastError = "network error talking to AI";
    }
  }
  const error = new Error(`AI unavailable: ${lastError || "unknown error"}.`);
  error.status = lastError === "rate limited" ? 429 : 503;
  throw error;
}

function upsertSession(userId) {
  const token = issueToken();
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.sessions = db.sessions.filter(session => !(session.userId === userId && session.expiresAt <= Date.now()));
  db.sessions.push({
    id: uid("sess"),
    userId,
    tokenHash,
    createdAt: Date.now(),
    expiresAt,
    lastSeenAt: Date.now(),
  });
  return { token, expiresAt };
}

function authMiddleware(req, res, next) {
  try {
    pruneDb();
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Missing authorization token." });
    }
    const tokenHash = hashToken(token);
    const session = db.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
    if (!session) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    const user = db.users.find(item => item.id === session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }
    session.lastSeenAt = Date.now();
    writeDb();
    req.session = session;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: false,
  allowedHeaders: ["Content-Type", "Authorization", "X-Native-Platform"],
  methods: ["GET", "POST", "OPTIONS"],
}));

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Stripe webhook is not configured." });
    }
    const signature = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);

    const setPremium = (user, active, plan, source, reference) => {
      user.billing = {
        ...(user.billing || {}),
        premium: active,
        plan: active ? plan : null,
        source,
        reference,
        updatedAt: nowIso(),
      };
    };

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const user = db.users.find(item => item.id === session.client_reference_id) || getUserByEmail(session.customer_details?.email);
      if (user) {
        user.stripeCustomerId = session.customer || user.stripeCustomerId || null;
        user.stripeSessionId = session.id;
        const plan = session.metadata?.plan || "monthly";
        setPremium(user, true, plan, "stripe", session.id);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const user = db.users.find(item => item.stripeCustomerId === subscription.customer);
      if (user) {
        const active = ["active", "trialing", "past_due"].includes(subscription.status);
        const plan = subscription.metadata?.plan || user.billing?.plan || "monthly";
        user.stripeSubscriptionId = subscription.id;
        setPremium(user, active, plan, "stripe", subscription.id);
      }
    }

    db.billingEvents.push({
      id: uid("stripeevt"),
      type: event.type,
      createdAt: nowIso(),
      payload: event.data.object,
    });
    writeDb();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use(express.json({ limit: "1mb" }));

const authRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(128),
  mode: z.literal("signup"),
  app: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  app: z.string().optional(),
});

const otpVerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  mode: z.literal("signup"),
  app: z.string().optional(),
});

function validateSignupPassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    error.status = 400;
    throw error;
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    const error = new Error("Password must include upper, lower, and number characters.");
    error.status = 400;
    throw error;
  }
}

app.get("/health", (_req, res) => {
  pruneDb();
  res.json({
    ok: true,
    uptime: process.uptime(),
    users: db.users.length,
    activeSessions: db.sessions.length,
  });
});

app.post("/api/auth/request-otp", async (req, res, next) => {
  try {
    pruneDb();
    const body = authRequestSchema.parse(req.body);
    const email = sanitizeEmail(body.email);
    rateLimit(`otp:ip:${req.ip}`, 20, 60 * 60 * 1000);
    rateLimit(`otp:email:${email}`, 5, 15 * 60 * 1000);

    const existingUser = getUserByEmail(email);
    validateSignupPassword(body.password);
    if (existingUser) return res.status(409).json({ error: "Account already exists." });

    const code = String(100000 + crypto.randomInt(0, 900000));
    db.otpChallenges = db.otpChallenges.filter(item => !(item.email === email && item.mode === body.mode));
    db.otpChallenges.push({
      id: uid("otp"),
      email,
      mode: body.mode,
      passwordHash: body.mode === "signup" ? hashPassword(body.password) : null,
      codeHash: hashOtp(email, code),
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      createdAt: Date.now(),
      usedAt: null,
    });
    const delivery = await sendOtpEmail(email, code, body.mode);
    writeDb();
    res.json({ ok: true, delivered: true, delivery });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", (req, res, next) => {
  try {
    pruneDb();
    const body = loginSchema.parse(req.body);
    const email = sanitizeEmail(body.email);
    rateLimit(`login:ip:${req.ip}`, 30, 60 * 60 * 1000);
    rateLimit(`login:email:${email}`, 12, 15 * 60 * 1000);
    const user = getUserByEmail(email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    const session = upsertSession(user.id);
    writeDb();
    res.json({
      ok: true,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      user: {
        email: user.email,
        premium: !!user.billing?.premium,
        plan: user.billing?.plan || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-otp", (req, res, next) => {
  try {
    pruneDb();
    const body = otpVerifySchema.parse(req.body);
    const email = sanitizeEmail(body.email);
    rateLimit(`otp-verify:ip:${req.ip}`, 40, 60 * 60 * 1000);
    rateLimit(`otp-verify:email:${email}`, 10, 15 * 60 * 1000);

    const challenge = [...db.otpChallenges]
      .reverse()
      .find(item => item.email === email && item.mode === body.mode && !item.usedAt);
    if (!challenge) return res.status(400).json({ error: "No active code found. Request a new code." });
    if (challenge.expiresAt <= Date.now()) return res.status(410).json({ error: "Code expired. Request a new code." });
    if (challenge.attempts >= 5) return res.status(429).json({ error: "Too many failed attempts. Request a new code." });

    if (hashOtp(email, body.code) !== challenge.codeHash) {
      challenge.attempts += 1;
      writeDb();
      return res.status(400).json({ error: "Incorrect code." });
    }

    let user = getUserByEmail(email);
    if (user) return res.status(409).json({ error: "Account already exists." });
    user = {
      id: uid("usr"),
      email,
      passwordHash: challenge.passwordHash,
      createdAt: nowIso(),
      billing: { premium: false, plan: null, source: null, reference: null, updatedAt: nowIso() },
      devices: { trialStartedAt: null, connections: [], lastHealthSync: null },
    };
    db.users.push(user);

    challenge.usedAt = Date.now();
    const session = upsertSession(user.id);
    writeDb();
    res.json({
      ok: true,
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      user: {
        email: user.email,
        premium: !!user.billing?.premium,
        plan: user.billing?.plan || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ai/chat", authMiddleware, async (req, res, next) => {
  try {
    pruneDb();
    rateLimit(`ai:ip:${req.ip}`, 80, 60 * 60 * 1000);
    rateLimit(`ai:user:${req.user.id}`, 120, 60 * 60 * 1000);
    const messages = validateAiMessages(req.body?.messages);
    const maxTokens = Math.min(4096, Math.max(64, Number(req.body?.maxTokens || 2048)));
    const temperature = Math.min(1.2, Math.max(0, Number(req.body?.temperature ?? 0.7)));
    const content = await callGroq(messages, maxTokens, temperature);
    res.json({
      ok: true,
      content,
      model: GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: {
      email: req.user.email,
      premium: !!req.user.billing?.premium,
      plan: req.user.billing?.plan || null,
    },
  });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  db.sessions = db.sessions.filter(item => item.id !== req.session.id);
  writeDb();
  res.json({ ok: true });
});

const billingSchema = z.object({
  plan: z.enum(["monthly", "yearly", "lifetime"]),
  method: z.enum(["apple", "google", "card"]),
  total: z.number().optional(),
  fee: z.number().optional(),
  cardholderName: z.string().optional(),
  email: z.string().email().optional(),
  platform: z.enum(["web", "ios", "android"]).optional(),
});

app.post("/api/billing/checkout", authMiddleware, async (req, res, next) => {
  try {
    const body = billingSchema.parse(req.body);
    if (!stripe) {
      return res.status(503).json({ error: "Stripe billing backend is not configured." });
    }
    const plan = getPlanConfig(body.plan, body.method);
    const session = await stripe.checkout.sessions.create({
      mode: plan.mode,
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      success_url: `${APP_URL}/?billing=success`,
      cancel_url: `${APP_URL}/?billing=cancelled`,
      metadata: {
        userId: req.user.id,
        plan: body.plan,
        method: body.method,
        platform: body.platform || "web",
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `${APP_NAME} ${plan.label}`,
            description: plan.mode === "payment" ? "One-time premium unlock" : "Recurring premium subscription",
          },
          ...(plan.mode === "subscription"
            ? { recurring: { interval: plan.interval }, unit_amount: plan.cents }
            : { unit_amount: plan.cents }),
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
    });

    res.json({
      ok: true,
      provider: "stripe",
      checkoutUrl: session.url,
      reference: session.id,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/status", authMiddleware, (req, res) => {
  res.json({
    ok: true,
    premium: !!req.user.billing?.premium,
    plan: req.user.billing?.plan || null,
    source: req.user.billing?.source || null,
    updatedAt: req.user.billing?.updatedAt || null,
  });
});

app.post("/api/webhooks/revenuecat", (req, res, next) => {
  try {
    if (!REVENUECAT_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "RevenueCat webhook is not configured." });
    }
    const authHeader = String(req.headers.authorization || "");
    if (authHeader !== REVENUECAT_WEBHOOK_SECRET && authHeader !== `Bearer ${REVENUECAT_WEBHOOK_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized webhook request." });
    }
    const event = req.body?.event || req.body || {};
    const appUserId = sanitizeEmail(event.app_user_id || event.appUserId || event.email);
    const user = getUserByEmail(appUserId);
    db.revenueCatEvents.push({
      id: uid("rcevt"),
      type: event.type || "UNKNOWN",
      createdAt: nowIso(),
      appUserId,
      payload: event,
    });

    if (user) {
      const expiration = Number(event.expiration_at_ms || 0);
      const stillActive = expiration ? expiration > Date.now() : ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE"].includes(event.type);
      const plan = String(event.product_id || event.productId || event.entitlement_ids?.[0] || user.billing?.plan || "monthly");
      user.billing = {
        premium: stillActive,
        plan: stillActive ? (plan.includes("lifetime") ? "lifetime" : plan.includes("year") ? "yearly" : "monthly") : null,
        source: "revenuecat",
        reference: String(event.transaction_id || event.original_transaction_id || ""),
        updatedAt: nowIso(),
      };
    }
    writeDb();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const deviceConnectionSchema = z.object({
  deviceName: z.string().min(2).max(80),
  deviceType: z.string().min(2).max(40),
  provider: z.string().optional(),
  source: z.string().optional(),
});

app.post("/api/devices/connect", authMiddleware, (req, res, next) => {
  try {
    const body = deviceConnectionSchema.parse(req.body);
    const clientPlatform = String(req.get("X-Native-Platform") || "web").trim().toLowerCase();
    const isNative = clientPlatform && clientPlatform !== "web";
    const source = body.source || (isNative ? clientPlatform : "web");
    const status = isNative ? "connected" : "linked";
    if (!req.user.devices) {
      req.user.devices = { trialStartedAt: null, connections: [], lastHealthSync: null };
    }
    if (!req.user.devices.trialStartedAt) {
      req.user.devices.trialStartedAt = nowIso();
    }
    const existing = req.user.devices.connections.find(item => item.name === body.deviceName);
    if (existing) {
      existing.status = status;
      existing.updatedAt = nowIso();
      existing.source = source || existing.source || "web";
    } else {
      req.user.devices.connections.push({
        id: uid("dev"),
        name: body.deviceName,
        type: body.deviceType,
        provider: body.provider || body.deviceName.toLowerCase().replace(/\s+/g, "_"),
        status,
        connectedAt: nowIso(),
        updatedAt: nowIso(),
        source,
      });
    }
    writeDb();
    res.json({ ok: true, status, trialStartedAt: req.user.devices.trialStartedAt });
  } catch (error) {
    next(error);
  }
});

app.post("/api/devices/disconnect", authMiddleware, (req, res, next) => {
  try {
    const body = deviceConnectionSchema.parse(req.body);
    if (!req.user.devices) {
      req.user.devices = { trialStartedAt: null, connections: [], lastHealthSync: null };
    }
    req.user.devices.connections = req.user.devices.connections.filter(item => item.name !== body.deviceName);
    writeDb();
    res.json({ ok: true, status: "disconnected" });
  } catch (error) {
    next(error);
  }
});

const healthSyncSchema = z.object({
  provider: z.string().min(2).max(60),
  deviceName: z.string().min(2).max(80).optional(),
  source: z.string().min(2).max(40),
  permissionsGranted: z.boolean().default(false),
  metrics: z.object({
    bodyWeightLbs: z.number().nonnegative().max(1400).optional(),
    stepsToday: z.number().nonnegative().max(150000).optional(),
    restingHeartRate: z.number().nonnegative().max(260).optional(),
    workoutsLast30Days: z.number().nonnegative().max(90).optional(),
    lastWorkoutAt: z.string().optional(),
  }),
});

app.post("/api/devices/health/sync", authMiddleware, (req, res, next) => {
  try {
    const body = healthSyncSchema.parse(req.body);
    if (!req.user.devices) {
      req.user.devices = { trialStartedAt: null, connections: [], lastHealthSync: null };
    }
    req.user.devices.lastHealthSync = {
      provider: body.provider,
      source: body.source,
      metrics: body.metrics,
      permissionsGranted: body.permissionsGranted,
      syncedAt: nowIso(),
    };
    if (body.deviceName) {
      const device = req.user.devices.connections.find(item => item.name === body.deviceName);
      if (device) {
        device.status = body.permissionsGranted ? "syncing" : "permission-needed";
        device.lastSyncAt = nowIso();
        device.updatedAt = nowIso();
      }
    }
    writeDb();
    res.json({ ok: true, syncedAt: req.user.devices.lastHealthSync.syncedAt });
  } catch (error) {
    next(error);
  }
});

app.get("/api/devices/state", authMiddleware, (req, res) => {
  const devices = req.user.devices || { trialStartedAt: null, connections: [], lastHealthSync: null };
  res.json({
    ok: true,
    trialStartedAt: devices.trialStartedAt || null,
    connectedDevices: devices.connections || [],
    lastHealthSync: devices.lastHealthSync || null,
  });
});

app.use((error, _req, res, _next) => {
  const status = error.status || error.statusCode || (error.name === "ZodError" ? 400 : 500);
  const message = error.name === "ZodError"
    ? error.issues?.[0]?.message || "Invalid request."
    : error.message || "Server error.";
  if (status >= 500) {
    console.error("[server]", error);
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`[server] ${APP_NAME} backend listening on http://localhost:${PORT}`);
});
