import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  Wind,
  Flame,
  Shirt,
  Refrigerator,
  Plug,
  Droplet,
  Tv,
  Lightbulb,
  Monitor,
  Zap,
  ArrowDownCircle,
  Sun,
  TrendingUp,
  IndianRupee,
  Gauge,
  Smile,
  Play,
  Pause,
  RotateCcw,
  Info,
  Equal,
  Clock,
  Leaf,
  Cpu,
  ChevronDown,
  ChevronUp,
  AlarmClock,
  Star,
  Thermometer,
  Users,
  Radio,
  Activity,
  AlertTriangle,
  Waves,
  ToggleLeft,
  BrainCircuit,
  ScrollText,
  CircuitBoard,
  Bolt,
  Gauge as GaugeIcon,
  Repeat,
  Calendar,
  Home,
  Battery,
  WifiOff,
  Ban,
  AlertOctagon,
  FlaskConical,
  Square,
  LayoutGrid,
  Wrench,
  ShieldCheck,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/* Core time helpers                                                      */
/* ---------------------------------------------------------------------- */

const SLOTS = 96; // 24h * 4 (15-min intervals)

const slotToHour = (slot) => slot / 4;

const formatTime = (slot) => {
  const h = Math.floor(slot / 4);
  const m = (slot % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// Formats a decimal-hour rule value (can exceed 24 for overnight windows)
const formatHourLabel = (h) => {
  const dayOffset = Math.floor(h / 24);
  const hh = h - dayOffset * 24;
  const hours = Math.floor(hh);
  const minutes = Math.round((hh - hours) * 60);
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return dayOffset > 0 ? `${base} (+${dayOffset}d)` : base;
};

const inRanges = (hour, ranges) => ranges.some(([s, e]) => hour >= s && hour < e);

const solarAt = (hour) => {
  if (hour < 6 || hour >= 18) return 0;
  const x = (hour - 6) / 12;
  return +(3.5 * Math.sin(Math.PI * x)).toFixed(3);
};

const carbonIntensityAt = (hour) => {
  if (hour >= 18 && hour < 22) return 0.9; // evening peak, fossil-heavy
  if (hour >= 6 && hour < 18) return solarAt(hour) > 0 ? 0.35 : 0.55; // daytime
  return 0.6; // night baseload mix
};

/* ---------------------------------------------------------------------- */
/* Tariff plans (Stage 2)                                                 */
/* ---------------------------------------------------------------------- */

const TARIFF_PLANS = [
  { id: "flat", label: "Flat Tariff", icon: Equal },
  { id: "tou", label: "Time-of-Use", icon: Clock },
  { id: "green", label: "Green / Solar-friendly", icon: Leaf },
];

const tariffAt = (hour, plan, prices) => {
  if (plan === "flat") return prices.normal;
  if (plan === "tou") {
    if (hour >= 18 && hour < 22) return prices.peak;
    if (hour >= 6 && hour < 18) return prices.normal;
    return prices.offpeak;
  }
  // green / solar-friendly: cheapest during solar-generation hours
  if (hour >= 18 && hour < 22) return prices.peak;
  if (hour >= 6 && hour < 18) return prices.offpeak;
  return prices.normal;
};

/* ---------------------------------------------------------------------- */
/* Appliance definitions                                                  */
/* ---------------------------------------------------------------------- */
// `flexible` appliances are scheduled by the RL-style Energy Scheduler
// (Stage 2). Non-flexible appliances keep their Stage 1 fixed schedules.

const APPLIANCES = [
  {
    id: "ac",
    name: "Air Conditioner",
    icon: Wind,
    ratingW: 1500,
    critical: true,
    deferable: true,
    flexible: false,
    baseline: [[13, 16], [20, 23]],
    ai: [[12, 14], [20, 21.5]],
  },
  {
    id: "waterheater",
    name: "Water Heater",
    icon: Flame,
    ratingW: 2000,
    critical: true,
    deferable: true,
    flexible: true,
    naiveStartHour: 6,
  },
  {
    id: "washingmachine",
    name: "Washing Machine",
    icon: Shirt,
    ratingW: 800,
    critical: false,
    deferable: true,
    flexible: true,
    naiveStartHour: 9,
  },
  {
    id: "fridge",
    name: "Refrigerator",
    icon: Refrigerator,
    ratingW: 150,
    critical: true,
    deferable: false,
    flexible: false,
    continuous: true,
    duty: 0.55,
    baseline: [],
    ai: [],
  },
  {
    id: "evcharger",
    name: "EV Charger",
    icon: Plug,
    ratingW: 3000,
    critical: false,
    deferable: true,
    flexible: true,
    naiveStartHour: 20,
  },
  {
    id: "waterpump",
    name: "Water Pump",
    icon: Droplet,
    ratingW: 1000,
    critical: false,
    deferable: true,
    flexible: true,
    naiveStartHour: 7,
  },
  {
    id: "tv",
    name: "Television",
    icon: Tv,
    ratingW: 150,
    critical: false,
    deferable: false,
    flexible: false,
    baseline: [[19, 22]],
    ai: [[19, 22]],
  },
  {
    id: "lighting",
    name: "Lighting",
    icon: Lightbulb,
    ratingW: 100,
    critical: false,
    deferable: false,
    flexible: false,
    baseline: [[5, 6], [18, 23]],
    ai: [[5, 6], [18, 23]],
  },
  {
    id: "computer",
    name: "Computer",
    icon: Monitor,
    ratingW: 200,
    critical: false,
    deferable: false,
    flexible: false,
    baseline: [[9, 18]],
    ai: [[9, 18]],
  },
];

const FLEX_IDS = ["waterheater", "washingmachine", "evcharger", "waterpump"];

// Default scheduling rules per flexible appliance (Stage 2, editable in UI)
const DEFAULT_RULES = {
  waterheater: { earliestStart: 3, latestCompletion: 7, runtimeHours: 1, priority: 4, flexibility: 0.4, comfortImpact: 0.8 },
  washingmachine: { earliestStart: 8, latestCompletion: 20, runtimeHours: 0.75, priority: 2, flexibility: 0.9, comfortImpact: 0.2 },
  evcharger: { earliestStart: 20, latestCompletion: 30, runtimeHours: 3, priority: 3, flexibility: 0.7, comfortImpact: 0.3 },
  waterpump: { earliestStart: 4, latestCompletion: 8, runtimeHours: 1, priority: 3, flexibility: 0.6, comfortImpact: 0.4 },
};

// Illustrative weighting constants for the transparent scheduling score.
// These are fixed, hand-chosen weights for a rule-based search — not
// learned coefficients from a trained reinforcement-learning model.
const SCORE_WEIGHTS = { peak: 6, comfort: 5, deadline: 8, carbon: 2, solar: 3 };

const SPEED_OPTIONS = [1, 2, 4, 8];

/* ---------------------------------------------------------------------- */
/* Scenario Lab (Stage 4)                                                 */
/* Each scenario nudges the existing simulation state (temperature,       */
/* occupancy, tariff, clock, overrides) and sets a small set of UI flags  */
/* used to show degraded/offline/at-risk states elsewhere in the app.     */
/* ---------------------------------------------------------------------- */

const DEFAULT_SCENARIO_FLAGS = {
  edgeOffline: false,
  tempSensorFault: false,
  currentSensorFault: false,
  transformerRisk: false,
  lowBattery: false,
  unavailableApplianceId: null,
};

const SCENARIOS = [
  { id: "weekday", label: "Normal Weekday", icon: Calendar },
  { id: "weekend", label: "Weekend", icon: Home },
  { id: "heatwave", label: "Heat Wave", icon: Flame },
  { id: "hightariff", label: "High-Tariff Evening", icon: TrendingUp },
  { id: "familyarrival", label: "Sudden Family Arrival", icon: Users },
  { id: "solarsurplus", label: "Solar Surplus", icon: Sun },
  { id: "lowbattery", label: "Low Battery", icon: Battery },
  { id: "outage", label: "Internet Outage", icon: WifiOff },
  { id: "tempfault", label: "Temp Sensor Failure", icon: Thermometer },
  { id: "currentfault", label: "Current Sensor Failure", icon: GaugeIcon },
  { id: "unavailable", label: "Appliance Unavailable", icon: Ban },
  { id: "transformer", label: "Transformer Overload Risk", icon: AlertOctagon },
];

// Conservative, hand-picked values used to keep the system safe when a
// sensor is marked faulty — deliberately boring/static, not derived from
// any live (and therefore untrustworthy) reading.
const SAFE_FALLBACK = { current: 0.0, power: 0, voltage: 230.0, dhtTemp: 26.0, humidity: 50 };

const DEMO_STEP_MS = 7500; // 12 steps * 7.5s = 90s
const DEMO_STEPS_COUNT = 12;

/* ---------------------------------------------------------------------- */
/* Non-flexible power lookup (Stage 1 behaviour, unchanged)               */
/* ---------------------------------------------------------------------- */

const staticPowerAt = (ap, slot, mode) => {
  if (ap.continuous) return ap.ratingW * ap.duty;
  const hour = slotToHour(slot);
  const ranges = mode === "baseline" ? ap.baseline : ap.ai;
  return inRanges(hour, ranges) ? ap.ratingW : 0;
};

/* ---------------------------------------------------------------------- */
/* RL-style Energy Scheduler (Stage 2)                                    */
/* A brute-force search over feasible start times within the appliance's  */
/* earliest-start / latest-completion window, scored by a transparent,    */
/* hand-weighted cost function. This is a rule-based optimizer, not a     */
/* trained RL agent.                                                      */
/* ---------------------------------------------------------------------- */

function computeOccupiedActual(startVirtualSlot, runtimeSlots) {
  const occ = [];
  for (let k = 0; k < runtimeSlots; k++) occ.push((startVirtualSlot + k) % SLOTS);
  return occ;
}

function scoreCandidate(ap, rule, startSlot, runtimeSlots, tariffArr, solarArr, peakWeightMultiplier = 1) {
  const powerKW = ap.ratingW / 1000;
  const occupiedActual = computeOccupiedActual(startSlot, runtimeSlots);

  let electricityCost = 0;
  let peakCount = 0;
  let carbon = 0;
  let solarMatch = 0;

  occupiedActual.forEach((actual) => {
    const hour = slotToHour(actual);
    electricityCost += powerKW * tariffArr[actual] * 0.25;
    if (hour >= 18 && hour < 22) peakCount++;
    carbon += powerKW * 0.25 * carbonIntensityAt(hour);
    solarMatch += Math.min(powerKW, solarArr[actual]) * 0.25;
  });

  const earliestSlot = Math.round(rule.earliestStart * 4);
  const latestSlot = Math.round(rule.latestCompletion * 4);
  const windowSpan = Math.max(1, latestSlot - runtimeSlots - earliestSlot);

  // peakWeightMultiplier > 1 means a grid-risk scenario (transformer overload
  // risk, low battery reserve) is active, so the scheduler leans harder
  // against occupying the peak-tariff band — this is what actually makes
  // those Scenario Lab flags do something, not just show a banner.
  const peakPenalty = (peakCount / runtimeSlots) * powerKW * SCORE_WEIGHTS.peak * peakWeightMultiplier;
  const delay = startSlot - earliestSlot;
  const comfortPenalty = rule.comfortImpact * (delay / windowSpan) * SCORE_WEIGHTS.comfort;
  const buffer = Math.max(1, Math.round(windowSpan * 0.15));
  const slotsToDeadline = latestSlot - (startSlot + runtimeSlots);
  const deadlinePenalty =
    (1 - rule.flexibility) * (Math.max(0, buffer - slotsToDeadline) / buffer) * SCORE_WEIGHTS.deadline;
  const carbonPenalty = carbon * SCORE_WEIGHTS.carbon;
  const solarBonus = solarMatch * SCORE_WEIGHTS.solar;

  const priorityFactor = rule.priority / 3;
  const score =
    electricityCost +
    peakPenalty * priorityFactor +
    comfortPenalty * priorityFactor +
    deadlinePenalty * priorityFactor +
    carbonPenalty -
    solarBonus;

  return {
    startSlot,
    actualStartSlot: startSlot % SLOTS,
    occupiedActual,
    electricityCost,
    peakPenalty,
    comfortPenalty,
    deadlinePenalty,
    carbonPenalty,
    solarBonus,
    score,
  };
}

function runScheduler(ap, rule, tariffArr, solarArr, peakWeightMultiplier = 1) {
  const earliestSlot = Math.round(rule.earliestStart * 4);
  const latestSlot = Math.round(rule.latestCompletion * 4);
  const runtimeSlots = Math.max(1, Math.round(rule.runtimeHours * 4));

  let best = null;
  for (let s = earliestSlot; s + runtimeSlots <= latestSlot; s++) {
    const candidate = scoreCandidate(ap, rule, s, runtimeSlots, tariffArr, solarArr, peakWeightMultiplier);
    if (!best || candidate.score < best.score) best = candidate;
  }
  return { best, runtimeSlots, earliestSlot, latestSlot };
}

function buildExplanation(ap, rule, baselineCost, best, naiveStartHour, naiveStartSlotVirtual) {
  if (!best) {
    return "No feasible slot exists inside the current earliest-start / latest-completion window — widen the window or shorten the runtime.";
  }
  const startLabel = formatTime(best.actualStartSlot) + (best.startSlot >= SLOTS ? " (+1d)" : "");
  const naiveLabel = formatHourLabel(naiveStartHour);
  const deltaH = (best.startSlot - naiveStartSlotVirtual) / 4;
  const parts = [];
  parts.push(
    `Scheduled to start at ${startLabel} instead of the habitual ${naiveLabel} (${deltaH >= 0 ? "+" : ""}${deltaH.toFixed(2)}h).`
  );
  const costDelta = baselineCost - best.electricityCost;
  if (costDelta > 0.5) {
    parts.push(`Saves an estimated ₹${costDelta.toFixed(2)} in electricity cost versus the habitual time.`);
  } else if (costDelta < -0.5) {
    parts.push(`Costs about ₹${Math.abs(costDelta).toFixed(2)} more than the habitual time, traded off against comfort/deadline penalties.`);
  } else {
    parts.push(`Electricity cost is similar to the habitual time (₹${best.electricityCost.toFixed(2)} vs ₹${baselineCost.toFixed(2)}).`);
  }
  if (best.solarBonus > 0.05) {
    parts.push(`Captures a ₹${best.solarBonus.toFixed(2)} solar-offset bonus by running while solar generation is available.`);
  }
  if (best.peakPenalty < 0.01) {
    parts.push("Avoids the evening peak-tariff band entirely.");
  } else {
    parts.push(`Still overlaps the peak band for part of the run (peak penalty ₹${best.peakPenalty.toFixed(2)}) — the lowest-score feasible option given the deadline.`);
  }
  parts.push(
    `Comfort penalty ₹${best.comfortPenalty.toFixed(2)} reflects a comfort-impact setting of ${Math.round(rule.comfortImpact * 100)}% and flexibility of ${Math.round(rule.flexibility * 100)}%.`
  );
  parts.push(`Deadline penalty ₹${best.deadlinePenalty.toFixed(2)} — margin to the ${formatHourLabel(rule.latestCompletion)} deadline is respected.`);
  parts.push(`Carbon penalty ₹${best.carbonPenalty.toFixed(2)}, based on an illustrative grid carbon-intensity-by-hour curve.`);
  return parts.join(" ");
}

/* ---------------------------------------------------------------------- */
/* Stage 3: Edge Forecast Engine — LSTM-STYLE SIMULATION                  */
/* ------------------------------------------------------------------------
   IMPORTANT: everything below is a deterministic, hand-written formula
   running in the browser. It mimics the SHAPE of an LSTM load-forecasting
   pipeline (recent history + contextual features → next-step prediction
   + uncertainty) so the interaction feels right, but no neural network is
   trained or executed anywhere in this file. It is a transparent stand-in
   for the ESP32-S3 TFLite-Micro model described in the deck, not the real
   thing.                                                                  */
/* ---------------------------------------------------------------------- */

// Deterministic pseudo-random noise in [-1, 1], reseedable so "Inject
// Forecast Error" can visibly perturb the series without real randomness
// making the demo non-reproducible.
const pseudoNoise = (i, seed) => {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

// Shape of a typical home demand day: gentle morning rise, midday plateau,
// sharp evening peak, quiet overnight trough. Pure illustration.
const demandShape = (hour) => {
  const morning = 0.55 * Math.exp(-Math.pow(hour - 7.5, 2) / 6);
  const midday = 0.35 * Math.exp(-Math.pow(hour - 13, 2) / 18);
  const evening = 1.0 * Math.exp(-Math.pow(hour - 20, 2) / 4);
  const base = 0.32;
  return base + morning + midday + evening;
};

// "Historical" reference day — yesterday's shape with mild day-to-day noise.
function buildHistoricalArr() {
  return Array.from({ length: SLOTS }, (_, i) => {
    const hour = slotToHour(i);
    const v = demandShape(hour) * (1 + 0.06 * pseudoNoise(i, 11));
    return +Math.max(0.05, v).toFixed(3);
  });
}

// The "LSTM-style" prediction: historical shape re-weighted by the live
// simulated context features (temperature, occupancy, tariff, solar,
// time-of-day). Coefficients are illustrative, not fitted.
function buildForecastArr(historicalArr, inputs) {
  const { temperature, occupancyPct, tariffPlan, prices, solarArr } = inputs;
  const tempFactor = 1 + (temperature - 26) * 0.028; // hotter → more cooling load
  const occFactor = 0.55 + 0.55 * (occupancyPct / 100); // more people home → more load
  return Array.from({ length: SLOTS }, (_, i) => {
    const hour = slotToHour(i);
    const tariff = tariffAt(hour, tariffPlan, prices);
    const priceSuppression = 1 - Math.min(0.18, ((tariff - prices.offpeak) / (prices.peak - prices.offpeak || 1)) * 0.18);
    const solarNudge = 1 - solarArr[i] * 0.02; // strong daytime solar slightly depresses forecast grid draw
    const v = historicalArr[i] * tempFactor * occFactor * priceSuppression * solarNudge;
    return +Math.max(0.05, v).toFixed(3);
  });
}

// The "actual" ground-truth curve used to validate the forecast. Normally
// tracks the forecast closely with small sensor-level jitter; an injected
// error adds a sustained anomaly window (e.g. an unplanned appliance run).
function buildActualArr(forecastArr, seed, errorWindow) {
  return Array.from({ length: SLOTS }, (_, i) => {
    let v = forecastArr[i] * (1 + 0.05 * pseudoNoise(i, seed));
    if (errorWindow) {
      const { startSlot, endSlot, magnitude } = errorWindow;
      if (i >= startSlot && i < endSlot) {
        v += magnitude * (1 - Math.abs((i - (startSlot + endSlot) / 2) / ((endSlot - startSlot) / 2 || 1)));
      }
    }
    return +Math.max(0.03, v).toFixed(3);
  });
}

// Confidence band widens further into the future from "now" and widens
// sharply after an injected error (the model's uncertainty spikes).
function buildConfidenceBand(forecastArr, currentSlot, errorWindow) {
  return forecastArr.map((v, i) => {
    const horizon = Math.min(Math.abs(i - currentSlot), SLOTS - Math.abs(i - currentSlot));
    let width = 0.06 + (horizon / SLOTS) * 0.35;
    if (errorWindow && i >= errorWindow.startSlot - 4 && i < errorWindow.endSlot + 8) {
      width += 0.25;
    }
    return { lower: +Math.max(0, v - width).toFixed(3), upper: +(v + width).toFixed(3) };
  });
}

// The confidence band is drawn as a stacked Area (invisible "bandLower" base
// + visible "bandRange" fill) purely to position the shaded region — it
// isn't a real data series, so we hide it from the tooltip instead of
// showing a confusing blank-named row.
function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const visible = payload.filter((p) => p.dataKey !== "bandLower");
  return (
    <div style={{ background: "#10161d", border: "1px solid #2a3b48", borderRadius: 4, padding: "8px 10px", fontSize: 11, fontFamily: "JetBrains Mono" }}>
      <div style={{ color: "#8b98a5", marginBottom: 4 }}>{label}</div>
      {visible.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value} kW
        </div>
      ))}
    </div>
  );
}

function computeMAPE(forecastArr, actualArr) {
  let sum = 0;
  let n = 0;
  forecastArr.forEach((f, i) => {
    const a = actualArr[i];
    if (a > 0.01) {
      sum += Math.abs(a - f) / a;
      n++;
    }
  });
  return n > 0 ? +((sum / n) * 100).toFixed(2) : 0;
}

/* ---------------------------------------------------------------------- */
/* Component                                                              */
/* ---------------------------------------------------------------------- */

export default function DiamondGridwiseAI() {
  const [currentSlot, setCurrentSlot] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // --- Stage 5: Display Mode (Full / Presentation / Engineering) ---
  const [displayMode, setDisplayMode] = useState("full"); // 'full' | 'presentation' | 'engineering'
  const showPresentation = displayMode === "presentation";
  const showEngineering = displayMode === "engineering";
  // "Detailed" sections are shared by Full mode and Engineering mode —
  // Full mode shows literally everything, Engineering mode shows the same
  // technical sections minus the casual stat bar / demo button.
  const showDetailed = displayMode === "full" || displayMode === "engineering";
  const showFullOnly = displayMode === "full";
  const [speed, setSpeed] = useState(4);
  const [overrides, setOverrides] = useState(() =>
    Object.fromEntries(APPLIANCES.map((a) => [a.id, "auto"]))
  );

  // --- Stage 2: tariff plan state ---
  const [tariffPlan, setTariffPlan] = useState("tou");
  const [prices, setPrices] = useState({ offpeak: 4.5, normal: 7.5, peak: 11.0 });

  // --- Stage 2: scheduling rules + explanation UI state ---
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [explainOpen, setExplainOpen] = useState({});

  // --- Stage 4: Scenario Lab state ---
  const [scenarioFlags, setScenarioFlags] = useState(DEFAULT_SCENARIO_FLAGS);
  const [activeScenario, setActiveScenario] = useState(null);
  const cachedTariffRef = useRef(null);

  // --- Stage 4: Hackathon Demo Mode state ---
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStepIndex, setDemoStepIndex] = useState(-1);
  const demoTimeoutRef = useRef(null);
  const demoStepsRef = useRef([]);
  const liveRef = useRef({});

  const updateRule = (id, field, value) =>
    setRules((r) => ({ ...r, [id]: { ...r[id], [field]: value } }));
  const toggleExplain = (id) => setExplainOpen((o) => ({ ...o, [id]: !o[id] }));

  // --- Tariff & solar arrays (recompute when plan/prices change) ---
  const tariffArr = useMemo(() => {
    // EDGE OFFLINE: cloud connectivity (and any fresh tariff push) is
    // unavailable, so the controller keeps operating on the last cached
    // tariff snapshot rather than reacting to new inputs.
    if (scenarioFlags.edgeOffline && cachedTariffRef.current) {
      const { plan, prices: cachedPrices } = cachedTariffRef.current;
      return Array.from({ length: SLOTS }, (_, i) => tariffAt(slotToHour(i), plan, cachedPrices));
    }
    return Array.from({ length: SLOTS }, (_, i) => tariffAt(slotToHour(i), tariffPlan, prices));
  }, [tariffPlan, prices, scenarioFlags.edgeOffline]);
  const solarArr = useMemo(
    () => Array.from({ length: SLOTS }, (_, i) => solarAt(slotToHour(i))),
    []
  );

  // Grid-risk scenarios make the scheduler lean harder against the peak
  // band instead of just showing a banner with no computational effect.
  const peakWeightMultiplier =
    1 + (scenarioFlags.transformerRisk ? 3 : 0) + (scenarioFlags.lowBattery ? 1.5 : 0);

  // --- Stage 2: run the RL-style scheduler for each flexible appliance ---
  const schedulerResults = useMemo(() => {
    const out = {};
    FLEX_IDS.forEach((id) => {
      const ap = APPLIANCES.find((a) => a.id === id);
      const rule = rules[id];
      const { best, runtimeSlots } = runScheduler(ap, rule, tariffArr, solarArr, peakWeightMultiplier);
      const naiveStartSlotVirtual = Math.round(ap.naiveStartHour * 4);
      const baselineOccupied = computeOccupiedActual(naiveStartSlotVirtual, runtimeSlots);
      const powerKW = ap.ratingW / 1000;
      const baselineCost = baselineOccupied.reduce(
        (s, actual) => s + powerKW * tariffArr[actual] * 0.25,
        0
      );
      out[id] = { rule, best, runtimeSlots, naiveStartSlotVirtual, baselineOccupied, baselineCost };
    });
    return out;
  }, [rules, tariffArr, solarArr, peakWeightMultiplier]);

  // Sets used by powerAt() to know exactly which slots a flexible appliance runs in
  const dynSchedules = useMemo(() => {
    const baselineSets = {};
    const aiSets = {};
    FLEX_IDS.forEach((id) => {
      const r = schedulerResults[id];
      baselineSets[id] = new Set(r.baselineOccupied);
      aiSets[id] = r.best ? new Set(r.best.occupiedActual) : new Set();
    });
    return { baselineSets, aiSets };
  }, [schedulerResults]);

  const powerAt = useCallback(
    (ap, slot, mode) => {
      if (ap.flexible) {
        const set = mode === "baseline" ? dynSchedules.baselineSets[ap.id] : dynSchedules.aiSets[ap.id];
        return set && set.has(slot) ? ap.ratingW : 0;
      }
      return staticPowerAt(ap, slot, mode);
    },
    [dynSchedules]
  );

  // --- Precomputed 24h plan arrays (react to tariff plan + rules via powerAt) ---
  const baselineLoadArr = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        (_, i) => APPLIANCES.reduce((sum, ap) => sum + powerAt(ap, i, "baseline"), 0) / 1000
      ),
    [powerAt]
  );
  const aiLoadArr = useMemo(
    () =>
      Array.from(
        { length: SLOTS },
        (_, i) => APPLIANCES.reduce((sum, ap) => sum + powerAt(ap, i, "ai"), 0) / 1000
      ),
    [powerAt]
  );
  const baselineGridImportArr = useMemo(
    () => baselineLoadArr.map((l, i) => Math.max(0, l - solarArr[i])),
    [baselineLoadArr, solarArr]
  );
  const aiGridImportArr = useMemo(
    () => aiLoadArr.map((l, i) => Math.max(0, l - solarArr[i])),
    [aiLoadArr, solarArr]
  );

  const baselineTotalCost = useMemo(
    () => baselineGridImportArr.reduce((s, g, i) => s + g * tariffArr[i] * 0.25, 0),
    [baselineGridImportArr, tariffArr]
  );
  const aiTotalCost = useMemo(
    () => aiGridImportArr.reduce((s, g, i) => s + g * tariffArr[i] * 0.25, 0),
    [aiGridImportArr, tariffArr]
  );
  const savingsPct =
    baselineTotalCost > 0
      ? (((baselineTotalCost - aiTotalCost) / baselineTotalCost) * 100).toFixed(1)
      : "0.0";

  const baselinePeak = useMemo(() => Math.max(...baselineLoadArr), [baselineLoadArr]);
  const aiPeak = useMemo(() => Math.max(...aiLoadArr), [aiLoadArr]);
  const peakReductionPct =
    baselinePeak > 0 ? (((baselinePeak - aiPeak) / baselinePeak) * 100).toFixed(1) : "0.0";

  const chartData = useMemo(
    () =>
      Array.from({ length: SLOTS }, (_, i) => ({
        time: formatTime(i),
        baseline: +baselineLoadArr[i].toFixed(2),
        aiOptimized: +aiLoadArr[i].toFixed(2),
        solar: +solarArr[i].toFixed(2),
      })),
    [baselineLoadArr, aiLoadArr, solarArr]
  );

  // --- Live / interactive values ---
  const getLivePowerW = useCallback(
    (ap) => {
      const ov = overrides[ap.id];
      if (ov === "on") return ap.continuous ? ap.ratingW * ap.duty : ap.ratingW;
      if (ov === "off") return 0;
      return powerAt(ap, currentSlot, "ai");
    },
    [overrides, currentSlot, powerAt]
  );

  const currentLoadKW = useMemo(
    () => APPLIANCES.reduce((s, ap) => s + getLivePowerW(ap), 0) / 1000,
    [getLivePowerW]
  );
  const currentSolar = solarArr[currentSlot];
  const currentGridImport = Math.max(0, currentLoadKW - currentSolar);
  const currentTariff = tariffArr[currentSlot];

  const costSoFar = useMemo(() => {
    let total = 0;
    for (let i = 0; i < currentSlot; i++) total += aiGridImportArr[i] * tariffArr[i] * 0.25;
    total += currentGridImport * tariffArr[currentSlot] * 0.25;
    return total;
  }, [currentSlot, currentGridImport, aiGridImportArr, tariffArr]);

  const peakSoFar = useMemo(() => {
    let m = 0;
    for (let i = 0; i < currentSlot; i++) if (aiLoadArr[i] > m) m = aiLoadArr[i];
    if (currentLoadKW > m) m = currentLoadKW;
    return m;
  }, [currentSlot, currentLoadKW, aiLoadArr]);

  const comfortScore = useMemo(() => {
    let penalty = 0;
    APPLIANCES.forEach((ap) => {
      if (ap.critical && overrides[ap.id] === "off") {
        const scheduled = powerAt(ap, currentSlot, "ai");
        if (scheduled > 0) penalty += 15;
      }
    });
    return Math.max(0, 100 - penalty);
  }, [overrides, currentSlot, powerAt]);

  /* ------------------------------------------------------------ */
  /* Stage 3: Edge Forecast Engine — LSTM-style browser simulation */
  /* ------------------------------------------------------------ */
  const [forecastInputs, setForecastInputs] = useState({ temperature: 27, occupancyPct: 65 });
  const [errorWindow, setErrorWindow] = useState(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [decisionLog, setDecisionLog] = useState([
    { id: "seed-1", time: "00:00", kind: "info", text: "Edge Forecast Engine simulation initialized. All figures below are generated locally — no live sensors or trained model are connected." },
  ]);
  const [selectedNode, setSelectedNode] = useState(null);

  const pushLog = useCallback((text, kind = "info") => {
    setDecisionLog((log) => {
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: formatTime(currentSlot), kind, text };
      return [entry, ...log].slice(0, 40);
    });
  }, [currentSlot]);

  const historicalLoadArr = useMemo(() => buildHistoricalArr(), []);
  const liveForecastLoadArr = useMemo(
    () => buildForecastArr(historicalLoadArr, { temperature: forecastInputs.temperature, occupancyPct: forecastInputs.occupancyPct, tariffPlan, prices, solarArr }),
    [historicalLoadArr, forecastInputs, tariffPlan, prices, solarArr]
  );
  // NOTE: the forecast engine runs on-device (edge-local), so — consistent
  // with the rest of this app's "offline autonomy" claims — it keeps
  // computing live from local temperature/occupancy inputs even during an
  // Internet Outage. Only the tariff (a cloud/utility-provided value, see
  // tariffArr above) is pinned to the last cached snapshot while offline.
  const forecastLoadArr = liveForecastLoadArr;
  const actualLoadForecastArr = useMemo(
    () => buildActualArr(forecastLoadArr, 7, errorWindow),
    [forecastLoadArr, errorWindow]
  );
  const confidenceBandArr = useMemo(
    () => buildConfidenceBand(forecastLoadArr, currentSlot, errorWindow),
    [forecastLoadArr, currentSlot, errorWindow]
  );
  const forecastMAPE = useMemo(
    () => computeMAPE(forecastLoadArr, actualLoadForecastArr),
    [forecastLoadArr, actualLoadForecastArr]
  );

  const forecastChartData = useMemo(
    () =>
      Array.from({ length: SLOTS }, (_, i) => ({
        time: formatTime(i),
        historical: historicalLoadArr[i],
        forecast: forecastLoadArr[i],
        actual: actualLoadForecastArr[i],
        bandLower: confidenceBandArr[i].lower,
        bandRange: +(confidenceBandArr[i].upper - confidenceBandArr[i].lower).toFixed(3),
      })),
    [historicalLoadArr, forecastLoadArr, actualLoadForecastArr, confidenceBandArr]
  );

  const handleInjectForecastError = () => {
    const startSlot = currentSlot;
    const endSlot = Math.min(SLOTS, startSlot + 10);
    const magnitude = +(0.7 + (errorNonce % 3) * 0.4).toFixed(2);
    setErrorNonce((n) => n + 1);
    setErrorWindow({ startSlot, endSlot, magnitude });
    pushLog(
      `Forecast error injected: simulated anomaly of +${magnitude.toFixed(2)} kW between ${formatTime(startSlot)} and ${formatTime(endSlot % SLOTS)}. Confidence band widened and MAPE will rise until cleared.`,
      "error"
    );
  };
  const handleClearForecastError = () => {
    setErrorWindow(null);
    pushLog("Forecast error cleared — Edge Forecast Engine confidence band restored to baseline.", "forecast");
  };

  // Periodic (hourly) forecast log entries as the simulation clock advances
  useEffect(() => {
    if (currentSlot % 4 !== 0) return;
    const f = forecastLoadArr[currentSlot];
    const band = confidenceBandArr[currentSlot];
    pushLog(
      `Forecast Engine predicted ${f.toFixed(2)} kW household load (confidence band ${band.lower.toFixed(2)}–${band.upper.toFixed(2)} kW).`,
      "forecast"
      // eslint-disable-next-line react-hooks/exhaustive-deps
    );
  }, [currentSlot]);

  // --- Stage 3: simulated hardware readings, derived from live sim state ---
  const anyRelaySwitchingNow = useMemo(
    () =>
      FLEX_IDS.some((id) => getLivePowerW(APPLIANCES.find((a) => a.id === id)) > 0) ||
      getLivePowerW(APPLIANCES.find((a) => a.id === "ac")) > 0,
    [getLivePowerW]
  );
  const prevSsrRef = useRef(anyRelaySwitchingNow);
  const [ssrSwitchCount, setSsrSwitchCount] = useState(0);
  useEffect(() => {
    if (prevSsrRef.current !== anyRelaySwitchingNow) {
      prevSsrRef.current = anyRelaySwitchingNow;
      setSsrSwitchCount((c) => c + 1);
      pushLog(
        `Zero-crossing SSR bank switched ${anyRelaySwitchingNow ? "ON" : "OFF"} at the next AC zero-crossing point — arc-free transition.`,
        "hardware"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyRelaySwitchingNow]);

  const energyTodayKWh = useMemo(() => {
    let e = 0;
    for (let i = 0; i < currentSlot; i++) e += aiGridImportArr[i] * 0.25;
    e += currentGridImport * 0.25;
    return e;
  }, [currentSlot, aiGridImportArr, currentGridImport]);

  const hardwareReadings = useMemo(() => {
    const voltage = +(229 + pseudoNoise(currentSlot, 3) * 3).toFixed(1);
    const power = +(currentLoadKW * 1000).toFixed(0);
    const liveCurrent = +(power / voltage).toFixed(2);
    const freq = +(50 + pseudoNoise(currentSlot, 9) * 0.05).toFixed(2);
    const cpuLoad = +(18 + Math.abs(pseudoNoise(currentSlot, 5)) * 22).toFixed(0);
    const inferenceMs = +(7.8 + Math.abs(pseudoNoise(currentSlot, 6)) * 3.6).toFixed(1);
    const boardTemp = +(34 + Math.abs(pseudoNoise(currentSlot, 7)) * 7).toFixed(1);
    const liveDhtTemp = +(forecastInputs.temperature + pseudoNoise(currentSlot, 2) * 0.6).toFixed(1);
    const humidity = +(48 + Math.abs(pseudoNoise(currentSlot, 4)) * 16).toFixed(0);
    const motion = forecastInputs.occupancyPct / 100 > 0.5 - 0.3 * pseudoNoise(currentSlot, 8);

    // Sensor-failure scenarios: a faulty sensor's live reading is no longer
    // trustworthy, so the panel falls back to a fixed, conservative value
    // instead of continuing to display (or act on) the raw noisy signal.
    const current = scenarioFlags.currentSensorFault ? SAFE_FALLBACK.current : liveCurrent;
    const dhtTemp = scenarioFlags.tempSensorFault ? SAFE_FALLBACK.dhtTemp : liveDhtTemp;

    return { voltage, power, current, freq, cpuLoad, inferenceMs, boardTemp, dhtTemp, humidity, motion };
  }, [currentSlot, currentLoadKW, forecastInputs, scenarioFlags.currentSensorFault, scenarioFlags.tempSensorFault]);

  const archNodes = [
    { id: "sensors", label: "Sensors", icon: Radio, desc: "SCT-013 current clamps, PZEM-004T power meters, DHT22 climate sensors, and PIR HC-SR501 motion sensors sample the home every few seconds and stream raw readings to the controller." },
    { id: "esp32", label: "ESP32-S3", icon: Cpu, desc: "The ESP32-S3 MCU aggregates sensor telemetry, runs the on-device forecast model via TFLite-Micro, and coordinates every downstream decision — entirely offline." },
    { id: "forecast", label: "Forecast Engine", icon: BrainCircuit, desc: "The Edge Forecast Engine (LSTM-style browser simulation) turns historical load, temperature, occupancy, tariff, solar and time-of-day into a next-step demand prediction with a confidence band." },
    { id: "scheduler", label: "Scheduler", icon: CircuitBoard, desc: "The RL-style Energy Scheduler takes the forecast and searches for the lowest-cost, lowest-discomfort start time for each flexible appliance within its allowed window." },
    { id: "ssr", label: "SSRs", icon: ToggleLeft, desc: "Zero-crossing solid-state relays receive the scheduler's actuation commands and switch heavy loads on or off exactly at the AC waveform's zero-crossing point, avoiding arcing." },
    { id: "appliances", label: "Appliances", icon: Bolt, desc: "Household appliances — AC, water heater, washing machine, EV charger, water pump and more — physically respond to the SSR state, closing the loop back to the sensors." },
  ];

  // --- Playback control ---
  useEffect(() => {
    if (!isPlaying) return undefined;
    const ms = 800 / speed;
    const id = setInterval(() => {
      setCurrentSlot((prev) => (prev >= SLOTS - 1 ? 0 : prev + 1));
    }, ms);
    return () => clearInterval(id);
  }, [isPlaying, speed]);

  const handleStartPause = () => setIsPlaying((p) => !p);

  const clearDemoTimeout = useCallback(() => {
    if (demoTimeoutRef.current) {
      clearTimeout(demoTimeoutRef.current);
      demoTimeoutRef.current = null;
    }
  }, []);

  const handleReset = () => {
    clearDemoTimeout();
    setDemoRunning(false);
    setDemoStepIndex(-1);
    demoStepsRef.current = [];
    setIsPlaying(false);
    setCurrentSlot(0);
    setOverrides(Object.fromEntries(APPLIANCES.map((a) => [a.id, "auto"])));
    setErrorWindow(null);
    setScenarioFlags(DEFAULT_SCENARIO_FLAGS);
    setActiveScenario(null);
    setExplainOpen({});
    setSelectedNode(null);
    pushLog("Simulation reset to 00:00. Scenario Lab and demo state cleared.", "info");
  };
  const handleSlider = (e) => {
    setIsPlaying(false);
    setCurrentSlot(Number(e.target.value));
  };
  const handleOverride = (id, val) => {
    // Appliance is marked unavailable by the Scenario Lab — ignore manual overrides.
    if (scenarioFlags.unavailableApplianceId === id) return;
    // A critical appliance can't be force-switched ON while a sensor is faulty
    // (degraded-safe mode) — that's exactly the unsafe switching we want to avoid.
    const ap = APPLIANCES.find((a) => a.id === id);
    const degradedSafe = scenarioFlags.tempSensorFault || scenarioFlags.currentSensorFault;
    if (val === "on" && degradedSafe && ap.critical) return;
    setOverrides((o) => ({ ...o, [id]: val }));
    if (val !== "auto") {
      pushLog(`Manual override: ${ap.name} forced ${val.toUpperCase()} by user, overriding the scheduler.`, "override");
    } else {
      pushLog(`Manual override cleared for ${ap.name} — returned to AUTO scheduling.`, "override");
    }
  };

  /* ---------------------------------------------------------------- */
  /* Stage 4: Scenario Lab                                             */
  /* Each scenario nudges real simulation inputs (temperature,         */
  /* occupancy, tariff, clock, overrides) and toggles a small set of   */
  /* flags that other panels read to show degraded / offline / at-risk */
  /* states. Applying a scenario always logs a decision-log entry.     */
  /* ---------------------------------------------------------------- */
  const applyScenario = useCallback(
    (id) => {
      setScenarioFlags(DEFAULT_SCENARIO_FLAGS);
      setErrorWindow(null);
      setActiveScenario(id);

      switch (id) {
        case "weekday":
          setForecastInputs({ temperature: 27, occupancyPct: 55 });
          setTariffPlan("tou");
          setPrices({ offpeak: 4.5, normal: 7.5, peak: 11.0 });
          pushLog("Scenario: Normal weekday — typical occupancy (55%) and temperature (27°C), Time-of-Use tariff.", "info");
          break;
        case "weekend":
          setForecastInputs((v) => ({ ...v, occupancyPct: 92, temperature: 29 }));
          pushLog("Scenario: Weekend — occupancy up to 92% through the day, higher daytime baseline load expected.", "info");
          break;
        case "heatwave":
          setForecastInputs((v) => ({ ...v, temperature: 42 }));
          pushLog("Scenario: Heat wave — ambient temperature spiked to 42°C, cooling demand forecast rising sharply.", "forecast");
          break;
        case "hightariff":
          setTariffPlan("tou");
          setPrices((p) => ({ ...p, peak: 18.5 }));
          setIsPlaying(false);
          setCurrentSlot(80); // 20:00
          pushLog("Scenario: High-tariff evening — peak price raised to ₹18.50/kWh, clock set to 20:00 inside the peak band.", "forecast");
          break;
        case "familyarrival":
          setForecastInputs((v) => ({ ...v, occupancyPct: 100 }));
          pushLog("Scenario: Sudden family arrival — occupancy jumped to 100%, comfort-critical appliances prioritized by the scheduler.", "override");
          break;
        case "solarsurplus":
          setTariffPlan("green");
          setIsPlaying(false);
          setCurrentSlot(48); // 12:00
          pushLog("Scenario: Solar surplus — clock set to 12:00 at peak solar generation, flexible loads shifted into free daytime capacity.", "forecast");
          break;
        case "lowbattery":
          setScenarioFlags((f) => ({ ...f, lowBattery: true }));
          pushLog("Scenario: Low battery reserve — scheduler avoids adding further peak-hour grid draw to protect remaining backup capacity.", "error");
          break;
        case "outage":
          setScenarioFlags((f) => ({ ...f, edgeOffline: true }));
          cachedTariffRef.current = { plan: tariffPlan, prices: { ...prices } };
          pushLog("Cloud connectivity lost — cloud services unavailable. Switching to EDGE OFFLINE mode: tariff pricing is pinned to the last cached snapshot, while the on-device forecast and scheduler keep running live from local sensor inputs.", "error");
          break;
        case "tempfault":
          setScenarioFlags((f) => ({ ...f, tempSensorFault: true }));
          pushLog("DHT22 temperature sensor fault detected — live reading marked FAULTY. Falling back to a safe default temperature estimate and entering degraded-safe mode.", "error");
          break;
        case "currentfault":
          setScenarioFlags((f) => ({ ...f, currentSensorFault: true }));
          pushLog("SCT-013 current sensor fault detected — live current reading marked FAULTY. Falling back to a safe scheduled-load estimate; manual force-ON of critical loads is locked until resolved.", "error");
          break;
        case "unavailable": {
          const targetId = "washingmachine";
          const targetAp = APPLIANCES.find((a) => a.id === targetId);
          setScenarioFlags((f) => ({ ...f, unavailableApplianceId: targetId }));
          setOverrides((o) => ({ ...o, [targetId]: "off" }));
          pushLog(`${targetAp.name} marked unavailable (out of service) — excluded from scheduling until cleared.`, "override");
          break;
        }
        case "transformer":
          setScenarioFlags((f) => ({ ...f, transformerRisk: true }));
          pushLog("Transformer overload risk detected on the local feeder — deferable loads held back and a peak-demand cap enforced.", "error");
          break;
        default:
          break;
      }
    },
    [tariffPlan, prices, forecastLoadArr, pushLog]
  );

  // Keep a live snapshot of frequently-changing derived values so the demo
  // runner (which fires on setTimeout, outside the normal render cycle)
  // always logs the freshest numbers instead of a stale closure.
  useEffect(() => {
    liveRef.current = {
      currentSlot,
      forecastNow: forecastLoadArr[currentSlot],
      savingsPct,
      peakReductionPct,
      comfortScore,
      baselineTotalCost,
      aiTotalCost,
      peakPrice: prices.peak,
    };
  });

  /* ---------------------------------------------------------------- */
  /* Stage 4: 90-second Hackathon Demo Mode                            */
  /* A scripted 12-step walkthrough of the whole pipeline. Steps mutate */
  /* real simulation state (clock, tariff, overrides, scenario flags)   */
  /* so every change is visible in the panels above, not just the log.  */
  /* ---------------------------------------------------------------- */
  const buildDemoSteps = useCallback(
    () => [
      {
        label: "Evening load rising",
        action: () => {
          setIsPlaying(false);
          setCurrentSlot(66); // 16:30
          setTariffPlan("tou");
          setSpeed(4);
          setIsPlaying(true);
          pushLog("Demo: Evening approaching — AC and lighting load beginning to rise toward the peak window.", "forecast");
        },
      },
      {
        label: "High tariff detection",
        action: () => {
          pushLog(`Demo: High-tariff evening band (18:00–22:00) detected — peak price ₹${liveRef.current.peakPrice?.toFixed(2)}/kWh now in effect.`, "forecast");
        },
      },
      {
        label: "Peak-demand risk",
        action: () => {
          setScenarioFlags((f) => ({ ...f, transformerRisk: true }));
          pushLog("Demo: Peak-demand risk flagged — the baseline (naive) load curve shows a sharp, uncontrolled evening spike.", "error");
        },
      },
      {
        label: "AI forecast",
        action: () => {
          setScenarioFlags((f) => ({ ...f, transformerRisk: false }));
          setSelectedNode("forecast");
          pushLog(`Demo: Edge Forecast Engine predicting ${liveRef.current.forecastNow?.toFixed(2)} kW near-term household load with a confidence band.`, "forecast");
        },
      },
      {
        label: "Water-heater deferral",
        action: () => {
          setSelectedNode("scheduler");
          setExplainOpen({ waterheater: true });
          pushLog("Demo: Water heater deferred by the scheduler to a cheaper, lower-carbon window instead of its habitual start time.", "scheduler");
        },
      },
      {
        label: "Washing-machine shifting",
        action: () => {
          setExplainOpen({ washingmachine: true });
          pushLog("Demo: Washing machine start time shifted away from the peak-tariff band.", "scheduler");
        },
      },
      {
        label: "EV charging optimization",
        action: () => {
          setExplainOpen({ evcharger: true });
          pushLog("Demo: EV charger optimized to draw power during the cheapest, lowest-carbon overnight window.", "scheduler");
        },
      },
      {
        label: "Internet outage",
        action: () => {
          applyScenario("outage");
        },
      },
      {
        label: "Offline edge control",
        action: () => {
          pushLog("Demo: Edge controller continues autonomous scheduling using cached tariff data and the local forecast — no cloud round-trip required.", "hardware");
        },
      },
      {
        label: "Baseline vs AI results",
        action: () => {
          setSelectedNode(null);
          setExplainOpen({});
          pushLog(`Demo: Full-day comparison — baseline ₹${liveRef.current.baselineTotalCost?.toFixed(0)} vs AI-optimized ₹${liveRef.current.aiTotalCost?.toFixed(0)}.`, "info");
        },
      },
      {
        label: "Cost & peak-demand savings",
        action: () => {
          pushLog(`Demo: Cost savings ${liveRef.current.savingsPct}% · Peak-demand reduction ${liveRef.current.peakReductionPct}%.`, "info");
        },
      },
      {
        label: "Comfort preservation",
        action: () => {
          pushLog(`Demo: Comfort score held at ${liveRef.current.comfortScore}/100 throughout the optimization run.`, "info");
        },
      },
    ],
    [pushLog, applyScenario]
  );

  const advanceDemo = useCallback(
    (idx) => {
      const steps = demoStepsRef.current;
      if (idx >= steps.length) {
        setDemoRunning(false);
        setDemoStepIndex(-1);
        pushLog("90-second Hackathon Demo complete.", "info");
        return;
      }
      setDemoStepIndex(idx);
      steps[idx].action();
      demoTimeoutRef.current = setTimeout(() => advanceDemo(idx + 1), DEMO_STEP_MS);
    },
    [pushLog]
  );

  const handleStartDemo = () => {
    clearDemoTimeout();
    demoStepsRef.current = buildDemoSteps();
    setDemoRunning(true);
    pushLog("Starting 90-second Hackathon Demo — evening peak scenario with AI scheduling and an offline failover.", "info");
    advanceDemo(0);
  };
  const handleStopDemo = () => {
    clearDemoTimeout();
    setIsPlaying(false);
    setDemoRunning(false);
    setDemoStepIndex(-1);
    pushLog("Hackathon demo stopped by user.", "info");
  };

  useEffect(() => () => clearDemoTimeout(), [clearDemoTimeout]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="diamond-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        .diamond-root {
          --bg: #0a0e14;
          --bg-glow: radial-gradient(1200px 600px at 15% -10%, rgba(0,217,255,0.10), transparent 60%),
                     radial-gradient(1000px 500px at 100% 0%, rgba(74,222,128,0.08), transparent 55%);
          --panel: #10161d;
          --panel-alt: #0d1218;
          --border: #1e2a35;
          --border-bright: #2a3b48;
          --cyan: #00d9ff;
          --green: #4ade80;
          --amber: #ffb020;
          --red: #ff5f6d;
          --text: #e6edf3;
          --muted: #8b98a5;
          --muted-dim: #5a6672;
          font-family: 'Space Grotesk', -apple-system, sans-serif;
          background: var(--bg-glow), var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding: 20px;
          box-sizing: border-box;
        }
        .diamond-root * { box-sizing: border-box; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

        .facet {
          clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
          background: var(--panel);
          border: 1px solid var(--border);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          padding: 18px 22px;
          margin-bottom: 18px;
        }
        .header-title-row { display: flex; align-items: center; gap: 12px; }
        .diamond-mark {
          width: 30px; height: 30px;
          background: linear-gradient(135deg, var(--cyan), var(--green));
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
          flex-shrink: 0;
        }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
        .header .subtitle { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
        .sim-pill {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
          color: var(--amber);
          border: 1px solid rgba(255,176,32,0.4);
          background: rgba(255,176,32,0.08);
          padding: 6px 12px; border-radius: 3px;
        }

        /* ---- Stage 5: Display Mode switcher ---- */
        .mode-switcher {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          padding: 12px 20px; margin-bottom: 18px;
        }
        .mode-switcher-label { font-size: 10.5px; letter-spacing: 0.4px; color: var(--muted-dim); font-weight: 700; }
        .mode-switcher-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .mode-btn {
          display: flex; align-items: center; gap: 7px;
          background: var(--panel-alt); border: 1px solid var(--border-bright); color: var(--muted);
          font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 8px 14px;
          cursor: pointer; border-radius: 4px; transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
        }
        .mode-btn:hover { border-color: var(--cyan); color: var(--cyan); }
        .mode-btn.active { border-color: var(--cyan); color: var(--cyan); background: rgba(0,217,255,0.10); }
        .mode-btn.active.presentation { border-color: var(--green); color: var(--green); background: rgba(74,222,128,0.10); }
        .mode-btn.active.engineering { border-color: var(--amber); color: var(--amber); background: rgba(255,176,32,0.10); }

        /* ---- About this Simulation ---- */
        .about-section { margin-bottom: 18px; padding-bottom: 16px; border: 1px solid rgba(0,217,255,0.25); }
        .about-header { display: flex; align-items: center; gap: 10px; padding: 16px 20px 4px; }
        .about-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .about-body { padding: 0 20px 14px; font-size: 12px; line-height: 1.7; color: var(--text); max-width: 980px; }
        .about-safety-list { list-style: none; margin: 0; padding: 0 20px; display: flex; flex-direction: column; gap: 8px; }
        .about-safety-list li {
          display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.55; color: var(--text);
          background: var(--panel-alt); border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px;
        }
        .about-safety-list li svg { flex-shrink: 0; color: var(--green); margin-top: 1px; }

        /* ---- Stage 5: Reward function panel (Engineering mode) ---- */
        .reward-fn-block {
          margin: 0 20px 16px; padding: 12px 14px; background: var(--panel-alt);
          border: 1px solid var(--border); border-radius: 4px;
        }
        .reward-fn-title { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: var(--cyan); margin-bottom: 8px; }
        .reward-fn-formula { font-size: 11px; color: var(--text); line-height: 1.7; margin-bottom: 10px; overflow-x: auto; white-space: nowrap; }
        .reward-fn-weights { display: flex; gap: 8px; flex-wrap: wrap; }
        .reward-fn-weights span {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted);
          border: 1px solid var(--border-bright); border-radius: 3px; padding: 4px 9px;
        }

        /* ---- Stage 5: Presentation Mode ---- */
        .presentation-view { display: flex; flex-direction: column; gap: 18px; }
        .presentation-title-card {
          display: flex; align-items: center; gap: 16px; padding: 26px 28px;
        }
        .presentation-title-card .diamond-mark { width: 44px; height: 44px; }
        .presentation-title-card h1 { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: 0.4px; }
        .presentation-title-card .subtitle { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
        .presentation-blurb {
          display: flex; gap: 12px; align-items: flex-start; padding: 18px 22px;
          font-size: 14px; line-height: 1.7; color: var(--text);
        }
        .presentation-blurb svg { flex-shrink: 0; color: var(--cyan); margin-top: 3px; }
        .presentation-blurb p { margin: 0; }
        .presentation-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 18px; align-items: start; }
        @media (max-width: 900px) { .presentation-grid { grid-template-columns: 1fr; } }
        .presentation-visual-card, .presentation-chart-card, .presentation-schedule-card { padding-bottom: 14px; }
        .presentation-metrics-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .presentation-metric-card { flex: 1; min-width: 180px; padding: 18px 20px; text-align: center; }
        .presentation-metric-card .p-label { font-size: 11px; letter-spacing: 0.4px; color: var(--muted-dim); margin-bottom: 8px; }
        .presentation-metric-card .p-value { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
        .presentation-metric-card .p-value.green { color: var(--green); }

        /* ---- Stage 5: Smart Home Visual ---- */
        .smart-home-visual { padding: 8px 18px 22px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .shv-roof { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
        .shv-sun { color: var(--muted-dim); }
        .shv-sun.on { color: var(--amber); filter: drop-shadow(0 0 4px var(--amber)); }
        .shv-house {
          width: 100%; max-width: 440px;
          clip-path: polygon(50% 0%, 100% 26%, 100% 100%, 0% 100%, 0% 26%);
          background: linear-gradient(180deg, rgba(0,217,255,0.08), var(--panel-alt));
          border: 1px solid var(--border-bright);
          padding: 50px 18px 18px;
        }
        .shv-rooms { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
        .shv-room {
          display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 9.5px;
          color: var(--muted-dim); background: var(--panel); border: 1px solid var(--border);
          border-radius: 4px; padding: 10px 4px; text-align: center; line-height: 1.2;
        }
        .shv-room.on { color: var(--green); border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.08); }
        .shv-grid-link {
          display: flex; align-items: center; gap: 6px; justify-content: center; font-size: 11px;
          color: var(--muted); font-family: 'JetBrains Mono', monospace; padding-top: 10px; border-top: 1px dashed var(--border);
        }
        .shv-grid-link.offline { color: var(--red); }

        .stat-bar {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px; margin-bottom: 16px;
        }
        .stat-card { padding: 12px 14px; }
        .stat-card-head {
          display: flex; align-items: center; gap: 6px;
          color: var(--muted); font-size: 11px; font-weight: 500;
          letter-spacing: 0.3px; margin-bottom: 8px;
        }
        .stat-value { font-size: 22px; font-weight: 600; }
        .stat-unit { font-size: 12px; color: var(--muted-dim); margin-left: 4px; }

        .controls-panel { padding: 16px 20px; margin-bottom: 18px; }
        .controls-row {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px;
        }
        .ctrl-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--panel-alt); border: 1px solid var(--border-bright);
          color: var(--text); font-family: inherit; font-size: 13px; font-weight: 600;
          padding: 8px 14px; cursor: pointer; border-radius: 3px;
          transition: border-color 0.15s ease, color 0.15s ease;
        }
        .ctrl-btn:hover { border-color: var(--cyan); color: var(--cyan); }
        .ctrl-btn.primary { background: rgba(0,217,255,0.10); border-color: var(--cyan); color: var(--cyan); }
        .speed-group { display: flex; gap: 6px; align-items: center; }
        .speed-group span { font-size: 11px; color: var(--muted); margin-right: 4px; }
        .speed-btn {
          background: var(--panel-alt); border: 1px solid var(--border-bright);
          color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 12px;
          padding: 6px 10px; cursor: pointer; border-radius: 3px;
        }
        .speed-btn.active { border-color: var(--green); color: var(--green); background: rgba(74,222,128,0.08); }
        .time-readout { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 20px; color: var(--cyan); font-weight: 600; }
        .slider-row { display: flex; align-items: center; gap: 10px; }
        .slider-row input[type="range"] { flex: 1; accent-color: var(--cyan); height: 4px; cursor: pointer; }
        .slider-labels {
          display: flex; justify-content: space-between; font-size: 10px;
          color: var(--muted-dim); font-family: 'JetBrains Mono', monospace; margin-top: 4px;
        }

        .main-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; align-items: start; }
        @media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }

        .panel-title { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 0; }
        .panel-title h2 { font-size: 14px; font-weight: 600; margin: 0; letter-spacing: 0.3px; }
        .panel-title p { font-size: 11px; color: var(--muted-dim); margin: 2px 0 0; }

        .appliance-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 10px; padding: 14px 18px 18px;
        }
        .appliance-card {
          background: var(--panel-alt); border: 1px solid var(--border); border-radius: 4px;
          padding: 12px; transition: border-color 0.2s ease;
        }
        .appliance-card.is-active { border-color: rgba(74,222,128,0.5); }
        .appliance-card.is-forced { border-color: rgba(255,176,32,0.5); }
        .appliance-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .appliance-head .icon-wrap {
          width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.04); border-radius: 3px; flex-shrink: 0;
        }
        .appliance-name { font-size: 12.5px; font-weight: 600; line-height: 1.2; }
        .appliance-rating { font-size: 10.5px; color: var(--muted-dim); font-family: 'JetBrains Mono', monospace; }
        .status-badge {
          display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.4px;
          padding: 3px 7px; border-radius: 2px; margin-bottom: 9px;
        }
        .status-active { background: rgba(74,222,128,0.15); color: var(--green); }
        .status-standby { background: rgba(255,176,32,0.15); color: var(--amber); }
        .status-off { background: rgba(139,152,165,0.12); color: var(--muted); }
        .status-forced-on { background: rgba(0,217,255,0.15); color: var(--cyan); }
        .status-forced-off { background: rgba(255,95,109,0.15); color: var(--red); }

        .override-group { display: flex; border: 1px solid var(--border-bright); border-radius: 3px; overflow: hidden; }
        .override-btn {
          flex: 1; background: transparent; border: none; color: var(--muted);
          font-size: 10px; font-weight: 600; padding: 5px 0; cursor: pointer;
          font-family: inherit; border-right: 1px solid var(--border-bright);
        }
        .override-btn:last-child { border-right: none; }
        .override-btn.on { background: rgba(74,222,128,0.14); color: var(--green); }
        .override-btn.off { background: rgba(255,95,109,0.14); color: var(--red); }
        .override-btn.auto-active { background: rgba(0,217,255,0.14); color: var(--cyan); }
        .override-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .safe-tag {
          margin-top: 8px; font-size: 9.5px; color: var(--amber); background: rgba(255,176,32,0.08);
          border: 1px solid rgba(255,176,32,0.3); border-radius: 3px; padding: 4px 6px; line-height: 1.4;
        }
        .safe-tag.unavailable { color: var(--red); background: rgba(255,95,109,0.08); border-color: rgba(255,95,109,0.3); }

        .chart-panel { padding-bottom: 12px; }
        .chart-legend-note { padding: 0 18px; font-size: 10.5px; color: var(--muted-dim); margin-top: -6px; }
        .summary-row { display: flex; gap: 10px; padding: 0 18px 16px; flex-wrap: wrap; }
        .summary-chip {
          flex: 1; min-width: 150px; background: var(--panel-alt); border: 1px solid var(--border);
          border-radius: 4px; padding: 10px 12px;
        }
        .summary-chip .label { font-size: 10px; color: var(--muted-dim); margin-bottom: 4px; }
        .summary-chip .value { font-size: 17px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
        .summary-chip .value.green { color: var(--green); }
        .summary-chip .target-note { font-size: 9.5px; color: var(--muted-dim); margin-top: 3px; }

        .disclaimer-banner {
          display: flex; gap: 10px; align-items: flex-start;
          background: rgba(0,217,255,0.05); border: 1px solid rgba(0,217,255,0.2);
          border-radius: 4px; padding: 10px 14px; margin-bottom: 16px;
          font-size: 11.5px; color: var(--muted); line-height: 1.5;
        }
        .disclaimer-banner svg { flex-shrink: 0; margin-top: 2px; color: var(--cyan); }

        /* ---- Stage 2: scheduler section ---- */
        .scheduler-section { margin-top: 18px; padding-bottom: 6px; }
        .scheduler-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; }
        .scheduler-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .scheduler-header .badge {
          font-size: 10px; font-weight: 700; color: var(--cyan); border: 1px solid rgba(0,217,255,0.35);
          background: rgba(0,217,255,0.08); padding: 3px 8px; border-radius: 3px; letter-spacing: 0.3px;
        }
        .scheduler-subtitle { padding: 0 20px 14px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }

        .tariff-block { padding: 0 20px 18px; }
        .tariff-tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .tariff-tab {
          display: flex; align-items: center; gap: 6px;
          background: var(--panel-alt); border: 1px solid var(--border-bright); color: var(--muted);
          font-family: inherit; font-size: 12px; font-weight: 600; padding: 8px 14px;
          cursor: pointer; border-radius: 3px;
        }
        .tariff-tab.active { border-color: var(--green); color: var(--green); background: rgba(74,222,128,0.08); }
        .price-inputs { display: flex; gap: 12px; flex-wrap: wrap; }
        .price-field { display: flex; flex-direction: column; gap: 4px; min-width: 120px; }
        .price-field label { font-size: 10px; color: var(--muted-dim); letter-spacing: 0.3px; }
        .price-field .input-wrap {
          display: flex; align-items: center; gap: 4px;
          background: var(--panel-alt); border: 1px solid var(--border-bright); border-radius: 3px; padding: 6px 8px;
        }
        .price-field input {
          background: transparent; border: none; color: var(--text); font-family: 'JetBrains Mono', monospace;
          font-size: 13px; width: 70px; outline: none;
        }
        .price-note { font-size: 10.5px; color: var(--muted-dim); margin-top: 8px; }

        .flex-appliance-grid { padding: 0 20px 18px; display: flex; flex-direction: column; gap: 12px; }
        .flex-card { background: var(--panel-alt); border: 1px solid var(--border); border-radius: 5px; padding: 14px; }
        .flex-card-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
        .flex-card-title { display: flex; align-items: center; gap: 10px; }
        .flex-card-title .icon-wrap {
          width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.05); border-radius: 4px;
        }
        .flex-card-title .name { font-size: 13.5px; font-weight: 700; }
        .flex-card-title .rating { font-size: 10.5px; color: var(--muted-dim); font-family: 'JetBrains Mono', monospace; }

        .schedule-pills { display: flex; gap: 8px; flex-wrap: wrap; }
        .schedule-pill {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 5px 10px; border-radius: 3px;
          border: 1px solid var(--border-bright); color: var(--muted);
        }
        .schedule-pill.baseline { color: var(--muted); }
        .schedule-pill.ai { color: var(--cyan); border-color: rgba(0,217,255,0.35); background: rgba(0,217,255,0.06); }
        .schedule-pill.save { color: var(--green); border-color: rgba(74,222,128,0.35); background: rgba(74,222,128,0.06); }
        .schedule-pill.warn { color: var(--red); border-color: rgba(255,95,109,0.35); background: rgba(255,95,109,0.06); }

        .rule-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px;
        }
        .rule-field { display: flex; flex-direction: column; gap: 4px; }
        .rule-field label {
          font-size: 9.5px; color: var(--muted-dim); letter-spacing: 0.3px; display: flex; align-items: center; gap: 4px;
        }
        .rule-field input[type="number"] {
          background: var(--panel); border: 1px solid var(--border-bright); border-radius: 3px;
          color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; padding: 6px 8px; width: 100%;
        }
        .rule-field .slider-with-value { display: flex; align-items: center; gap: 8px; }
        .rule-field input[type="range"] { flex: 1; accent-color: var(--cyan); }
        .rule-field .slider-value { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--cyan); width: 34px; text-align: right; }

        .explain-toggle {
          display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border-bright);
          color: var(--muted); font-family: inherit; font-size: 11.5px; font-weight: 600; padding: 7px 12px;
          border-radius: 3px; cursor: pointer;
        }
        .explain-toggle:hover { color: var(--cyan); border-color: var(--cyan); }

        .explain-box {
          margin-top: 10px; background: var(--panel); border: 1px solid var(--border-bright); border-radius: 4px; padding: 12px 14px;
        }
        .explain-text { font-size: 12px; line-height: 1.6; color: var(--text); margin-bottom: 12px; }
        .score-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .score-table th, .score-table td {
          text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
        }
        .score-table th { color: var(--muted-dim); font-weight: 500; font-size: 10px; letter-spacing: 0.3px; }
        .score-table td.metric-name { font-family: 'Space Grotesk', sans-serif; color: var(--muted); }
        .score-table tr.total td { color: var(--cyan); font-weight: 700; border-top: 1px solid var(--border-bright); border-bottom: none; }

        .compare-table-wrap { padding: 0 20px 20px; overflow-x: auto; }
        .compare-table { width: 100%; border-collapse: collapse; min-width: 620px; }
        .compare-table th, .compare-table td {
          text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 12px;
        }
        .compare-table th { color: var(--muted-dim); font-weight: 600; font-size: 10.5px; letter-spacing: 0.3px; text-transform: uppercase; }
        .compare-table td.mono-cell { font-family: 'JetBrains Mono', monospace; }
        .compare-table td.positive { color: var(--green); }
        .compare-table td.negative { color: var(--red); }

        /* ---- Stage 4: Scenario Lab ---- */
        .scenario-section { margin-top: 18px; }
        .scenario-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; }
        .scenario-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .scenario-subtitle { padding: 0 20px 14px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
        .scenario-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px;
          padding: 0 20px 14px;
        }
        .scenario-btn {
          display: flex; align-items: center; gap: 8px; text-align: left;
          background: var(--panel-alt); border: 1px solid var(--border-bright); color: var(--text);
          font-family: inherit; font-size: 12px; font-weight: 600; padding: 10px 12px;
          cursor: pointer; border-radius: 4px; transition: border-color 0.15s ease, background 0.15s ease;
        }
        .scenario-btn svg { flex-shrink: 0; color: var(--muted); }
        .scenario-btn:hover { border-color: var(--cyan); }
        .scenario-btn:hover svg { color: var(--cyan); }
        .scenario-btn.active { border-color: var(--cyan); background: rgba(0,217,255,0.10); }
        .scenario-btn.active svg { color: var(--cyan); }

        .scenario-status-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 20px 18px; }
        .scenario-status-chip {
          display: flex; align-items: center; gap: 6px;
          font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px;
          padding: 5px 10px; border-radius: 3px;
          color: var(--red); border: 1px solid rgba(255,95,109,0.4); background: rgba(255,95,109,0.08);
        }
        .scenario-status-chip svg { flex-shrink: 0; }
        .scenario-status-empty { font-size: 11px; color: var(--muted-dim); padding: 0 20px 18px; }

        .offline-banner {
          display: flex; gap: 10px; align-items: flex-start; margin: 0 20px 18px;
          background: rgba(255,95,109,0.06); border: 1px solid rgba(255,95,109,0.3);
          border-radius: 4px; padding: 10px 14px; font-size: 11.5px; color: var(--text); line-height: 1.5;
        }
        .offline-banner svg { flex-shrink: 0; color: var(--red); margin-top: 2px; }

        .tariff-tab:disabled, .price-field input:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ---- Stage 4: Hackathon Demo Mode ---- */
        .demo-section { margin-top: 18px; }
        .demo-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; }
        .demo-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .demo-subtitle { padding: 0 20px 16px; font-size: 11.5px; color: var(--muted); line-height: 1.5; max-width: 900px; }
        .demo-controls-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 0 20px 16px; }
        .demo-run-btn {
          display: flex; align-items: center; gap: 10px; justify-content: center;
          background: linear-gradient(135deg, rgba(0,217,255,0.16), rgba(74,222,128,0.16));
          border: 1px solid var(--cyan); color: var(--cyan);
          font-family: inherit; font-size: 14px; font-weight: 700; letter-spacing: 0.4px;
          padding: 14px 22px; border-radius: 5px; cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .demo-run-btn:hover:not(:disabled) { box-shadow: 0 0 0 1px var(--cyan), 0 0 18px rgba(0,217,255,0.25); }
        .demo-run-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .demo-hint { font-size: 11px; color: var(--muted-dim); }
        .demo-progress { padding: 0 20px 20px; }
        .demo-progress-bar { height: 6px; border-radius: 3px; background: var(--panel-alt); border: 1px solid var(--border); overflow: hidden; margin-bottom: 8px; }
        .demo-progress-fill { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--green)); transition: width 0.4s linear; }
        .demo-step-label { font-size: 12px; color: var(--cyan); font-family: 'JetBrains Mono', monospace; }
        .demo-step-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 20px; }
        .demo-step-pill {
          font-size: 9.5px; font-family: 'JetBrains Mono', monospace; padding: 3px 7px; border-radius: 3px;
          border: 1px solid var(--border); color: var(--muted-dim);
        }
        .demo-step-pill.done { color: var(--green); border-color: rgba(74,222,128,0.35); background: rgba(74,222,128,0.06); }
        .demo-step-pill.current { color: var(--cyan); border-color: rgba(0,217,255,0.45); background: rgba(0,217,255,0.08); }

        .footer-note { text-align: center; font-size: 10.5px; color: var(--muted-dim); margin-top: 18px; line-height: 1.6; }

        /* ---- Stage 3: Edge Forecast Engine ---- */
        .forecast-section { margin-top: 18px; padding-bottom: 6px; }
        .forecast-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .forecast-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .badge.sim {
          font-size: 10px; font-weight: 700; color: var(--amber); border: 1px solid rgba(255,176,32,0.35);
          background: rgba(255,176,32,0.08); padding: 3px 8px; border-radius: 3px; letter-spacing: 0.3px;
        }
        .forecast-subtitle { padding: 0 20px 16px; font-size: 11.5px; color: var(--muted); line-height: 1.5; max-width: 900px; }

        .sim-inputs-block { padding: 0 20px 18px; }
        .sim-inputs-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 12px;
        }
        .sim-input-field { display: flex; flex-direction: column; gap: 6px; }
        .sim-input-field label {
          font-size: 10px; color: var(--muted-dim); letter-spacing: 0.3px; display: flex; align-items: center; gap: 5px;
        }
        .sim-input-field .slider-with-value { display: flex; align-items: center; gap: 8px; }
        .sim-input-field input[type="range"] { flex: 1; accent-color: var(--cyan); }
        .sim-input-field .slider-value { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--cyan); width: 48px; text-align: right; }

        .context-chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .context-chip {
          display: flex; align-items: center; gap: 6px;
          background: var(--panel-alt); border: 1px solid var(--border); border-radius: 3px;
          padding: 6px 10px; font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace;
        }
        .context-chip svg { color: var(--muted-dim); flex-shrink: 0; }

        .forecast-chart-wrap { padding: 4px 18px 0; }
        .forecast-legend-note { padding: 0 20px; font-size: 10.5px; color: var(--muted-dim); margin: -4px 0 4px; }

        .mape-row { display: flex; gap: 10px; padding: 14px 20px 6px; flex-wrap: wrap; align-items: stretch; }
        .mape-card { flex: 1; min-width: 170px; background: var(--panel-alt); border: 1px solid var(--border); border-radius: 4px; padding: 12px 14px; }
        .mape-card .label { font-size: 10px; color: var(--muted-dim); margin-bottom: 4px; letter-spacing: 0.3px; }
        .mape-card .value { font-size: 20px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
        .mape-card .value.warn { color: var(--amber); }
        .mape-card .value.ok { color: var(--green); }
        .mape-card .target-note { font-size: 9.5px; color: var(--muted-dim); margin-top: 3px; }

        .error-btn-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 6px 20px 18px; }
        .ctrl-btn.danger { border-color: rgba(255,95,109,0.5); color: var(--red); }
        .ctrl-btn.danger:hover { border-color: var(--red); color: var(--red); background: rgba(255,95,109,0.08); }
        .error-status { font-size: 11px; color: var(--amber); font-family: 'JetBrains Mono', monospace; display: flex; align-items: center; gap: 6px; }

        /* ---- Stage 3: Hardware panel ---- */
        .hw-section { margin-top: 18px; }
        .hw-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; }
        .hw-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .hw-subtitle { padding: 0 20px 14px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
        .hw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; padding: 0 20px 20px; }
        .hw-card { background: var(--panel-alt); border: 1px solid var(--border); border-radius: 4px; padding: 12px 14px; }
        .hw-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
        .hw-card-head .icon-wrap {
          width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.04); border-radius: 3px; flex-shrink: 0; color: var(--cyan);
        }
        .hw-card-name { font-size: 12px; font-weight: 700; line-height: 1.2; }
        .hw-card-sub { font-size: 9.5px; color: var(--muted-dim); font-family: 'JetBrains Mono', monospace; }
        .hw-reading-list { display: flex; flex-direction: column; gap: 5px; }
        .hw-reading { display: flex; justify-content: space-between; font-size: 11.5px; }
        .hw-reading .rk { color: var(--muted-dim); }
        .hw-reading .rv { font-family: 'JetBrains Mono', monospace; color: var(--text); }
        .hw-reading .rv.on { color: var(--green); }
        .hw-reading .rv.off { color: var(--muted); }
        .hw-reading .rv.fault { color: var(--red); font-size: 10.5px; }
        .hw-card.faulty { border-color: rgba(255,95,109,0.45); }

        /* ---- Stage 3: Architecture diagram ---- */
        .arch-section { margin-top: 18px; }
        .arch-header { padding: 16px 20px 4px; display: flex; align-items: center; gap: 10px; }
        .arch-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .arch-subtitle { padding: 0 20px 16px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
        .arch-flow {
          display: flex; align-items: center; gap: 6px; padding: 6px 20px 18px; overflow-x: auto;
        }
        .arch-node {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          background: var(--panel-alt); border: 1px solid var(--border-bright); border-radius: 5px;
          padding: 14px 12px; min-width: 110px; cursor: pointer; flex-shrink: 0;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .arch-node:hover { border-color: var(--cyan); }
        .arch-node.selected { border-color: var(--cyan); background: rgba(0,217,255,0.08); }
        .arch-node .icon-wrap {
          width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.05); border-radius: 50%; color: var(--cyan);
        }
        .arch-node .arch-node-label { font-size: 11px; font-weight: 700; text-align: center; line-height: 1.25; }
        .arch-arrow { color: var(--border-bright); flex-shrink: 0; }
        .arch-arrow.flowing { position: relative; width: 26px; height: 2px; background: var(--border-bright); overflow: hidden; }
        .arch-arrow.flowing .pulse {
          position: absolute; top: -3px; left: 0; width: 8px; height: 8px; border-radius: 50%;
          background: var(--cyan); box-shadow: 0 0 6px var(--cyan);
          animation: flowPulse 2.4s linear infinite;
        }
        @keyframes flowPulse { 0% { left: -10px; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: 26px; opacity: 0; } }
        .arch-detail-panel {
          margin: 0 20px 18px; background: var(--panel); border: 1px solid var(--border-bright); border-radius: 4px;
          padding: 12px 16px; font-size: 12px; line-height: 1.6; color: var(--text);
        }
        .arch-detail-panel .dt-title { font-size: 12.5px; font-weight: 700; color: var(--cyan); margin-bottom: 4px; }

        /* ---- Stage 3: Live decision log ---- */
        .log-section { margin-top: 18px; }
        .log-header { padding: 16px 20px 4px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .log-header h2 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
        .log-header .log-header-left { display: flex; align-items: center; gap: 10px; }
        .log-subtitle { padding: 0 20px 12px; font-size: 11.5px; color: var(--muted); line-height: 1.5; }
        .log-list {
          list-style: none; margin: 0; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 7px;
          max-height: 300px; overflow-y: auto;
        }
        .log-entry {
          display: flex; gap: 10px; align-items: flex-start; background: var(--panel-alt);
          border: 1px solid var(--border); border-left: 3px solid var(--border-bright);
          border-radius: 3px; padding: 8px 10px; font-size: 11.5px; line-height: 1.5;
        }
        .log-entry .log-time { font-family: 'JetBrains Mono', monospace; color: var(--muted-dim); font-size: 10.5px; flex-shrink: 0; padding-top: 1px; }
        .log-entry .log-text { color: var(--text); }
        .log-entry.kind-forecast { border-left-color: var(--cyan); }
        .log-entry.kind-scheduler { border-left-color: var(--green); }
        .log-entry.kind-hardware { border-left-color: var(--muted); }
        .log-entry.kind-error { border-left-color: var(--red); background: rgba(255,95,109,0.06); }
        .log-entry.kind-override { border-left-color: var(--amber); }
        .log-empty { padding: 0 20px 20px; font-size: 11.5px; color: var(--muted-dim); }
      `}</style>

      {/* Header */}
      <div className="header facet">
        <div className="header-title-row">
          <div className="diamond-mark" />
          <div>
            <h1>DIAMOND GRIDWISE AI</h1>
            <p className="subtitle">Predictive Smart Home Energy Management — interactive simulation</p>
          </div>
        </div>
        <div className="sim-pill">
          <Info size={13} />
          SIMULATION ONLY — NO HARDWARE CONNECTED
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Stage 5: Display Mode switcher                                */}
      {/* ------------------------------------------------------------ */}
      <div className="mode-switcher facet">
        <span className="mode-switcher-label">DISPLAY MODE</span>
        <div className="mode-switcher-group">
          <button
            className={`mode-btn ${displayMode === "full" ? "active" : ""}`}
            onClick={() => setDisplayMode("full")}
          >
            <LayoutGrid size={14} />
            Full View
          </button>
          <button
            className={`mode-btn ${showPresentation ? "active presentation" : ""}`}
            onClick={() => setDisplayMode("presentation")}
          >
            <Tv size={14} />
            Presentation Mode
          </button>
          <button
            className={`mode-btn ${showEngineering ? "active engineering" : ""}`}
            onClick={() => setDisplayMode("engineering")}
          >
            <Wrench size={14} />
            Engineering Mode
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* About this Simulation — always visible, regardless of mode    */}
      {/* ------------------------------------------------------------ */}
      <div className="facet about-section">
        <div className="about-header">
          <ShieldCheck size={18} color="var(--cyan)" />
          <h2>About this Simulation</h2>
        </div>
        <p className="about-body">
          This is an educational software simulation of Team Diamond's Predictive Smart Home Energy Management
          System. It does not control real electrical appliances and does not connect directly to mains voltage,
          ESP32 hardware, sensors, or relays. The AI forecast and RL-style scheduling are simulated for
          demonstration. The displayed performance percentages are project targets or illustrative simulation
          results, not independently verified field measurements.
        </p>
        <ul className="about-safety-list">
          <li>
            <ShieldCheck size={14} />
            <span>Human override is always available.</span>
          </li>
          <li>
            <ShieldCheck size={14} />
            <span>Critical appliances must use safe fallback behavior.</span>
          </li>
          <li>
            <ShieldCheck size={14} />
            <span>
              Real deployment requires electrical isolation, certified protection, overcurrent protection, thermal
              protection, and qualified hardware integration.
            </span>
          </li>
        </ul>
      </div>

      {showDetailed && (
        <div className="disclaimer-banner">
          <Info size={15} />
          <span>
            Everything below runs locally in your browser as an in-memory simulation. No sensors, relays, or
            appliances are actually being read or switched. The scheduler below is labelled an{" "}
            <strong>RL-style Energy Scheduler</strong>: it is a rule-based search over candidate start times scored
            by a hand-weighted formula, not a trained reinforcement-learning model. Further down, the{" "}
            <strong>Edge Forecast Engine</strong> is likewise a transparent, hand-written formula that mimics the
            shape of an LSTM load forecaster — not a trained neural network. Forecast curves, tariffs, hardware
            readings, and carbon-intensity figures are simplified, illustrative values.
          </span>
        </div>
      )}

      {/* Live stat bar — shown in Full and Engineering modes (Engineering
          needs these raw readouts at least as much as Full view does) */}
      {showDetailed && (
        <div className="stat-bar">
          <StatCard icon={Zap} label="Current Load" value={currentLoadKW.toFixed(2)} unit="kW" />
          <StatCard icon={ArrowDownCircle} label="Grid Import" value={currentGridImport.toFixed(2)} unit="kW" />
          <StatCard icon={Sun} label="Solar Generation" value={currentSolar.toFixed(2)} unit="kW" color="var(--green)" />
          <StatCard icon={TrendingUp} label="Current Tariff" value={currentTariff.toFixed(2)} unit="₹/kWh" color="var(--amber)" />
          <StatCard icon={IndianRupee} label="Cost So Far" value={costSoFar.toFixed(2)} unit="₹" />
          <StatCard icon={Gauge} label="Peak Demand" value={peakSoFar.toFixed(2)} unit="kW" />
          <StatCard
            icon={Smile}
            label="Comfort Score"
            value={comfortScore}
            unit="/100"
            color={comfortScore >= 85 ? "var(--green)" : "var(--amber)"}
          />
        </div>
      )}

      {/* Controls */}
      <div className="controls-panel facet">
        <div className="controls-row">
          <button className={`ctrl-btn ${isPlaying ? "" : "primary"}`} onClick={handleStartPause}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {isPlaying ? "Pause" : currentSlot === 0 ? "Start" : "Resume"}
          </button>
          <button className="ctrl-btn" onClick={handleReset}>
            <RotateCcw size={14} />
            Reset
          </button>
          <div className="speed-group">
            <span>SPEED</span>
            {SPEED_OPTIONS.map((s) => (
              <button key={s} className={`speed-btn ${speed === s ? "active" : ""}`} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <div className="time-readout mono">{formatTime(currentSlot)}</div>
        </div>
        <div className="slider-row">
          <input type="range" min={0} max={SLOTS - 1} step={1} value={currentSlot} onChange={handleSlider} />
        </div>
        <div className="slider-labels">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:45</span>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Stage 5: Presentation Mode view                               */}
      {/* ------------------------------------------------------------ */}
      {showPresentation && (
        <div className="presentation-view">
          <div className="facet presentation-title-card">
            <div className="diamond-mark" />
            <div>
              <h1>Team Diamond</h1>
              <p className="subtitle">Diamond Gridwise AI — Predictive Smart Home Energy Management</p>
            </div>
          </div>

          <div className="facet presentation-blurb">
            <Info size={15} />
            <p>
              Diamond Gridwise AI is a predictive smart-home energy system. An on-device forecast engine
              anticipates household demand, and a scheduler shifts flexible appliances — water heater, washing
              machine, EV charger, water pump — away from expensive, high-carbon peak hours, while protecting
              comfort and continuing to run safely even if cloud connectivity is lost.
            </p>
          </div>

          <div className="presentation-grid">
            <div className="facet presentation-visual-card">
              <div className="panel-title">
                <div>
                  <h2>Smart Home — live state</h2>
                  <p>Appliances light up green when the AI schedule has them running</p>
                </div>
              </div>
              <SmartHomeVisual
                appliances={APPLIANCES}
                currentSlot={currentSlot}
                powerAt={powerAt}
                solarKW={currentSolar}
                gridImportKW={currentGridImport}
                edgeOffline={scenarioFlags.edgeOffline}
              />
            </div>

            <div className="facet presentation-chart-card">
              <div className="panel-title">
                <div>
                  <h2>Baseline vs AI-Optimized Load</h2>
                  <p>24-hour simulated demand curve</p>
                </div>
              </div>
              <div style={{ width: "100%", height: 260, padding: "10px 8px 0" }}>
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="#1e2a35" vertical={false} />
                    <XAxis
                      dataKey="time"
                      interval={7}
                      tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#1e2a35" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={{ stroke: "#1e2a35" }}
                      tickLine={false}
                      width={38}
                    />
                    <Tooltip
                      contentStyle={{ background: "#10161d", border: "1px solid #2a3b48", borderRadius: 4, fontSize: 11, fontFamily: "JetBrains Mono" }}
                      labelStyle={{ color: "#8b98a5" }}
                      formatter={(v, name) => [`${v} kW`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Area type="monotone" dataKey="solar" name="Solar" stroke="none" fill="#4ade80" fillOpacity={0.12} />
                    <Line type="stepAfter" dataKey="baseline" name="Baseline" stroke="#8b98a5" strokeDasharray="4 3" dot={false} strokeWidth={1.75} />
                    <Line type="stepAfter" dataKey="aiOptimized" name="AI-optimized" stroke="#00d9ff" dot={false} strokeWidth={2} />
                    <ReferenceLine x={chartData[currentSlot]?.time} stroke="#ffb020" strokeDasharray="2 2" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="facet presentation-schedule-card">
            <div className="panel-title">
              <div>
                <h2>Appliance Schedule</h2>
                <p>Baseline (habitual) start vs AI-optimized start for each flexible appliance</p>
              </div>
            </div>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Appliance</th>
                    <th>Baseline Start</th>
                    <th>AI Start</th>
                    <th>Time Shifted</th>
                    <th>Est. Saving</th>
                  </tr>
                </thead>
                <tbody>
                  {FLEX_IDS.map((id) => {
                    const ap = APPLIANCES.find((a) => a.id === id);
                    const r = schedulerResults[id];
                    const baselineLabel = formatHourLabel(ap.naiveStartHour);
                    const aiLabel = r.best
                      ? formatTime(r.best.actualStartSlot) + (r.best.startSlot >= SLOTS ? " (+1d)" : "")
                      : "—";
                    const deltaH = r.best ? (r.best.startSlot - r.naiveStartSlotVirtual) / 4 : null;
                    const saving = r.best ? r.baselineCost - r.best.electricityCost : null;
                    return (
                      <tr key={id}>
                        <td>{ap.name}</td>
                        <td className="mono-cell">{baselineLabel}</td>
                        <td className="mono-cell">{aiLabel}</td>
                        <td className="mono-cell">{deltaH === null ? "—" : `${deltaH >= 0 ? "+" : ""}${deltaH.toFixed(2)}h`}</td>
                        <td className={`mono-cell ${saving === null ? "" : saving >= 0 ? "positive" : "negative"}`}>
                          {saving === null ? "infeasible" : `₹${saving.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="presentation-metrics-row">
            <div className="facet presentation-metric-card">
              <div className="p-label">COST SAVINGS</div>
              <div className="p-value green">{savingsPct}%</div>
            </div>
            <div className="facet presentation-metric-card">
              <div className="p-label">PEAK REDUCTION</div>
              <div className="p-value green">{peakReductionPct}%</div>
            </div>
            <div className="facet presentation-metric-card">
              <div className="p-label">COMFORT SCORE</div>
              <div className="p-value" style={{ color: comfortScore >= 85 ? "var(--green)" : "var(--amber)" }}>
                {comfortScore}/100
              </div>
            </div>
            <div className="facet presentation-metric-card">
              <div className="p-label">EDGE STATUS</div>
              <div className="p-value" style={{ color: scenarioFlags.edgeOffline ? "var(--red)" : "var(--green)" }}>
                {scenarioFlags.edgeOffline ? "EDGE OFFLINE" : "ONLINE"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 4: Scenario Lab                                         */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet scenario-section">
        <div className="scenario-header">
          <FlaskConical size={18} color="var(--cyan)" />
          <h2>Scenario Lab</h2>
        </div>
        <p className="scenario-subtitle">
          Tap a scenario to push it into the live simulation — it changes real inputs (temperature, occupancy,
          tariff, clock, overrides) across every panel above and below, and logs what happened.
        </p>
        <div className="scenario-grid">
          {SCENARIOS.map((s) => {
            const SIcon = s.icon;
            return (
              <button
                key={s.id}
                className={`scenario-btn ${activeScenario === s.id ? "active" : ""}`}
                onClick={() => applyScenario(s.id)}
              >
                <SIcon size={15} />
                {s.label}
              </button>
            );
          })}
        </div>

        {(scenarioFlags.edgeOffline ||
          scenarioFlags.tempSensorFault ||
          scenarioFlags.currentSensorFault ||
          scenarioFlags.transformerRisk ||
          scenarioFlags.lowBattery ||
          scenarioFlags.unavailableApplianceId) ? (
          <div className="scenario-status-row">
            {scenarioFlags.edgeOffline && (
              <span className="scenario-status-chip"><WifiOff size={12} /> EDGE OFFLINE</span>
            )}
            {scenarioFlags.tempSensorFault && (
              <span className="scenario-status-chip"><Thermometer size={12} /> TEMP SENSOR FAULT</span>
            )}
            {scenarioFlags.currentSensorFault && (
              <span className="scenario-status-chip"><GaugeIcon size={12} /> CURRENT SENSOR FAULT</span>
            )}
            {scenarioFlags.transformerRisk && (
              <span className="scenario-status-chip"><AlertOctagon size={12} /> TRANSFORMER RISK</span>
            )}
            {scenarioFlags.lowBattery && (
              <span className="scenario-status-chip"><Battery size={12} /> LOW BATTERY</span>
            )}
            {scenarioFlags.unavailableApplianceId && (
              <span className="scenario-status-chip">
                <Ban size={12} /> {APPLIANCES.find((a) => a.id === scenarioFlags.unavailableApplianceId)?.name.toUpperCase()} UNAVAILABLE
              </span>
            )}
          </div>
        ) : (
          <div className="scenario-status-empty">No active scenario flags — system nominal.</div>
        )}

        {scenarioFlags.edgeOffline && (
          <div className="offline-banner">
            <WifiOff size={16} />
            <span>
              <strong>Cloud unavailable — EDGE OFFLINE mode.</strong> The simulation keeps running locally: tariff
              pricing is pinned to the last cached snapshot instead of any live cloud update, while the on-device
              forecast engine and scheduler keep computing live from local sensor inputs. Tariff plan and price
              inputs below are locked until connectivity is restored (pick "Normal Weekday" or another scenario to
              clear this state).
            </span>
          </div>
        )}
        {(scenarioFlags.tempSensorFault || scenarioFlags.currentSensorFault) && (
          <div className="offline-banner">
            <AlertTriangle size={16} />
            <span>
              <strong>Degraded-safe mode.</strong> A sensor is marked faulty, so its live reading has been replaced
              with a fixed, conservative fallback estimate and manual force-ON of critical appliances (AC, water
              heater) is locked to avoid an unsafe switching decision based on bad data.
            </span>
          </div>
        )}
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 4: Hackathon Demo Mode                                  */}
      {/* ------------------------------------------------------------ */}
      {showFullOnly && (
      <div className="facet demo-section">
        <div className="demo-header">
          <ScrollText size={18} color="var(--cyan)" />
          <h2>Hackathon Demo Mode</h2>
        </div>
        <p className="demo-subtitle">
          Runs a scripted 90-second walkthrough of the full pipeline end-to-end — evening peak detection, AI
          scheduling of every flexible appliance, an internet outage with offline edge control, and a baseline vs
          AI results summary — driving the real controls above so every step is visible, not just logged.
        </p>
        <div className="demo-controls-row">
          <button className="demo-run-btn" onClick={handleStartDemo} disabled={demoRunning}>
            <Play size={16} />
            RUN 90-SECOND HACKATHON DEMO
          </button>
          {demoRunning && (
            <button className="ctrl-btn danger" onClick={handleStopDemo}>
              <Square size={13} />
              Stop Demo
            </button>
          )}
          {!demoRunning && demoStepIndex === -1 && (
            <span className="demo-hint">Press Reset (above) any time to clear the demo and return to 00:00.</span>
          )}
        </div>
        {demoRunning && demoStepIndex >= 0 && (
          <div className="demo-progress">
            <div className="demo-progress-bar">
              <div className="demo-progress-fill" style={{ width: `${((demoStepIndex + 1) / DEMO_STEPS_COUNT) * 100}%` }} />
            </div>
            <div className="demo-step-label">
              Step {demoStepIndex + 1}/{DEMO_STEPS_COUNT} — {demoStepsRef.current[demoStepIndex]?.label}
            </div>
          </div>
        )}
        {demoStepsRef.current.length > 0 && (
          <div className="demo-step-list">
            {demoStepsRef.current.map((step, i) => (
              <span
                key={step.label}
                className={`demo-step-pill ${i < demoStepIndex ? "done" : ""} ${i === demoStepIndex ? "current" : ""}`}
              >
                {i + 1}. {step.label}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Main grid: appliances + chart */}
      {showDetailed && (
      <div className="main-grid">
        <div className="facet">
          <div className="panel-title">
            <div>
              <h2>Appliances — live AI-controlled state</h2>
              <p>Auto follows the optimized schedule · override to force a state</p>
            </div>
          </div>
          <div className="appliance-grid">
            {APPLIANCES.map((ap) => (
              <ApplianceCard
                key={ap.id}
                appliance={ap}
                currentSlot={currentSlot}
                override={overrides[ap.id]}
                onOverride={(val) => handleOverride(ap.id, val)}
                powerAt={powerAt}
                isUnavailable={scenarioFlags.unavailableApplianceId === ap.id}
                degradedSafe={scenarioFlags.tempSensorFault || scenarioFlags.currentSensorFault}
              />
            ))}
          </div>
        </div>

        <div className="facet chart-panel">
          <div className="panel-title">
            <div>
              <h2>Baseline vs AI-optimized load — 24h</h2>
              <p>Simulated demand curves from illustrative appliance schedules</p>
            </div>
          </div>
          <div style={{ width: "100%", height: 300, padding: "10px 8px 0" }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1e2a35" vertical={false} />
                <XAxis
                  dataKey="time"
                  interval={3}
                  tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  axisLine={{ stroke: "#1e2a35" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  axisLine={{ stroke: "#1e2a35" }}
                  tickLine={false}
                  width={38}
                />
                <Tooltip
                  contentStyle={{ background: "#10161d", border: "1px solid #2a3b48", borderRadius: 4, fontSize: 11, fontFamily: "JetBrains Mono" }}
                  labelStyle={{ color: "#8b98a5" }}
                  formatter={(v, name) => [`${v} kW`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Area type="monotone" dataKey="solar" name="Solar (simulated)" stroke="none" fill="#4ade80" fillOpacity={0.12} />
                <Line type="stepAfter" dataKey="baseline" name="Baseline (naive)" stroke="#8b98a5" strokeDasharray="4 3" dot={false} strokeWidth={1.75} />
                <Line type="stepAfter" dataKey="aiOptimized" name="AI-optimized" stroke="#00d9ff" dot={false} strokeWidth={2} />
                <ReferenceLine x={chartData[currentSlot]?.time} stroke="#ffb020" strokeDasharray="2 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend-note">Vertical amber line marks the current simulation time.</div>

          <div className="summary-row" style={{ marginTop: 14 }}>
            <div className="summary-chip">
              <div className="label">SIMULATED PEAK REDUCTION</div>
              <div className="value green">{peakReductionPct}%</div>
              <div className="target-note">PPT target: 18.7% (illustrative)</div>
            </div>
            <div className="summary-chip">
              <div className="label">SIMULATED COST SAVINGS</div>
              <div className="value green">{savingsPct}%</div>
              <div className="target-note">PPT target: 22.5% (illustrative)</div>
            </div>
            <div className="summary-chip">
              <div className="label">FULL-DAY COST (BASELINE / AI)</div>
              <div className="value mono">₹{baselineTotalCost.toFixed(0)} / ₹{aiTotalCost.toFixed(0)}</div>
              <div className="target-note">Projected for the full simulated day</div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 2: RL-style Energy Scheduler                            */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet scheduler-section">
        <div className="scheduler-header">
          <Cpu size={18} color="var(--cyan)" />
          <h2>RL-style Energy Scheduler</h2>
          <span className="badge">RULE-BASED SEARCH · NOT A TRAINED RL MODEL</span>
        </div>
        <p className="scheduler-subtitle">
          For each flexible appliance, the scheduler searches every feasible start time between its earliest-start
          and latest-completion limits and picks the one with the lowest transparent score below. It behaves in the
          spirit of a reinforcement-learning scheduler (reward shaping, action search) but is implemented here as a
          deterministic brute-force search, not a trained neural policy.
        </p>

        <div className="reward-fn-block">
          <div className="reward-fn-title"><ScrollText size={13} /> Reward / Score Function — hand-weighted, not learned</div>
          <div className="reward-fn-formula mono">
            score = cost + peakPenalty·w<sub>peak</sub> + comfortPenalty·w<sub>comfort</sub> + deadlinePenalty·w<sub>deadline</sub> + carbonPenalty·w<sub>carbon</sub> − solarBonus·w<sub>solar</sub>
          </div>
          <div className="reward-fn-weights">
            <span>Peak ×{SCORE_WEIGHTS.peak}{peakWeightMultiplier > 1 ? ` (×${peakWeightMultiplier.toFixed(1)} risk boost active)` : ""}</span>
            <span>Comfort ×{SCORE_WEIGHTS.comfort}</span>
            <span>Deadline ×{SCORE_WEIGHTS.deadline}</span>
            <span>Carbon ×{SCORE_WEIGHTS.carbon}</span>
            <span>Solar ×{SCORE_WEIGHTS.solar}</span>
          </div>
          {peakWeightMultiplier > 1 && (
            <div className="price-note">
              Transformer overload risk / low-battery reserve is active — the peak-band penalty weight is
              multiplied ×{peakWeightMultiplier.toFixed(1)}, so the scheduler pushes flexible loads out of the
              18:00–22:00 band harder than usual.
            </div>
          )}
        </div>

        {/* Tariff plan selector */}
        <div className="tariff-block">
          <div className="tariff-tabs">
            {TARIFF_PLANS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  className={`tariff-tab ${tariffPlan === p.id ? "active" : ""}`}
                  onClick={() => setTariffPlan(p.id)}
                  disabled={scenarioFlags.edgeOffline}
                >
                  <Icon size={14} />
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="price-inputs">
            <div className="price-field">
              <label>OFF-PEAK PRICE (₹/kWh)</label>
              <div className="input-wrap">
                <IndianRupee size={12} />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={prices.offpeak}
                  disabled={scenarioFlags.edgeOffline}
                  onChange={(e) => setPrices((p) => ({ ...p, offpeak: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="price-field">
              <label>NORMAL PRICE (₹/kWh)</label>
              <div className="input-wrap">
                <IndianRupee size={12} />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={prices.normal}
                  disabled={scenarioFlags.edgeOffline}
                  onChange={(e) => setPrices((p) => ({ ...p, normal: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="price-field">
              <label>PEAK PRICE (₹/kWh)</label>
              <div className="input-wrap">
                <IndianRupee size={12} />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={prices.peak}
                  disabled={scenarioFlags.edgeOffline}
                  onChange={(e) => setPrices((p) => ({ ...p, peak: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>
          <div className="price-note">
            {scenarioFlags.edgeOffline && "EDGE OFFLINE — tariff plan and prices are locked to the cached snapshot until connectivity is restored."}
            {!scenarioFlags.edgeOffline && tariffPlan === "flat" && "Flat plan: every hour is billed at the Normal price."}
            {!scenarioFlags.edgeOffline && tariffPlan === "tou" && "Time-of-Use: 22:00–06:00 = off-peak, 06:00–18:00 = normal, 18:00–22:00 = peak."}
            {!scenarioFlags.edgeOffline && tariffPlan === "green" && "Green / solar-friendly: 06:00–18:00 (solar hours) = off-peak price, 18:00–22:00 = peak, 22:00–06:00 = normal."}
          </div>
        </div>

        {/* Flexible appliance scheduling rules + explanations */}
        <div className="flex-appliance-grid">
          {FLEX_IDS.map((id) => {
            const ap = APPLIANCES.find((a) => a.id === id);
            const rule = rules[id];
            const result = schedulerResults[id];
            return (
              <SchedulerApplianceCard
                key={id}
                ap={ap}
                rule={rule}
                result={result}
                onRuleChange={(field, value) => updateRule(id, field, value)}
                isOpen={!!explainOpen[id]}
                onToggle={() => toggleExplain(id)}
              />
            );
          })}
        </div>

        {/* Schedule comparison table */}
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Appliance</th>
                <th>Baseline Start</th>
                <th>AI Start</th>
                <th>Time Shifted</th>
                <th>Estimated Cost Saving</th>
              </tr>
            </thead>
            <tbody>
              {FLEX_IDS.map((id) => {
                const ap = APPLIANCES.find((a) => a.id === id);
                const r = schedulerResults[id];
                const baselineLabel = formatHourLabel(ap.naiveStartHour);
                const aiLabel = r.best
                  ? formatTime(r.best.actualStartSlot) + (r.best.startSlot >= SLOTS ? " (+1d)" : "")
                  : "—";
                const deltaH = r.best ? (r.best.startSlot - r.naiveStartSlotVirtual) / 4 : null;
                const saving = r.best ? r.baselineCost - r.best.electricityCost : null;
                return (
                  <tr key={id}>
                    <td>{ap.name}</td>
                    <td className="mono-cell">{baselineLabel}</td>
                    <td className="mono-cell">{aiLabel}</td>
                    <td className="mono-cell">{deltaH === null ? "—" : `${deltaH >= 0 ? "+" : ""}${deltaH.toFixed(2)}h`}</td>
                    <td className={`mono-cell ${saving === null ? "" : saving >= 0 ? "positive" : "negative"}`}>
                      {saving === null ? "infeasible" : `₹${saving.toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 3: Edge Forecast Engine — LSTM-style browser simulation */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet forecast-section">
        <div className="forecast-header">
          <BrainCircuit size={18} color="var(--cyan)" />
          <h2>Edge Forecast Engine</h2>
          <span className="badge sim">BROWSER SIMULATION · NOT A TRAINED LSTM</span>
        </div>
        <p className="forecast-subtitle">
          This panel mimics the shape of the ESP32-S3's on-device LSTM load forecaster described in the deck:
          recent history plus live context features go in, a next-step load prediction and confidence band come
          out. Everything here is a deterministic formula running in your browser — no neural network is trained
          or executed, and no real sensor data is involved.
        </p>

        {/* Simulated inputs */}
        <div className="sim-inputs-block">
          <div className="sim-inputs-grid">
            <div className="sim-input-field">
              <label><Thermometer size={12} /> SIMULATED TEMPERATURE (°C)</label>
              <div className="slider-with-value">
                <input
                  type="range" min={16} max={42} step={1}
                  value={forecastInputs.temperature}
                  onChange={(e) => setForecastInputs((v) => ({ ...v, temperature: Number(e.target.value) }))}
                />
                <span className="slider-value">{forecastInputs.temperature}°C</span>
              </div>
            </div>
            <div className="sim-input-field">
              <label><Users size={12} /> SIMULATED OCCUPANCY</label>
              <div className="slider-with-value">
                <input
                  type="range" min={0} max={100} step={5}
                  value={forecastInputs.occupancyPct}
                  onChange={(e) => setForecastInputs((v) => ({ ...v, occupancyPct: Number(e.target.value) }))}
                />
                <span className="slider-value">{forecastInputs.occupancyPct}%</span>
              </div>
            </div>
          </div>
          <div className="context-chips">
            <span className="context-chip"><IndianRupee size={12} /> Tariff: {TARIFF_PLANS.find((p) => p.id === tariffPlan)?.label} · ₹{currentTariff.toFixed(2)}/kWh now</span>
            <span className="context-chip"><Sun size={12} /> Solar now: {currentSolar.toFixed(2)} kW</span>
            <span className="context-chip"><Clock size={12} /> Time of day: {formatTime(currentSlot)}</span>
            <span className="context-chip"><Activity size={12} /> Historical load feed: {historicalLoadArr[currentSlot].toFixed(2)} kW</span>
          </div>
        </div>

        {/* Forecast graph */}
        <div className="forecast-chart-wrap">
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={forecastChartData} margin={{ top: 6, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#1e2a35" vertical={false} />
                <XAxis
                  dataKey="time"
                  interval={7}
                  tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  axisLine={{ stroke: "#1e2a35" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#5a6672", fontSize: 10, fontFamily: "JetBrains Mono" }}
                  axisLine={{ stroke: "#1e2a35" }}
                  tickLine={false}
                  width={38}
                />
                <Tooltip content={<ForecastTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                <Area dataKey="bandLower" stackId="band" stroke="none" fill="transparent" name="" legendType="none" />
                <Area
                  dataKey="bandRange"
                  stackId="band"
                  stroke="none"
                  fill="#00d9ff"
                  fillOpacity={0.12}
                  name="Confidence band"
                />
                <Line type="monotone" dataKey="historical" name="Historical (yesterday)" stroke="#5a6672" strokeDasharray="3 3" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#00d9ff" dot={false} strokeWidth={2} />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual (simulated)"
                  stroke={errorWindow ? "#ff5f6d" : "#4ade80"}
                  dot={false}
                  strokeWidth={2}
                />
                <ReferenceLine x={forecastChartData[currentSlot]?.time} stroke="#ffb020" strokeDasharray="2 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="forecast-legend-note">
            Dashed grey = yesterday's simulated demand. Cyan = the forecast engine's live prediction. Green (or red
            after an injected error) = the simulated "actual" outcome used to score the forecast. Shaded band =
            simulated prediction uncertainty.
          </div>
        </div>

        {/* MAPE + error injection */}
        <div className="mape-row">
          <div className="mape-card">
            <div className="label">SIMULATED FORECAST MAPE</div>
            <div className={`value ${forecastMAPE > 12 ? "warn" : "ok"}`}>{forecastMAPE}%</div>
            <div className="target-note">PPT target: 6.3% MAPE (illustrative)</div>
          </div>
          <div className="mape-card">
            <div className="label">CONFIDENCE BAND (NOW)</div>
            <div className="value mono">±{(confidenceBandArr[currentSlot].upper - forecastLoadArr[currentSlot]).toFixed(2)} kW</div>
            <div className="target-note">Widens further into the forecast horizon</div>
          </div>
          <div className="mape-card">
            <div className="label">ERROR STATE</div>
            <div className={`value ${errorWindow ? "warn" : "ok"}`}>{errorWindow ? "ANOMALY ACTIVE" : "NOMINAL"}</div>
            <div className="target-note">{errorWindow ? `Injected +${errorWindow.magnitude.toFixed(2)} kW spike` : "Forecast tracking actual load"}</div>
          </div>
        </div>
        <div className="error-btn-row">
          <button className="ctrl-btn danger" onClick={handleInjectForecastError}>
            <AlertTriangle size={14} />
            Inject Forecast Error
          </button>
          {errorWindow && (
            <button className="ctrl-btn" onClick={handleClearForecastError}>
              <RotateCcw size={14} />
              Clear Error
            </button>
          )}
          {errorWindow && (
            <span className="error-status">
              <Waves size={13} />
              Simulated anomaly window: {formatTime(errorWindow.startSlot)}–{formatTime(errorWindow.endSlot % SLOTS)}
            </span>
          )}
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 3: Hardware panel — simulated sensor readings           */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet hw-section">
        <div className="hw-header">
          <CircuitBoard size={18} color="var(--cyan)" />
          <h2>Hardware Panel — simulated sensor readings</h2>
        </div>
        <p className="hw-subtitle">
          Illustrative readings only. No physical ESP32-S3, sensors, or relays are connected — every value below is
          computed from the in-browser simulation state to show what the real hardware stack would report.
        </p>
        <div className="hw-grid">
          <div className="hw-card">
            <div className="hw-card-head">
              <div className="icon-wrap"><Cpu size={15} /></div>
              <div>
                <div className="hw-card-name">ESP32-S3 MCU</div>
                <div className="hw-card-sub">TFLite-Micro inference core</div>
              </div>
            </div>
            <div className="hw-reading-list">
              <div className="hw-reading"><span className="rk">Inference time</span><span className="rv">{hardwareReadings.inferenceMs} ms</span></div>
              <div className="hw-reading"><span className="rk">CPU load</span><span className="rv">{hardwareReadings.cpuLoad}%</span></div>
              <div className="hw-reading"><span className="rk">Board temp</span><span className="rv">{hardwareReadings.boardTemp}°C</span></div>
              <div className="hw-reading"><span className="rk">AES engine</span><span className="rv on">ACTIVE</span></div>
            </div>
          </div>
          <div className={`hw-card ${scenarioFlags.currentSensorFault ? "faulty" : ""}`}>
            <div className="hw-card-head">
              <div className="icon-wrap"><GaugeIcon size={15} /></div>
              <div>
                <div className="hw-card-name">SCT-013</div>
                <div className="hw-card-sub">Non-invasive current clamp</div>
              </div>
            </div>
            <div className="hw-reading-list">
              {scenarioFlags.currentSensorFault ? (
                <>
                  <div className="hw-reading"><span className="rk">Current</span><span className="rv fault">FAULT — fallback {hardwareReadings.current.toFixed(2)} A</span></div>
                  <div className="hw-reading"><span className="rk">Sample rate</span><span className="rv fault">OFFLINE</span></div>
                </>
              ) : (
                <>
                  <div className="hw-reading"><span className="rk">Current</span><span className="rv">{hardwareReadings.current} A</span></div>
                  <div className="hw-reading"><span className="rk">Sample rate</span><span className="rv">4 Hz</span></div>
                </>
              )}
            </div>
          </div>
          <div className="hw-card">
            <div className="hw-card-head">
              <div className="icon-wrap"><Zap size={15} /></div>
              <div>
                <div className="hw-card-name">PZEM-004T</div>
                <div className="hw-card-sub">Voltage / power / energy meter</div>
              </div>
            </div>
            <div className="hw-reading-list">
              <div className="hw-reading"><span className="rk">Voltage</span><span className="rv">{hardwareReadings.voltage} V</span></div>
              <div className="hw-reading"><span className="rk">Power</span><span className="rv">{hardwareReadings.power} W</span></div>
              <div className="hw-reading"><span className="rk">Frequency</span><span className="rv">{hardwareReadings.freq} Hz</span></div>
              <div className="hw-reading"><span className="rk">Energy today</span><span className="rv">{energyTodayKWh.toFixed(2)} kWh</span></div>
            </div>
          </div>
          <div className={`hw-card ${scenarioFlags.tempSensorFault ? "faulty" : ""}`}>
            <div className="hw-card-head">
              <div className="icon-wrap"><Thermometer size={15} /></div>
              <div>
                <div className="hw-card-name">DHT22</div>
                <div className="hw-card-sub">Temperature / humidity</div>
              </div>
            </div>
            <div className="hw-reading-list">
              {scenarioFlags.tempSensorFault ? (
                <div className="hw-reading"><span className="rk">Temperature</span><span className="rv fault">FAULT — fallback {hardwareReadings.dhtTemp.toFixed(1)}°C</span></div>
              ) : (
                <div className="hw-reading"><span className="rk">Temperature</span><span className="rv">{hardwareReadings.dhtTemp}°C</span></div>
              )}
              <div className="hw-reading"><span className="rk">Humidity</span><span className="rv">{hardwareReadings.humidity}%</span></div>
            </div>
          </div>
          <div className="hw-card">
            <div className="hw-card-head">
              <div className="icon-wrap"><Radio size={15} /></div>
              <div>
                <div className="hw-card-name">PIR HC-SR501</div>
                <div className="hw-card-sub">Room occupancy motion sensor</div>
              </div>
            </div>
            <div className="hw-reading-list">
              <div className="hw-reading"><span className="rk">Motion</span><span className={`rv ${hardwareReadings.motion ? "on" : "off"}`}>{hardwareReadings.motion ? "DETECTED" : "CLEAR"}</span></div>
              <div className="hw-reading"><span className="rk">Occupancy input</span><span className="rv">{forecastInputs.occupancyPct}%</span></div>
            </div>
          </div>
          <div className="hw-card">
            <div className="hw-card-head">
              <div className="icon-wrap"><ToggleLeft size={15} /></div>
              <div>
                <div className="hw-card-name">Zero-crossing SSR</div>
                <div className="hw-card-sub">Solid-state relay bank</div>
              </div>
            </div>
            <div className="hw-reading-list">
              <div className="hw-reading"><span className="rk">State</span><span className={`rv ${anyRelaySwitchingNow ? "on" : "off"}`}>{anyRelaySwitchingNow ? "ON" : "OFF"}</span></div>
              <div className="hw-reading"><span className="rk">Switch count</span><span className="rv">{ssrSwitchCount}</span></div>
              <div className="hw-reading"><span className="rk">Switching mode</span><span className="rv">ZERO-CROSSING</span></div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 3: Interactive architecture diagram                     */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet arch-section">
        <div className="arch-header">
          <Repeat size={18} color="var(--cyan)" />
          <h2>System Architecture — data flow</h2>
        </div>
        <p className="arch-subtitle">
          Tap a stage to see what it does. The moving dots show the direction data and commands travel through the
          pipeline; they animate while the simulation is playing.
        </p>
        <div className="arch-flow">
          {archNodes.map((node, idx) => {
            const NodeIcon = node.icon;
            return (
              <React.Fragment key={node.id}>
                <div
                  className={`arch-node ${selectedNode === node.id ? "selected" : ""}`}
                  onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                >
                  <div className="icon-wrap"><NodeIcon size={17} /></div>
                  <div className="arch-node-label">{node.label}</div>
                </div>
                {idx < archNodes.length - 1 && (
                  <div className="arch-arrow flowing">
                    <div className="pulse" style={{ animationPlayState: isPlaying ? "running" : "paused", animationDelay: `${idx * 0.3}s` }} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        {selectedNode && (
          <div className="arch-detail-panel">
            <div className="dt-title">{archNodes.find((n) => n.id === selectedNode)?.label}</div>
            {archNodes.find((n) => n.id === selectedNode)?.desc}
          </div>
        )}
      </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Stage 3: Live decision log                                    */}
      {/* ------------------------------------------------------------ */}
      {showDetailed && (
      <div className="facet log-section">
        <div className="log-header">
          <div className="log-header-left">
            <ScrollText size={18} color="var(--cyan)" />
            <h2>Live Decision Log</h2>
          </div>
          <span className="badge sim">SIMULATED EVENT TRACE</span>
        </div>
        <p className="log-subtitle">
          A running trace of what the simulated pipeline is doing — forecasts, scheduler picks, relay switching, and
          manual overrides — newest first. All entries are generated by this in-browser simulation.
        </p>
        {decisionLog.length === 0 ? (
          <div className="log-empty">No events yet — press Start to run the simulation.</div>
        ) : (
          <ul className="log-list">
            {decisionLog.map((entry) => (
              <li key={entry.id} className={`log-entry kind-${entry.kind}`}>
                <span className="log-time mono">{entry.time}</span>
                <span className="log-text">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {showDetailed && (
        <div className="footer-note">
          Team Diamond · Smart India Hackathon 2026 · Predictive Smart Home Energy Management System (Stage 1 + Stage
          2 + Stage 3 simulation)
          <br />
          All figures shown — including the Edge Forecast Engine, hardware panel, and decision log — are simulated /
          illustrative values generated by this in-browser model, not measurements from physical hardware. The
          scheduler is a rule-based search, not a trained RL agent, and the forecast engine is a hand-written formula
          that mimics the shape of an LSTM predictor, not a trained neural network.
        </div>
      )}
      {showPresentation && (
        <div className="footer-note">Team Diamond · Smart India Hackathon 2026 · Diamond Gridwise AI</div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sub-components                                                         */
/* ---------------------------------------------------------------------- */

function StatCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="stat-card facet">
      <div className="stat-card-head">
        <Icon size={13} />
        {label}
      </div>
      <div className="stat-value mono" style={color ? { color } : undefined}>
        {value}
        <span className="stat-unit">{unit}</span>
      </div>
    </div>
  );
}

/* Stage 5: A lightweight house-shaped snapshot of live appliance state,
   solar generation, and grid/edge status — used by Presentation Mode. */
function SmartHomeVisual({ appliances, currentSlot, powerAt, solarKW, gridImportKW, edgeOffline }) {
  return (
    <div className="smart-home-visual">
      <div className="shv-roof">
        <Sun size={16} className={`shv-sun ${solarKW > 0.05 ? "on" : ""}`} />
        <span>Solar {solarKW.toFixed(2)} kW</span>
      </div>
      <div className="shv-house">
        <div className="shv-rooms">
          {appliances.map((ap) => {
            const Icon = ap.icon;
            const on = powerAt(ap, currentSlot, "ai") > 0;
            return (
              <div key={ap.id} className={`shv-room ${on ? "on" : ""}`}>
                <Icon size={18} />
                <span>{ap.name}</span>
              </div>
            );
          })}
        </div>
        <div className={`shv-grid-link ${edgeOffline ? "offline" : ""}`}>
          {edgeOffline ? <WifiOff size={14} /> : <Zap size={14} />}
          <span>{edgeOffline ? "GRID LINK — EDGE OFFLINE" : `Grid import ${gridImportKW.toFixed(2)} kW`}</span>
        </div>
      </div>
    </div>
  );
}

function ApplianceCard({ appliance, currentSlot, override, onOverride, powerAt, isUnavailable, degradedSafe }) {
  const Icon = appliance.icon;
  const scheduledOn = powerAt(appliance, currentSlot, "ai") > 0;
  const lockManualOn = degradedSafe && appliance.critical;

  let statusLabel = "OFF";
  let statusClass = "status-off";
  let cardClass = "";

  if (isUnavailable) {
    statusLabel = "UNAVAILABLE";
    statusClass = "status-forced-off";
    cardClass = "is-forced";
  } else if (override === "on") {
    statusLabel = "FORCED ON";
    statusClass = "status-forced-on";
    cardClass = "is-forced";
  } else if (override === "off") {
    statusLabel = "FORCED OFF";
    statusClass = "status-forced-off";
    cardClass = "is-forced";
  } else if (scheduledOn) {
    statusLabel = "ACTIVE";
    statusClass = "status-active";
    cardClass = "is-active";
  } else if (appliance.deferable) {
    statusLabel = "STANDBY";
    statusClass = "status-standby";
  } else {
    statusLabel = "OFF";
    statusClass = "status-off";
  }

  return (
    <div className={`appliance-card ${cardClass}`}>
      <div className="appliance-head">
        <div className="icon-wrap">
          <Icon size={16} />
        </div>
        <div>
          <div className="appliance-name">{appliance.name}</div>
          <div className="appliance-rating">
            {appliance.continuous ? `${appliance.ratingW}W · ~${Math.round(appliance.duty * 100)}% duty` : `${appliance.ratingW}W`}
          </div>
        </div>
      </div>
      <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
      <div className="override-group">
        <button
          className={`override-btn ${override === "auto" ? "auto-active" : ""}`}
          onClick={() => onOverride("auto")}
          disabled={isUnavailable}
        >
          AUTO
        </button>
        <button
          className={`override-btn ${override === "on" ? "on" : ""}`}
          onClick={() => onOverride("on")}
          disabled={isUnavailable || lockManualOn}
          title={lockManualOn ? "Force-ON locked while a sensor is faulty (degraded-safe mode)" : undefined}
        >
          ON
        </button>
        <button
          className={`override-btn ${override === "off" ? "off" : ""}`}
          onClick={() => onOverride("off")}
          disabled={isUnavailable}
        >
          OFF
        </button>
      </div>
      {isUnavailable && <div className="safe-tag unavailable">Marked unavailable — Scenario Lab</div>}
      {!isUnavailable && lockManualOn && <div className="safe-tag">Degraded-safe mode — manual ON locked</div>}
    </div>
  );
}

function RuleNumberField({ label, value, onChange, step, min, max }) {
  return (
    <div className="rule-field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function RuleSliderField({ label, icon: Icon, value, displayValue, onChange, min, max, step }) {
  return (
    <div className="rule-field">
      <label>
        {Icon ? <Icon size={11} /> : null}
        {label}
      </label>
      <div className="slider-with-value">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-value">{displayValue}</span>
      </div>
    </div>
  );
}

function SchedulerApplianceCard({ ap, rule, result, onRuleChange, isOpen, onToggle }) {
  const Icon = ap.icon;
  const { best, baselineCost, naiveStartSlotVirtual } = result;

  const baselineLabel = formatHourLabel(ap.naiveStartHour);
  const aiLabel = best ? formatTime(best.actualStartSlot) + (best.startSlot >= SLOTS ? " (+1d)" : "") : "No feasible slot";
  const deltaH = best ? (best.startSlot - naiveStartSlotVirtual) / 4 : null;
  const saving = best ? baselineCost - best.electricityCost : null;

  const explanation = buildExplanation(ap, rule, baselineCost, best, ap.naiveStartHour, naiveStartSlotVirtual);

  return (
    <div className="flex-card">
      <div className="flex-card-head">
        <div className="flex-card-title">
          <div className="icon-wrap">
            <Icon size={17} />
          </div>
          <div>
            <div className="name">{ap.name}</div>
            <div className="rating">{ap.ratingW}W · runtime {rule.runtimeHours}h</div>
          </div>
        </div>
        <div className="schedule-pills">
          <span className="schedule-pill baseline">Baseline {baselineLabel}</span>
          <span className="schedule-pill ai">AI {aiLabel}</span>
          {deltaH !== null && (
            <span className="schedule-pill">{deltaH >= 0 ? "+" : ""}{deltaH.toFixed(2)}h shift</span>
          )}
          {saving !== null && (
            <span className={`schedule-pill ${saving >= 0 ? "save" : "warn"}`}>
              {saving >= 0 ? `Saves ₹${saving.toFixed(2)}` : `+₹${Math.abs(saving).toFixed(2)} cost`}
            </span>
          )}
          {!best && <span className="schedule-pill warn">Infeasible rules</span>}
        </div>
      </div>

      <div className="rule-grid">
        <RuleNumberField
          label="EARLIEST START (h)"
          value={rule.earliestStart}
          step={0.25}
          min={0}
          max={30}
          onChange={(v) => onRuleChange("earliestStart", v)}
        />
        <RuleNumberField
          label="LATEST COMPLETION (h)"
          value={rule.latestCompletion}
          step={0.25}
          min={0}
          max={32}
          onChange={(v) => onRuleChange("latestCompletion", v)}
        />
        <RuleNumberField
          label="RUNTIME (h)"
          value={rule.runtimeHours}
          step={0.25}
          min={0.25}
          max={8}
          onChange={(v) => onRuleChange("runtimeHours", v)}
        />
        <RuleSliderField
          label="PRIORITY"
          icon={Star}
          value={rule.priority}
          displayValue={rule.priority}
          min={1}
          max={5}
          step={1}
          onChange={(v) => onRuleChange("priority", v)}
        />
        <RuleSliderField
          label="FLEXIBILITY"
          value={rule.flexibility}
          displayValue={`${Math.round(rule.flexibility * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onRuleChange("flexibility", v)}
        />
        <RuleSliderField
          label="COMFORT IMPACT"
          icon={Smile}
          value={rule.comfortImpact}
          displayValue={`${Math.round(rule.comfortImpact * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onRuleChange("comfortImpact", v)}
        />
      </div>

      <button className="explain-toggle" onClick={onToggle}>
        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Why did AI do this?
      </button>

      {isOpen && (
        <div className="explain-box">
          <div className="explain-text">{explanation}</div>
          {best ? (
            <table className="score-table">
              <thead>
                <tr>
                  <th>Score component</th>
                  <th>Value (₹-equivalent)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="metric-name">Electricity cost</td>
                  <td>₹{best.electricityCost.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="metric-name">Peak-demand penalty</td>
                  <td>₹{best.peakPenalty.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="metric-name">Comfort penalty</td>
                  <td>₹{best.comfortPenalty.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="metric-name">Deadline penalty</td>
                  <td>₹{best.deadlinePenalty.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="metric-name">Carbon penalty</td>
                  <td>₹{best.carbonPenalty.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="metric-name">Solar bonus</td>
                  <td>−₹{best.solarBonus.toFixed(2)}</td>
                </tr>
                <tr className="total">
                  <td className="metric-name">Total score (lower is better)</td>
                  <td>₹{best.score.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="explain-text" style={{ color: "var(--red)" }}>
              <AlarmClock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
              Latest completion is before earliest start + runtime — widen the window or shorten the runtime.
            </div>
          )}
        </div>
      )}
    </div>
  );
