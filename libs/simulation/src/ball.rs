use nalgebra::Point2;

use crate::*;

const BALL_MAX_SPEED: f32 = 20.0;
const BALL_FRICTION: f32 = 0.2;
const BALL_DAMPING: f32 = 0.05;
pub const BALL_RADIUS: f32 = 0.15;
const BALL_RESTITUTION: f32 = 0.6;
const BALL_MASS: f32 = 1.0;
pub struct GameBall {
    pub physics: PhysicsComponent,
}

impl GameBall {
    pub fn new(physics_world: &mut PhysicsWorld, pos: Point2<f32>) -> GameBall {
        GameBall {
            physics: PhysicsComponent::new_circular(
                physics_world,
                pos,
                BALL_RADIUS,
                BALL_MASS,
                BALL_MAX_SPEED,
                BALL_RESTITUTION,
                BALL_FRICTION,
                BALL_DAMPING,
            ),
        }
    }
}
