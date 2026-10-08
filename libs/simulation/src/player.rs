use nalgebra::Point2;
use neural_network::*;
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
const SHOOT_COOLDOWN: u64 = 1;

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
    pub fitness: f32,
    pub prev_ball_distance: Option<f32>,
    last_shot_frame: u64,
}

impl Player {
    pub fn new(physics_world: &mut PhysicsWorld, pos: Point2<f32>, team: Team) -> Player {
        // Una sola capa oculta de 12 neuronas, si no aprenden se añaden más
        let topology = vec![
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
            fitness: 0.0,
            prev_ball_distance: None,
            last_shot_frame: 0,
        }
    }

    pub fn kick(
        &mut self,
        physics_world: &mut PhysicsWorld,
        ball: &mut GameBall,
        power: f32,
        current_frame: u64,
    ) {
        if current_frame - self.last_shot_frame < SHOOT_COOLDOWN {
            return;
        }

        self.last_shot_frame = current_frame;
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

    #[allow(clippy::too_many_arguments)]
    pub fn think_and_act(
        &mut self,
        physics_world: &mut PhysicsWorld,
        other_players: Option<Vec<&Player>>,
        ball: &mut GameBall,
        own_goal_pos: [f32; 2],
        enemy_goal_pos: [f32; 2],
        field_limits: [f32; 4],
        current_frame: u64,
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

        self.prev_ball_distance =
            Some(self.get_distance_to(ball.physics.position(physics_world), physics_world));

        self.physics.apply_force(
            physics_world,
            responses[0] * MAX_AGENT_FORCE,
            responses[1] * MAX_AGENT_FORCE,
        );
        if responses[2] != 0.0 {
            self.kick(physics_world, ball, responses[2], current_frame);
        }
    }

    pub fn show_genome(&self) -> (usize, Vec<usize>, Vec<f32>) {
        (
            self.brain.input_size(),
            self.brain.layer_sizes(),
            self.brain.to_genome(),
        )
    }

    pub fn get_distance_to(&self, other_position: [f32; 2], physics_world: &PhysicsWorld) -> f32 {
        let position: Vec2 = self.physics.position(physics_world).into();
        position.distance(other_position.into())
    }

    pub fn from_genome(&mut self, genome: &[f32]) {
        let topology = vec![
            LayerTopology::uniform_layer(12, Activation::Relu),
            LayerTopology::output_layer(),
        ];
        self.brain = Network::from_genome(14, &topology, genome.to_vec())
    }

    pub fn random_brain(&mut self) {
        let topology = vec![
            LayerTopology::uniform_layer(12, Activation::Relu),
            LayerTopology::output_layer(),
        ];

        let mut rng = rng();

        self.brain = Network::random(&mut rng, 14, &topology);
    }
}
