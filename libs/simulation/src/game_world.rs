use std::ops::Div;

use crate::*;
use nalgebra::Point2;

// Medidas del campo (línea de gol a línea de gol / banda a banda).
pub const FIELD_HALF_WIDTH: f32 = 53.0;
pub const FIELD_HALF_HEIGHT: f32 = 34.5;
// Portería: hueco de 11 m (y en [-5.5, 5.5]) y 4 m de fondo.
pub const GOAL_HALF_HEIGHT: f32 = 5.5;
pub const GOAL_DEPTH: f32 = 4.0;

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
            Player::new(&mut physics, Point2::new(-25.0, 0.0), Team::Blue),
            Player::new(&mut physics, Point2::new(25.0, 0.0), Team::Red),
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
        }
    }

    pub fn dt(&self) -> f32 {
        self.physics.integration_parameters.dt
    }

    pub fn reset(&mut self) {
        let possible_positions = [0.0, 25.0, -25.0];

        for (i, player) in self.players.iter_mut().enumerate() {
            let real_position_x = if player.team == Team::Blue {
                25.0
            } else {
                -25.0
            };
            let real_position_y = possible_positions[(i + 1).div(2)];

            player
                .physics
                .reset(&mut self.physics, real_position_x, real_position_y)
        }
        self.ball.physics.reset(&mut self.physics, 0.0, 0.0);
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

        self.physics.step();
        self.check_goals();
        self.check_touches();
        self.calculate_fitness();
        for player in self.players.iter() {
            player.physics.reset_forces(&mut self.physics);
        }
        self.process_brains();
        self.ball.physics.reset_forces(&mut self.physics);
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
                            -50.0
                        } else {
                            50.0
                        };
                    }
                } else {
                    self.away_goals += 1;
                    let p_i = self.last_touch_index.unwrap_or(10000000);

                    if let Some(player) = self.players.get_mut(p_i as usize) {
                        player.fitness += if player.team == Team::Red {
                            50.0
                        } else {
                            -50.0
                        };
                    }
                }
                self.reset();
                break;
            }
        }
    }

    pub fn check_touches(&mut self) {
        let mut has_player_touched = false;
        for (i, player) in self.players.iter().enumerate() {
            let player_collider = self
                .physics
                .colliders
                .get(self.ball.physics.collider_handle)
                .unwrap();
            if let Some(contact) = self.physics.narrow_phase.contact_pair(
                self.ball.physics.collider_handle,
                player.physics.collider_handle,
            ) {
                if contact.has_any_active_contact() {
                    if has_player_touched == false {
                        self.last_touch_index = Some(i as u32);
                        continue;
                    }
                    self.last_touch_index = None;
                    break;
                }
            }
        }
    }

    pub fn calculate_fitness(&mut self) {
        let fitness_function = match self.mode {
            Mode::Exploration => ExplorationFitness::default(),
            Mode::Competition => ExplorationFitness::default(),
            Mode::Cooperation => ExplorationFitness::default(),
            Mode::FinalTest => ExplorationFitness::default(),
        };
        for player in self.players.iter_mut() {
            player.fitness += fitness_function.add_by_situation(
                player,
                &self.ball,
                &self.physics,
                [self.away_goals, self.local_goals],
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
}

#[derive(Clone, Debug)]
pub struct GameData {
    pub player_positions: Vec<[f32; 2]>,
    pub ball_position: [f32; 2],
    pub score: [u32; 2],
}
