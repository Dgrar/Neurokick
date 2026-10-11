use simulation as sim;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Simulation {
    sim: sim::GameWorld,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            sim: sim::GameWorld::new(sim::PhysicsWorld::new()),
        }
    }

    // Funcion cuando quiero entrenar sin visualizar (En proceso)
    pub fn train(&mut self) {
        self.sim.step();
    }
    // Función cuando sí que quiero visualizar
    pub fn visualize(&mut self) -> Data {
        self.sim.step();
        let game_data: sim::GameData = self.sim.get_world_state();
        Data::new(game_data)
    }

    pub fn show_positions(&self) -> Data {
        let game_data: sim::GameData = self.sim.get_world_state();
        Data::new(game_data)
    }

    // Medidas para evitar el hardcodeo
    pub fn player_radius(&self) -> f32 {
        sim::PLAYER_RADIUS
    }

    pub fn ball_radius(&self) -> f32 {
        sim::BALL_RADIUS
    }

    pub fn field_half_width(&self) -> f32 {
        sim::FIELD_HALF_WIDTH
    }

    pub fn field_half_height(&self) -> f32 {
        sim::FIELD_HALF_HEIGHT
    }

    pub fn goal_half_height(&self) -> f32 {
        sim::GOAL_HALF_HEIGHT
    }

    pub fn goal_depth(&self) -> f32 {
        sim::GOAL_DEPTH
    }

    // Marcador
    pub fn local_goals(&self) -> u32 {
        self.sim.local_goals
    }

    pub fn away_goals(&self) -> u32 {
        self.sim.away_goals
    }

    // Funcion para mover jugadores
    pub fn apply_external_force(&mut self, idx: usize, fx: f32, fy: f32) {
        self.sim.apply_external_force(idx, fx, fy);
    }

    // Funciones relativas a ver el genoma
    pub fn player_count(&self) -> usize {
        self.sim.player_count()
    }

    pub fn show_genome(&self, idx: usize) -> Option<GenomeData> {
        self.sim
            .show_genome(idx)
            .map(|(input_size, layer_sizes, genome)| GenomeData {
                input_size: input_size as u32,
                layer_sizes: layer_sizes.into_iter().map(|s| s as u32).collect(),
                genome,
            })
    }
    // Para la simulación del escaparate
    pub fn from_genome(&mut self, idx: usize, genome: Vec<f32>) {
        if let Some(p) = self.sim.players.get_mut(idx) {
            p.from_genome(&genome);
        }
    }

    pub fn get_fitness(&self, idx: usize) -> f32 {
        self.sim
            .players
            .get(idx)
            .map(|player| player.fitness)
            .unwrap_or(0.0)
    }

    // Puesta a cero del fitness acumulado. Necesario al cerrar una generación:
    // los cerebros se conservan, pero la puntuación del partido anterior no debe
    // contaminar la siguiente, o el elitismo compararía valores acumulados.
    pub fn reset_fitness(&mut self) {
        for player in self.sim.players.iter_mut() {
            player.fitness = 0.0;
            player.prev_ball_distance = None;
        }
        self.sim.local_goals = 0;
        self.sim.away_goals = 0;
    }
}

#[wasm_bindgen]
pub struct Data {
    #[wasm_bindgen(getter_with_clone)]
    pub players: Vec<Player>,
    pub ball: Ball,
    pub away_goals: u32,
    pub local_goals: u32,
}

impl Data {
    fn new(game_data: sim::GameData) -> Self {
        let players = game_data
            .player_positions
            .into_iter()
            .map(|[x, y]| Player { x, y })
            .collect();

        let ball = Ball {
            x: game_data.ball_position[0],
            y: game_data.ball_position[1],
        };

        Self {
            players,
            ball,
            away_goals: game_data.score[0],
            local_goals: game_data.score[1],
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct Player {
    pub x: f32,
    pub y: f32,
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct Ball {
    pub x: f32,
    pub y: f32,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct GenomeData {
    pub input_size: u32,
    #[wasm_bindgen(getter_with_clone)]
    pub layer_sizes: Vec<u32>,
    #[wasm_bindgen(getter_with_clone)]
    pub genome: Vec<f32>,
}
