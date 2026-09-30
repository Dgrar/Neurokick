use std::{cell::Cell, time::Duration};
use web_time::Instant;

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
const MAX_KICK_STRENGHT: f32 = 20.0;
const SHOOT_RADIUS: f32 = 2.0;
const MAX_AGENT_FORCE: f32 = 400.0;

#[derive(Debug, PartialEq)]
pub enum Team {
    Blue,
    Red,
}

pub struct Player {
    pub brain: Network,
    pub eye: Eye,
    pub physics: PhysicsComponent,
    pub team: Team,
    last_shot: Cell<Instant>,
}

impl Player {
    pub fn new(physics_world: &mut PhysicsWorld, pos: Point2<f32>, team: Team) -> Player {
        let topology = vec![
            LayerTopology::uniform_layer(14, Activation::Relu),
            LayerTopology::uniform_layer(12, Activation::Relu),
            LayerTopology::output_layer(),
        ];

        let mut rng = rng();

        let brain = Network::random(&mut rng, 14, &topology);

        let eye = Eye {};
        Player {
            brain,
            eye,
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
            team,
            last_shot: Cell::new(Instant::now()),
        }
    }

    pub fn kick(&self, physics_world: &mut PhysicsWorld, ball: &mut GameBall, power: f32) {
        if self.last_shot.get().elapsed() < Duration::from_secs_f64(1.5) {
            return;
        }
        self.last_shot.set(Instant::now());
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
    pub fn think_and_act(
        &self,
        physics_world: &mut PhysicsWorld,
        other_players: Option<Vec<&Player>>,
        ball: &mut GameBall,
        own_goal_pos: [f32; 2],
        enemy_goal_pos: [f32; 2],
        field_limits: [f32; 4],
    ) {
        let inputs = self.eye.see(
            physics_world,
            self,
            other_players,
            ball,
            own_goal_pos,
            enemy_goal_pos,
            field_limits,
        );
        let responses = self.brain.propagate(inputs.as_slice());

        self.physics.apply_force(
            physics_world,
            responses[0] * MAX_AGENT_FORCE,
            responses[1] * MAX_AGENT_FORCE,
        );

        self.kick(physics_world, ball, responses[2]);
    }
}
