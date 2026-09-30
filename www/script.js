// Neurokick — visualización Canvas 2D de `libs/wasm-simulation/src/lib.rs`.
//
// Contrato Rust (no modificar Rust, solo consumirlo):
//   Simulation::new() -> Simulation
//   Simulation::visualize() -> Data   (avanza 1 step y devuelve el estado)
//   Simulation::train()               (avanza 1 step sin devolver nada)
//   Simulation::kick(idx)             (chut si el balón está a rango)
//   Data { players: Vec<Player { x, y }>, ball: Ball { x, y } }
//
// El campo es inventado (105x68 m, centro en 0,0) porque la física aún no
// define límites ni porterías: solo expone posiciones sueltas.

// ---------------------------------------------------------------- constantes


const FIELD = {
    w: 105,          // largo (eje x, porterías en x = ±w/2)
    h: 68,           // ancho (eje y)
    margin: 8,       // margen visible alrededor del campo (m)
    goalWidth: 7.32, // ancho reglamentario de portería (m)
    goalDepth: 2.44, // fondo de la portería dibujada (m)
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
    }
    train() {this.#step();}
    visualize() {
        this.#step();
        return {
            players: [{x: this.px, y: this.py}],
            ball: {x: this.bx, y: this.by},
        };
    }
    player_radius() {return vis.playerR;}
    ball_radius() {return vis.ballR;}
    #step() {
        // Jugador: fuerza proporcional hacia el balón + amortiguación.
        const fx = (this.bx - this.px) - this.pvx * 1.2;
        const fy = (this.by - this.py) - this.pvy * 1.2;
        this.pvx += fx * this.dt; this.pvy += fy * this.dt;
        const sp = Math.hypot(this.pvx, this.pvy);
        if (sp > 10) {this.pvx *= 10 / sp; this.pvy *= 10 / sp;}
        this.px += this.pvx * this.dt; this.py += this.pvy * this.dt;

        // Balón: rozamiento + rebote en límites + colisión con el jugador.
        this.bvx *= 0.9995; this.bvy *= 0.9995;
        this.bx += this.bvx * this.dt; this.by += this.bvy * this.dt;
        const hx = FIELD.w / 2, hy = FIELD.h / 2;
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

// Lee los radios físicos del sim (wasm o mock) para dibujar a escala real.
function readRadii(sim) {
    try {
        if (typeof sim.player_radius === "function") vis.playerR = sim.player_radius();
        if (typeof sim.ball_radius === "function") vis.ballR = sim.ball_radius();
    } catch { /* mock antiguo o pkg viejo: se usan los valores de reserva */}
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
                probe.ball.x.toFixed(2) + ", " + probe.ball.y.toFixed(2) + ")");
            if (typeof probe.free === "function") probe.free();
            readRadii(sim);
            mark(true, "radios: jugador=" + vis.playerR + " balon=" + vis.ballR);
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
    return {sim: mock, mode: "MOCK (wasm no accesible)"};
}

// Normaliza Data (wasm o mock) a { players: [{x,y}], ball: {x,y} }.
function snapshot(data) {
    const players = Array.from(data.players ?? [], (p) => ({x: p.x, y: p.y}));
    const ball = {x: data.ball.x, y: data.ball.y};
    try {
        for (const p of data.players ?? []) if (p && typeof p.free === "function") p.free();
        if (data.ball && typeof data.ball.free === "function") data.ball.free();
        if (typeof data.free === "function") data.free();
    } catch { /* los objetos mock no tienen free(); sin problema */}
    return {players, ball};
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

    // Líneas exteriores y medio campo.
    ctx.strokeRect(x0, y0, fw, fh);
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
        const gTop = Y(FIELD.goalWidth / 2);
        ctx.strokeRect(
            side < 0 ? X(gx) - FIELD.goalDepth * s : X(gx),
            gTop,
            FIELD.goalDepth * s,
            FIELD.goalWidth * s
        );
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
    pos: document.getElementById("stPos"),
};

const app = {
    sim: null,
    mode: "…",
    running: true,
    frame: 0,
    stepsPerFrame: 2,
    state: {players: [], ball: {x: 0, y: 0}},
    trail: [],
    fpsEMA: 60,
    lastT: performance.now(),
    headings: [], // rumbo por jugador (radianes, derivado del movimiento)
    prevPlayers: [],
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

function reset() {
    loadSimulation().then(({sim, mode}) => {
        app.sim = sim;
        app.mode = mode;
        app.frame = 0;
        app.trail = [];
        app.headings = [];
        app.prevPlayers = [];
        setBadge();
        advance(1);
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

ui.play.addEventListener("click", () => setRunning(!app.running));
ui.step.addEventListener("click", () => {if (!app.running) advance(1);});
ui.reset.addEventListener("click", reset);
ui.speed.addEventListener("input", () => {
    app.stepsPerFrame = Number(ui.speed.value);
    ui.speedVal.textContent = ui.speed.value;
});
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
    requestAnimationFrame(loop);
});


window.__neurokick = app;
