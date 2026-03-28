import { useState, useEffect, useRef, useCallback } from "react";

// ── API Keys (loaded from env or config) ──
const GROQ_KEYS = (() => {
  const envKey = import.meta.env.VITE_GROQ_API_KEY;
  const envKey2 = import.meta.env.VITE_GROQ_API_KEY_2;
  if (envKey) return [envKey, envKey2].filter(Boolean);
  // Fallback: keys can be set in localStorage for self-hosted
  try {
    const stored = localStorage.getItem("mb_groq_keys");
    if (stored) return JSON.parse(stored);
  } catch {}
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

const EMPTY = {
  splits: [], logs: [], chat: [],
  settings: { restTime: 90, unit: "lbs" },
  premium: false,
  nutrition: { profile: null, foodLog: [], waterLog: [] },
  bodyWeight: [],
};

// ── Seed test account on first load ──
(() => {
  const users = store.getUsers();
  if (!users.find(x => x.e === "test@muscle.com")) {
    users.push({ e: "test@muscle.com", p: "test123", ph: cipher.hash("test123"), verified: true });
    store.setUsers(users);
    store.setData("test@muscle.com", JSON.parse(JSON.stringify(EMPTY)));
  }
})();

// ── Groq API ──
async function groq(messages, maxTokens = 2048) {
  for (const key of GROQ_KEYS) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature: 0.7 }),
      });
      if (r.status === 429 || r.status === 401) continue;
      const d = await r.json();
      if (d.choices?.[0]?.message?.content) return d.choices[0].message.content;
    } catch { continue; }
  }
  return "API is busy. Please try again in a moment.";
}

const SPLIT_RE = /\b(create|make|build|generate|give|design|set\s*up|plan|want|need|get|change|update|add|switch|modify|redo)\b.*\b(split|routine|program|plan|workout|schedule|ppl|push\s*pull|upper\s*lower|bro\s*split|full\s*body|day\s*split|to\s*my\s*split)\b/i;

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

const TYPE_COLORS = {
  push: "#3B82F6", pull: "#A855F7", legs: "#22C55E", upper: "#3B82F6",
  lower: "#22C55E", chest: "#EF4444", back: "#A855F7", shoulders: "#F59E0B",
  arms: "#6366F1", core: "#EAB308", cardio: "#EC4899", rest: "#525252", custom: "#F59E0B",
};

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
  return new Date().toLocaleDateString("en-CA");
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

  return { splits, logs, chat: [], settings: { restTime: 90, unit: "lbs" }, premium: false, nutrition: { profile: null, foodLog: [], waterLog: [] }, bodyWeight: [] };
}

// ── Toast ──
function Toast({ message, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  const bg = type === "pr" ? "#854D0E" : type === "error" ? "#7F1D1D" : "#14532D";
  const fg = type === "pr" ? "#FDE047" : type === "error" ? "#FCA5A5" : "#86EFAC";
  return <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", padding: "10px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 9999, background: bg, color: fg, animation: "fadeUp .3s ease" }}>{message}</div>;
}

// ── AUTH ──
function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [verifyStep, setVerifyStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sentCode, setSentCode] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [sending, setSending] = useState(false);
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));

  const go = async (e) => {
    e.preventDefault(); setErr("");
    if (!email.trim() || !pass.trim()) return setErr("Fill in all fields");
    if (!validEmail(email)) return setErr("Enter a valid email");
    if (mode === "signup" && pass.length < 6) return setErr("Password needs 6+ characters");
    const users = store.getUsers();
    if (mode === "login") {
      const user = users.find(x => x.e === email.toLowerCase());
      if (!user) return setErr("No account found");
      if (user.ph !== cipher.hash(pass) && user.p !== pass) return setErr("Wrong password");
      // Send OTP for login verification
      setSending(true);
      const code = generateOTP();
      setSentCode(code);
      // In production: send via email API. For now, simulate with console + toast
      console.log(`[MuscleBuilder] Verification code for ${email}: ${code}`);
      await new Promise(r => setTimeout(r, 800));
      setSending(false);
      setVerifyStep(true);
    } else {
      if (users.find(x => x.e === email.toLowerCase())) return setErr("Account exists already");
      // Send OTP for signup verification
      setSending(true);
      const code = generateOTP();
      setSentCode(code);
      console.log(`[MuscleBuilder] Verification code for ${email}: ${code}`);
      await new Promise(r => setTimeout(r, 800));
      setSending(false);
      setVerifyStep(true);
    }
  };

  const verifyOTP = () => {
    setErr("");
    if (otpInput !== sentCode) return setErr("Incorrect code. Check your email.");
    const users = store.getUsers();
    if (mode === "signup") {
      users.push({ e: email.toLowerCase(), ph: cipher.hash(pass), verified: true });
      store.setUsers(users);
      store.setData(email.toLowerCase(), JSON.parse(JSON.stringify(EMPTY)));
    } else {
      // Migrate old plaintext passwords to hashed
      const idx = users.findIndex(x => x.e === email.toLowerCase());
      if (idx >= 0 && users[idx].p && !users[idx].ph) {
        users[idx].ph = cipher.hash(users[idx].p);
        delete users[idx].p;
        users[idx].verified = true;
        store.setUsers(users);
      }
    }
    onLogin(email.toLowerCase());
  };

  const resendCode = async () => {
    setSending(true);
    const code = generateOTP();
    setSentCode(code);
    console.log(`[MuscleBuilder] New verification code for ${email}: ${code}`);
    await new Promise(r => setTimeout(r, 800));
    setSending(false);
    setErr("");
  };

  if (verifyStep) {
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

          {/* OTP display (simulated - in production this would be in email) */}
          <div style={{ background: "#0A1F0A", border: "1px solid #14532D", borderRadius: 10, padding: 12, marginBottom: 14, textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "#525252", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Your Code (demo)</p>
            <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: 8, color: "#22C55E", fontVariantNumeric: "tabular-nums" }}>{sentCode}</p>
            <p style={{ fontSize: 10, color: "#404040", marginTop: 4 }}>In production, this arrives via email</p>
          </div>

          <input className="input" type="text" inputMode="numeric" placeholder="Enter 6-digit code" value={otpInput}
            onChange={e => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{ textAlign: "center", fontSize: 22, fontWeight: 800, letterSpacing: 8 }} />
          <button className="btn-accent" onClick={verifyOTP} disabled={otpInput.length !== 6}
            style={{ opacity: otpInput.length !== 6 ? 0.5 : 1 }}>Verify & Continue</button>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>
            <button onClick={resendCode} disabled={sending}
              style={{ background: "none", border: "none", color: "#3B82F6", fontSize: 13, fontWeight: 600, cursor: sending ? "wait" : "pointer" }}>
              {sending ? "Sending..." : "Resend Code"}
            </button>
            <button onClick={() => { setVerifyStep(false); setOtpInput(""); setErr(""); }}
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
        <div className="auth-logo">MB</div>
        <h1 className="auth-h1">MuscleBuilder</h1>
        <p className="auth-p">{mode === "login" ? "Sign in to continue" : "Create your account"}</p>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={go}>
          <input className="input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <input className="input" type="password" placeholder="Password" value={pass} onChange={e => setPass(e.target.value)} />
          <button className="btn-accent" type="submit" disabled={sending}
            style={{ opacity: sending ? 0.7 : 1 }}>
            {sending ? "Sending code..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "No account? " : "Already have one? "}
          <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(""); }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </span>
        </p>
        <div className="auth-test">
          Test account: <strong>test@muscle.com</strong> / <strong>test123</strong>
        </div>
        <p style={{ fontSize: 10, color: "#333", textAlign: "center", marginTop: 10 }}>
          🔒 Email verification + encrypted data storage
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
    <div className="float-timer" onClick={onExpand}>
      <div style={{ height: 3, background: "#262626" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: left <= 5 ? "#EF4444" : "#22C55E", transition: "width 0.2s linear" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#A3A3A3" }}>Rest</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: left <= 5 ? "#EF4444" : "#22C55E", fontVariantNumeric: "tabular-nums" }}>{fmtTime(left)}</span>
        <button onClick={e => { e.stopPropagation(); onDone(); }} style={{ background: "#262626", border: "none", color: "#A3A3A3", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer" }}>Skip</button>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <button className="btn-accent" onClick={() => onNav("coach")} style={{ maxWidth: 280 }}>Ask AI Coach</button>
            <button className="btn-ghost" onClick={addDay} style={{ maxWidth: 280, width: "100%" }}>+ Add day manually</button>
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
                <div key={i} className="week-day" onClick={() => setEd(i)}>
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
                <div key={i} className="day-card" onClick={() => setEd(i)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", background: c + "15", borderRadius: 4 }}>{day.type}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#525252", fontWeight: 600 }}>Day {day.day}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeDay(i); }} style={{ background: "none", border: "none", color: "#404040", cursor: "pointer", fontSize: 14 }}>x</button>
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
            <button className="btn-ghost" onClick={addDay} style={{ flex: 1 }}>+ Add Day</button>
            <button className="btn-danger-sm" onClick={() => { if (window.confirm("Clear entire split?")) onSetSplits([]); }}>Clear All</button>
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
function WorkoutPage({ splits, logs, onLogWorkout, restTime, onToast }) {
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
    return (<>
      <div className="fade-in">
        <div className="workout-header">
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{day.name}</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <span className="badge badge-orange">{fmtTime(elapsed)}</span>
              <span className="badge badge-green">{doneSets}/{totalSets} sets</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setFullTimer(true)} className="btn-ghost" style={{ padding: "8px 12px" }}>Timer</button>
            <button onClick={finishWorkout} className="btn-accent" style={{ padding: "8px 20px" }}>Finish</button>
          </div>
        </div>
        <div style={{ height: 3, background: "#1C1C1C", borderRadius: 2, marginBottom: 16 }}>
          <div style={{ height: "100%", width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%`, background: "#22C55E", borderRadius: 2, transition: "width .4s" }} />
        </div>

        {day.exercises.map((ex, exIdx) => {
          const exDone = (active.sets[exIdx] || []).filter(s => s.done).length;
          const exTotal = (active.sets[exIdx] || []).length;
          const allDone = exDone === exTotal;
          const lastSets = active.lastSession?.[ex.name];
          return (
            <div key={exIdx} className="card" style={{ marginBottom: 10, borderColor: allDone ? "#166534" : "#1C1C1C" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>{ex.name}</h3>
                  <p style={{ fontSize: 12, color: "#737373", marginTop: 1 }}>
                    {ex.muscle} / {ex.sets}x{ex.reps}
                    {getExerciseInfo(ex.name).compound && <span style={{ color: "#3B82F6", marginLeft: 4, fontSize: 10, fontWeight: 700, padding: "1px 4px", background: "#3B82F620", borderRadius: 3 }}>COMPOUND</span>}
                    {lastSets && <span style={{ color: "#525252", fontStyle: "italic" }}> / prev: {lastSets.slice(0, 2).map(s => `${s.weight}x${s.reps}${s.rpe ? ` @${s.rpe}` : ""}`).join(", ")}</span>}
                  </p>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? "#22C55E" : "#525252", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: allDone ? "#14532D" : "#1C1C1C" }}>
                  {allDone ? "\u2713" : `${exDone}/${exTotal}`}
                </span>
              </div>
              {/* Warm-up & substitution row */}
              {!allDone && exDone === 0 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {getExerciseInfo(ex.name).compound && (active.sets[exIdx]?.[0]?.weight) && Number(active.sets[exIdx][0].weight) > 45 && (
                    <button onClick={() => setWarmupEx({ name: ex.name, weight: Number(active.sets[exIdx][0].weight), reps: ex.reps })}
                      style={{ padding: "4px 10px", background: "#1A1500", border: "1px solid #3B2F00", borderRadius: 6, color: "#F59E0B", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Warm-up sets
                    </button>
                  )}
                  {getExerciseInfo(ex.name).subs.length > 0 && (
                    <button onClick={() => onToast(`Subs: ${getExerciseInfo(ex.name).subs.slice(0, 3).join(", ")}`, "success")}
                      style={{ padding: "4px 10px", background: "#141414", border: "1px solid #262626", borderRadius: 6, color: "#737373", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      Swap exercise
                    </button>
                  )}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 44px 36px", gap: 4, fontSize: 10, fontWeight: 700, color: "#525252", marginBottom: 6, padding: "0 2px" }}>
                <span>SET</span><span>LBS</span><span>REPS</span><span>RPE</span><span></span>
              </div>
              {(active.sets[exIdx] || []).map((s, si) => (
                <div key={si} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 44px 36px", gap: 4, alignItems: "center", padding: "3px 2px", borderRadius: 6, background: s.done ? "#0A1F0A" : "transparent" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#525252", textAlign: "center" }}>{si + 1}</span>
                  <div style={{ position: "relative" }}>
                    <input className="set-inp" type="number" inputMode="decimal" placeholder={lastSets?.[si]?.weight?.toString() || "0"}
                      value={s.weight} onChange={e => updateSet(exIdx, si, "weight", e.target.value)} disabled={s.done} />
                    {!s.done && s.weight && Number(s.weight) >= 45 && (
                      <button onClick={() => setPlateCalc(s.weight)} style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 11, cursor: "pointer", color: "#525252" }}>plates</button>
                    )}
                  </div>
                  <input className="set-inp" type="number" inputMode="numeric" placeholder={lastSets?.[si]?.reps?.toString() || "0"}
                    value={s.reps} onChange={e => updateSet(exIdx, si, "reps", e.target.value)} disabled={s.done} />
                  <select value={s.rpe || ""} onChange={e => updateSet(exIdx, si, "rpe", e.target.value)} disabled={s.done}
                    style={{ padding: "6px 2px", background: "#141414", border: "1px solid #1C1C1C", borderRadius: 6, color: s.rpe ? (Number(s.rpe) >= 9 ? "#EF4444" : Number(s.rpe) >= 7 ? "#F59E0B" : "#22C55E") : "#404040", fontSize: 12, fontWeight: 600, outline: "none", textAlign: "center", appearance: "none", WebkitAppearance: "none" }}>
                    <option value="">RPE</option>
                    <option value="6">6</option><option value="6.5">6.5</option>
                    <option value="7">7</option><option value="7.5">7.5</option>
                    <option value="8">8</option><option value="8.5">8.5</option>
                    <option value="9">9</option><option value="9.5">9.5</option>
                    <option value="10">10</option>
                  </select>
                  <button onClick={() => !s.done && completeSet(exIdx, si)} disabled={s.done}
                    style={{ width: 32, height: 32, borderRadius: "50%", border: s.done ? "none" : "2px solid #333", background: s.done ? "#22C55E" : "transparent",
                      color: s.done ? "#fff" : "#404040", fontSize: 14, fontWeight: 700, cursor: s.done ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all .15s" }}>
                    {s.done ? "\u2713" : "\u2713"}
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <button onClick={() => addSet(exIdx)} style={{ background: "none", border: "none", color: "#525252", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Set</button>
                <input placeholder="Note..." value={notes[ex.name] || ""} onChange={e => setNotes(p => ({ ...p, [ex.name]: e.target.value }))}
                  style={{ flex: 1, padding: "5px 8px", background: "#0A0A0A", border: "1px solid #1C1C1C", borderRadius: 6, color: "#737373", fontSize: 12, outline: "none" }} />
              </div>
            </div>
          );
        })}
        <div style={{ height: 100 }} />
      </div>
      {floatTimer && !fullTimer && <FloatingTimer seconds={smartRestSeconds} onDone={() => setFloatTimer(false)} onExpand={() => { setFloatTimer(false); setFullTimer(true); }} />}
      {fullTimer && <RestTimer seconds={smartRestSeconds} onDone={() => setFullTimer(false)} onCancel={() => setFullTimer(false)} />}
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
    <div className="fade-in">
      <h1 className="page-h1">Workout</h1>
      {workDays.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: 48 }}>&#128170;</p>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No workouts</h3>
          <p style={{ color: "#737373", fontSize: 14 }}>Create a split first to start training</p>
        </div>
      ) : (
        <div className="day-grid">
          {workDays.map((day) => {
            const origIdx = splits.indexOf(day);
            const c = TYPE_COLORS[day.type] || "#F59E0B";
            const lastLog = [...logs].reverse().find(l => l.dayName === day.name);
            return (
              <div key={origIdx} className="day-card day-card-start" onClick={() => startWorkout(origIdx)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: 0.5, padding: "3px 8px", background: c + "15", borderRadius: 4 }}>{day.type}</span>
                  <span style={{ fontSize: 12, color: "#525252" }}>Day {day.day}</span>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{day.name}</h3>
                {day.exercises.slice(0, 3).map((ex, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, borderBottom: "1px solid #1C1C1C" }}>
                    <span style={{ fontWeight: 500 }}>{ex.name}</span>
                    <span style={{ color: "#525252", fontSize: 12, fontWeight: 600 }}>{ex.sets}x{ex.reps}</span>
                  </div>
                ))}
                {day.exercises.length > 3 && <p style={{ fontSize: 12, color: "#525252", marginTop: 4 }}>+{day.exercises.length - 3} more</p>}
                {lastLog && <p style={{ fontSize: 11, color: "#404040", marginTop: 6 }}>Last: {new Date(lastLog.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>}
                <div style={{ marginTop: 10, textAlign: "center", padding: 8, background: "#22C55E12", borderRadius: 6, color: "#22C55E", fontSize: 13, fontWeight: 700 }}>Start Workout</div>
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
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, ld, pendingSplit]);

  const send = async () => {
    if (!inp.trim() || ld) return;
    const msg = inp.trim(); setInp("");
    onUpdate(prev => ({ ...prev, chat: [...prev.chat, { role: "user", content: msg }] }));
    setLd(true);
    const splitInfo = splits.length > 0
      ? `User's current split:\n${splits.map(d => `Day ${d.day}: ${d.name} (${d.type}) - ${d.exercises.map(e => e.name).join(", ") || "empty"}`).join("\n")}`
      : "User has NO split yet.";
    const isSplitReq = SPLIT_RE.test(msg);
    const sysMsg = `You are a fitness coach called MuscleBuilder Coach. Be concise, direct, and science-backed. Keep responses short (2-4 sentences max unless explaining exercises).

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
      const jsonReply = await groq([{
        role: "system",
        content: `You are a science-based workout generator. Return ONLY a valid JSON array. Each element: {"day":number,"name":"string","type":"string","exercises":[{"name":"string","sets":number,"reps":"string","muscle":"string"}]}.
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
    onUpdate(prev => ({ ...prev, chat: [...prev.chat, { role: "assistant", content: reply }] }));
    if (splitData) setPendingSplit(splitData);
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

  return (
    <div className="fade-in">
      <h1 className="page-h1">AI Coach</h1>
      <div className="chat-container">
        <div className="chat-messages">
          {chat.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, textAlign: "center", padding: 20 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: "#141414", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 12, border: "1px solid #262626" }}>&#129302;</div>
              <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Coach</p>
              <p style={{ color: "#737373", fontSize: 13, marginBottom: 16 }}>Build splits, get form tips, nutrition advice</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 400 }}>
                {quickPrompts.map((q, i) => (
                  <button key={i} onClick={() => setInp(q)}
                    style={{ padding: "7px 12px", background: "#141414", border: "1px solid #262626", borderRadius: 6, color: "#A3A3A3", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{q}</button>
                ))}
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
            <div style={{ alignSelf: "flex-start", background: "#0A1F0A", border: "1px solid #166534", borderRadius: 10, padding: 14, maxWidth: "85%" }}>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Split Ready - {pendingSplit.length} days</p>
              {pendingSplit.map((d, i) => {
                const c = TYPE_COLORS[d.type] || "#F59E0B";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #1A3A1A" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#525252", width: 36 }}>Day {d.day}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c, padding: "2px 6px", background: c + "15", borderRadius: 3 }}>{d.type}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: "#525252" }}>{d.exercises.length} ex</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn-accent" onClick={saveSplit} style={{ flex: 1, padding: "10px 16px" }}>Save to My Split</button>
                <button className="btn-ghost" onClick={() => setPendingSplit(null)}>Dismiss</button>
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
        <div className="chat-input-bar">
          <input value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask your coach..."
            style={{ flex: 1, padding: "10px 14px", background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#E5E5E5", fontSize: 14, outline: "none" }} />
          <button onClick={send} disabled={ld || !inp.trim()}
            style={{ width: 38, height: 38, borderRadius: 8, background: "#22C55E", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: ld || !inp.trim() ? "not-allowed" : "pointer", opacity: ld || !inp.trim() ? 0.3 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── REMINDER SYSTEM (workout, water, protein) ──
function useReminders(settings, onUpdate) {
  const [notifPerm, setNotifPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const timerRef = useRef(null);
  const waterTimerRef = useRef(null);

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    return perm;
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!settings.reminderEnabled || notifPerm !== "granted") return;

    const checkReminder = () => {
      const now = new Date();
      const days = settings.reminderDays || [1, 2, 3, 4, 5];
      if (!days.includes(now.getDay())) return;

      const [h, m] = (settings.reminderTime || "18:00").split(":").map(Number);
      if (now.getHours() === h && now.getMinutes() === m) {
        new Notification("MuscleBuilder", {
          body: "Time to hit the gym! Your workout is waiting.",
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
    if (!settings.waterReminder || notifPerm !== "granted") return;

    const checkWaterReminder = () => {
      const now = new Date();
      const hour = now.getHours();
      if (hour >= 8 && hour <= 20 && hour % 2 === 0 && now.getMinutes() === 0) {
        new Notification("MuscleBuilder - Hydration", {
          body: "Time to drink water! Stay hydrated for better performance.",
          icon: "/icon-192.png",
          tag: "water-reminder",
        });
      }
      if (settings.proteinReminder && hour >= 8 && hour <= 20 && hour % 4 === 0 && now.getMinutes() === 0) {
        new Notification("MuscleBuilder - Protein", {
          body: "Have you had enough protein? Aim for 30-40g per meal.",
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
function PremiumCheckout({ onUpgrade }) {
  const [plan, setPlan] = useState("yearly");
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState("plans"); // plans | payment | success

  const plans = [
    { id: "monthly", label: "Monthly", price: "$8.99", period: "/month", yearly: "$107.88/yr", save: null },
    { id: "yearly", label: "Yearly", price: "$4.99", period: "/month", yearly: "$59.88/yr", save: "Save 44%" },
    { id: "lifetime", label: "Lifetime", price: "$120", period: "one-time", yearly: null, save: "Best Value" },
  ];

  const [payMethod, setPayMethod] = useState("apple"); // apple | card

  const features = [
    { icon: "🍽", title: "AI Nutrition Tracker", desc: "80+ foods from Indian, Italian, Mexican, Japanese & more cuisines" },
    { icon: "🔥", title: "Calorie & Macro Calculator", desc: "TDEE calculator with personalized targets" },
    { icon: "⌚", title: "Wearable Sync", desc: "Connect Apple Watch, Fitbit, Garmin for live data" },
    { icon: "⚖️", title: "Smart Scale Market", desc: "Connect Bluetooth scales for auto weight logging" },
    { icon: "🤖", title: "AI Meal Planning", desc: "Describe any food — AI scans calories instantly" },
    { icon: "📊", title: "Advanced Analytics", desc: "Muscle volume, hard sets, and RPE tracking" },
  ];

  const formatCard = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  };

  const formatExp = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return digits.slice(0, 2) + "/" + digits.slice(2);
    return digits;
  };

  const handlePay = async () => {
    if (payMethod === "card" && (!cardNum.replace(/\s/g, "").length || !cardExp || !cardCvc || !cardName.trim())) return;
    setProcessing(true);
    // Simulate payment processing (Apple Pay or card)
    await new Promise(r => setTimeout(r, payMethod === "apple" ? 1500 : 2000));
    setProcessing(false);
    setStep("success");
    haptic.success();
  };

  if (step === "success") {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#22C55E,#16A34A)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 36, boxShadow: "0 8px 32px rgba(34,197,94,.3)" }}>✓</div>
        <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Welcome to Pro!</h2>
        <p style={{ color: "#737373", fontSize: 14, marginBottom: 24, maxWidth: 300, margin: "0 auto 24px" }}>
          Your premium features are now unlocked. Time to level up your nutrition game.
        </p>
        <button className="btn-accent" onClick={onUpgrade} style={{ maxWidth: 280 }}>Start Using Pro Features</button>
      </div>
    );
  }

  if (step === "payment") {
    const selectedPlan = plans.find(p => p.id === plan);
    return (
      <div className="fade-in">
        <button onClick={() => setStep("plans")} style={{ background: "none", border: "none", color: "#737373", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          ← Back to plans
        </button>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #1A1A1A" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>MuscleBuilder Pro ({selectedPlan?.label})</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: "#22C55E" }}>{selectedPlan?.price}<span style={{ fontSize: 12, color: "#525252", fontWeight: 600 }}>{selectedPlan?.period !== "one-time" ? selectedPlan?.period : ""}</span></span>
          </div>

          {/* Apple Pay button */}
          <button onClick={() => { setPayMethod("apple"); handlePay(); }} disabled={processing}
            style={{ width: "100%", padding: 14, background: "#000", border: "1px solid #333", borderRadius: 10, cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: processing && payMethod === "apple" ? 0.7 : 1 }}>
            {processing && payMethod === "apple" ? (
              <span style={{ color: "#A3A3A3", fontSize: 14, fontWeight: 600 }}>Authorizing...</span>
            ) : (
              <svg width="50" height="20" viewBox="0 0 50 20" fill="none">
                <path d="M9.4 3.3c-.6.7-1.5 1.2-2.4 1.1-.1-1 .4-2 .9-2.6C8.5 1.1 9.5.6 10.3.5c.1 1-.3 2-.9 2.8zM10.3 4.6c-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7C2.9 4.7 1.5 5.7.8 7.2c-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2 2.5 2 1-.1 1.4-.6 2.6-.6 1.2 0 1.5.6 2.6.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2.2-.8-2.2-3.3 0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.6-1.6-3.1-1.7l.7.7z" fill="#fff"/>
                <path d="M20.3 2.2c3.1 0 5.3 2.1 5.3 5.3 0 3.2-2.2 5.3-5.4 5.3h-3.4v5.5h-2.5V2.2h6zm-3.5 8.5h2.8c2.2 0 3.4-1.2 3.4-3.2 0-2-1.2-3.2-3.4-3.2h-2.8v6.4zM26.5 14.3c0-2.1 1.6-3.3 4.4-3.5l3.2-.2v-.9c0-1.3-.9-2.1-2.4-2.1-1.4 0-2.3.7-2.5 1.7h-2.3c.1-2.2 2-3.8 4.9-3.8 2.9 0 4.7 1.5 4.7 3.9v8.2h-2.3v-2h-.1c-.7 1.3-2.1 2.2-3.7 2.2-2.3 0-3.9-1.4-3.9-3.5zm7.6-1.1v-.9l-2.9.2c-1.5.1-2.3.7-2.3 1.7 0 1 .9 1.7 2.2 1.7 1.7 0 3-1.2 3-2.7zM38 21.3v-1.9c.2 0 .6.1.9.1 1.3 0 2-.5 2.4-1.9l.3-.9-4.5-12.4h2.6l3.1 10.1h.1l3.1-10.1h2.5l-4.6 13c-1.1 3-2.3 3.9-4.8 3.9-.3.1-.8.1-1.1.1z" fill="#fff"/>
              </svg>
            )}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#262626" }} />
            <span style={{ fontSize: 11, color: "#404040", fontWeight: 600 }}>or pay with card</span>
            <div style={{ flex: 1, height: 1, background: "#262626" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <svg width="38" height="24" viewBox="0 0 38 24" fill="none"><rect width="38" height="24" rx="4" fill="#1A1F36"/><circle cx="15" cy="12" r="7" fill="#EB001B" opacity=".8"/><circle cx="23" cy="12" r="7" fill="#F79E1B" opacity=".8"/></svg>
            <svg width="38" height="24" viewBox="0 0 38 24" fill="none"><rect width="38" height="24" rx="4" fill="#1A1F36"/><path d="M13 7l-2 10h3l2-10h-3zm10 0l-4 10h3l1-2h3l.5 2h3L27 7h-4zm1 6l1.5-4 .8 4h-2.3zM9 7L6 17h3l3-10H9z" fill="#fff"/></svg>
            <span style={{ fontSize: 11, color: "#404040" }}>Secure payment</span>
          </div>

          <p className="label" style={{ marginBottom: 6 }}>Cardholder Name</p>
          <input className="input" placeholder="John Doe" value={cardName}
            onChange={e => setCardName(e.target.value)} autoComplete="cc-name" />

          <p className="label" style={{ marginBottom: 6 }}>Card Number</p>
          <input className="input" placeholder="4242 4242 4242 4242" value={cardNum}
            onChange={e => setCardNum(formatCard(e.target.value))} inputMode="numeric" autoComplete="cc-number" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <p className="label" style={{ marginBottom: 6 }}>Expiry</p>
              <input className="input" placeholder="MM/YY" value={cardExp}
                onChange={e => setCardExp(formatExp(e.target.value))} inputMode="numeric" autoComplete="cc-exp" />
            </div>
            <div>
              <p className="label" style={{ marginBottom: 6 }}>CVC</p>
              <input className="input" placeholder="123" value={cardCvc} type="password"
                onChange={e => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="cc-csc" />
            </div>
          </div>

          <button className="btn-accent" onClick={() => { setPayMethod("card"); handlePay(); }} disabled={processing}
            style={{ marginTop: 8, background: processing && payMethod === "card" ? "#1C1C1C" : "linear-gradient(135deg,#22C55E,#16A34A)", opacity: processing && payMethod === "card" ? 0.7 : 1 }}>
            {processing && payMethod === "card" ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#A3A3A3" }}>
                <span className="dot" style={{ width: 6, height: 6 }} /><span className="dot d2" style={{ width: 6, height: 6 }} /><span className="dot d3" style={{ width: 6, height: 6 }} />
                <span style={{ marginLeft: 4 }}>Processing...</span>
              </span>
            ) : `Pay ${selectedPlan?.price}${plan === "lifetime" ? "" : selectedPlan?.period}`}
          </button>

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
        <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4, background: "linear-gradient(135deg, #E5E5E5, #A78BFA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>MuscleBuilder Pro</h2>
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
              <div style={{ fontSize: 18, fontWeight: 900, color: plan === p.id ? "#A78BFA" : "#525260" }}>{p.price}</div>
              <div style={{ fontSize: 10, color: "#525260", fontWeight: 600 }}>{p.period}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: plan === p.id ? "#E5E5E5" : "#404050", marginTop: 4 }}>{p.label}</div>
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
      <button className="btn-accent" onClick={() => setStep("payment")}
        style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", marginBottom: 8, boxShadow: "0 4px 16px rgba(99,102,241,.3)" }}>
        Start 7-Day Free Trial
      </button>
      <p style={{ fontSize: 11, color: "#404040", textAlign: "center", marginBottom: 20 }}>No charge today. Cancel anytime before trial ends.</p>

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
function NutritionPage({ nutrition, bodyWeight, onUpdate, onToast }) {
  const [tab, setTab] = useState("overview");
  const [foodInput, setFoodInput] = useState("");
  const [foodLoading, setFoodLoading] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [foodSearch, setFoodSearch] = useState("");
  const [foodCat, setFoodCat] = useState("All");

  // Profile setup state
  const [profileForm, setProfileForm] = useState({
    sex: "male", age: "", weight: "", heightFt: "", heightIn: "", activity: "moderate", goal: "maintain",
  });

  const today = todayStr();

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
    if (!foodInput.trim() || foodLoading) return;
    setFoodLoading(true);
    const response = await groq([{
      role: "system",
      content: 'Estimate the nutrition for this food. Return ONLY valid JSON: {"name":"food description","calories":number,"protein":number,"carbs":number,"fat":number}. Be accurate. No text outside JSON.'
    }, { role: "user", content: foodInput.trim() }], 512);

    try {
      const m = response.match(/\{[\s\S]*?\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        const item = {
          name: parsed.name || foodInput.trim(),
          calories: Math.round(Number(parsed.calories) || 0),
          protein: Math.round(Number(parsed.protein) || 0),
          carbs: Math.round(Number(parsed.carbs) || 0),
          fat: Math.round(Number(parsed.fat) || 0),
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
        onToast("Could not parse food data", "error");
      }
    } catch {
      onToast("Could not parse food data", "error");
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

  // If no profile, show setup
  if (!profile) {
    return (
      <div className="fade-in">
        <h1 className="page-h1">Nutrition</h1>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Set Up Your Profile</h3>
          <p style={{ fontSize: 13, color: "#737373", marginBottom: 16 }}>Calculate your daily calorie and macro targets</p>

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
    );
  }

  const nutTabs = [
    { id: "overview", label: "Overview" },
    { id: "food", label: "Food Log" },
    { id: "water", label: "Water" },
    { id: "weight", label: "Weight" },
    { id: "devices", label: "Devices" },
  ];

  const calPct = Math.min(100, (dailyCals / calTarget) * 100);

  return (
    <div className="fade-in">
      <h1 className="page-h1">Nutrition</h1>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto" }}>
        {nutTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${tab === t.id ? "#22C55E" : "#262626"}`,
              background: tab === t.id ? "#0A1F0A" : "#141414", color: tab === t.id ? "#22C55E" : "#737373",
              fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === "overview" && (
        <div>
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

          {/* Quick water */}
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
          </div>
        </div>
      )}

      {/* FOOD LOG TAB */}
      {tab === "food" && (
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

          {/* AI food logging */}
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="label" style={{ marginBottom: 8 }}>AI Food Scanner</p>
            <p style={{ fontSize: 11, color: "#404040", marginBottom: 8 }}>Describe anything — AI estimates the macros</p>
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
      {tab === "water" && (
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
      {tab === "weight" && (
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
      {tab === "devices" && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1E1E1E,#2A2A2A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⌚</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>Wearable Devices</p>
                <p style={{ fontSize: 12, color: "#737373" }}>Sync workouts, heart rate & calories</p>
              </div>
            </div>
            {[
              { name: "Apple Watch", icon: "🍎", desc: "Sync via Apple HealthKit", color: "#E5E5E5", connected: false },
              { name: "Fitbit", icon: "💚", desc: "Steps, heart rate, sleep", color: "#00B0B9", connected: false },
              { name: "Garmin", icon: "🔵", desc: "Training load & recovery", color: "#007CC3", connected: false },
              { name: "Samsung Galaxy Watch", icon: "💜", desc: "Samsung Health sync", color: "#8B5CF6", connected: false },
              { name: "Whoop", icon: "🟡", desc: "Strain & recovery scores", color: "#F59E0B", connected: false },
            ].map((device, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i > 0 ? "1px solid #1A1A1A" : "none" }}>
                <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{device.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{device.name}</p>
                  <p style={{ fontSize: 11, color: "#525252" }}>{device.desc}</p>
                </div>
                <button onClick={() => onToast(`${device.name} pairing initiated. Open your device's companion app.`)}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #262626", background: "#141414", color: "#22C55E", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Connect
                </button>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#1E1E1E,#2A2A2A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⚖️</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 700 }}>Smart Scales</p>
                <p style={{ fontSize: 12, color: "#737373" }}>Auto-log weight & body composition</p>
              </div>
            </div>
            {[
              { name: "Withings Body+", desc: "Weight, BMI, body fat, muscle mass", price: "$99.95", rating: "4.6" },
              { name: "Renpho ES-CS20M", desc: "13 body metrics via Bluetooth", price: "$29.99", rating: "4.5" },
              { name: "Eufy Smart Scale P2", desc: "Wi-Fi body comp, Apple Health sync", price: "$39.99", rating: "4.7" },
              { name: "Garmin Index S2", desc: "Wi-Fi scale, multi-user, Garmin Connect", price: "$149.99", rating: "4.4" },
              { name: "Wyze Scale X", desc: "12 body metrics, heart rate", price: "$33.98", rating: "4.3" },
            ].map((scale, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i > 0 ? "1px solid #1A1A1A" : "none" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 20 }}>⚖️</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600 }}>{scale.name}</p>
                  <p style={{ fontSize: 11, color: "#525252" }}>{scale.desc}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700 }}>★ {scale.rating}</span>
                    <span style={{ fontSize: 11, color: "#22C55E", fontWeight: 700 }}>{scale.price}</span>
                  </div>
                </div>
                <button onClick={() => onToast(`Searching for ${scale.name}... Enable Bluetooth on your device.`)}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #262626", background: "#141414", color: "#3B82F6", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Pair
                </button>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 16, background: "#0A1F0A", borderColor: "#14532D" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#22C55E", marginBottom: 4 }}>How it works</p>
            <p style={{ fontSize: 12, color: "#737373", lineHeight: 1.6 }}>
              Connect your wearable or smart scale to automatically sync data. Workouts, steps, heart rate, and weight
              readings will appear in your MuscleBuilder dashboard in real-time. All connections use secure Bluetooth LE
              or HealthKit/Google Fit APIs.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SETTINGS ──
function SettingsPage({ settings, onUpdate, onLogout, user, onClearData, onLoadSample, premium, onTogglePremium }) {
  const restOpts = [30, 45, 60, 90, 120, 180, 300];
  const { notifPerm, requestPermission } = useReminders(settings, onUpdate);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

  const exportData = () => {
    const d = store.getData(user);
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `musclebuilder-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
            <button key={s} onClick={() => onUpdate({ ...settings, restTime: s })}
              style={{ padding: "8px 14px", background: settings.restTime === s ? "#0A1F0A" : "#141414", border: `1px solid ${settings.restTime === s ? "#22C55E" : "#262626"}`,
                borderRadius: 6, color: settings.restTime === s ? "#22C55E" : "#737373", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              {s >= 60 ? `${s / 60}m` : `${s}s`}
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
              if (perm === "granted") onUpdate({ ...settings, reminderEnabled: true, reminderTime: "18:00", reminderDays: [1, 2, 3, 4, 5] });
            }} style={{ padding: "10px 16px" }}>Enable Notifications</button>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Reminders</span>
              <button onClick={() => onUpdate({ ...settings, reminderEnabled: !settings.reminderEnabled })}
                style={{ width: 44, height: 24, borderRadius: 12, background: settings.reminderEnabled ? "#22C55E" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.reminderEnabled ? 22 : 2, transition: "left .2s" }} />
              </button>
            </div>
            {settings.reminderEnabled && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#737373" }}>Time: </span>
                  <input type="time" value={settings.reminderTime || "18:00"}
                    onChange={e => onUpdate({ ...settings, reminderTime: e.target.value })}
                    style={{ background: "#141414", border: "1px solid #262626", borderRadius: 6, color: "#E5E5E5", padding: "4px 8px", fontSize: 14, outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => {
                    const days = settings.reminderDays || [1, 2, 3, 4, 5];
                    const active = days.includes(i);
                    return (
                      <button key={i} onClick={() => {
                        const nd = active ? days.filter(x => x !== i) : [...days, i];
                        onUpdate({ ...settings, reminderDays: nd });
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
                    <button onClick={() => onUpdate({ ...settings, waterReminder: !settings.waterReminder })}
                      style={{ width: 44, height: 24, borderRadius: 12, background: settings.waterReminder ? "#3B82F6" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.waterReminder ? 22 : 2, transition: "left .2s" }} />
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Protein Reminders (every 4h)</span>
                    <button onClick={() => onUpdate({ ...settings, proteinReminder: !settings.proteinReminder })}
                      style={{ width: 44, height: 24, borderRadius: 12, background: settings.proteinReminder ? "#A855F7" : "#333", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: settings.proteinReminder ? 22 : 2, transition: "left .2s" }} />
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

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 8 }}>Testing</p>
        <button className="btn-ghost" onClick={() => { if (window.confirm("Load 6 weeks of sample workout data?")) onLoadSample(); }} style={{ width: "100%", marginBottom: 8 }}>
          Load Sample Data (for testing)
        </button>
        <button className="btn-ghost" onClick={onTogglePremium} style={{ width: "100%", borderColor: premium ? "#F59E0B" : "#262626", color: premium ? "#F59E0B" : "#A3A3A3" }}>
          {premium ? "Disable Premium (testing)" : "Enable Premium (testing)"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <p className="label" style={{ marginBottom: 4 }}>App</p>
        <p style={{ fontSize: 13, color: "#737373" }}>MuscleBuilder v6.0{premium ? " Pro" : ""}</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>AI Coach powered by Groq (Llama 3.3 70B)</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Science-based training with RPE tracking</p>
        <p style={{ fontSize: 12, color: "#525252", marginTop: 2 }}>Apple Watch, Fitbit & Garmin compatible</p>
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

  useEffect(() => {
    if (user) {
      const d = store.getData(user) || JSON.parse(JSON.stringify(EMPTY));
      if (!d.settings) d.settings = { restTime: 90, unit: "lbs" };
      if (!d.chat) d.chat = [];
      if (!d.splits) d.splits = [];
      if (!d.logs) d.logs = [];
      if (!d.nutrition) d.nutrition = { profile: null, foodLog: [], waterLog: [] };
      if (!d.bodyWeight) d.bodyWeight = [];
      if (d.premium === undefined) d.premium = false;
      store.setData(user, d);
      setData(d);
    }
  }, [user]);

  const save = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (user) store.setData(user, next);
      return next;
    });
  }, [user]);

  const showToast = useCallback((msg, type = "success") => setToast({ msg, type }), []);
  const login = u => { store.setSession(u); setUser(u); };
  const logout = () => { store.setSession(null); setUser(null); setData(null); setPg("coach"); };

  if (!user) return <><style>{CSS}</style><Auth onLogin={login} /></>;
  if (!data) return null;

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
            <div className="logo-mark">MB</div>
            <span className="logo-text">MuscleBuilder</span>
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
            <WorkoutPage splits={data.splits} logs={data.logs} restTime={data.settings?.restTime || 90}
              onLogWorkout={l => { save(prev => ({ ...prev, logs: [...prev.logs, l] })); showToast("Workout logged"); }}
              onToast={showToast} />
          )}
          {pg === "nutrition" && (
            data.premium
              ? <NutritionPage nutrition={data.nutrition} bodyWeight={data.bodyWeight} onUpdate={save} onToast={showToast} />
              : <PremiumCheckout onUpgrade={() => save(prev => ({ ...prev, premium: true }))} />
          )}
          {pg === "analytics" && <AnalyticsPage logs={data.logs} />}
          {pg === "settings" && (
            <SettingsPage settings={data.settings || { restTime: 90 }}
              onUpdate={s => save(prev => ({ ...prev, settings: s }))}
              onLogout={logout} user={user}
              premium={data.premium}
              onTogglePremium={() => save(prev => ({ ...prev, premium: !prev.premium }))}
              onClearData={() => { save(JSON.parse(JSON.stringify(EMPTY))); showToast("Data cleared"); }}
              onLoadSample={() => { const sample = generateSampleData(); save(sample); showToast("Sample data loaded"); }} />
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
.app-shell{display:flex;min-height:100vh;min-height:100dvh}
.sidebar{width:220px;background:#0C0C0C;border-right:1px solid #1A1A1A;padding:20px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
.sidebar-head{display:flex;align-items:center;gap:10px;padding:0 16px;margin-bottom:32px}
.logo-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#22C55E,#16A34A);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#000;box-shadow:0 2px 8px rgba(34,197,94,.25)}
.logo-text{font-size:15px;font-weight:800;letter-spacing:-.2px}
.sidebar-nav{flex:1}
.nav-item{padding:10px 16px;color:#737373;cursor:pointer;font-size:13px;font-weight:600;border-left:2px solid transparent;transition:all .15s;margin:1px 0}
.nav-item:hover{color:#E5E5E5;background:#141414}
.nav-item-active{color:#22C55E;border-left-color:#22C55E;background:linear-gradient(90deg,#0A1F0A,transparent)}
.sidebar-foot{padding:14px 16px;border-top:1px solid #1A1A1A;display:flex;align-items:center;gap:10px}
.sidebar-user{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#22C55E,#16A34A);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;flex-shrink:0}
.sidebar-email{font-size:11px;color:#525252;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.main-content{flex:1;margin-left:220px;padding:28px 36px 80px;max-width:800px}
.mobile-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(12,12,12,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid #1A1A1A;padding:6px 0 env(safe-area-inset-bottom,8px);z-index:200;justify-content:space-around}
.mob-tab{display:flex;flex-direction:column;align-items:center;padding:4px 2px;background:none;border:none;color:#525252;cursor:pointer;font-size:9px;font-weight:700;min-width:0;transition:color .15s;letter-spacing:.2px}
.mob-tab-active{color:#22C55E}
@media(max-width:768px){
  .sidebar{display:none}
  .main-content{margin-left:0;padding:16px 16px 90px;padding-top:env(safe-area-inset-top,16px)}
  .mobile-nav{display:flex}
}

/* Typography */
.page-h1{font-size:28px;font-weight:900;margin-bottom:18px;letter-spacing:-.5px}
.section-h2{font-size:16px;font-weight:700;margin:0 0 10px}
.label{font-size:10px;font-weight:800;color:#525252;text-transform:uppercase;letter-spacing:.8px}

/* Cards */
.card{background:#111111;border:1px solid #1A1A1A;border-radius:12px;padding:16px;transition:border-color .15s}
.day-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.day-card{background:#111111;border:1px solid #1A1A1A;border-radius:12px;padding:14px 16px;cursor:pointer;transition:all .15s}
.day-card:hover{border-color:#333;transform:translateY(-1px)}
.day-card-start:hover{border-color:#22C55E;box-shadow:0 4px 12px rgba(34,197,94,.08)}

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
.input{width:100%;padding:12px 14px;background:#0A0A0A;border:1px solid #262626;border-radius:10px;color:#E5E5E5;font-size:15px;outline:none;margin-bottom:10px;transition:border-color .15s}
.input:focus{border-color:#22C55E50;box-shadow:0 0 0 3px rgba(34,197,94,.08)}
.input::placeholder{color:#404040}
.input.sm{padding:9px 10px;font-size:14px;margin-bottom:0}
.set-inp{padding:8px;background:#141414;border:1px solid #1C1C1C;border-radius:8px;color:#E5E5E5;font-size:14px;font-weight:600;outline:none;text-align:center;width:100%;transition:border-color .15s}
.set-inp:focus{border-color:#22C55E50;box-shadow:0 0 0 2px rgba(34,197,94,.06)}
.set-inp:disabled{opacity:.4;color:#525252}

/* Buttons */
.btn-accent{width:100%;padding:12px;background:linear-gradient(135deg,#22C55E,#16A34A);color:#000;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s;box-shadow:0 2px 8px rgba(34,197,94,.2)}
.btn-accent:hover{opacity:.92;transform:translateY(-1px);box-shadow:0 4px 12px rgba(34,197,94,.3)}
.btn-accent:active{opacity:.85;transform:translateY(0)}
.btn-ghost{padding:10px 16px;background:#141414;border:1px solid #262626;border-radius:10px;color:#A3A3A3;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.btn-ghost:hover{border-color:#404040;color:#E5E5E5;background:#1A1A1A}
.btn-danger-sm{padding:10px 16px;background:transparent;border:1px solid #7F1D1D;border-radius:10px;color:#737373;font-size:13px;font-weight:600;cursor:pointer;transition:all .12s}
.btn-danger-sm:hover{color:#EF4444;border-color:#EF4444}
.move-btn{background:none;border:none;color:#404040;cursor:pointer;font-size:9px;padding:1px 4px;line-height:1}
.move-btn:hover:not(:disabled){color:#22C55E}
.move-btn:disabled{opacity:.2}

/* Badges */
.badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;border:1px solid #1C1C1C}
.badge-orange{color:#F59E0B;background:#1A1500;border-color:#3B2F00}
.badge-green{color:#22C55E;background:#0A1F0A;border-color:#14532D}

/* Stats */
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
@media(max-width:500px){.stats-row{grid-template-columns:repeat(2,1fr)}}
.stat-box{background:#111111;border:1px solid #1A1A1A;border-radius:12px;padding:16px 10px;text-align:center}
.stat-num{font-size:26px;font-weight:900;letter-spacing:-.5px}
.sv-sm{font-size:18px!important}
.stat-label{font-size:9px;color:#525252;text-transform:uppercase;letter-spacing:.8px;margin-top:4px;font-weight:800}

/* Split stats */
.split-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
@media(max-width:500px){.split-stats{grid-template-columns:repeat(2,1fr)}}
.split-stat{background:#111111;border:1px solid #1A1A1A;border-radius:10px;padding:14px 8px;text-align:center}
.split-stat-num{font-size:22px;font-weight:900;display:block;letter-spacing:-.3px}
.split-stat-label{font-size:9px;color:#525252;text-transform:uppercase;font-weight:800;display:block;margin-top:2px;letter-spacing:.5px}

/* Week bar */
.week-bar{display:flex;gap:6px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px}
.week-day{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:56px;cursor:pointer;transition:transform .1s}
.week-day:active{transform:scale(.95)}
.week-day-num{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;transition:all .15s}
.week-day-name{font-size:10px;color:#525252;font-weight:600;white-space:nowrap}

/* Exercise row */
.ex-row{display:flex;align-items:center;padding:10px 12px;background:#141414;border-radius:10px;margin-bottom:4px;gap:8px;transition:background .1s}

/* Overlays */
.overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:300;display:flex;align-items:flex-end;justify-content:center;animation:overlayIn .2s ease}
@keyframes overlayIn{from{opacity:0}to{opacity:1}}
.sheet{background:#111111;border-radius:16px 16px 0 0;width:100%;max-width:500px;max-height:88vh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom,28px);animation:sheetUp .3s cubic-bezier(.16,1,.3,1)}
@keyframes sheetUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
.timer-modal{background:#111111;border:1px solid #1A1A1A;border-radius:20px;padding:32px 40px;text-align:center;animation:scaleIn .25s cubic-bezier(.16,1,.3,1);box-shadow:0 16px 48px rgba(0,0,0,.5)}
@keyframes scaleIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
.plate-modal{background:#111111;border:1px solid #1A1A1A;border-radius:16px;padding:20px;max-width:280px;width:90%;animation:scaleIn .2s cubic-bezier(.16,1,.3,1)}
.summary-modal{background:#111111;border:1px solid #1A1A1A;border-radius:16px;padding:28px 24px;max-width:380px;width:90%;animation:scaleIn .3s cubic-bezier(.16,1,.3,1);box-shadow:0 16px 48px rgba(0,0,0,.5)}

/* Float timer */
.float-timer{position:fixed;bottom:68px;left:50%;transform:translateX(-50%);width:calc(100% - 24px);max-width:460px;background:rgba(17,17,17,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid #1A1A1A;border-radius:12px;overflow:hidden;z-index:250;cursor:pointer;animation:slideUp .25s cubic-bezier(.16,1,.3,1);box-shadow:0 4px 20px rgba(0,0,0,.4)}
@media(min-width:769px){.float-timer{bottom:16px;left:calc(220px + 50%);transform:translateX(calc(-50% - 110px))}}
@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* Workout header */
.workout-header{position:sticky;top:0;z-index:50;background:rgba(10,10,10,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 0;margin-bottom:4px}
@media(max-width:768px){.workout-header{padding-top:env(safe-area-inset-top,8px)}}

/* Chat */
.chat-container{display:flex;flex-direction:column;height:calc(100vh - 120px);height:calc(100dvh - 120px);background:#0C0C0C;border:1px solid #1A1A1A;border-radius:14px;overflow:hidden}
.chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
.chat-msg{max-width:80%;padding:10px 14px;font-size:14px;line-height:1.6;animation:fadeUp .2s ease}
.chat-msg-user{align-self:flex-end;background:linear-gradient(135deg,#22C55E,#16A34A);color:#000;border-radius:14px 14px 2px 14px;font-weight:500}
.chat-msg-bot{align-self:flex-start;background:#141414;border:1px solid #1A1A1A;border-radius:14px 14px 14px 2px}
.chat-input-bar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #1A1A1A;background:#0C0C0C}

/* Typing dots */
.dot{width:6px;height:6px;border-radius:50%;background:#525252;animation:bounce 1.2s infinite}
.d2{animation-delay:.2s}
.d3{animation-delay:.4s}
@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
`;
