/* Angle Meter PWA
   - Tilt from DeviceOrientation when available (beta/gamma)
   - Fallback to accelerationIncludingGravity (DeviceMotion)
   - Smoothed output with ~0.1 s time constant
*/

const $ = (id) => document.getElementById(id);

const angleEl = $("angle");
const statusEl = $("status");
const modeNameEl = $("modeName");
const sampleInfoEl = $("sampleInfo");

const btnMode = $("btnMode");
const btnZero = $("btnZero");
const btnFullscreen = $("btnFullscreen");

const MODES = [
  { key: "pitch", name: "Pitch (dopředu/dozadu)" }, // around X axis-ish
  { key: "roll",  name: "Roll (doleva/doprava)" }    // around Y axis-ish
];
let modeIndex = 0;

let hasOrientation = false;
let hasMotion = false;

let lastT = null;
let filt = 0;
let offset = 0;

// Smoothing: first-order low-pass with time constant tau
const TAU = 0.50; // seconds (~0,5 s)
let hzEstimate = 0;

// For display rounding
function fmtDeg(x){
  // whole degrees
  const v = Math.round(x);
  return `${v}°`;
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// Convert to degrees
function rad2deg(r){ return r * 180 / Math.PI; }

// Compute pitch/roll from accelerationIncludingGravity (m/s^2)
function tiltFromAccel(gx, gy, gz){
  // Common definitions:
  // roll  = atan2(gy, gz)
  // pitch = atan2(-gx, sqrt(gy^2 + gz^2))
  const roll = rad2deg(Math.atan2(gy, gz));
  const pitch = rad2deg(Math.atan2(-gx, Math.sqrt(gy*gy + gz*gz)));
  return { roll, pitch };
}

function setMode(i){
  modeIndex = (i + MODES.length) % MODES.length;
  modeNameEl.textContent = MODES[modeIndex].name;
}

function updateAngle(rawDeg, tMs){
  const t = tMs / 1000;
  if(lastT === null){
    lastT = t;
    filt = rawDeg;
    return;
  }
  const dt = Math.max(0, t - lastT);
  lastT = t;

  // Estimate sample rate for footer
  if(dt > 0){
    const hz = 1 / dt;
    // very light smoothing for Hz itself
    hzEstimate += 0.08 * (hz - hzEstimate);
  }

  const a = clamp(dt / TAU, 0, 1); // filter coefficient
  filt = filt + a * (rawDeg - filt);

  const shown = filt - offset;
  angleEl.textContent = fmtDeg(shown);
  sampleInfoEl.textContent = `Vzorkování ~ ${hzEstimate.toFixed(0)} Hz • Vyhlazení ~ ${TAU.toFixed(2).replace(".", ",")} s`;
}

function setStatus(msg){
  statusEl.textContent = msg;
}

async function requestSensorPermissionIfNeeded(){
  // iOS Safari requires explicit permission request
  try{
    if(typeof DeviceOrientationEvent !== "undefined" &&
       typeof DeviceOrientationEvent.requestPermission === "function"){
      const r = await DeviceOrientationEvent.requestPermission();
      if(r !== "granted") throw new Error("Permission not granted for DeviceOrientationEvent");
    }
  }catch(e){
    // We'll still try DeviceMotion permission in parallel
  }
  try{
    if(typeof DeviceMotionEvent !== "undefined" &&
       typeof DeviceMotionEvent.requestPermission === "function"){
      const r2 = await DeviceMotionEvent.requestPermission();
      if(r2 !== "granted") throw new Error("Permission not granted for DeviceMotionEvent");
    }
  }catch(e){
    // Ignore here; status will be set later if nothing works
  }
}

function attachOrientation(){
  if(typeof window.DeviceOrientationEvent === "undefined") return false;

  window.addEventListener("deviceorientation", (ev) => {
    // beta: front-to-back (-180..180), gamma: left-to-right (-90..90)
    if(ev.beta == null && ev.gamma == null) return;

    hasOrientation = true;

    const beta = ev.beta;   // pitch
    const gamma = ev.gamma; // roll

    const mode = MODES[modeIndex].key;
    const raw = (mode === "pitch") ? beta : gamma;

    // beta/gamma are already degrees; keep within reasonable range
    updateAngle(raw, ev.timeStamp || performance.now());
  }, { passive:true });

  return true;
}

function attachMotion(){
  if(typeof window.DeviceMotionEvent === "undefined") return false;

  window.addEventListener("devicemotion", (ev) => {
    const a = ev.accelerationIncludingGravity;
    if(!a || a.x == null || a.y == null || a.z == null) return;

    hasMotion = true;

    const { pitch, roll } = tiltFromAccel(a.x, a.y, a.z);
    const mode = MODES[modeIndex].key;
    const raw = (mode === "pitch") ? pitch : roll;

    updateAngle(raw, ev.timeStamp || performance.now());
  }, { passive:true });

  return true;
}

function updateAvailabilityStatus(){
  if(hasOrientation || hasMotion){
    setStatus("Měřím…");
  }else{
    setStatus("Senzory nejsou dostupné (nebo nejsou povolené).");
  }
}

async function startSensors(){
  setStatus("Žádám o přístup k senzorům…");
  await requestSensorPermissionIfNeeded();

  const ok1 = attachOrientation();
  const ok2 = attachMotion();

  if(!ok1 && !ok2){
    setStatus("Tento prohlížeč nepodporuje DeviceOrientation/DeviceMotion.");
    return;
  }

  // Give it a moment to receive first event
  setTimeout(updateAvailabilityStatus, 600);
}

btnMode.addEventListener("click", async () => {
  // First interaction is a good moment to ask for permissions (iOS)
  await startSensorsIfNotStarted();
  setMode(modeIndex + 1);
});

btnZero.addEventListener("click", async () => {
  await startSensorsIfNotStarted();
  offset = filt; // zero to current filtered value
  angleEl.textContent = fmtDeg(0);
  setStatus("Vynulováno.");
  setTimeout(updateAvailabilityStatus, 500);
});

btnFullscreen.addEventListener("click", async () => {
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen();
    }else{
      await document.exitFullscreen();
    }
  }catch(e){
    // ignore
  }
});

// Ensure sensors start on first user interaction (best practice for iOS)
let started = false;
async function startSensorsIfNotStarted(){
  if(started) return;
  started = true;
  await startSensors();
}

setMode(0);
angleEl.textContent = "--.-°";
setStatus("Klepni na tlačítko (Změnit osu / Vynulovat) pro povolení senzorů.");

// PWA install: register service worker
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}
