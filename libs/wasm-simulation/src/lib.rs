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
        Self {
            sim: sim::GameWorld::new(sim::PhysicsWorld::new()),
        }
    }

    pub fn train(&mut self) {
        self.sim.step();
    }

    pub fn visualize(&mut self) -> Data {
        self.sim.step();
        let game_data: sim::GameData = self.sim.get_world_state();
        Data::new(game_data)
    }

    pub fn player_radius(&self) -> f32 {
        sim::PLAYER_RADIUS
    }

    pub fn ball_radius(&self) -> f32 {
        sim::BALL_RADIUS
    }
}

#[wasm_bindgen]
pub struct Data {
    #[wasm_bindgen(getter_with_clone)]
    pub players: Vec<Player>,
    pub ball: Ball,
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

        Self { players, ball }
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
