const encoder = new TextEncoder();

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Native-Platform",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function sanitizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function timingSafeEqual(a, b) {
  const left = encoder.encode(String(a || ""));
  const right = encoder.encode(String(b || ""));
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i];
  return result === 0;
}

function hex(bytes) {
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function allowConsoleOtp(env) {
  return String(env.ALLOW_CONSOLE_OTP || "").toLowerCase() === "true";
}

function getOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = parseCsv(env.CORS_ORIGINS);
  if (!origin) return allowed[0] || "*";
  if (allowed.includes(origin)) return origin;
  return allowed[0] || "*";
}

function requireJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw httpError(415, "Expected application/json.");
  }
}

async function readJson(request) {
  requireJson(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw httpError(400, "Invalid JSON body.");
  return body;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertEnv(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) {
    throw new Error("SESSION_SECRET secret is missing or too short.");
  }
  if (!env.DATA_ENCRYPTION_SECRET || String(env.DATA_ENCRYPTION_SECRET).length < 32) {
    throw new Error("DATA_ENCRYPTION_SECRET secret is missing or too short.");
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return hex(new Uint8Array(digest));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return hex(new Uint8Array(sig));
}

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g).map((b) => Number.parseInt(b, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return hex(new Uint8Array(bits));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = hex(salt);
  const derived = await pbkdf2(password, saltHex);
  return `${saltHex}:${derived}`;
}

async function verifyPassword(password, encoded) {
  const [salt, stored] = String(encoded || "").split(":");
  if (!salt || !stored) return false;
  const derived = await pbkdf2(password, salt);
  return timingSafeEqual(derived, stored);
}

async function hashOtp(env, email, code) {
  return hmacHex(env.SESSION_SECRET, `${sanitizeEmail(email)}:${code}`);
}

async function hashToken(env, token) {
  return hmacHex(env.SESSION_SECRET, token);
}

function issueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    throw httpError(400, "Password must include upper, lower, and number characters.");
  }
}

function validateEmail(email) {
  const value = sanitizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw httpError(400, "Enter a valid email.");
  }
  return value;
}

function validateMetrics(metrics) {
  const next = metrics && typeof metrics === "object" ? metrics : {};
  if (next.bodyWeightLbs != null && (Number(next.bodyWeightLbs) < 0 || Number(next.bodyWeightLbs) > 1400)) {
    throw httpError(400, "bodyWeightLbs out of range.");
  }
  if (next.stepsToday != null && (Number(next.stepsToday) < 0 || Number(next.stepsToday) > 150000)) {
    throw httpError(400, "stepsToday out of range.");
  }
  if (next.restingHeartRate != null && (Number(next.restingHeartRate) < 0 || Number(next.restingHeartRate) > 260)) {
    throw httpError(400, "restingHeartRate out of range.");
  }
  if (next.workoutsLast30Days != null && (Number(next.workoutsLast30Days) < 0 || Number(next.workoutsLast30Days) > 90)) {
    throw httpError(400, "workoutsLast30Days out of range.");
  }
  return next;
}

function validateAiMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw httpError(400, "Messages are required.");
  }
  if (messages.length > 24) {
    throw httpError(400, "Too many messages.");
  }
  return messages.map((item, index) => {
    const role = String(item?.role || "").trim();
    const content = String(item?.content || "");
    if (!["system", "user", "assistant"].includes(role)) {
      throw httpError(400, `Invalid role at message ${index + 1}.`);
    }
    if (!content.trim()) {
      throw httpError(400, `Message ${index + 1} is empty.`);
    }
    if (content.length > 12000) {
      throw httpError(400, `Message ${index + 1} is too long.`);
    }
    return { role, content };
  });
}

async function pruneExpired(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM otp_challenges WHERE used_at IS NOT NULL OR expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").bind(now),
  ]);
}

async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || Number(row.reset_at) <= now) {
    await env.DB.prepare(
      "INSERT INTO rate_limits(key, count, reset_at) VALUES(?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at"
    ).bind(key, now + windowMs).run();
    return;
  }
  if (Number(row.count) >= limit) {
    throw httpError(429, `Too many requests. Try again in ${Math.ceil((Number(row.reset_at) - now) / 1000)}s.`);
  }
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
}

async function getUserByEmail(env, email) {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(sanitizeEmail(email)).first();
}

async function createSession(env, userId) {
  const token = issueToken();
  const tokenHash = await hashToken(env, token);
  const now = Date.now();
  const ttl = Number(env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
  const expiresAt = now + ttl;
  await env.DB.prepare(
    "INSERT INTO sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES(?, ?, ?, ?, ?, ?)"
  ).bind(uid("sess"), userId, tokenHash, now, expiresAt, now).run();
  return { token, expiresAt };
}

async function getAuthContext(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Missing authorization token.");
  const tokenHash = await hashToken(env, token);
  const row = await env.DB.prepare(
    "SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.billing_premium, u.billing_plan, u.devices_trial_started_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?"
  ).bind(tokenHash).first();
  if (!row || Number(row.expires_at) <= Date.now()) throw httpError(401, "Session expired. Please sign in again.");
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(Date.now(), row.session_id).run();
  return row;
}

async function sendOtpEmail(env, email, code, mode) {
  if (env.RESEND_API_KEY) {
    const appName = String(env.APP_NAME || "WorkoutBuddy");
    const subject = mode === "signup" ? `Finish creating your ${appName} account` : `Your ${appName} sign-in code`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;background:#0b0b0b;color:#e5e5e5;padding:24px">
        <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid #1f1f1f;border-radius:16px;padding:24px">
          <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#22c55e;font-weight:700;margin:0 0 10px">${appName}</p>
          <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px">${subject}</h1>
          <p style="font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 16px">Use this secure one-time code to continue. It expires in 10 minutes.</p>
          <div style="font-size:32px;font-weight:900;letter-spacing:.35em;text-align:center;background:#0a1f0a;color:#22c55e;padding:16px 20px;border-radius:14px;border:1px solid #14532d">${code}</div>
        </div>
      </div>
    `;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: email,
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw httpError(502, `Resend delivery failed: ${text || response.status}`);
    }
    return "email";
  }
  if (allowConsoleOtp(env)) {
    console.log(`[worker] OTP for ${email}: ${code}`);
    return "console";
  }
  throw httpError(503, "Email delivery is not configured.");
}

async function callGroq(env, messages, maxTokens = 2048, temperature = 0.7) {
  const keys = [env.GROQ_API_KEY, env.GROQ_API_KEY_2].map(v => String(v || "").trim()).filter(Boolean);
  if (!keys.length) {
    throw httpError(503, "AI is not configured on the server.");
  }
  const model = String(env.GROQ_MODEL || "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile";
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
          model,
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
        const text = await response.text();
        lastError = text || `HTTP ${response.status}`;
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
  throw httpError(lastError === "rate limited" ? 429 : 503, `AI unavailable: ${lastError || "unknown error"}.`);
}

async function handleHealth(request, env) {
  const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
  const sessions = await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?").bind(Date.now()).first();
  return json({ ok: true, users: Number(users?.count || 0), activeSessions: Number(sessions?.count || 0) }, 200, getOrigin(request, env));
}

async function handleRequestOtp(request, env) {
  const body = await readJson(request);
  const email = validateEmail(body.email);
  const password = String(body.password || "");
  const mode = String(body.mode || "");
  if (mode !== "signup") throw httpError(400, "Email verification is only used when creating a new account.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rateLimit(env, `otp:ip:${ip}`, 20, 60 * 60 * 1000);
  await rateLimit(env, `otp:email:${email}`, 5, 15 * 60 * 1000);

  const existing = await getUserByEmail(env, email);
  validatePassword(password);
  if (existing) throw httpError(409, "Account already exists.");

  const code = String(100000 + Math.floor(Math.random() * 900000));
  const codeHash = await hashOtp(env, email, code);
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const expiresAt = now + Number(env.OTP_TTL_MS || 10 * 60 * 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM otp_challenges WHERE email = ? AND mode = ?").bind(email, mode),
    env.DB.prepare(
      "INSERT INTO otp_challenges(id, email, mode, password_hash, code_hash, expires_at, attempts, created_at, used_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, NULL)"
    ).bind(uid("otp"), email, mode, passwordHash, codeHash, expiresAt, now),
  ]);
  const delivery = await sendOtpEmail(env, email, code, mode);
  return json({ ok: true, delivered: true, delivery }, 200, getOrigin(request, env));
}

async function handleVerifyOtp(request, env) {
  const body = await readJson(request);
  const email = validateEmail(body.email);
  const code = String(body.code || "");
  const mode = String(body.mode || "");
  if (!/^\d{6}$/.test(code)) throw httpError(400, "Invalid code.");
  if (mode !== "signup") throw httpError(400, "Email verification is only used when creating a new account.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rateLimit(env, `otp-verify:ip:${ip}`, 40, 60 * 60 * 1000);
  await rateLimit(env, `otp-verify:email:${email}`, 10, 15 * 60 * 1000);

  const challenge = await env.DB.prepare(
    "SELECT * FROM otp_challenges WHERE email = ? AND mode = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).bind(email, mode).first();
  if (!challenge) throw httpError(400, "No active code found. Request a new code.");
  if (Number(challenge.expires_at) <= Date.now()) throw httpError(410, "Code expired. Request a new code.");
  if (Number(challenge.attempts) >= 5) throw httpError(429, "Too many failed attempts. Request a new code.");

  const nextHash = await hashOtp(env, email, code);
  if (!timingSafeEqual(nextHash, challenge.code_hash)) {
    await env.DB.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?").bind(challenge.id).run();
    throw httpError(400, "Incorrect code.");
  }

  let user = await getUserByEmail(env, email);
  if (user) throw httpError(409, "Account already exists.");
  const userId = uid("usr");
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users(id, email, password_hash, created_at, billing_premium, billing_plan, billing_source, billing_reference, billing_updated_at, devices_trial_started_at) VALUES(?, ?, ?, ?, 0, NULL, NULL, NULL, ?, NULL)"
  ).bind(userId, email, challenge.password_hash, now, now).run();
  user = { id: userId, email, billing_premium: 0, billing_plan: null };

  await env.DB.prepare("UPDATE otp_challenges SET used_at = ? WHERE id = ?").bind(Date.now(), challenge.id).run();
  const session = await createSession(env, user.id);
  return json({
    ok: true,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: {
      email: user.email,
      premium: !!user.billing_premium,
      plan: user.billing_plan || null,
    },
  }, 200, getOrigin(request, env));
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const email = validateEmail(body.email);
  const password = String(body.password || "");
  if (!password) throw httpError(400, "Password is required.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rateLimit(env, `login:ip:${ip}`, 30, 60 * 60 * 1000);
  await rateLimit(env, `login:email:${email}`, 12, 15 * 60 * 1000);

  const user = await getUserByEmail(env, email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw httpError(401, "Invalid email or password.");
  }

  const session = await createSession(env, user.id);
  return json({
    ok: true,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    user: {
      email: user.email,
      premium: !!user.billing_premium,
      plan: user.billing_plan || null,
    },
  }, 200, getOrigin(request, env));
}

async function handleAiChat(request, env) {
  const auth = await getAuthContext(request, env);
  const body = await readJson(request);
  const messages = validateAiMessages(body.messages);
  const maxTokens = Math.min(4096, Math.max(64, Number(body.maxTokens || 2048)));
  const temperature = Math.min(1.2, Math.max(0, Number(body.temperature ?? 0.7)));
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await rateLimit(env, `ai:ip:${ip}`, 80, 60 * 60 * 1000);
  await rateLimit(env, `ai:user:${auth.user_id}`, 120, 60 * 60 * 1000);
  const content = await callGroq(env, messages, maxTokens, temperature);
  return json({
    ok: true,
    content,
    model: String(env.GROQ_MODEL || "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile",
  }, 200, getOrigin(request, env));
}

async function handleSession(request, env) {
  const auth = await getAuthContext(request, env);
  return json({
    ok: true,
    user: {
      email: auth.email,
      premium: !!auth.billing_premium,
      plan: auth.billing_plan || null,
    },
  }, 200, getOrigin(request, env));
}

async function handleLogout(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Missing authorization token.");
  const tokenHash = await hashToken(env, token);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  return json({ ok: true }, 200, getOrigin(request, env));
}

async function handleDeviceConnect(request, env) {
  const auth = await getAuthContext(request, env);
  const body = await readJson(request);
  const deviceName = String(body.deviceName || "").trim();
  const deviceType = String(body.deviceType || "").trim();
  if (deviceName.length < 2 || deviceType.length < 2) throw httpError(400, "Device name and type are required.");
  const provider = String(body.provider || deviceName.toLowerCase().replace(/\s+/g, "_")).trim();
  const clientPlatform = String(request.headers.get("X-Native-Platform") || "web").trim().toLowerCase();
  const isNative = clientPlatform && clientPlatform !== "web";
  const source = String(body.source || (isNative ? clientPlatform : "web")).trim();
  const status = isNative ? "connected" : "linked";
  const now = Date.now();
  let trialStartedAt = auth.devices_trial_started_at ? Number(auth.devices_trial_started_at) : null;
  if (!trialStartedAt) {
    trialStartedAt = now;
    await env.DB.prepare("UPDATE users SET devices_trial_started_at = ? WHERE id = ?").bind(trialStartedAt, auth.user_id).run();
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM device_connections WHERE user_id = ? AND name = ? LIMIT 1"
  ).bind(auth.user_id, deviceName).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE device_connections SET status = ?, provider = ?, source = ?, updated_at = ? WHERE id = ?"
    ).bind(status, provider, source, now, existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO device_connections(id, user_id, name, type, provider, status, source, connected_at, updated_at, last_sync_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"
    ).bind(uid("dev"), auth.user_id, deviceName, deviceType, provider, status, source, now, now).run();
  }
  return json({ ok: true, status, trialStartedAt: new Date(trialStartedAt).toISOString() }, 200, getOrigin(request, env));
}

async function handleDeviceDisconnect(request, env) {
  const auth = await getAuthContext(request, env);
  const body = await readJson(request);
  const deviceName = String(body.deviceName || "").trim();
  if (!deviceName) throw httpError(400, "Device name is required.");
  await env.DB.prepare("DELETE FROM device_connections WHERE user_id = ? AND name = ?").bind(auth.user_id, deviceName).run();
  return json({ ok: true, status: "disconnected" }, 200, getOrigin(request, env));
}

async function handleHealthSync(request, env) {
  const auth = await getAuthContext(request, env);
  const body = await readJson(request);
  const provider = String(body.provider || "").trim();
  const source = String(body.source || "").trim();
  const deviceName = String(body.deviceName || "").trim();
  if (provider.length < 2 || source.length < 2) throw httpError(400, "Provider and source are required.");
  const metrics = validateMetrics(body.metrics);
  const permissionsGranted = !!body.permissionsGranted;
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO device_health_syncs(id, user_id, provider, source, permissions_granted, metrics_json, synced_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).bind(uid("sync"), auth.user_id, provider, source, permissionsGranted ? 1 : 0, JSON.stringify(metrics), now).run();
  if (deviceName) {
    await env.DB.prepare(
      "UPDATE device_connections SET status = ?, last_sync_at = ?, updated_at = ?, source = ? WHERE user_id = ? AND name = ?"
    ).bind(permissionsGranted ? "syncing" : "permission-needed", now, now, source, auth.user_id, deviceName).run();
  }
  return json({ ok: true, syncedAt: new Date(now).toISOString() }, 200, getOrigin(request, env));
}

async function handleDeviceState(request, env) {
  const auth = await getAuthContext(request, env);
  const devices = await env.DB.prepare(
    "SELECT name, type, provider, status, source, connected_at, updated_at, last_sync_at FROM device_connections WHERE user_id = ? ORDER BY connected_at DESC"
  ).bind(auth.user_id).all();
  const latestSync = await env.DB.prepare(
    "SELECT provider, source, permissions_granted, metrics_json, synced_at FROM device_health_syncs WHERE user_id = ? ORDER BY synced_at DESC LIMIT 1"
  ).bind(auth.user_id).first();
  return json({
    ok: true,
    trialStartedAt: auth.devices_trial_started_at ? new Date(Number(auth.devices_trial_started_at)).toISOString() : null,
    connectedDevices: (devices.results || []).map((item) => ({
      name: item.name,
      type: item.type,
      provider: item.provider,
      status: item.status,
      source: item.source,
      connectedAt: item.connected_at ? new Date(Number(item.connected_at)).toISOString() : null,
      updatedAt: item.updated_at ? new Date(Number(item.updated_at)).toISOString() : null,
      lastSyncAt: item.last_sync_at ? new Date(Number(item.last_sync_at)).toISOString() : null,
    })),
    lastHealthSync: latestSync ? {
      provider: latestSync.provider,
      source: latestSync.source,
      permissionsGranted: !!latestSync.permissions_granted,
      metrics: JSON.parse(latestSync.metrics_json || "{}"),
      syncedAt: new Date(Number(latestSync.synced_at)).toISOString(),
    } : null,
  }, 200, getOrigin(request, env));
}

async function handleBillingStatus(request, env) {
  const auth = await getAuthContext(request, env);
  return json({
    ok: true,
    premium: !!auth.billing_premium,
    plan: auth.billing_plan || null,
    source: null,
    updatedAt: null,
  }, 200, getOrigin(request, env));
}

async function handleUnconfiguredBilling(request, env) {
  await getAuthContext(request, env);
  throw httpError(503, "Stripe billing will be configured after frontend/backend deployment is complete.");
}

export default {
  async fetch(request, env) {
    const origin = getOrigin(request, env);
    try {
      assertEnv(env);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Native-Platform",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      const url = new URL(request.url);
      await pruneExpired(env);

      if (url.pathname === "/" || url.pathname === "/health") return await handleHealth(request, env);
      if (url.pathname === "/api/auth/request-otp" && request.method === "POST") return await handleRequestOtp(request, env);
      if (url.pathname === "/api/auth/verify-otp" && request.method === "POST") return await handleVerifyOtp(request, env);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return await handleLogin(request, env);
      if (url.pathname === "/api/ai/chat" && request.method === "POST") return await handleAiChat(request, env);
      if (url.pathname === "/api/auth/session" && request.method === "GET") return await handleSession(request, env);
      if (url.pathname === "/api/auth/logout" && request.method === "POST") return await handleLogout(request, env);
      if (url.pathname === "/api/devices/connect" && request.method === "POST") return await handleDeviceConnect(request, env);
      if (url.pathname === "/api/devices/disconnect" && request.method === "POST") return await handleDeviceDisconnect(request, env);
      if (url.pathname === "/api/devices/health/sync" && request.method === "POST") return await handleHealthSync(request, env);
      if (url.pathname === "/api/devices/state" && request.method === "GET") return await handleDeviceState(request, env);
      if (url.pathname === "/api/billing/status" && request.method === "GET") return await handleBillingStatus(request, env);
      if (url.pathname === "/api/billing/checkout" && request.method === "POST") return await handleUnconfiguredBilling(request, env);

      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      const status = error.status || 500;
      const message = error.message || "Server error.";
      if (status >= 500) console.error("[worker]", error);
      return json({ error: message }, status, origin);
    }
  },
};
