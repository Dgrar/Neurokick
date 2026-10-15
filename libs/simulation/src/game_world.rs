use std::ops::Div;

// Navegador no ejecuta funciones por debajo, solo ejecuta una simulación elegida

use crate::*;
use nalgebra::Point2;
use rand::{RngExt, rng};

// Medidas del campo (línea de gol a línea de gol / banda a banda).
pub const FIELD_HALF_WIDTH: f32 = 53.0;
pub const FIELD_HALF_HEIGHT: f32 = 34.5;
// Portería: hueco de 11 m (y en [-5.5, 5.5]) y 4 m de fondo.
pub const GOAL_HALF_HEIGHT: f32 = 5.5;
pub const GOAL_DEPTH: f32 = 4.0;

const MIN_TOUCH_PROGRESS: f32 = 1.0;

const WAKE_SPEED_THRESHOLD: f32 = 0.5; // m/s por debajo de la cual se considera dormido
const WAKE_FRAMES: u64 = 60; // frames dormido antes de aplicar el impulso
const WAKE_IMPULSE: f32 = 3.0; // La potencia que tiene al despertarse
pub const WAKE_CORNER_MARGIN: f32 = 2.0; // metros desde cada pared para considerar esquina

#[derive(Debug)]
pub enum Mode {
    Exploration,
    Competition,
    Cooperation,
    FinalTest,
}

pub struct GameWorld {
    pub physics: PhysicsWorld,
    pub players: Vec<Player>,
    pub ball: GameBall,
    pub local_goals: u32,
    pub away_goals: u32,
    pub mode: Mode,
    goals: [ColliderHandle; 2],
    last_touch_index: Option<u32>,
    frame: u64,
    prev_ball_vel: [f32; 2],
    ball_sleep_frames: u64,
}

impl GameWorld {
    pub fn new(mut physics: PhysicsWorld) -> GameWorld {
        physics.gravity *= 0.0;
        // Dimensiones del campo: 53.5 x 34.5
        // Portería de 5.5

        // Barreras/Paredes del campo
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
        let east_wall_top = ColliderBuilder::cuboid(0.5, 14.5)
            .translation(Vector2::new(53.0, 20.0))
            .build();
        physics
            .colliders
            .insert_with_parent(east_wall_top, body_handle, &mut physics.bodies);
        let east_wall_bottom = ColliderBuilder::cuboid(0.5, 14.5)
            .translation(Vector2::new(53.0, -20.0))
            .build();
        physics
            .colliders
            .insert_with_parent(east_wall_bottom, body_handle, &mut physics.bodies);
        let west_wall_top = ColliderBuilder::cuboid(0.5, 14.5)
            .translation(Vector2::new(-53.0, 20.0))
            .build();
        physics
            .colliders
            .insert_with_parent(west_wall_top, body_handle, &mut physics.bodies);
        let west_wall_bottom = ColliderBuilder::cuboid(0.5, 14.5)
            .translation(Vector2::new(-53.0, -20.0))
            .build();
        physics
            .colliders
            .insert_with_parent(west_wall_bottom, body_handle, &mut physics.bodies);

        // Porterias:
        let goal_left = ColliderBuilder::cuboid(2.0, 5.5)
            .sensor(true)
            .translation(Vec2 { x: -55.0, y: 0.0 })
            .build();

        let left_goal_handle = physics.colliders.insert(goal_left);

        let goal_right = ColliderBuilder::cuboid(2.0, 5.5)
            .sensor(true)
            .translation(Vec2 { x: 55.0, y: 0.0 })
            .build();
        let right_goal_handle = physics.colliders.insert(goal_right);
        let players = vec![
            // El orden debe ser jugador equipo 1, jugador equipo 2...
            Player::new(&mut physics, Point2::new(25.0, 0.0), Team::Blue),
        ];

        let ball = GameBall::new(&mut physics, Point2::new(0.0, 0.0));

        GameWorld {
            physics,
            players,
            ball,
            local_goals: 0,
            away_goals: 0,
            goals: [left_goal_handle, right_goal_handle],
            mode: Mode::Exploration,
            last_touch_index: None,
            frame: 0,
            prev_ball_vel: [0.0, 0.0],
            ball_sleep_frames: 0,
        }
    }

    pub fn dt(&self) -> f32 {
        self.physics.integration_parameters.dt
    }

    pub fn reset(&mut self) {
        for player in self.players.iter_mut() {
            let mut rng = rng();

            let x = (rng.random::<f32>() * 2.0 - 1.0) * (FIELD_HALF_WIDTH - PLAYER_RADIUS);
            let y = (rng.random::<f32>() * 2.0 - 1.0) * (FIELD_HALF_HEIGHT - PLAYER_RADIUS);
            player.physics.reset(&mut self.physics, x, y);

            player.prev_ball_distance = None;
        }
        self.ball.physics.reset(&mut self.physics, 0.0, 0.0);
        self.ball.prev_goal_distance = None;
        self.ball_sleep_frames = 0;
    }

    fn process_brains(&mut self) {
        for i in 0..self.players.len() {
            let (before, rest) = self.players.split_at_mut(i);
            let (player, after) = rest
                .split_first_mut()
                .expect("El indice siempre esta dentro del vec");

            let otros_jugadores: Vec<&Player> = before.iter().chain(after.iter()).collect();

            let (own_goal_pos, enemy_goal_pos) = match player.team {
                Team::Blue => ([-FIELD_HALF_WIDTH, 0.0], [FIELD_HALF_WIDTH, 0.0]),
                Team::Red => ([FIELD_HALF_WIDTH, 0.0], [-FIELD_HALF_WIDTH, 0.0]),
            };

            player.think_and_act(
                &mut self.physics,
                Some(otros_jugadores),
                &mut self.ball,
                own_goal_pos,
                enemy_goal_pos,
                [
                    -FIELD_HALF_WIDTH,
                    FIELD_HALF_WIDTH,
                    FIELD_HALF_HEIGHT,
                    -FIELD_HALF_HEIGHT,
                ],
                self.frame,
            );
        }
    }

    pub fn step(&mut self) {
        self.prev_ball_vel = self.ball.physics.velocity(&self.physics);
        self.frame = self.frame.wrapping_add(1);

        self.wake_ball_if_sleeping();

        self.physics.step();
        self.add_shot_fitness();
        self.check_goals();
        self.check_touches();
        self.add_situation_fitness();
        for player in self.players.iter() {
            player.physics.reset_forces(&mut self.physics);
        }
        self.process_brains();
        self.ball.physics.reset_forces(&mut self.physics);
    }

    fn wake_ball_if_sleeping(&mut self) {
        if !self
            .ball
            .physics
            .is_in_corner(self.ball.physics.position(&self.physics))
        {
            self.ball_sleep_frames = 0;
            return;
        }
        let velocity = self.ball.physics.velocity(&self.physics);
        let speed = (velocity[0] * velocity[0] + velocity[1] * velocity[1]).sqrt();
        if speed >= WAKE_SPEED_THRESHOLD {
            self.ball_sleep_frames = 0;
            return;
        }
        self.ball_sleep_frames = self.ball_sleep_frames.wrapping_add(1);
        if self.ball_sleep_frames >= WAKE_FRAMES {
            let mut rng = rng();
            let angle = rng.random::<f32>() * PI * 2.0;
            self.ball.physics.apply_impulse(
                &mut self.physics,
                angle.cos() * WAKE_IMPULSE,
                angle.sin() * WAKE_IMPULSE,
            );
            self.ball_sleep_frames = 0;
        }
    }

    pub fn apply_external_force(&mut self, idx: usize, fx: f32, fy: f32) {
        if let Some(player) = self.players.get_mut(idx) {
            player.physics.apply_force(&mut self.physics, fx, fy);
        }
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn show_genome(&self, idx: usize) -> Option<(usize, Vec<usize>, Vec<f32>)> {
        self.players.get(idx).map(|p| {
            let (input_size, layer_sizes, genome) = p.show_genome();
            (input_size, layer_sizes, genome)
        })
    }

    fn check_goals(&mut self) {
        let ball_collider = self.ball.physics.collider_handle;
        for (i, goal) in self.goals.iter().enumerate() {
            if self
                .physics
                .narrow_phase
                .intersection_pair(*goal, ball_collider)
                == Some(true)
            {
                // Azul derecha rojo izquierda
                if i == 0 {
                    self.local_goals += 1;
                    let p_i = self.last_touch_index.unwrap_or(10000000);

                    if let Some(player) = self.players.get_mut(p_i as usize) {
                        player.fitness += if player.team == Team::Red {
                            50.0
                        } else {
                            -50.0
                        };
                    }
                } else {
                    self.away_goals += 1;
                    let p_i = self.last_touch_index.unwrap_or(10000000);

                    if let Some(player) = self.players.get_mut(p_i as usize) {
                        player.fitness += if player.team == Team::Red {
                            -50.0
                        } else {
                            50.0
                        };
                    }
                }
                self.reset();
                break;
            }
        }
    }
    pub fn check_touches(&mut self) {
        self.last_touch_index = None;
        for (i, player) in self.players.iter().enumerate() {
            if let Some(contact) = self.physics.narrow_phase.contact_pair(
                self.ball.physics.collider_handle,
                player.physics.collider_handle,
            ) && contact.has_any_active_contact()
            {
                self.last_touch_index = Some(i as u32);
            }
        }
    }

    pub fn add_situation_fitness(&mut self) {
        let fitness_function = match self.mode {
            Mode::Exploration => ExplorationFitness::default(),
            Mode::Competition => ExplorationFitness::default(),
            Mode::Cooperation => ExplorationFitness::default(),
            Mode::FinalTest => ExplorationFitness::default(),
        };

        for player in self.players.iter_mut() {
            let enemy_goal = match player.team {
                Team::Blue => [FIELD_HALF_WIDTH, 0.0],
                Team::Red => [-FIELD_HALF_WIDTH, 0.0],
            };
            player.fitness +=
                fitness_function.add_by_goal_progress(&self.ball, &self.physics, enemy_goal);
            player.fitness += fitness_function.add_by_situation(
                player,
                &self.ball,
                &self.physics,
                [self.away_goals, self.local_goals],
            );
        }
        if self.frame.is_multiple_of((1.0 / self.dt()) as u64) {
            for player in self.players.iter_mut() {
                player.fitness += fitness_function.add_by_inactivity(player, &self.physics);
            }
        }

        if let Some(idx) = self.last_touch_index
            && let Some(pl) = self.players.get_mut(idx as usize)
        {
            let dist_now = self.ball.distance_to_goal(
                &self.physics,
                match pl.team {
                    Team::Blue => [FIELD_HALF_WIDTH, 0.0],
                    Team::Red => [-FIELD_HALF_WIDTH, 0.0],
                },
            );

            let progressed = matches!(self.ball.dist_at_touch, Some(previous) if dist_now <= previous- MIN_TOUCH_PROGRESS);

            if progressed && pl.claim_reward_for_touching(self.frame) {
                pl.fitness += fitness_function.add_by_touch();
            }

            self.ball.dist_at_touch = Some(dist_now);
        }
    }

    pub fn add_shot_fitness(&mut self) {
        let fitness_function = match self.mode {
            Mode::Exploration => ExplorationFitness::default(),
            Mode::Competition => ExplorationFitness::default(),
            Mode::Cooperation => ExplorationFitness::default(),
            Mode::FinalTest => ExplorationFitness::default(),
        };
        for player in self.players.as_mut_slice() {
            if !player.shot_on_frame(self.frame)
                && player
                    .physics
                    .is_in_corner(player.physics.position(&self.physics))
            {
                continue;
            }
            let enemy_goal = match player.team {
                Team::Blue => [FIELD_HALF_WIDTH, 0.0],
                Team::Red => [-FIELD_HALF_WIDTH, 0.0],
            };
            self.ball.prev_goal_distance =
                Some(self.ball.distance_to_goal(&self.physics, enemy_goal));
            player.fitness += fitness_function.add_by_shot(
                &self.ball,
                &self.physics,
                self.prev_ball_vel.into(),
                enemy_goal.into(),
            );
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
            score: [self.away_goals, self.local_goals],
        }
    }

    pub fn from_genome_same_mode(&mut self, genome: Vec<Vec<f32>>) {
        assert_eq!(genome.len(), self.players.len());

        for (i, player) in self.players.iter_mut().enumerate() {
            player.from_genome(&genome[i]);
        }
    }

    pub fn from_genome_change_mode(&mut self, genome: Vec<Vec<f32>>) {
        assert_eq!(genome.len(), self.players.len());

        for i in 0..self.players.len() {
            if let Some(genes) = genome.get(i) {
                self.players[i].from_genome(genes);
            } else {
                self.players[i].random_brain()
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct GameData {
    pub player_positions: Vec<[f32; 2]>,
    pub ball_position: [f32; 2],
    pub score: [u32; 2],
}

// Función train bunch sustituida por web workers
