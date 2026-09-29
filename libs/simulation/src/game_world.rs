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

        let wall_body = RigidBodyBuilder::fixed()
            .translation(Vec2 { x: 0.0, y: 0.0 })
            .build();

        let body_handle = physics.bodies.insert(wall_body);

        let north_wall = ColliderBuilder::cuboid(53.5, 0.5)
            .translation(Vector2::new(0.0, 34.5))
            .build();
        physics
            .colliders
            .insert_with_parent(north_wall, body_handle, &mut physics.bodies);

        let south_wall = ColliderBuilder::cuboid(53.5, 0.5)
            .translation(Vector2::new(0.0, -34.5))
            .build();
        physics
            .colliders
            .insert_with_parent(south_wall, body_handle, &mut physics.bodies);
        let east_wall = ColliderBuilder::cuboid(0.5, 34.5)
            .translation(Vector2::new(53.0, 0.0))
            .build();
        physics
            .colliders
            .insert_with_parent(east_wall, body_handle, &mut physics.bodies);
        let west_wall = ColliderBuilder::cuboid(0.5, 34.5)
            .translation(Vector2::new(-53.0, 0.0))
            .build();
        physics
            .colliders
            .insert_with_parent(west_wall, body_handle, &mut physics.bodies);

        let players = vec![
            Player::new(&mut physics, Point2::new(-25.0, 0.0)),
            Player::new(&mut physics, Point2::new(25.0, 0.0)),
        ];

        let ball = GameBall::new(&mut physics, Point2::new(0.0, 0.0));

        GameWorld {
            physics,
            players,
            ball,
        }
    }

    fn process_brains(&self) {
        for player in self.players.iter() {
            player.think()
        }
    }

    pub fn step(&mut self) {
        self.physics.step();
        for player in self.players.iter() {
            player.physics.reset_forces(&mut self.physics);
            self.process_brains();
        }
        self.ball.physics.reset_forces(&mut self.physics);
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
