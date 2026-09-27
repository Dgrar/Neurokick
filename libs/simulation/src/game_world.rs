use crate::*;
use nalgebra::Point2;

pub struct GameWorld {
    pub physics: PhysicsWorld,
    pub players: Vec<Player>,
    pub ball: GameBall,
}

impl GameWorld {
    pub fn new(mut physics: PhysicsWorld) -> GameWorld {
        physics.gravity *= 0.0;
        let players = vec![Player::new(&mut physics, Point2::new(-25.0, 0.0))];

        let ball = GameBall::new(&mut physics, Point2::new(0.0, 0.0));

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
        if let Some(player) = self.players.get_mut(idx) {
            player.physics.apply_force(&mut self.physics, fx, fy);
        }
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
    pub player_positions: Vec<[f32; 2]>,
    pub ball_position: [f32; 2],
}
