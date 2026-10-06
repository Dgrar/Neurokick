// Neurokick — visualización Canvas 2D de `libs/wasm-simulation/src/lib.rs`.
//
// Contrato Rust (libs/wasm-simulation/src/lib.rs):
//   Simulation::new() -> Simulation
//   Simulation::visualize() -> Data   (avanza 1 step y devuelve el estado)
//   Simulation::train()               (avanza 1 step sin devolver nada)
//   Simulation::apply_external_force(idx, fx, fy)
//   Simulation::field_half_width/height(), goal_half_height(), goal_depth()
//   Simulation::player_count(), Simulation::show_genome(idx) -> GenomeData
//   Data { players: Vec<Player { x, y }>, ball: Ball { x, y },
//          local_goals: u32, away_goals: u32 }
//   GenomeData { input_size: u32, layer_sizes: Vec<u32>, genome: Vec<f32> }
// Campo real: 106x69, porterías de 11x4 en x = ±53 (sensores en ±55).

// ---------------------------------------------------------------- constantes

// Dimensiones reales del sim (libs/simulation/src/game_world.rs):
// campo 106x69 (x en ±53, y en ±34.5), portería 11 de ancho y 4 de fondo.
// Se corrigen desde el wasm si expone los getters (ver readFieldDims).
const FIELD = {
    w: 106,          // largo (eje x, líneas de gol en x = ±53)
    h: 69,           // ancho (eje y, bandas en y = ±34.5)
    margin: 10,      // margen visible alrededor del campo (m)
    goalWidth: 11,   // 2 * GOAL_HALF_HEIGHT (5.5)
    goalDepth: 4,    // GOAL_DEPTH
};

// Radios de dibujo (m). Se toman del sim real (`player_radius()` /
// `ball_radius()` del wasm) cuando está disponible; si no, estos valores
// de reserva, que coinciden con las constantes de Rust.
const vis = {playerR: 0.4, ballR: 0.15};
const TRAIL_MAX = 140;

// ---------------------------------------------------------------- mock
// Imita la API wasm. Solo se usa si el wasm no carga (ver loadSimulation):
// física mínima de demo donde el jugador persigue el balón.

class MockSimulation {
    constructor() {
        this.px = -5; this.py = 0; this.pvx = 0; this.pvy = 0;
        this.bx = 0; this.by = 0; this.bvx = 2.5; this.bvy = 1.2;
        this.dt = 1 / 120;
        this.local_goals = 0; this.away_goals = 0;
    }
    train() {this.#step();}
    visualize() {
        this.#step();
        return {
            players: [{x: this.px, y: this.py}],
            ball: {x: this.bx, y: this.by},
            local_goals: this.local_goals,
            away_goals: this.away_goals,
        };
    }
    player_radius() {return vis.playerR;}
    ball_radius() {return vis.ballR;}
    field_half_width() {return FIELD.w / 2;}
    field_half_height() {return FIELD.h / 2;}
    goal_half_height() {return FIELD.goalWidth / 2;}
    goal_depth() {return FIELD.goalDepth;}
    local_goals_count() {return this.local_goals;}
    away_goals_count() {return this.away_goals;}
    player_count() {return 1;}
    // Genoma falso pero estable por idx (14 entradas, 12 ocultas, 3 salida).
    show_genome(idx) {
        const input_size = 14, layers = [12, 3];
        let seed = (idx + 1) * 0x9e3779b9;
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 * 2 - 1;
        const genome = [];
        let prev = input_size;
        for (const n of layers) {
            for (let k = 0; k < n; k++) {
                genome.push(rnd() * 0.5);
                for (let w = 0; w < prev; w++) genome.push(rnd());
            }
            prev = n;
        }
        return {input_size, layer_sizes: layers, genome};
    }
    #step() {
        // Jugador: fuerza proporcional hacia el balón + amortiguación.
        const fx = (this.bx - this.px) - this.pvx * 1.2;
        const fy = (this.by - this.py) - this.pvy * 1.2;
        this.pvx += fx * this.dt; this.pvy += fy * this.dt;
        const sp = Math.hypot(this.pvx, this.pvy);
        if (sp > 10) {this.pvx *= 10 / sp; this.pvy *= 10 / sp;}
        this.px += this.pvx * this.dt; this.py += this.pvy * this.dt;

        // Balón: rozamiento + rebote en límites (con hueco de portería) + colisión.
        this.bvx *= 0.9995; this.bvy *= 0.9995;
        this.bx += this.bvx * this.dt; this.by += this.bvy * this.dt;
        const hx = FIELD.w / 2, hy = FIELD.h / 2;
        const gh = FIELD.goalWidth / 2;
        const inMouth = Math.abs(this.by) < gh;
        // Gol: cruza la línea dentro del hueco.
        if (this.bx > hx && inMouth) { this.away_goals++; this.bx = 0; this.by = 0; this.bvx = -2.5; this.bvy = 1.2; }
        else if (this.bx < -hx && inMouth) { this.local_goals++; this.bx = 0; this.by = 0; this.bvx = 2.5; this.bvy = -1.2; }
        if (this.bx > hx) { this.bx = hx; this.bvx *= -0.6; }
        if (this.bx < -hx) { this.bx = -hx; this.bvx *= -0.6; }
        if (this.by > hy) { this.by = hy; this.bvy *= -0.6; }
        if (this.by < -hy) { this.by = -hy; this.bvy *= -0.6; }
        const dx = this.bx - this.px, dy = this.by - this.py;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d < vis.playerR + vis.ballR + 0.1) {
            const nx = dx / d, ny = dy / d;
            const push = (vis.playerR + vis.ballR + 0.1 - d);
            this.bx += nx * push; this.by += ny * push;
            const rel = (this.bvx - this.pvx) * nx + (this.bvy - this.pvy) * ny;
            if (rel < 0) {this.bvx -= 1.6 * rel * nx; this.bvy -= 1.6 * rel * ny;}
        }
    }
}

// ---------------------------------------------------------------- carga wasm

// Lee los radios físicos del sim (wasm o mock) para dibujar a escala real.
function readRadii(sim) {
    try {
        if (typeof sim.player_radius === "function") vis.playerR = sim.player_radius();
        if (typeof sim.ball_radius === "function") vis.ballR = sim.ball_radius();
    } catch { /* mock antiguo o pkg viejo: se usan los valores de reserva */}
}

// Sincroniza FIELD con las constantes reales de Rust si el wasm las expone.
function readFieldDims(sim) {
    try {
        if (typeof sim.field_half_width === "function") FIELD.w = sim.field_half_width() * 2;
        if (typeof sim.field_half_height === "function") FIELD.h = sim.field_half_height() * 2;
        if (typeof sim.goal_half_height === "function") FIELD.goalWidth = sim.goal_half_height() * 2;
        if (typeof sim.goal_depth === "function") FIELD.goalDepth = sim.goal_depth();
    } catch { /* pkg viejo sin getters: se quedan los valores por defecto */}
}

async function loadSimulation() {
    const diag = [];
    const mark = (ok, msg) => {diag.push((ok ? "OK  " : "FALLO ") + msg); console.log("[neurokick]", diag[diag.length - 1]);};
    try {
        const mod = await import("./pkg/wasm_simulation.js");
        mark(true, "pkg/wasm_simulation.js importado (exports: " + Object.keys(mod).join(", ") + ")");
        // El glue actual es síncrono (sin export default); la guarda cubre
        // variantes del glue que sí requieren init().
        if (typeof mod.default === "function") {await mod.default(); mark(true, "init() del wasm completado");}
        else mark(true, "sin init (glue síncrono)");
        if (typeof mod.Simulation !== "function") {mark(false, "mod.Simulation no es constructor"); throw new Error("sin Simulation");}
        const sim = new mod.Simulation();
        mark(true, "new Simulation() construido");
        // Sonda: la API real devuelve Data con players + ball.
        const probe = sim.visualize();
        const ok = probe && Array.isArray(probe.players) && probe.ball;
        if (ok) {
            mark(true, "visualize() -> " + probe.players.length + " jugador(es), balon (" +
                probe.ball.x.toFixed(2) + ", " + probe.ball.y.toFixed(2) + ")" +
                " marcador " + (probe.local_goals ?? 0) + "-" + (probe.away_goals ?? 0));
            if (typeof probe.free === "function") probe.free();
            readRadii(sim);
            readFieldDims(sim);
            mark(true, "radios: jugador=" + vis.playerR + " balon=" + vis.ballR);
            mark(true, "campo: " + FIELD.w + "x" + FIELD.h + " porteria: " + FIELD.goalWidth + "x" + FIELD.goalDepth);
            mark(true, "kick(): " + (typeof sim.kick === "function" ? "disponible" : "AUSENTE en el pkg"));
            window.__neurokickDiag = diag;
            return {sim, mode: "WASM REAL"};
        }
        mark(false, "visualize() no devolvió Data válido");
    } catch (err) {
        mark(false, "wasm no accesible: " + (err?.message ?? err));
    }
    window.__neurokickDiag = diag;
    const mock = new MockSimulation();
    readRadii(mock);
    readFieldDims(mock);
    return {sim: mock, mode: "MOCK (wasm no accesible)"};
}

// Normaliza Data (wasm o mock) a { players, ball, local_goals, away_goals }.
function snapshot(data) {
    const players = Array.from(data.players ?? [], (p) => ({x: p.x, y: p.y}));
    const ball = {x: data.ball.x, y: data.ball.y};
    const local_goals = Number(data.local_goals ?? 0);
    const away_goals = Number(data.away_goals ?? 0);
    try {
        for (const p of data.players ?? []) if (p && typeof p.free === "function") p.free();
        if (data.ball && typeof data.ball.free === "function") data.ball.free();
        if (typeof data.free === "function") data.free();
    } catch { /* los objetos mock no tienen free(); sin problema */}
    return {players, ball, local_goals, away_goals};
}

// ---------------------------------------------------------------- canvas

const canvas = document.getElementById("pitch");
const ctx = canvas.getContext("2d");
const wrap = canvas.parentElement;

let view = {w: 0, h: 0, scale: 10, dpr: 1};

function resize() {
    const rect = wrap.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(50, rect.width);
    view.h = Math.max(50, rect.height);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const sx = view.w / (FIELD.w + FIELD.margin * 2);
    const sy = view.h / (FIELD.h + FIELD.margin * 2);
    view.scale = Math.min(sx, sy);
}
new ResizeObserver(resize).observe(wrap);

// Mundo (x right, y up, centro 0,0) -> pantalla (y down).
const X = (x) => view.w / 2 + x * view.scale;
const Y = (y) => view.h / 2 - y * view.scale;
const R = (r) => r * view.scale;
// Radio de dibujo de cuerpos: tamaño real con mínimo en píxeles para que
// los cuerpos sigan viéndose en un campo de 105 m. Posiciones exactas.
// El balón se dibuja al 80% de su radio físico (más pequeño, misma posición).
const MIN_PX = 6;
const BALL_DRAW_SCALE = 0.8;
const RD = (r) => Math.max(R(r), MIN_PX);
const PR = () => RD(vis.playerR);
const BR = () => RD(vis.ballR * BALL_DRAW_SCALE);

// Aclara u oscurece un color hex ("#4f8cff", f > 1 aclara).
function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
}

function drawField() {
    const s = view.scale;
    ctx.save();
    ctx.scale(view.dpr, view.dpr);
    // Fondo exterior.
    ctx.fillStyle = "#0a1f14";
    ctx.fillRect(0, 0, view.w, view.h);

    const x0 = X(-FIELD.w / 2), y0 = Y(FIELD.h / 2);
    const fw = FIELD.w * s, fh = FIELD.h * s;

    // Césped a franjas verticales.
    const stripes = 11;
    for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 ? "#2a8f56" : "#2f9e5f";
        ctx.fillRect(x0 + (fw / stripes) * i, y0, fw / stripes + 1, fh);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(1.5, 0.12 * s);

    // Líneas exteriores con hueco de portería (el sim deja y en ±5.5 libre).
    const hx = FIELD.w / 2, hy = FIELD.h / 2, gh = FIELD.goalWidth / 2;
    ctx.beginPath();
    // Banda norte y sur completas.
    ctx.moveTo(X(-hx), Y(hy)); ctx.lineTo(X(hx), Y(hy));
    ctx.moveTo(X(-hx), Y(-hy)); ctx.lineTo(X(hx), Y(-hy));
    // Laterales partidos (dejan el hueco del gol).
    for (const gx of [-hx, hx]) {
        ctx.moveTo(X(gx), Y(hy)); ctx.lineTo(X(gx), Y(gh));
        ctx.moveTo(X(gx), Y(-gh)); ctx.lineTo(X(gx), Y(-hy));
    }
    ctx.stroke();
    // Medio campo.
    ctx.beginPath();
    ctx.moveTo(X(0), Y(FIELD.h / 2));
    ctx.lineTo(X(0), Y(-FIELD.h / 2));
    ctx.stroke();
    // Círculo central (9.15 m) + punto.
    ctx.beginPath();
    ctx.arc(X(0), Y(0), R(9.15), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(0), Y(0), Math.max(2, R(0.25)), 0, Math.PI * 2);
    ctx.fill();


    for (const side of [-1, 1]) {
        const gx = side * FIELD.w / 2;
        const dir = -side; // hacia dentro del campo
        const big = {d: 16.5, w: 40.32};
        const small = {d: 5.5, w: 18.32};
        for (const a of [big, small]) {
            const rx = side < 0 ? X(gx) : X(gx) - a.d * s;
            ctx.strokeRect(rx, Y(a.w / 2), a.d * s, a.w * s);
        }
        ctx.beginPath();
        ctx.arc(X(gx + dir * 11), Y(0), Math.max(2, R(0.25)), 0, Math.PI * 2);
        ctx.fill();
        // Portería real del sim: caja de goalDepth x goalWidth fuera de la línea.
        const gTop = Y(FIELD.goalWidth / 2);
        const gx0 = side < 0 ? X(gx) - FIELD.goalDepth * s : X(gx);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(gx0, gTop, FIELD.goalDepth * s, FIELD.goalWidth * s);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.strokeRect(gx0, gTop, FIELD.goalDepth * s, FIELD.goalWidth * s);
        // Postes.
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        for (const py of [-FIELD.goalWidth / 2, FIELD.goalWidth / 2]) {
            ctx.beginPath();
            ctx.arc(X(gx), Y(py), Math.max(2.5, R(0.3)), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
    }
    ctx.restore();
}

function drawTrail(trail) {
    if (trail.length < 2) return;
    ctx.save();
    ctx.scale(view.dpr, view.dpr);
    for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        ctx.strokeStyle = `rgba(255,255,255,${(a * 0.55).toFixed(3)})`;
        ctx.lineWidth = 1 + a * 2;
        ctx.beginPath();
        ctx.moveTo(X(trail[i - 1].x), Y(trail[i - 1].y));
        ctx.lineTo(X(trail[i].x), Y(trail[i].y));
        ctx.stroke();
    }
    ctx.restore();
}

function drawEntities(state, showCoords) {
    ctx.save();
    ctx.scale(view.dpr, view.dpr);
    // Balón con sombra.
    const br = BR();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(X(state.ball.x), Y(state.ball.y) + br * 0.55, br, br * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    const sheen = ctx.createRadialGradient(
        X(state.ball.x) - br * 0.35, Y(state.ball.y) - br * 0.35, br * 0.1,
        X(state.ball.x), Y(state.ball.y), br
    );
    sheen.addColorStop(0, "#ffffff");
    sheen.addColorStop(0.7, "#dfe6f2");
    sheen.addColorStop(1, "#9aa7bd");
    ctx.fillStyle = sheen;
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X(state.ball.x), Y(state.ball.y), br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Motes del balón.
    ctx.fillStyle = "#5b6472";
    for (let k = 0; k < 3; k++) {
        const a = k * (Math.PI * 2 / 3) + 0.5;
        ctx.beginPath();
        ctx.arc(X(state.ball.x) + Math.cos(a) * br * 0.45, Y(state.ball.y) + Math.sin(a) * br * 0.45, Math.max(1, br * 0.16), 0, Math.PI * 2);
        ctx.fill();
    }

    // Jugadores: cuerpo con degradado, anillo, morro direccional y dorsal.
    state.players.forEach((p, i) => {
        const color = i % 2 === 0 ? "#4f8cff" : "#ff5d5d";
        const dark = shade(color, 0.55);
        const light = shade(color, 1.35);
        const pr = PR();
        const cx = X(p.x), cy = Y(p.y);
        const h = app.headings[i] ?? 0;
        const hx = Math.cos(h), hy = -Math.sin(h); // rumbo en pantalla
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + pr * 0.55, pr, pr * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        const g = ctx.createRadialGradient(cx - pr * 0.35, cy - pr * 0.35, pr * 0.15, cx, cy, pr);
        g.addColorStop(0, light);
        g.addColorStop(0.55, color);
        g.addColorStop(1, dark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = dark;
        ctx.lineWidth = Math.max(2, pr * 0.12);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, pr * 0.78, 0, Math.PI * 2);
        ctx.stroke();
        // Morro direccional.
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(cx + hx * pr * 1.02, cy + hy * pr * 1.02);
        ctx.lineTo(cx + (hx * 0.45 - hy * 0.32) * pr, cy + (hy * 0.45 + hx * 0.32) * pr);
        ctx.lineTo(cx + (hx * 0.45 + hy * 0.32) * pr, cy + (hy * 0.45 - hx * 0.32) * pr);
        ctx.closePath();
        ctx.fill();
        // Dorsal con contorno.
        ctx.font = `700 ${Math.max(11, pr * 0.85)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = dark;
        ctx.strokeText(String(i), cx - hx * pr * 0.15, cy - hy * pr * 0.15);
        ctx.fillStyle = "#fff";
        ctx.fillText(String(i), cx - hx * pr * 0.15, cy - hy * pr * 0.15);
        // Anillo de foco.
        if (i === app.focus) {
            ctx.strokeStyle = "#ffd54d";
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.arc(cx, cy, pr + 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (showCoords) {
            ctx.font = "11px ui-monospace, monospace";
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.fillText(`(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`, cx, cy - pr - 10);
        }
    });
    if (showCoords) {
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.textAlign = "center";
        ctx.fillText(
            `balón (${state.ball.x.toFixed(1)}, ${state.ball.y.toFixed(1)})`,
            X(state.ball.x), Y(state.ball.y) - R(vis.ballR) - 10
        );
    }
    ctx.restore();
}

// ---------------------------------------------------------------- app

const ui = {
    badge: document.getElementById("modeBadge"),
    err: document.getElementById("loadError"),
    play: document.getElementById("btnPlay"),
    step: document.getElementById("btnStep"),
    reset: document.getElementById("btnReset"),
    speed: document.getElementById("speed"),
    speedVal: document.getElementById("speedVal"),
    trails: document.getElementById("chkTrails"),
    coords: document.getElementById("chkCoords"),
    frame: document.getElementById("stFrame"),
    fps: document.getElementById("stFps"),
    mode: document.getElementById("stMode"),
    nplayers: document.getElementById("stPlayers"),
    score: document.getElementById("stScore"),
    scoreLocal: document.getElementById("scoreLocal"),
    scoreAway: document.getElementById("scoreAway"),
    goalFlash: document.getElementById("goalFlash"),
    pos: document.getElementById("stPos"),
    focusRow: document.getElementById("focusRow"),
    genome: document.getElementById("genome"),
    genomeInfo: document.getElementById("genomeInfo"),
    genomeTitle: document.getElementById("genomeTitle"),
};

const app = {
    sim: null,
    mode: "…",
    running: true,
    frame: 0,
    stepsPerFrame: 2,
    state: {players: [], ball: {x: 0, y: 0}, local_goals: 0, away_goals: 0},
    trail: [],
    fpsEMA: 60,
    lastT: performance.now(),
    headings: [], // rumbo por jugador (radianes, derivado del movimiento)
    prevPlayers: [],
    lastScore: "0-0",
    flashUntil: 0,
    focus: 0,          // índice del jugador enfocado (clic o botones)
    genomeCache: new Map(), // idx -> {input_size, layer_sizes, layers}
};

function setBadge() {
    const mock = app.mode.startsWith("MOCK");
    ui.badge.textContent = mock ? "● MOCK · sin wasm" : "● WASM REAL";
    ui.badge.className = "badge " + (mock ? "badge-mock" : "badge-wasm");
    ui.mode.textContent = app.mode;
}

// (control por teclado eliminado: solo botones y red neuronal)


// Orientación de cada jugador derivada del movimiento (el wasm no la expone).
function trackHeadings() {
    const prev = app.prevPlayers;
    app.state.players.forEach((p, i) => {
        const q = prev[i];
        if (q) {
            const dx = p.x - q.x, dy = p.y - q.y;
            if (dx * dx + dy * dy > 1e-8) app.headings[i] = Math.atan2(dy, dx);
        } else if (app.headings[i] === undefined) app.headings[i] = 0;
    });
    app.prevPlayers = app.state.players.map((p) => ({x: p.x, y: p.y}));
}

// ---------------------------------------------------------------- foco + genoma

function setFocus(i) {
    const n = app.state.players.length || 1;
    app.focus = Math.max(0, Math.min(n - 1, i | 0));
    syncFocusButtons();
    drawGenome();
}

function syncFocusButtons() {
    if (!ui.focusRow) return;
    const n = app.state.players.length;
    if (ui.focusRow.childElementCount !== n) buildFocusButtons();
    for (const btn of ui.focusRow.children) {
        btn.classList.toggle("active", Number(btn.dataset.idx) === app.focus);
    }
    if (ui.genomeTitle) ui.genomeTitle.textContent = "jugador " + app.focus;
}

function buildFocusButtons() {
    ui.focusRow.innerHTML = "";
    app.state.players.forEach((_, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn" + (i === app.focus ? " active" : "");
        b.dataset.idx = String(i);
        b.textContent = "Jugador " + i;
        b.addEventListener("click", () => setFocus(i));
        ui.focusRow.appendChild(b);
    });
}

// Llama al show_genome() de Rust (o del mock) y lo decodifica a capas.
// Cachea por jugador: los pesos no cambian durante el partido.
function fetchGenome(idx) {
    if (app.genomeCache.has(idx)) return app.genomeCache.get(idx);
    let raw = null;
    try {
        if (typeof app.sim.show_genome === "function") raw = app.sim.show_genome(idx);
    } catch (err) {
        console.warn("[neurokick] show_genome() falló:", err);
        return null;
    }
    if (!raw) return null;
    const input_size = Number(raw.input_size ?? 0);
    const layer_sizes = Array.from(raw.layer_sizes ?? [], Number);
    const flat = Array.from(raw.genome ?? []);
    try { if (typeof raw.free === "function") raw.free(); } catch {}
    if (!input_size || !layer_sizes.length || !flat.length) return null;
    // Decodifica [bias, w0..] por neurona y capa.
    const layers = [];
    let c = 0, prev = input_size;
    for (const n of layer_sizes) {
        const biases = [], weights = [];
        for (let k = 0; k < n; k++) {
            biases.push(flat[c++]);
            weights.push(flat.slice(c, c + prev));
            c += prev;
        }
        layers.push({biases, weights});
        prev = n;
    }
    const decoded = {input_size, layer_sizes, layers};
    app.genomeCache.set(idx, decoded);
    return decoded;
}

function drawGenome() {
    const cv = ui.genome;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth || 280, H = 260;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext("2d");
    g.save();
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const data = fetchGenome(app.focus);
    if (!data) {
        g.fillStyle = "#93a1c0";
        g.font = "12px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText("sin genoma (¿pkg viejo? recompila el wasm)", W / 2, H / 2);
        g.restore();
        return;
    }
    const cols = [data.input_size, ...data.layer_sizes];
    const names = ["E", "O", "S"];
    const maxW = Math.max(1e-6, ...data.layers.flatMap((l) => l.weights.flat().map(Math.abs)));
    const padX = 34, padY = 22;
    const xs = (i) => padX + (W - padX * 2) * (i / (cols.length - 1));
    const ys = (j, n) => (n === 1 ? H / 2 : padY + (H - padY * 2) * (j / (n - 1)));
    // Aristas (solo capas con pesos conocidos).
    data.layers.forEach((layer, li) => {
        const prevN = cols[li], curN = cols[li + 1];
        layer.weights.forEach((ws, k) => {
            ws.forEach((w, j) => {
                const m = Math.min(1, Math.abs(w) / maxW);
                g.strokeStyle = w >= 0
                    ? `rgba(46,204,113,${(0.06 + m * 0.85).toFixed(3)})`
                    : `rgba(255,93,93,${(0.06 + m * 0.85).toFixed(3)})`;
                g.lineWidth = 0.4 + m * 2;
                g.beginPath();
                g.moveTo(xs(li), ys(j, prevN));
                g.lineTo(xs(li + 1), ys(k, curN));
                g.stroke();
            });
        });
    });
    // Nodos: entrada + cada capa. El brillo del borde refleja |bias|.
    const outNames = ["Fx", "Fy", "Kick"];
    cols.forEach((n, ci) => {
        for (let k = 0; k < n; k++) {
            const cx = xs(ci), cy = ys(k, n);
            let bias = 0, isOut = ci === cols.length - 1;
            if (ci > 0) bias = data.layers[ci - 1].biases[k] ?? 0;
            const r = isOut ? 9 : n > 12 ? 3.5 : 5.5;
            g.fillStyle = ci === 0 ? "#22314f" : ci === cols.length - 1 ? "#3a2f10" : "#16233d";
            g.beginPath();
            g.arc(cx, cy, r, 0, Math.PI * 2);
            g.fill();
            const bb = Math.min(1, Math.abs(bias));
            g.strokeStyle = ci === 0 ? "#4f8cff" : `rgba(255,213,77,${(0.3 + bb * 0.7).toFixed(3)})`;
            g.lineWidth = ci === 0 ? 1.2 : 1 + bb * 1.6;
            g.stroke();
            if (isOut) {
                g.fillStyle = "#e8eefc";
                g.font = "700 8px system-ui, sans-serif";
                g.textAlign = "center";
                g.fillText(outNames[k] ?? ("o" + k), cx, cy - r - 5);
                g.fillStyle = "#93a1c0";
                g.font = "7.5px ui-monospace, monospace";
                g.fillText((bias >= 0 ? "+" : "") + bias.toFixed(2), cx, cy + r + 9);
            }
        }
        g.fillStyle = "#93a1c0";
        g.font = "10px system-ui, sans-serif";
        g.textAlign = "center";
        g.fillText(names[Math.min(ci, 2)] + "·" + n, xs(ci), H - 5);
    });
    g.restore();
    if (ui.genomeInfo) {
        const arch = cols.join("→");
        ui.genomeInfo.textContent =
            `jugador ${app.focus} · ${arch} · |w|max ${maxW.toFixed(3)}` +
            `\nO (ReLU×12) → S (Fx/Fy tanh, Kick sigmoid)` +
            `\nbias S: ` + data.layers.at(-1).biases.map((b) => b.toFixed(3)).join(", ");
    }
}

function advance(steps) {
    for (let i = 0; i < steps; i++) {
        try {
            app.state = snapshot(app.sim.visualize());
            trackHeadings();
        } catch (err) {
            console.error("[neurokick] visualize() falló:", err);
            ui.err.hidden = false;
            ui.err.textContent = "Error en visualize(): " + (err?.message ?? err) + ". Revisa la consola.";
            setRunning(false);
            return;
        }
        app.frame++;
    }
    app.trail.push({...app.state.ball});
    if (app.trail.length > TRAIL_MAX) app.trail.splice(0, app.trail.length - TRAIL_MAX);
}

function setRunning(v) {
    app.running = v;
    ui.play.textContent = v ? "⏸ Pausar" : "▶ Reanudar";
    ui.step.disabled = v;
}

function updateScoreboard() {
    const l = app.state.local_goals ?? 0, a = app.state.away_goals ?? 0;
    const key = l + "-" + a;
    ui.scoreLocal.textContent = String(l);
    ui.scoreAway.textContent = String(a);
    ui.score.textContent = l + " – " + a;
    if (key !== app.lastScore) {
        app.lastScore = key;
        app.flashUntil = performance.now() + 2000;
        app.trail = []; // la jugada se corta con el gol
    }
    ui.goalFlash.hidden = performance.now() > app.flashUntil;
}

function reset() {
    loadSimulation().then(({sim, mode}) => {
        app.sim = sim;
        app.mode = mode;
        app.frame = 0;
        app.trail = [];
        app.headings = [];
        app.prevPlayers = [];
        app.lastScore = "0-0";
        app.flashUntil = 0;
        app.focus = 0;
        app.genomeCache.clear();
        setBadge();
        advance(1);
        syncFocusButtons();
        updateScoreboard();
        drawGenome();
    });
}

let hudLast = 0;
function loop(now) {
    const dt = now - app.lastT;
    app.lastT = now;
    if (dt > 0) app.fpsEMA += (1000 / dt - app.fpsEMA) * 0.06;

    if (app.running) advance(app.stepsPerFrame);

    drawField();
    if (ui.trails.checked) drawTrail(app.trail);
    drawEntities(app.state, ui.coords.checked);
    updateScoreboard();
    syncFocusButtons();

    if (now - hudLast > 250) {
        hudLast = now;
        ui.frame.textContent = String(app.frame);
        ui.fps.textContent = app.fpsEMA.toFixed(0);
        ui.nplayers.textContent = String(app.state.players.length);
        const lines = app.state.players.map((p, i) => `jugador ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        lines.push(`balón: (${app.state.ball.x.toFixed(2)}, ${app.state.ball.y.toFixed(2)})`);
        ui.pos.textContent = lines.join("\n");
    }
    requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- eventos

// Clic en el campo: enfoca al jugador más cercano al clic.
canvas.addEventListener("click", (ev) => {
    if (!app.state.players.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (ev.clientX - rect.left - view.w / 2) / view.scale;
    const my = -(ev.clientY - rect.top - view.h / 2) / view.scale;
    let best = 0, bestD = Infinity;
    app.state.players.forEach((p, i) => {
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    });
    if (Math.sqrt(bestD) < 6) setFocus(best);
});

ui.play.addEventListener("click", () => setRunning(!app.running));
ui.step.addEventListener("click", () => {if (!app.running) advance(1);});
ui.reset.addEventListener("click", reset);
ui.speed.addEventListener("input", () => {
    app.stepsPerFrame = Number(ui.speed.value);
    ui.speedVal.textContent = ui.speed.value;
});
window.addEventListener("resize", () => drawGenome());
// Sin control por teclado: toda la interacción es con los botones.

// ---------------------------------------------------------------- init

resize();
setRunning(true);
loadSimulation().then(({sim, mode}) => {
    app.sim = sim;
    app.mode = mode;
    setBadge();
    if (mode.startsWith("MOCK")) {
        ui.err.hidden = false;
        const isFile = location.protocol === "file:";
        ui.err.textContent =
            (isFile
                ? "Estás abriendo el HTML directamente (file://): así no cargan los módulos ni el .wasm. Ejecuta `npm run dev` en www/ y abre http://localhost:5173. "
                : "Modo MOCK: no se pudo cargar www/pkg. Regenera con: wasm-pack build libs/wasm-simulation --target web --out-dir ../../www/pkg --out-name wasm_simulation. ") +
            "Diagnóstico: " + (window.__neurokickDiag || []).join(" | ");
    }
    advance(1);
    syncFocusButtons();
    drawGenome();
    requestAnimationFrame(loop);
});


window.__neurokick = app;
