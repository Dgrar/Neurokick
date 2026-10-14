use nalgebra::Point2;

use crate::*;

const BALL_MAX_SPEED: f32 = 20.0;
const BALL_FRICTION: f32 = 0.2;
const BALL_DAMPING: f32 = 0.6;
pub const BALL_RADIUS: f32 = 0.3;
const BALL_RESTITUTION: f32 = 0.8;
const BALL_MASS: f32 = 1.0;
pub struct GameBall {
    pub physics: PhysicsComponent,
    pub prev_goal_distance: Option<f32>,
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
            prev_goal_distance: None,
        }
    }
    pub fn distance_to_goal(&self, physics_world: &PhysicsWorld, goal: [f32; 2]) -> f32 {
        let pos: Vec2 = self.physics.position(physics_world).into();
        let goal: Vec2 = goal.into();
        pos.distance(goal)
    }
}
