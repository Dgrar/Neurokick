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
        return this.show_positions();
    }
    show_positions() {
        return {
            players: [{x: this.px, y: this.py}],
            ball: {x: this.bx, y: this.by},
            local_goals: this.local_goals,
            away_goals: this.away_goals,
        };
    }
    get_fitness() {return 0;}
    from_genome(idx, genome) {this._genomes = this._genomes || new Map(); this._genomes.set(idx, Array.from(genome ?? []));}
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
        if (this.bx > hx && inMouth) {this.away_goals++; this.bx = 0; this.by = 0; this.bvx = -2.5; this.bvy = 1.2;}
        else if (this.bx < -hx && inMouth) {this.local_goals++; this.bx = 0; this.by = 0; this.bvx = 2.5; this.bvy = -1.2;}
        if (this.bx > hx) {this.bx = hx; this.bvx *= -0.6;}
        if (this.bx < -hx) {this.bx = -hx; this.bvx *= -0.6;}
        if (this.by > hy) {this.by = hy; this.bvy *= -0.6;}
        if (this.by < -hy) {this.by = -hy; this.bvy *= -0.6;}
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

// Módulo wasm ya importado, para poder crear partidas nuevas sin reimportar.
let wasmModule = null;

// Crea una Simulation nueva (partido en blanco: posiciones, balón, marcador y
// fitness a cero). Se usa al reiniciar con nuevos cerebros.
function createFreshSim() {
    if (wasmModule && typeof wasmModule.Simulation === "function") {
        return {sim: new wasmModule.Simulation(), mode: "WASM REAL"};
    }
    return {sim: new MockSimulation(), mode: app.mode || "MOCK"};
}

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
        wasmModule = mod;
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
            // Se liberan también los wrappers de players/ball: son punteros
            // del externref table y quedarían zombis.
            try {
                for (const p of probe.players ?? []) if (p && typeof p.free === "function") p.free();
                if (probe.ball && typeof probe.ball.free === "function") probe.ball.free();
            } catch { }
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
//
// IMPORTANTE: los getters del glue se llaman UNA sola vez y se guardan en
// variables. `Data.players` es `getter_with_clone`: cada acceso crea wrappers
// JS NUEVOS sobre los punteros del externref table. Si se lee dos veces, la
// segunda tanda de wrappers queda huérfana (nunca se libera) y sus punteros
// se reciclan: el siguiente snapshot lee posiciones corruptas y el dibujo se
// va al vacío. `Data.ball` también se mueve fuera del struct, por lo que un
// segundo acceso devolvería un puntero ya liberado.
function snapshot(data) {
    let rawPlayers = [];
    let rawBall = null;
    try {
        rawPlayers = data.players ?? [];
        rawBall = data.ball;
    } catch { /* mock antiguo: se construye a mano */}

    const players = Array.from(rawPlayers ?? [], (p) => ({x: p.x, y: p.y}));
    const ball = {x: rawBall ? rawBall.x : 0, y: rawBall ? rawBall.y : 0};
    const local_goals = Number(data.local_goals ?? 0);
    const away_goals = Number(data.away_goals ?? 0);
    try {
        for (const p of rawPlayers ?? []) if (p && typeof p.free === "function") p.free();
        if (rawBall && typeof rawBall.free === "function") rawBall.free();
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
    // Asignar canvas.width borra el bitmap SIEMPRE, aunque el valor sea el
    // mismo (así lo define el estándar). El ResizeObserver llama a esta función
    // en cada cambio de layout, y un borrado sin repintado es un frame negro.
    // Solo se reasigna cuando el tamaño cambia de verdad.
    const cw = Math.round(view.w * view.dpr);
    const ch = Math.round(view.h * view.dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
    }
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
    btnTrain: document.getElementById("btnTrain"),
    trainStatus: document.getElementById("trainStatus"),
    stGen: document.getElementById("stGen"),
    stBgFit: document.getElementById("stBgFit"),
    evoChart: document.getElementById("evoChart"),
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
    loopErrorLogged: false,  // solo se avisa una vez del error de render
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
    try {if (typeof raw.free === "function") raw.free();} catch { }
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
    try {
        renderFrame(now);
    } catch (err) {
        // Una excepción dentro del bucle MATARÍA el render para siempre: el
        // requestAnimationFrame final no se alcanzaría y el canvas se quedaría
        // congelado (el "campo desaparece"). Se aísla el fallo y se reporta.
        if (!app.loopErrorLogged) {
            app.loopErrorLogged = true;
            console.error("[neurokick] error en el bucle de render:", err);
            if (ui.err) {
                ui.err.hidden = false;
                ui.err.textContent = "Error de render (ver consola): " + (err?.message ?? err);
            }
        }
    } finally {
        // El siguiente fotograma se pide SIEMPRE, incluso si algo falló.
        requestAnimationFrame(loop);
    }
}

function renderFrame(now) {
    const dt = now - app.lastT;
    app.lastT = now;
    if (dt > 0) app.fpsEMA += (1000 / dt - app.fpsEMA) * 0.06;

    // El escaparate es la sim local: siempre avanza aquí, a velocidad humana.
    // El fondo corre por su cuenta en el worker (no se esperan entre sí).
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
        if (ui.stGen) ui.stGen.textContent = String(bg.generation);
        if (ui.stBgFit) {
            const h = bg.history[bg.history.length - 1];
            ui.stBgFit.textContent = h
                ? `mejor ${h.best.toFixed(1)} · media ${h.avg.toFixed(1)}`
                : "—";
        }
        // Se redibuja en cada refresco del HUD: la gráfica muestra el
        // progreso mientras la generación en curso avanza, no solo al cerrarse.
        drawEvolution();
    }
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
        if (d < bestD) {bestD = d; best = i;}
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
window.addEventListener("resize", () => {drawGenome(); drawEvolution();});
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


// ---------------------------------------------------------------- fondo
// Trastienda: BG_WORKER_COUNT workers con su propia Simulation corriendo
// train() a máxima velocidad, todos a la vez. Cada generación dura 6000 pasos
// (ver GEN_STEPS en sim-worker.js). Al cumplirse, cada worker se congela y
// entrega su veredicto (fitness + genomas); este hilo principal decide quién
// sobrevive, cruza y muta (el algoritmo genético) y reparte los nuevos
// cerebros con {type:"load"}. El escaparate es la sim local y solo cambia
// cuando el usuario pulsa "Entrenar".

const BG_WORKER_COUNT = 20;  // workers en paralelo. Para 40, sube a 40.
const BG_BATCH = 2000;      // pasos por tanda: el worker repite hasta los 8000.
const GEN_STEPS = 8000;     // pasos por generación (debe coincidir con el worker)

// Parámetros del algoritmo genético (mismo criterio que
// libs/genetic-algorithm/src/lib.rs: elitismo + torneo + cruce aritmético +
// mutación gaussiana).
const GA = {
    elite: 1,            // showcaste el mejor sin tocarlo
    tournament: 3,       // tamaño del torneo de selección de padres
    crossoverAlpha: 0.5, // mezcla de los dos padres
    mutationChance: 0.08,// probabilidad por gen de mutar
    mutationCoeff: 0.3,  // magnitud del ruido
};

const bg = {
    workers: [],       // [{worker, ready, mode, playerCount, stepsDone, frozen, fitness}]
    generation: 0,     // generaciones completadas (toda la población)
    running: false,    // ¿el orquestador está repartiendo?
    results: new Map(),// workerIdx -> {fitness, genomes} de la generación en curso
    history: [],       // [{gen, best, avg, worst}] para la curva
    gen: 0,            // simulación mostrada en el escaparate
    cloning: false,
    pendingFrom: -1,
    pendingGenomes: new Map(),
};

function bgReadyCount() {
    return bg.workers.filter((w) => w.ready).length;
}

// Mejor jugador de la generación en curso (mayor fitness).
function bgBest() {
    let best = -1, bestFit = -Infinity, bestPlayer = -1;
    bg.workers.forEach((w, i) => {
        if (!w.ready) return;
        w.fitness.forEach((f, p) => {
            if (f > bestFit) {best = i; bestFit = f; bestPlayer = p;}
        });
    });
    return best >= 0 ? {worker: best, player: bestPlayer, fitness: bestFit} : null;
}

function renderTrainStatus() {
    if (!ui.trainStatus) return;
    if (!bg.workers.length) {ui.trainStatus.textContent = "fondo parado…"; return;}
    const best = bgBest();
    const lines = [`generación ${bg.generation} · ${bgReadyCount()}/${bg.workers.length} workers · elitismo ${GA.elite} · mut ${(GA.mutationChance * 100).toFixed(0)}%`];
    lines.push(bg.workers.map((w, i) => {
        const fit = w.fitness.length ? w.fitness.map((f) => Number(f).toFixed(1)).join("/") : "—";
        const star = best && best.worker === i ? " ★" : "";
        const state = w.frozen ? "evaluado" : `${w.stepsDone}/${GEN_STEPS}`;
        return `[${i}${star} ${state} fit ${fit}]`;
    }).join(" "));

    // Línea del mejor. Durante el reparto los workers aún no tienen fitness
    // (se acaba de vaciar), así que se muestra el de la generación anterior:
    // así el usuario ve siempre el mejor fitness mientras se intercambian los
    // cerebros y no un hueco vacío.
    const last = bg.history[bg.history.length - 1];
    if (best) {
        lines.push(`mejor: fondo ${best.worker} jugador ${best.player} · fitness ${best.fitness.toFixed(2)}`);
    } else if (last) {
        lines.push(`mejor g${last.gen}: ${last.best.toFixed(2)} · media ${last.avg.toFixed(2)} · intercambiando cerebros…`);
    }
    lines.push(`escaparate: simulación ${bg.gen}`);
    ui.trainStatus.textContent = lines.join("\n");
    if (ui.btnTrain) ui.btnTrain.disabled = best === null || !app.sim || bg.cloning;
}

// ------------------------------------------------------------------ GA
// Réplica en JS del motor de libs/genetic-algorithm/src/lib.rs, orquestado
// aquí porque los traits/genéricos de Rust no se exportan a wasm de forma
// práctica y el hilo principal ya tiene los fitness de todos los workers.

// Selección por torneo: elige al azar `tournament` candidatos y gana el mejor.
function tournamentSelect(pop, rng) {
    let best = null;
    for (let i = 0; i < GA.tournament; i++) {
        const cand = pop[Math.floor(rng() * pop.length)];
        if (!best || cand.fitness > best.fitness) best = cand;
    }
    return best;
}

// Cruce aritmético: hijo = a*alpha + b*(1-alpha), gen a gen, alfa aleatorio.
function crossover(a, b, rng) {
    const alpha = rng();
    const child = new Array(a.length);
    for (let i = 0; i < a.length; i++) child[i] = a[i] * alpha + b[i] * (1 - alpha);
    return child;
}

// Mutación gaussiana: cada gen tiene una probabilidad de moverse con ruido.
function mutate(child, rng) {
    for (let i = 0; i < child.length; i++) {
        if (rng() < GA.mutationChance) {
            // Ruido gaussiano aproximado (suma de dos uniformes centradas).
            const noise = (rng() + rng() + rng() - 1.5) * GA.mutationCoeff;
            child[i] += noise;
        }
    }
    return child;
}

// Una generación: de la población actual,elitistas + hijos, vuelve el mismo tamaño.
function evolve(population, rng) {
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    const next = [];
    // Elitismo: los mejores pasan intactos.
    for (let i = 0; i < Math.min(GA.elite, sorted.length); i++) {
        next.push({genome: sorted[i].genome.slice(), fitness: sorted[i].fitness});
    }
    // El resto: dos padres por torneo, cruce y mutación.
    while (next.length < population.length) {
        const pa = tournamentSelect(population, rng);
        const pb = tournamentSelect(population, rng);
        const child = mutate(crossover(pa.genome, pb.genome, rng), rng);
        // El fitness del hijo aún no existe: se medirá jugando.
        next.push({genome: child, fitness: -Infinity});
    }
    return next;
}

// Cuando TODOS los workers han entregado su veredicto: evoluciona y reparte.
function evolveGeneration() {
    if (bg.results.size < bg.workers.length) return;

    // Población = todos los jugadores de todos los workers de esta generación.
    // Se descartan los fitness no finitos (NaN/Inf): si uno se colara,
    // contaminaría las estadísticas y la gráfica Saldría con NaN.
    const population = [];
    let discarded = 0;
    bg.workers.forEach((w, i) => {
        const r = bg.results.get(i);
        if (!r) return;
        (r.genomes ?? []).forEach((genome, p) => {
            const raw = r.fitness?.[p];
            if (!Number.isFinite(raw)) {discarded++; return;}
            population.push({genome, fitness: Number(raw)});
        });
    });
    if (!population.length) {
        console.warn("[neurokick] generación sin fitness válido; se repite");
        bg.results.clear();
        bg.workers.forEach((w) => {w.stepsDone = 0; w.frozen = false; w.fitness = [];});
        for (const w of bg.workers) bgRun(w);
        renderTrainStatus();
        return;
    }
    if (discarded) console.warn("[neurokick] fitness no finito descartado: " + discarded);

    const finite = population.map((x) => x.fitness);
    const stats = {
        gen: bg.generation,
        best: Math.max(...finite),
        worst: Math.min(...finite),
        avg: finite.reduce((a, b) => a + b, 0) / finite.length,
    };
    bg.history.push(stats);

    const rng = Math.random;
    const next = evolve(population, rng);
    const bestGenome = population.reduce((a, b) => (b.fitness > a.fitness ? b : a)).genome;

    // Reparto: cada worker recibe los jugadores de su puesto. La suma debe
    // coincidir con la población o los cerebros acabarían desalineados (cada
    // worker jugaría con los genes de otro).
    const needed = bg.workers.reduce((acc, w) => acc + (w.playerCount || 2), 0);
    if (population.length !== needed) {
        console.warn(`[neurokick] población (${population.length}) != necesarios (${needed}); se rellena con el mejor`);
    }

    let cursor = 0;
    bg.workers.forEach((w) => {
        const n = w.playerCount || 2;
        const genomes = [];
        for (let p = 0; p < n; p++) {
            const slot = next[cursor + p];
            genomes.push(slot ? slot.genome : bestGenome);
        }
        cursor += n;
        w.stepsDone = 0;
        w.frozen = false;
        w.fitness = [];
        // El worker responde "loaded" cuando tiene el mundo nuevo; el arranque
        // de la generación siguiente se dispara ahí (no aquí, para no encolar
        // un "run" mientras el worker todavía está congelado).
        w.worker.postMessage({type: "load", genomes});
    });
    bg.results.clear();
    bg.generation += 1;
    renderTrainStatus();
    drawEvolution();
    console.log(`[neurokick] generación ${stats.gen}: mejor ${stats.best.toFixed(2)} · media ${stats.avg.toFixed(2)} · peor ${stats.worst.toFixed(2)}`);
}

function bgRun(entry) {
    if (!entry.ready || entry.frozen) return;
    entry.worker.postMessage({type: "run", steps: BG_BATCH});
}

function onWorkerMessage(entry, ev) {
    const msg = ev.data ?? {};
    const idx = bg.workers.indexOf(entry);

    if (msg.type === "ready") {
        entry.ready = true;
        entry.mode = msg.mode ?? "?";
        entry.playerCount = Number(msg.player_count ?? 0);
        entry.stepsDone = 0;
        entry.frozen = false;
        entry.fitness = [];
        renderTrainStatus();
        bgRun(entry); // arranca a máxima velocidad
        return;
    }

    if (msg.type === "progress") {
        entry.stepsDone = Number(msg.stepsDone ?? 0);
        if (Array.isArray(msg.fitness)) entry.fitness = msg.fitness.map(Number);
        renderTrainStatus();
        bgRun(entry); // siguiente tanda hasta cumplir la generación
        return;
    }

    if (msg.type === "done") {
        // Generación cumplida en este worker: veredicto congelado.
        entry.frozen = true;
        entry.stepsDone = Number(msg.stepsDone ?? GEN_STEPS);
        entry.fitness = Array.isArray(msg.fitness) ? msg.fitness.map(Number) : [];
        bg.results.set(idx, {fitness: entry.fitness, genomes: msg.genomes});
        renderTrainStatus();
        // Barrera: cuando todos han entregado su veredicto, evolucionamos.
        if (bg.results.size >= bg.workers.length) evolveGeneration();
        return;
    }

    if (msg.type === "loaded") {
        // Nuevo cerebro recibido: el worker confirma el mundo nuevo.
        entry.stepsDone = Number(msg.stepsDone ?? 0);
        if (Number.isFinite(Number(msg.player_count))) {
            entry.playerCount = Number(msg.player_count);
        }
        entry.frozen = false;
        bgRun(entry);
        return;
    }

    if (msg.type === "snapshot") {
        window.__neurokickBgSnapshot = msg.state;
        return;
    }

    if (msg.type === "genome") {
        if (idx !== bg.pendingFrom) return; // de otro worker, ignorar
        bg.pendingGenomes.set(Number(msg.playerIdx ?? 0), {genome: msg.genome, fitness: msg.fitness});
        finishCloneIfReady();
        return;
    }
    if (msg.type === "error") {
        console.warn("[neurokick] fondo error:", msg.message);
        renderTrainStatus();
    }
}

// Trae los cerebros al escaparate y REINICIA el partido con ellos.
// Clonar solo los pesos no basta: la partida seguiría en curso con el
// marcador y el fitness acumulados. Se crea una Simulation nueva (partido en
// blanco) y se le cargan los cerebros encima: resetea todo menos las evoluciones.
function finishCloneIfReady() {
    const entry = bg.workers[bg.pendingFrom];
    const n = entry?.playerCount || app.state.players.length || 0;
    if (!entry || !n || bg.pendingGenomes.size < n) return;

    const genomes = [];
    for (let i = 0; i < n; i++) {
        const g = bg.pendingGenomes.get(i);
        if (g) genomes.push(g.genome);
    }
    bg.pendingGenomes.clear();
    bg.pendingFrom = -1;
    bg.cloning = false;

    // Partido nuevo de verdad, con los mismos cerebros encima.
    const fresh = createFreshSim();
    if (typeof fresh.sim.from_genome !== "function") {
        console.warn("[neurokick] from_genome() no existe en esta sim (¿pkg viejo?).");
        app.sim = fresh.sim;
        renderTrainStatus();
        return;
    }
    genomes.forEach((genome, i) => {
        try {fresh.sim.from_genome(i, genome);} catch (err) {
            console.warn("[neurokick] fallo al cargar el genoma del jugador " + i, err);
        }
    });

    // Sustituye la sim del escaparate y reinicia TODO su estado de partido.
    app.sim = fresh.sim;
    app.mode = fresh.mode;
    app.frame = 0;
    app.state = {players: [], ball: {x: 0, y: 0}, local_goals: 0, away_goals: 0};
    app.trail = [];
    app.headings = [];
    app.prevPlayers = [];
    app.lastScore = "0-0";
    app.flashUntil = 0;
    app.focus = 0;
    app.genomeCache.clear();
    bg.gen += 1; // siguiente simulación en el escaparate

    advance(1);
    syncFocusButtons();
    updateScoreboard();
    drawGenome();
    renderTrainStatus();
    console.log("[neurokick] partido reiniciado con los cerebros del fondo: simulación " + bg.gen);
}

// Botón Entrenar: clona aquí el cerebro del MEJOR jugador del fondo y
// reinicia el partido del escaparate con esos cerebros.
function onTrain() {
    const best = bgBest();
    if (!best || bg.cloning || !app.sim) return;
    const entry = bg.workers[best.worker];
    // Comprobación temprana: si este paquete no tiene from_genome, avisamos
    // sin tocar el partido que se está viendo.
    const probe = createFreshSim();
    if (typeof probe.sim.from_genome !== "function") {
        if (ui.trainStatus) ui.trainStatus.textContent = "No se puede entrenar: este pkg no tiene from_genome(). Regenera el wasm.";
        return;
    }
    try {if (typeof probe.sim.free === "function") probe.sim.free();} catch { }
    const n = entry.playerCount || (typeof app.sim.player_count === "function" ? app.sim.player_count() : 0) || 0;
    if (!n) return;
    bg.cloning = true;
    bg.pendingFrom = best.worker;
    bg.pendingGenomes.clear();
    renderTrainStatus();
    for (let i = 0; i < n; i++) entry.worker.postMessage({type: "genome", playerIdx: i});
}

function startBackground() {
    // Los workers arrancan solos al cargar, sin panel: todos a la vez.
    if (bg.workers.length) return;
    for (let i = 0; i < BG_WORKER_COUNT; i++) {
        const worker = new Worker(new URL("./sim-worker.js", import.meta.url), {type: "module"});
        const entry = {
            worker, ready: false, mode: "…", playerCount: 0,
            stepsDone: 0, frozen: false, fitness: [],
        };
        worker.onmessage = (ev) => onWorkerMessage(entry, ev);
        worker.onerror = (err) => console.warn("[neurokick] fondo" + i + " onerror:", err?.message ?? err);
        bg.workers.push(entry);
        worker.postMessage({type: "init"});
    }
    renderTrainStatus();
}

ui.btnTrain?.addEventListener("click", onTrain);

// Curva de fitness por generación: si la media sube, están aprendiendo.
function drawEvolution() {
    const cv = ui.evoChart;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth || 280, H = 120;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext("2d");
    g.save();
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0a0f1e";
    g.fillRect(0, 0, W, H);

    const hist = bg.history;
    g.font = "9px ui-monospace, monospace";
    g.fillStyle = "#93a1c0";
    g.textAlign = "left";
    if (!hist.length) {
        g.fillText("generación 0 en curso…", 8, H / 2);
        g.restore();
        return;
    }
    // Rango vertical: incluye las generaciones cerradas y el mejor
    // provisional de la que está en curso (evita saltos de escala).
    const all = hist.flatMap((h) => [h.best, h.avg, h.worst]).filter(Number.isFinite);
    if (!all.length) {
        g.fillText("sin datos válidos", 8, H / 2);
        g.restore();
        return;
    }
    let lo = Math.min(...all), hi = Math.max(...all);
    const live = liveBest();
    if (live !== null) {lo = Math.min(lo, live); hi = Math.max(hi, live);}
    if (hi - lo < 1e-6) {lo -= 1; hi += 1;}
    const margin = (hi - lo) * 0.12;
    lo -= margin; hi += margin;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {lo = 0; hi = 1;}
    const pad = 10;
    const denom = Math.max(1, hist.length); // incluye la x del punto en curso
    const X = (i) => pad + (W - pad * 2) * (i / denom);
    const Y = (v) => H - pad - (H - pad * 2) * ((v - lo) / (hi - lo));

    const series = [
        {key: "best", color: "#2ecc71"},
        {key: "avg", color: "#4f8cff"},
        {key: "worst", color: "#ff5d5d"},
    ];
    for (const s of series) {
        g.strokeStyle = s.color;
        g.lineWidth = s.key === "avg" ? 2 : 1;
        g.beginPath();
        hist.forEach((h, i) => {
            const x = X(i), y = Y(h[s.key]);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        // Extensión provisional hacia la generación en curso: se prolonga la
        // serie hasta la x siguiente con el mejor fitness medido hasta ahora.
        if (live !== null) g.lineTo(X(hist.length), Y(live));
        g.stroke();
    }
    g.fillStyle = "#93a1c0";
    g.textAlign = "right";
    g.fillText(hi.toFixed(1), W - 4, 10);
    g.fillText(lo.toFixed(1), W - 4, H - 3);
    g.textAlign = "left";
    g.fillText("g" + hist[0].gen, 4, H - 3);
    g.textAlign = "right";
    g.fillText("g" + bg.generation, W - 4, 21);
    g.restore();
}

// Mejor fitness provisional de la generación en curso (null si no hay datos).
function liveBest() {
    let best = null;
    for (const w of bg.workers) {
        for (const f of w.fitness) {
            if (Number.isFinite(f) && (best === null || f > best)) best = f;
        }
    }
    return best;
}
// El fondo arranca solo: los workers entran en bucle de generaciones.
startBackground();
renderTrainStatus();

window.addEventListener("resize", () => {drawGenome(); drawEvolution();});
window.__neurokick = app;
window.__neurokickBg = bg;
