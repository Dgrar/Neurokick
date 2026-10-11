# Neurokick — Documento de Diseño de Software (SDD)

Simulación de aprendizaje genético con redes neuronales y neuroevolución aplicadas a dinámicas de fútbol en tiempo real.

---

## 1. Arquitectura de Entidades y Físicas
El entorno gestiona físicas diferenciadas según el tipo de entidad para simular masa, inercia y control activo.

| Característica | Jugador (`Agent`) | Pelota (`Ball`) | Portería (`Goal`) |
| :--- | :--- | :--- | :--- |
| **Componentes del struct** | `Network`, `EyeSensors`, Fuerzas, Masa, Velocidad, Dirección, `last_touch_frame` | Vector Posición, Vector Velocidad, Fricción, Restitución | Caja de Colisión Estática, Sensor de Meta |
| **Comportamiento físico** | **Activo:** Aplica fuerzas autogeneradas a través de su Red Neuronal. | **Pasivo:** Reacciona exclusivamente a fuerzas externas (impactos y fricción). | **Inmóvil:** Bloquea cuerpos sólidos (postes) y registra anotaciones. |
| **Fricción e Inercia** | Alta inercia (Aceleración y frenado graduales mediante fuerzas de arrastre). | Fricción continua con el suelo (Pérdida exponencial de energía cinética). | Sin fricción interna (Física de rebote elástico en postes). |

---

## 2. Red Neuronal y Sensores (Percepción y Acción)
Cada agente cuenta con un "cerebro" modular basado en una Red Neuronal *Feedforward* que procesa el entorno de forma relativa y ejecuta acciones físicas en cada fotograma. El procesamiento visual se delega al módulo `eye.rs`.

### Estructura Jerárquica del Cerebro (`src/network.rs`)
La red no almacena la capa de entrada; `layers[0]` representa la primera capa oculta o la capa de salida.

```rust
#[derive(Debug, Clone)]
pub struct Network {
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone)]
pub struct Layer {
    pub neurons: Vec<Neuron>,
}

#[derive(Debug, Clone)]
pub struct Neuron {
    pub bias: f32,
    pub weights: Vec<f32>,
}
```

### Capa de Entrada (Sensores Relativos Fijos desde `eye.rs`)
Para evitar fallos de dimensionalidad en la red, las entradas de otras entidades dinámicas **se ordenan estrictamente por proximidad euclidiana** en cada frame. Todos los valores lineales se normalizan en el rango `[-1.0, 1.0]`.

```rust
pub struct EyeSensors {
    pub ball_relative: (f32, f32),         // (distancia, ángulo en radianes)
    pub closest_ally: Option<(f32, f32)>,   // None en modo 1v1 (relleno con 0.0)
    pub closest_enemy: (f32, f32),         // Rival más cercano (garantiza orden estricto)
    pub enemy_goal: (f32, f32),            // Centro del arco rival
    pub own_goal: (f32, f32),              // Centro del arco propio
    pub field_limits: [f32; 4],            // Distancias ortogonales normalizadas [N, S, E, O]
}
```

### Capa de Salida (Actuadores Mecánicos)
La capa final produce valores continuos evaluados mediante la función de activación **tangente hiperbólica (\(\tanh\))** en el rango `[-1.0, 1.0]`:

*   **Fuerza X / Fuerza Y:** Magnitudes de empuje continuo aplicadas al motor físico multiplicadas por la constante `PLAYER_MAX_SPEED`.
*   **Acción de Chute:** La potencia del chute estará limitada del **0 al 1**, para poder hacer que los jugadores puedan chutar fuertemente a porteria como hacer pases suaves.
---

## 3. Algoritmo Genético y Ciclo de Entrenamiento
La optimización se realiza mediante una estrategia de **Simulación Concurrente** en entornos aislados en paralelo (múltiples hilos de CPU). 

### Interfaz del Cromosoma (`src/agent.rs`)
Para desacoplar la simulación del motor evolutivo, el agente aplana y reconstruye su red neuronal convirtiéndola en un cromosoma compatible con el módulo de algoritmos genéticos (`ga::Chromosome`).

```rust
impl Agent {
    /// Serializa los pesos de la red neuronal en un cromosoma plano para el algoritmo genético.
    pub(crate) fn as_chromosome(&self) -> ga::Chromosome {
        self.nn.weights().into_iter().collect()
    }
}
```

1.  **Población Inicial:** Se instancian N = 20 individuos con topologías idénticas pero pesos y sesgos iniciales aleatorios en el rango `[-1.0, 1.0]`.
2.  **Evaluación (Partidos Concurrentes):** Los agentes juegan simultáneamente en campos paralelos aislados físicamente. Acumulan *Fitness* según el sistema de recompensas durante un límite estricto de fotogramas.
3.  **Selección:** Al finalizar el tiempo, se ordena la población y se preserva el **Top 5 (Élite)**, descartando al resto.
4.  **Reproducción y Mutación:** Los supervivientes se clonan de forma asexual para restaurar el tamaño de la población (N=20). Cada clon sufre una mutación aleatoria con una **probabilidad del 4% por cada gen** de alterar su valor mediante ruido gaussiano.

---

## 4. Fases de Diseño del Aprendizaje (Reward Shaping)

### Fase 1: Exploración Básica (Tocar el Balón)
Diseñada para romper el estatismo inicial de la generación cero mediante recompensas densas continuas.
*   **Acercamiento al balón:** `R_acercar = (Distancia_anterior - Distancia_actual) * 0.1`
*   **Toque de balón (`+1.0` punto):** Colisión directa con el balón. Para evitar la explotación por contacto continuo, este premio se valida comprobando que el `current_frame - last_touch_frame > 30` (1 segundo a 30fps) o si el toque fue producto de una acción explícita de Chute.
*   **Chute orientado (`+5.0` puntos):** Incremento de velocidad de la pelota si el vector resultante se dirige al campo rival.
*   **Anotación de Gol (`+50.0` puntos):** Máxima recompensa instantánea de la fase.
*   **Penalización por Inactividad (`-0.01` puntos/s):** Aplicada si el jugador o el balón permanecen estáticos.

### Fase 2: Competitividad Estricta (1v1)
Introduce el análisis del contexto del partido mediante un sistema de suma cero que fuerza al agente a adoptar roles ofensivos o defensivos.
*   **Puntuación Dinámica del Partido (Recompensa de Estado):** `R_estado = (Goles_Propios - Goles_Rivales) * 0.02` por cada segundo de juego.
*   **Intercepción / Robo (`+2.0` puntos):** Interrumpir la trayectoria del balón cuando el último toque registrado pertenecía al contrincante.
*   **Recibir Gol (`-30.0` puntos):** Penalización crítica en el *fitness* acumulado si el rival anota.

### Fase 3: Cooperación Emergente (2v2)
Fomenta la interacción colectiva coordinando los jugadores de un mismo equipo y penalizando conductas individualistas.
*   **Pase Exitoso (`+4.0` puntos compartidos):** Toque secuencial entre compañeros de equipo siempre que la distancia entre ambos al momento del pase supere un radio mínimo elemental.
*   **Asistencia de Gol (`+15.0` puntos):** Otorgada al pasador si su compañero anota en un intervalo inferior a los siguientes 90 fotogramas (3.0 segundos) tras la recepción.
*   **Bonificación de Gol Colectivo (`+20%`):** Multiplicador sobre el valor del gol si fue precedido por una combinación verificada de pases.
*   **Penalización por Amontonamiento (`-0.05` puntos/s):** Se aplica si ambos compañeros están a una distancia menor a un radio crítico r sin que ninguno posea la posesión de la pelota, forzándolos a abrir el campo.

### Fase Opcional: 5v5:
Es el test definitivo por el que tiene que pasar la red neuronal, se mantienen mismas recompensas, se estudiará este caso para definir el exito del experimento

---

## 5. Como entrenar en el frontend

**Primera decisión**: Crear una funcion que en la parte de rust entrene las 10 simulaciones sinmultaneamente, y crear un thread unico para el frontend

**Porque es imposible:** En el navegador no se pueden usar hilos de rayon, lo que imposibilita mi primera idea. Rayon queda tras `#[cfg(not(target_arch = "wasm32"))]`; en el navegador el paralelismo real son los Web Workers.

**Por qué workers y no 10 sims en el hilo principal:**
Solo 1 worker tiene que mostrarse a 60 fps, el resto corren en rust a toda velocidad. El hilo principal ya dibuja a 60fps (Canvas 2D); meter física + red neuronal ahí lo congelaría.

**Implementación frontend (`www/`):**
- `sim-worker.js`: cada worker crea su propia `Simulation` del mismo `pkg/wasm_simulation.js` (fallback a `MockSimulation` si el wasm no carga). Mensajes `init/run/snapshot/genome/load` → respuestas `ready/progress/generation/snapshot/genome/loaded/error`. `run` usa solo `train()` en bloques de 500 pasos.
- `script.js`: pool `bg.workers` arrancado solo al cargar (sin panel, `BG_WORKER_COUNT = 8`), bucles continuos `run` → `progress` → `run`, y botón 🧬 **Entrenar** que pide el genoma de cada jugador al worker con mejor fitness y lo clona al escaparate.
- `vite.config.js`: `worker.format = "es"` porque el worker importa wasm con top-level await (el formato IIFE rompe `vite build`).

**Límites asumidos:**
Los workers compiten por `navigator.hardwareConcurrency` núcleos (típico 4–16); se empieza con 8 y se escala a 40. Cada worker guarda su `GameWorld` + Rapier en memoria. La evolución completa (selección/mutación) sigue siendo fase 2: hoy se recogen pasos y fitness por worker.

### 5.1 Generaciones de 6000 pasos con reseteo conservando genomas

**Decisión del autor:** cada simulación de fondo corre **exactamente 6000 pasos** y, al cumplirlos, **resetea todo el mundo menos los genomas**: posiciones al inicio, balón al centro, marcador a 0 y fitness del partido a 0; los cerebros intactos.

**Por qué:** el fitness solo es comparable si todas las generaciones se miden en las mismas condiciones. Si el partido se arrastrara entre generaciones, un individuo que marcara al principio ganaría al que marca al final solo por tener más tiempo acumulado. Con 6000 pasos fijos cada generación es un experimento reproducible.

**Cómo se implementa (`sim-worker.js`):** constante `GEN_STEPS = 6000`. El bucle `run` avanza como mucho hasta el paso restante de la generación; al cruzarla, guarda los genomas con `show_genome()`, libera la `Simulation`, crea una nueva (`new Simulation()`) y los recarga con `from_genome()`. Es exactamente "reset de mundo, cerebro conservado". Después responde `generation` al hilo principal, que reinicia su contador de pasos.

**Escaparate bajo demanda:** el canvas es la sim del hilo principal a velocidad humana, y solo cambia cuando el usuario lo pide. El botón 🧬 **Entrenar** pide al mejor worker el genoma de cada jugador y **crea una `Simulation` nueva** (`createFreshSim()`) con esos cerebros cargados encima, reiniciando además contador, estela, marcadores y focos. Clonar pesos sin recrear el mundo dejaría el partido a medias, con el marcador y el fitness del partido anterior.

### 5.2 Bucle evolutivo cerrado

**Decisión del autor:** la evolución la dirige el hilo principal, no los workers. Cada generación dura **exactamente 6000 pasos** y termina en una **barrera**: todos los workers se congelan, entregan su veredicto y esperan.

**Por qué una barrera y no un reset autónomo:** si cada worker resetease solo al cumplir sus 6000 pasos, seguiría jugando con su propio ritmo y las generaciones se desincronizarían (unos en la g12, otros en la g15). El fitness solo es comparable si **todos los individuos se miden en las mismas condiciones**: mismos 6000 pasos, mismo estado inicial, misma duración. La barrera garantiza eso, a costa de perder algo de paralelismo en el instante de repartir.

**Ciclo completo:**
1. Los N workers entrenan en paralelo (`train()`, sin dibujar) hasta 6000 pasos.
2. Al cumplirse, cada uno responde `done` con su `fitness` por jugador y sus `genomas`, y queda **congelado** esperando.
3. Cuando han respondido los N, el hilo principal junta la población (todos los jugadores de todos los workers) y calcula `best` / `avg` / `worst` de la generación.
4. El GA elige la siguiente población: **elitismo** (los mejores intactos), **torneo** de tamaño 3 para elegir padres, **cruce aritmético** (`a*alpha + b*(1-alpha)`) y **mutación gaussiana** por gen. Mismos criterios que `libs/genetic-algorithm/src/lib.rs`.
5. Reparte los nuevos cerebros con `{type:"load"}`. Cada worker crea una `Simulation` nueva y carga los genomas encima: **resetea todo el mundo (posiciones, balón, marcador, fitness) y conserva la evolución**.
6. Cada worker responde `loaded` y arranca la generación siguiente. El ciclo se repite indefinidamente.

**Por qué el GA está en JS y no en Rust:** `GeneticAlgorithm::evolve` es genérico sobre `SelectionMethod` y opera con el trait `Individual`. Exponer eso a wasm con `#[wasm_bindgen]` es inviable (los traits y genéricos no se cruzan a JS); habría que escribir un wrapper específico que duplique el motor. Además el coste del GA es despreciable frente a la simulación: 6000 pasos de física Rapier por individuo dominan con diferencia el cruce de unos pocos cientos de genes. La decisión es **no duplicar lógica en dos lenguajes**: el motor nativo sigue siendo el de referencia (`simulate_bunch`) y la web tiene su equivalente ligero en JS.

**Parámetros actuales** (`GA` en `script.js`): elitismo 2, torneo 3, `crossoverAlpha` 0.5, `mutationChance` 4% por gen, `mutationCoeff` 0.3.

**Visualización:** una gráfica (`#evoChart`) dibuja `best` / `avg` / `worst` por generación. Si la línea azul (media) sube, la población está aprendiendo; si se estanca en un valor bajo, hay que revisar las recompensas o subir la mutación.

### 5.3 Bugs corregidos en el cálculo del fitness

Estos fallos hacen que el entrenamiento fuera inútil y la gráfica mostrara `NaN`. Se documentan porque son el tipo de error que más cuesta ver:

1. **Recompensa por cercanía invertida.** `fitness.rs` aplicaba `(distancia_actual - distancia_anterior)`, al revés de lo que define el diseño. Acercarse al balón **restaba** puntos: el óptimo a optimizar era huir del balón.
2. **Fitness exponencial hasta infinito.** `add_by_situation()` devolvía el fitness **ya acumulado** y su llamante en `GameWorld::add_situation_fitness()` lo sumaba otra vez: `f = f + (f + delta) = 2f + delta`. Cada paso doblaba el valor, así que a los ~128 pasos el fitness era `inf`, a los ~256 `NaN` por `inf - inf`, y la gráfica se rompía con `NaN` en los ejes. Ahora la función devuelve **solo el delta** y el llamante lo suma una vez.
3. **Doble llamada a `add_situation_fitness()`** por step en `GameWorld::step()`, pese a documentarse "una vez por segundo". Doblaba todas las recompensas.

**El frontend, aunque el motor corrija el fitness, filtra valores no finitos (`Number.isFinite`). Un único `NaN` contaminaría `Math.min`/`Math.max` de la población entera, el elitismo y toda la escala vertical. Si una generación llega sin ningún dato válido, se descarta y se repite en vez de propagar el error.

**Prueba de regresión:** `libs/tests/tests/fitness_finite.rs` reproduce el bucle de la web en nativo (4 generaciones × 6000 pasos, con mutación entre generaciones) y falla si el fitness, las posiciones o el balón dejan de ser finitos. Es la forma barata de cazar este tipo de fallo sin depender del navegador.

### 5.4 Otros dos fallos de la evolución (y cómo se depuraron)

Ambos se diagnosticaron **ejecutando el wasm real en Node** (`target/debug-loop.js` y `target/debug-fitness.js`, compilando el crate con `--target nodejs`) en lugar de mirar la gráfica desde el navegador. La gráfica solo decía "algo está mal"; Node decía exactamente qué valor se obtenía y por qué.

4. **El fitness se acumulaba entre generaciones.** `load` recreaba la `Simulation` (fitness a 0) pero el `Simulation` del escaparate y algunos caminos no, y sobre todo el `prev_ball_distance` quedaba obsoleto. El fitness de la generación N arrastraba el de la N-1, así que la curva descendía siempre en escalones idénticos (`-62 → -124 → -186`): la población parecía empeorar sin que nada cambiara. Se añadió `Simulation::reset_fitness()` en Rust y el worker lo invoca tras cada `load`. El test en Node pasa a mostrar valores comparables entre generaciones (`-63, -65, -59, -69...`), que es la condición necesaria para que el elitismo signifique algo.
5. **El campo desaparecía al cerrar la primera generación.** Al recibir `load`, el worker creaba una `Simulation` nueva, pero el hilo principal conservaba el `playerCount` antiguo y el reparto de genomas se desalineaba: cada worker recibía cerebros de otro, o ninguno. El mensaje `loaded` ahora incluye `player_count` y el hilo principal lo sincroniza.

**Limitación honesta de la recompensa actual:** con solo `per_distance` y `per_inactivity`, la señal es muy pobre y la penalización por inactividad se aplica en cada frame. Los agentes solo aprenden a aproximarse al balón, pero no "jugar al fútbol": no hay premio por tocar, chutar ni marcar. `per_goal`, `per_touch` e `per_in_goal` existen como campos pero `add_by_situation()` no los usa. Hasta implementarlos, la curva mide "acercarse al balón", no juego.

### 5.5 Fuga de memoria en el puente wasm (el campo desaparecía)

**Síntoma:** tras la primera generación el canvas se quedaba en negro / sin jugadores.

**Causa raíz: doble acceso a los getters de `Data`.** En `snapshot()` se leía el estado y luego, en el bucle de `free()`, se volvía a acceder a `data.players` y `data.ball`:

```js
const players = Array.from(data.players, (p) => ({x: p.x, y: p.y})); // 1er acceso
for (const p of data.players) p.free();                             // 2º acceso
```

`Data.players` es `#[wasm_bindgen(getter_with_clone)]`: **cada acceso clona el `Vec<Player>` en memoria wasm y devuelve wrappers JS nuevos**. El primer acceso creaba 2 objetos `Player` en Rust que nadie liberaba nunca; el segundo creaba otros 2 que sí se liberaban. Medido en Node: **2 objetos Rust fugados por fotograma y por worker** (600 en 300 fotogramas). Con 8 workers a la vez, la memoria del módulo wasm crece sin control hasta que la asignación falla y el dibujo se detiene.

`Data.ball` suffers the same problem: su getter (`__wbg_get_data_ball`) devuelve un puntero nuevo en cada llamada.

**Arreglo:** leer cada getter **una sola vez**, guardarlo en una variable y liberar exactamente ese mismo objeto:

```js
const rawPlayers = data.players ?? [];
const rawBall = data.ball;
const players = Array.from(rawPlayers, (p) => ({x: p.x, y: p.y}));
for (const p of rawPlayers) p.free();
if (rawBall) rawBall.free();
data.free();
```

Aplicado en los tres puntos affected: `snapshot()` de `script.js`, `snapshotOf()` de `sim-worker.js` y las sondas de arranque (`loadSimulation()` y `createSim()` del worker), que también creaban y liberaban mal.

**Regla general para este proyecto:** los getters de wasm que devuelven structs (`getter_with_clone`) son de un solo uso por objeto. Si se leen dos veces para "ahorrar una llamada", se está fugando memoria Y leyendo punteros que el GC puede liberar en cualquier momento. Este tipo de fallo es invisible en pruebas cortas y solo aparece bajo carga sostenida, que es exactamente lo que hace un bucle de 8 workers a máximo rendimiento.

### 5.6 Un `ReferenceError` apagaba el render para siempre (causa real del campo vacío)

**Síntoma:** el campo desaparecía justo tras la primera generación.

**Causa raíz:** un error de ámbito en `drawEvolution()`:
```js
hist.forEach((h, i) => { ... });     // 'h' existe SOLO dentro del callback
if (live !== null) g.lineTo(X(hist.length), Y(h.best));  // ReferenceError: h is not defined
```

`drawEvolution()` se invoca desde `renderFrame()`, que se invoca desde `loop()`. La excepción subía por la pila y **el `requestAnimationFrame(loop)` del final de `loop()` nunca se ejecutaba**. Como el siguiente fotograma solo se pide ahí, un único error mataba la cadena de render para el resto de la vida de la página: el canvas se quedaba congelado con el último fotograma válido (o vacío tras un `resize`). El entrenamiento seguía corriendo por detrás, así que la consola seguía imprimiendo generaciones: la app parecía viva pero el canvas no.

**Por qué costó encontrarlo:** el síntoma (canvas vacío) no apuntaba al código de dibujo, sino a "algo se rompe al evolucionar". La pista decisiva fue el *stack trace* de la consola, que señalaba `drawEvolution ← loop`. Con `generation 0` logged justo antes del primer error, encajaba: la gráfica solo dibuja líneas cuando hay historial, que es justo cuando empieza a ejecutarse esa rama.

**Arreglo (dos partes):**
1. El `ReferenceError`: `Y(live)` en lugar de `Y(h.best)` — `live` es el valor del mejor provisional, que es lo que se quería dibujar.
2. **Defensa estructural**, que es lo que evita que esto vuelva a ocurrir: `loop()` se reescribió con `try { renderFrame(now) } catch { ...reportar... } finally { requestAnimationFrame(loop) }`. El siguiente fotograma se pide en el `finally`, así que *ninguna* excepción en el dibujo o en el HUD puede matar la cadena de render. El error se registra una sola vez en consola y en el aviso de la interfaz.

**Lección de ingeniería:** en un bucle de `requestAnimationFrame`, el `requestAnimationFrame` siguiente debe pedirlo en un `finally`, no como última sentencia del camino feliz. Un fallo puntual en el dibujado no puede permitirse el lujo de matar la animación entera.

### 5.4 Límites asumidos

Los workers compiten por `navigator.hardwareConcurrency` núcleos (típico 4–16); se empieza con 8 y se escala a 40. La barrera introduce una pausa de CPU mientras el hilo principal reparte (despreciable frente a 6000 pasos). Cada worker mantiene su `GameWorld` + Rapier en memoria. El escaparate es una `Simulation` independiente en el hilo principal, a velocidad humana, y solo se actualiza cuando el usuario pulsa **Entrenar**.