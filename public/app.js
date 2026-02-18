import { fal } from "https://esm.sh/@fal-ai/client@1?bundle";

// ── Preset definitions ───────────────────────────────────────────────────────

const PRESETS = {
  studio:       "premium product render, modern industrial design object, clean lighting, realistic material",
  toy:          "cute collectible designer toy, smooth plastic body, playful proportions",
  ceramic:      "handcrafted ceramic object, matte glaze, subtle imperfections, gallery product shot",
  plush:        "soft plush fabric object, stitched seams, cozy toy aesthetic",
  wood:         "carved wooden object, natural wood grain texture, warm studio lighting, realistic product shot",
  metal:        "brushed metal object, high-end industrial product, clean reflections",
  stone:        "carved stone object, smooth sculpture, soft shadows, museum lighting",
  anime:        "anime-inspired stylized object, clean cel shading, bold shape language, playful cartoon look",
  neon:         "neon glow, dark background, vibrant cyan and magenta lines, cyberpunk",
  glass:        "translucent borosilicate glass, caustics, elegant minimal form",
  ink:          "Japanese ink wash painting, sumi-e, expressive brush strokes, minimal",
};

// Important: fal.realtime.connect adds the realtime path internally.
// Use the base app id here (without trailing /realtime).
const FAL_APP = "fal-ai/flux-2/klein";

// ── State ────────────────────────────────────────────────────────────────────

let activePreset      = "studio";
let connection        = null;
let sendDebounceTimer = null;
let hasDrawn          = false;
let viewMode          = "split";
let generationTimeout = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const canvas      = document.getElementById("draw-canvas");
const ctx         = canvas.getContext("2d");
const clearBtn    = document.getElementById("clear-btn");
const barClearBtn = document.getElementById("bar-clear-btn");
const outputImg   = document.getElementById("output-img");
const mergeOutputImg = document.getElementById("merge-output-img");
const placeholder = document.getElementById("output-placeholder");
const indicator   = document.getElementById("processing-indicator");
const presetBtns  = document.querySelectorAll(".preset");
const statusEl    = document.getElementById("status");
const workspaceEl = document.getElementById("workspace");
const modeSplitBtn = document.getElementById("mode-split-btn");
const modeMergeBtn = document.getElementById("mode-merge-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function resizeCanvas() {
  const pane = document.getElementById("draw-pane");
  const rect = pane.getBoundingClientRect();
  canvas.width  = Math.floor(rect.width);
  canvas.height = Math.floor(rect.height);
  applyCanvasDefaults();
}

function applyCanvasDefaults() {
  const { canvasBg, stroke } = getThemePalette();
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = 3;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
}

// ── Drawing ───────────────────────────────────────────────────────────────────

let isDrawing = false;
let lastX = 0;
let lastY = 0;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches) {
    return {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top,
    };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDraw(e) {
  isDrawing = true;
  if (viewMode === "merge") {
    workspaceEl.classList.add("show-sketch");
  }
  const { x, y } = getPos(e);
  lastX = x;
  lastY = y;
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function draw(e) {
  if (!isDrawing) return;
  e.preventDefault();
  const { x, y } = getPos(e);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  lastX = x;
  lastY = y;
  hasDrawn = true;
  scheduleSend();
}

function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;
  scheduleSend();
}

canvas.addEventListener("mousedown",  startDraw);
canvas.addEventListener("mousemove",  draw);
canvas.addEventListener("mouseup",    endDraw);
canvas.addEventListener("mouseleave", endDraw);
canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove",  draw,      { passive: false });
canvas.addEventListener("touchend",   endDraw);

// ── Clear ─────────────────────────────────────────────────────────────────────

function clearScene() {
  ctx.fillStyle = getThemePalette().canvasBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  applyCanvasDefaults();
  hasDrawn = false;
  outputImg.classList.remove("visible");
  mergeOutputImg.classList.remove("visible");
  outputImg.removeAttribute("src");
  mergeOutputImg.removeAttribute("src");
  placeholder.classList.remove("hidden");
  indicator.classList.remove("active");
  workspaceEl.classList.remove("show-sketch");
  setStatus("draw something");
}

clearBtn.addEventListener("click", clearScene);
barClearBtn.addEventListener("click", clearScene);

// ── Preset switching ──────────────────────────────────────────────────────────

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    presetBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activePreset = btn.dataset.preset;
    if (hasDrawn) scheduleSend(0);
  });
});

function setViewMode(nextMode) {
  viewMode = nextMode;
  workspaceEl.classList.toggle("merge-mode", viewMode === "merge");
  workspaceEl.classList.toggle("show-sketch", false);
  modeSplitBtn.classList.toggle("active", viewMode === "split");
  modeMergeBtn.classList.toggle("active", viewMode === "merge");
}

modeSplitBtn.addEventListener("click", () => setViewMode("split"));
modeMergeBtn.addEventListener("click", () => setViewMode("merge"));
themeToggleBtn.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("light-theme") ? "dark" : "light";
  applyTheme(nextTheme);
});

function initFalRealtime() {
  setStatus("listening...");
  connection = fal.realtime.connect(FAL_APP, {
    connectionKey: "klein-realtime",
    throttleInterval: 64,
    tokenProvider: async (app) => {
      const response = await fetch("/api/fal/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app }),
      });
      if (!response.ok) {
        throw new Error(`Token request failed (${response.status})`);
      }
      return response.text();
    },
    tokenExpirationSeconds: 110,
    onResult: (result) => {
      clearGeneratingState();

      // Some realtime responses can be non-image messages or error payloads.
      if (result?.error || result?.status === "error") {
        console.warn("[fal realtime result]", result);
        setStatus("listening...");
        return;
      }

      const images = result?.images;
      if (!images?.length) {
        setStatus("listening...");
        return;
      }
      const img = images[images.length - 1];
      if (!img?.content) {
        setStatus("listening...");
        return;
      }
      const normalizedSrc = toImageSrc(img);
      if (!normalizedSrc) {
        setStatus("listening...");
        return;
      }
      outputImg.src = normalizedSrc;
      mergeOutputImg.src = normalizedSrc;
      outputImg.classList.add("visible");
      mergeOutputImg.classList.add("visible");
      placeholder.classList.add("hidden");
      if (viewMode === "merge") {
        workspaceEl.classList.remove("show-sketch");
      }
      setStatus("ready");
    },
    onError: (error) => {
      console.error("[fal realtime]", error);
      clearGeneratingState();
      setStatus("connection error");
    },
  });
}

function toImageSrc(img) {
  const mime = img.content_type ?? "image/jpeg";
  const content = img.content;

  // Most responses provide base64 content.
  if (typeof content === "string") {
    if (content.startsWith("data:image/")) return content;
    return `data:${mime};base64,${content}`;
  }

  // Some runtimes may surface raw bytes (Uint8Array / ArrayBuffer).
  if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  console.error("[image] Unsupported content type:", typeof content, content);
  return null;
}

// ── Send ──────────────────────────────────────────────────────────────────────

function scheduleSend(delay = 128) {
  clearTimeout(sendDebounceTimer);
  sendDebounceTimer = setTimeout(sendToFal, delay);
}

async function sendToFal() {
  if (!hasDrawn) return;

  markGeneratingState();
  let dataUrl;
  try {
    dataUrl = captureCanvas();
  } catch (err) {
    console.error("[capture]", err);
    clearGeneratingState();
    return;
  }

  const payload = {
    image_url:                dataUrl,
    prompt:                   composePrompt(PRESETS[activePreset] ?? PRESETS.studio),
    image_size:               "square",
    num_inference_steps:      3,
    seed:                     35,
    output_feedback_strength: 1,
  };

  if (!connection) {
    initFalRealtime();
  }

  try {
    connection.send(payload);
  } catch (err) {
    console.error("[send]", err);
    clearGeneratingState();
    setStatus("send error");
  }
}

// ── Canvas capture ────────────────────────────────────────────────────────────

function captureCanvas() {
  const SIZE = 704;
  const tmp  = document.createElement("canvas");
  tmp.width  = SIZE;
  tmp.height = SIZE;
  const tc   = tmp.getContext("2d");

  tc.fillStyle = getThemePalette().canvasBg;
  tc.fillRect(0, 0, SIZE, SIZE);

  const scale = Math.min(SIZE / canvas.width, SIZE / canvas.height);
  const w  = canvas.width  * scale;
  const h  = canvas.height * scale;
  const dx = (SIZE - w) / 2;
  const dy = (SIZE - h) / 2;
  tc.drawImage(canvas, dx, dy, w, h);

  return tmp.toDataURL("image/jpeg", 0.5);
}

// ── Status display ────────────────────────────────────────────────────────────

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function composePrompt(stylePrompt) {
  const bgHint = document.body.classList.contains("light-theme")
    ? "Keep a pure white background unchanged."
    : "Keep a pure black background unchanged.";
  return `${stylePrompt}. ${bgHint} Transform only the sketched object in the center. No extra scene or environment. Preserve overall silhouette from the sketch.`;
}

function markGeneratingState() {
  indicator.classList.add("active");
  setStatus("generating...");
  clearTimeout(generationTimeout);
  generationTimeout = setTimeout(() => {
    // Guardrail: prevent stuck UI when backend sends no image event.
    clearGeneratingState();
    setStatus("listening...");
  }, 15000);
}

function clearGeneratingState() {
  indicator.classList.remove("active");
  clearTimeout(generationTimeout);
  generationTimeout = null;
}

function getThemePalette() {
  const light = document.body.classList.contains("light-theme");
  return {
    canvasBg: light ? "#f5f5f5" : "#111111",
    stroke: light ? "#111111" : "#ffffff",
  };
}

function applyTheme(theme) {
  document.body.classList.toggle("light-theme", theme === "light");
  localStorage.setItem("klein-theme", theme);
  themeToggleBtn.textContent = theme === "light" ? "Theme: Light" : "Theme: Dark";
  clearScene();
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
setStatus("draw something");
setViewMode("split");
applyTheme(localStorage.getItem("klein-theme") === "light" ? "light" : "dark");
initFalRealtime();
