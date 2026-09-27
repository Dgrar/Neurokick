use crate::*;

pub struct GameWorld {
    physics: PhysicsWorld,
    players: Vec<Player>,
    ball: GameBall,
}

impl GameWorld {
    pub fn new(physics: PhysicsWorld, players: Vec<Player>, ball: GameBall) -> GameWorld {
        GameWorld {
            physics,
            players,
            ball,
        }
    }
    pub fn step(&mut self) {
        self.physics.step();
    }

    pub fn apply_external_force(&mut self, idx: usize, fx: f32, fy: f32) {
        self.players[idx]
            .physics
            .apply_force(&mut self.physics, fx, fy);
    }

    pub fn get_world_state(&self) -> GameData {
        GameData {
            player_positions: self
                .players
                .iter()
                .map(|player| player.physics.position(&self.physics))
                .collect(),
            ball_position: self.ball.physics.position(&self.physics),
        }
    }
}

#[derive(Clone, Debug)]
pub struct GameData {
    player_positions: Vec<[f32; 2]>,
    ball_position: [f32; 2],
}
