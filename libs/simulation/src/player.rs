use nalgebra::Point2;
use neural_network::{Activation, LayerTopology, Network};
use rand::{RngExt, rng};

use crate::*;

const PLAYER_MAX_SPEED: f32 = 10.0;
const PLAYER_FRICTION: f32 = 0.8;
const PLAYER_DAMPING: f32 = 2.0;
pub const PLAYER_RADIUS: f32 = 0.4;
const PLAYER_RESTITUTION: f32 = 0.8;
const PLAYER_MASS: f32 = 120.0;
const MAX_KICK_STRENGHT: f32 = 100.0;
const SHOOT_RADIUS: f32 = 0.2;
pub struct Player {
    pub brain: Network,
    // eye: el ojo
    pub physics: PhysicsComponent,
}

impl Player {
    pub fn new(physics_world: &mut PhysicsWorld, pos: Point2<f32>) -> Player {
        let topology = vec![
            LayerTopology::uniform_layer(12, Activation::Relu),
            LayerTopology::uniform_layer(12, Activation::Relu),
            LayerTopology::output_layer(),
        ];

        let mut rng = rng();

        let brain = Network::random(&mut rng, 12, &topology);
        Player {
            brain,
            physics: PhysicsComponent::new_circular(
                physics_world,
                pos,
                PLAYER_RADIUS,
                PLAYER_MASS,
                PLAYER_MAX_SPEED,
                PLAYER_RESTITUTION,
                PLAYER_FRICTION,
                PLAYER_DAMPING,
            ),
        }
    }

    pub fn kick(&self, physics_world: &mut PhysicsWorld, ball: &mut GameBall, power: f32) {
        let position: Vec2 = self.physics.position(physics_world).into();
        let ball_position: Vec2 = ball.physics.position(physics_world).into();

        let delta = ball_position - position;

        let distance = delta.length();

        if distance < PLAYER_RADIUS + BALL_RADIUS + SHOOT_RADIUS && distance > 0.0 {
            let direction = delta.normalize();

            let shooting_vector = direction * MAX_KICK_STRENGHT * power;

            ball.physics
                .apply_impulse(physics_world, shooting_vector.x, shooting_vector.y);
        }
    }
    pub fn think(&self) {
        let mut rng = rng();

        // Genera 12 números flotantes aleatorios entre -20.0 y 20.0 y los pasa como un Vec
        let inputs: Vec<f32> = (0..12).map(|_| rng.random_range(-20.0..20.0)).collect();

        self.brain.propagate(inputs.as_slice());
    }
}
