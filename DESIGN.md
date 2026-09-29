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