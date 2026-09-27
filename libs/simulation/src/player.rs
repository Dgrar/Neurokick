use nalgebra::Point2;

use crate::*;

const PLAYER_MAX_SPEED: f32 = 10.0;
const PLAYER_FRICTION: f32 = 0.5;
const PLAYER_DAMPING: f32 = 0.1;
pub const PLAYER_RADIUS: f32 = 0.4;
const PLAYER_RESTITUTION: f32 = 0.2;
const PLAYER_MASS: f32 = 10.0;
pub struct Player {
    // brain: Red neuronal
    // eye: el ojo
    pub physics: PhysicsComponent,
}

impl Player {
    pub fn new(physics_world: &mut PhysicsWorld, pos: Point2<f32>) -> Player {
        Player {
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
}
