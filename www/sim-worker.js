// Neurokick — Workers de entrenamiento en fondo (generaciones de 6000 pasos).
//
// Cada worker tiene SU PROPIA `Simulation` (mundo aislado) y corre a máxima
// velocidad con `train()` (sin dibujar). Todos avanzan a la vez.
//
// REGLA DE GENERACIÓN (barrera): cada worker entrena hasta GEN_STEPS pasos y
// entonces PARA y espera. No resetea solo: se queda congelado y devuelve su
// resultado (fitness + genomas) al hilo principal. El hilo principal es quien
// decide quién sobrevive, cruza y muta, y devuelve a cada worker su nuevo
// cerebro con {type:"load"}. Al recibirlo, el worker resetea el mundo entero
// (posiciones, balón, marcador, fitness) y arranca la generación siguiente.
//
// Así la evolución la dirige el hilo principal y todas las generaciones se
// miden en las mismas condiciones: 6000 pasos desde cero.
//
// Protocolo:
//   IN:  {type:"init"}                     -> crea la sim, responde ready
//   IN:  {type:"run", steps}               -> avanza hasta `steps` (o hasta 6000) y responde
//   IN:  {type:"load", genomes:[[...],...]}-> carga cerebros, resetea mundo, responde loaded
//   IN:  {type:"genome", playerIdx}        -> show_genome()+get_fitness(), responde genome
//   IN:  {type:"snapshot"}                 -> estado SIN avanzar, responde snapshot
//   OUT: {type:"ready", mode, player_count}
//   OUT: {type:"progress", stepsDone, fitness, done}   (done=true al cumplir la generación)
//   OUT: {type:"done", generation, stepsDone, fitness, genomes}
//   OUT: {type:"loaded", stepsDone}
//   OUT: {type:"genome", playerIdx, input_size, layer_sizes, genome, fitness}
//   OUT: {type:"snapshot", state, stepsDone}
//   OUT: {type:"error", message}

const GEN_STEPS = 8000; // pasos por generación (barrera de evolución)

// Currículo de dificultad: el balón empieza pegado a la portería rival y se
// va alejando conforme pasan las generaciones. Al principio el jugador (x=25)
// queda DETRÁS del balón respecto a la portería, así que empujar en recto ya
// va en la dirección correcta; al final el problema es el de verdad.
const CURRICULUM_NEAR_DIST = 8;  // metros desde la portería en la gen 0
const CURRICULUM_FAR_DIST = 53;  // hasta el centro del campo
const CURRICULUM_LATERAL = 10;   // dispersión lateral (evita memorizar un carril)


// El hilo principal manda la posición: todos los workers de una generación
// reciben la MISMA, para que sus genomas se comparen en la misma tarea. Si no,
// cada uno sortearía la suya y la selección premiaría la suerte.
function applyCurriculum(msg) {
    if (!sim || typeof sim.set_ball_spawn !== "function") return;
    try {
        const x = Number(msg?.ballX);
        const y = Number(msg?.ballY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        sim.set_ball_spawn(x, y);
    } catch {}
}

// --- Mock de reserva (misma idea que script.js, física mínima de demo) ---
class MockSimulation {
    constructor() {
        this.px = -5; this.py = 0; this.pvx = 0; this.pvy = 0;
        this.bx = 0; this.by = 0; this.bvx = 2.5; this.bvy = 1.2;
        this.dt = 1 / 120;
        this.local_goals = 0; this.away_goals = 0;
        this._genomes = new Map();
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
    player_count() {return 1;}
    get_fitness() {return 0;}
    from_genome(idx, genome) {this._genomes.set(idx, Array.from(genome ?? []));}
    set_ball_spawn(x, y) {this.bx = x; this.by = y; this.bvx = 0; this.bvy = 0;}
    show_genome(idx) {
        if (this._genomes.has(idx)) {
            return {input_size: 14, layer_sizes: [12, 3], genome: this._genomes.get(idx)};
        }
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
        const fx = (this.bx - this.px) - this.pvx * 1.2;
        const fy = (this.by - this.py) - this.pvy * 1.2;
        this.pvx += fx * this.dt; this.pvy += fy * this.dt;
        const sp = Math.hypot(this.pvx, this.pvy);
        if (sp > 10) {this.pvx *= 10 / sp; this.pvy *= 10 / sp;}
        this.px += this.pvx * this.dt; this.py += this.pvy * this.dt;
        this.bvx *= 0.9995; this.bvy *= 0.9995;
        this.bx += this.bvx * this.dt; this.by += this.bvy * this.dt;
        const hx = 53, hy = 34.5, gh = 5.5;
        const inMouth = Math.abs(this.by) < gh;
        if (this.bx > hx && inMouth) {this.away_goals++; this.bx = 0; this.by = 0; this.bvx = -2.5; this.bvy = 1.2;}
        else if (this.bx < -hx && inMouth) {this.local_goals++; this.bx = 0; this.by = 0; this.bvx = 2.5; this.bvy = -1.2;}
        if (this.bx > hx) {this.bx = hx; this.bvx *= -0.6;}
        if (this.bx < -hx) {this.bx = -hx; this.bvx *= -0.6;}
        if (this.by > hy) {this.by = hy; this.bvy *= -0.6;}
        if (this.by < -hy) {this.by = -hy; this.bvy *= -0.6;}
    }
}

let sim = null;
let mode = "…";
let stepsDone = 0;   // pasos dentro de la generación actual
let generation = 0;  // generaciones completadas por este worker
let frozen = false;  // true al cumplir la generación: espera nuevos genomas

async function createSim() {
    // Crea un mundo nuevo (wasm real si se puede, mock si no).
    try {
        const mod = await import("./pkg/wasm_simulation.js");
        if (typeof mod.default === "function") await mod.default();
        const s = new mod.Simulation();
        // Sonda: tiene que devolver players + ball (sin avanzar).
        const probe = typeof s.show_positions === "function" ? s.show_positions() : s.visualize();
        const ok = probe && Array.isArray(probe.players) && probe.ball;
        // Se liberan también los wrappers de players/ball: son punteros del
        // externref table y quedarían zombis.
        try {
            if (probe) for (const p of probe.players ?? []) if (p && typeof p.free === "function") p.free();
            if (probe && probe.ball && typeof probe.ball.free === "function") probe.ball.free();
        } catch {}
        if (!ok) throw new Error("sin Data válido");
        return {sim: s, mock: false, mode: "WASM REAL"};
    } catch (err) {
        return {sim: new MockSimulation(), mock: true, mode: "MOCK (wasm no accesible: " + (err?.message ?? err) + ")"};
    }
}

function playerGenomes() {
    // Fotocopia los cerebros actuales.
    const saved = [];
    try {
        const n = typeof sim.player_count === "function" ? sim.player_count() : 1;
        for (let i = 0; i < n; i++) {
            const raw = sim.show_genome(i);
            if (raw) {
                saved.push(Array.from(raw.genome ?? []));
                try {if (typeof raw.free === "function") raw.free();} catch { }
            }
        }
    } catch { }
    return saved;
}

function snapshotOf(data) {
    // Los getters se llaman UNA vez y se guardan: `Data.players` es
    // getter_with_clone y cada acceso crea wrappers nuevos sobre el externref
    // table. Leerlos dos veces deja wrappers huérfanos que corrompen el
    // siguiente snapshot.
    let rawPlayers = [];
    let rawBall = null;
    try {
        rawPlayers = data.players ?? [];
        rawBall = data.ball;
    } catch {}
    const players = Array.from(rawPlayers ?? [], (p) => ({ x: p.x, y: p.y }));
    const ball = { x: rawBall ? rawBall.x : 0, y: rawBall ? rawBall.y : 0 };
    const local_goals = Number(data.local_goals ?? 0);
    const away_goals = Number(data.away_goals ?? 0);
    try {
        for (const p of rawPlayers ?? []) if (p && typeof p.free === "function") p.free();
        if (rawBall && typeof rawBall.free === "function") rawBall.free();
        if (typeof data.free === "function") data.free();
    } catch {}
    return { players, ball, local_goals, away_goals };
}

function goalsOf() {
    try {
        const l = typeof sim.local_goals === "function" ? sim.local_goals() : sim.local_goals;
        const a = typeof sim.away_goals === "function" ? sim.away_goals() : sim.away_goals;
        return {local_goals: Number(l ?? 0), away_goals: Number(a ?? 0)};
    } catch {
        return {local_goals: 0, away_goals: 0};
    }
}

function fitnessOf() {
    // Array con el fitness por jugador (el wasm expone get_fitness()).
    try {
        const n = typeof sim.player_count === "function" ? sim.player_count() : 1;
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push(typeof sim.get_fitness === "function" ? Number(sim.get_fitness(i)) : 0);
        }
        return out;
    } catch {
        return [];
    }
}

onmessage = async (e) => {
    const msg = e.data ?? {};
    try {
        if (msg.type === "init") {
            const created = await createSim();
            sim = created.sim;
            mode = created.mode;
            stepsDone = 0;
            generation = 0;
            frozen = false;
            let n = 1;
            try {if (typeof sim.player_count === "function") n = sim.player_count();} catch { }
            applyCurriculum(msg);
            postMessage({type: "ready", mode, player_count: n});
            return;
        }
        if (!sim) {
            postMessage({type: "error", message: "worker sin init previo"});
            return;
        }

        if (msg.type === "run") {
            if (frozen) return; // esperando la siguiente generación
            // Nunca se pasa de GEN_STEPS: la barrera la manda el hilo principal.
            const asked = Math.max(1, Number(msg.steps ?? 2000) | 0);
            const budget = Math.min(asked, GEN_STEPS - stepsDone);
            const CHUNK = 500;
            let done = 0;
            while (done < budget) {
                const n = Math.min(CHUNK, budget - done);
                for (let i = 0; i < n; i++) sim.train();
                done += n;
                stepsDone += n;
            }
            if (stepsDone >= GEN_STEPS) {
                // Generación cumplida: se congela y entrega el veredicto.
                frozen = true;
                generation += 1;
                postMessage({
                    type: "done",
                    generation,
                    stepsDone,
                    fitness: fitnessOf(),
                    genomes: playerGenomes(),
                });
                return;
            }
            postMessage({type: "progress", stepsDone, done: false, ...goalsOf(), fitness: fitnessOf()});
            return;
        }

if (msg.type === "load") {
            // Nueva generación: mundo en blanco + los cerebros que envía el
            // hilo principal. Reset total salvo la evolución.
            const genomes = Array.isArray(msg.genomes) ? msg.genomes : [];
            try { if (typeof sim.free === "function") sim.free(); } catch {}
            const created = await createSim();
            sim = created.sim;
            genomes.forEach((g, i) => {
                try { if (typeof sim.from_genome === "function") sim.from_genome(i, g); } catch {}
            });
            // El mundo nuevo nace con fitness a 0, pero se pide explícitamente
            // por si el paquete se reutiliza sin recrear la Simulation.
            try { if (typeof sim.reset_fitness === "function") sim.reset_fitness(); } catch {}
            applyCurriculum(msg);
            let n = genomes.length || 1;
            try { if (typeof sim.player_count === "function") n = sim.player_count(); } catch {}
            stepsDone = 0;
            frozen = false;
            postMessage({ type: "loaded", stepsDone, generation, player_count: n });
            return;
        }

        if (msg.type === "snapshot") {
            const data = typeof sim.show_positions === "function" ? sim.show_positions() : sim.visualize();
            postMessage({type: "snapshot", state: snapshotOf(data), stepsDone, generation});
            return;
        }

        if (msg.type === "genome") {
            const idx = Number(msg.playerIdx ?? 0);
            const raw = sim.show_genome(idx);
            if (!raw) {
                postMessage({type: "error", message: "sin genoma para idx " + idx});
                return;
            }
            let fitness = 0;
            try {if (typeof sim.get_fitness === "function") fitness = Number(sim.get_fitness(idx));} catch { }
            const out = {
                type: "genome",
                playerIdx: idx,
                input_size: Number(raw.input_size ?? 0),
                layer_sizes: Array.from(raw.layer_sizes ?? []),
                genome: Array.from(raw.genome ?? []),
                fitness,
            };
            try {if (typeof raw.free === "function") raw.free();} catch { }
            postMessage(out);
            return;
        }
    } catch (err) {
        postMessage({type: "error", message: String(err?.message ?? err)});
    }
};