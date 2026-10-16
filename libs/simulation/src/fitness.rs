use crate::*;
use std::default::Default;
//*   **Acercamiento al balón:** `R_acercar = (Distancia_anterior - Distancia_actual) * 0.1`
//*   **Toque de balón (`+1.0` punto):** Colisión directa con el balón. Para evitar la explotación por contacto continuo, este premio se valida comprobando que el `current_frame - last_touch_frame > 30` (1 segundo a 30fps) o si el toque fue producto de una acción explícita de Chute.
//*   **Chute orientado (`+10.0` puntos):** Incremento de velocidad de la pelota si el vector resultante se dirige al campo rival.
//*   **Anotación de Gol (`+50.0` puntos):** Máxima recompensa instantánea de la fase.
//*   **Penalización por Inactividad (`-0.01` puntos/s):** Aplicada si el jugador o el balón permanecen estáticos.

const IDLE_SPEED: f32 = 0.1;
const MIN_SHOT_GAIN: f32 = 3.0;
// En radianes 0.7 es aprox 45%
const SHOT_TOLERANCE: f32 = 0.7;
// Ganancia de velocidad a la que el chute paga el premio completo.
const FULL_SHOT_GAIN: f32 = 10.0;

pub struct ExplorationFitness {
    pub per_goal: f32,
    per_distance: f32,
    per_score: f32,
    per_goal_progress: f32,
    per_touch: f32,
    per_in_goal: f32,
    per_inactivity: f32,
    per_corner: f32,
}
pub trait FitnessFunction {
    fn add_by_situation(
        &self,
        player: &mut Player,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        score: [u32; 2],
    ) -> f32;
    fn add_by_touch(&self) -> f32;
    fn add_by_inactivity(&self, player: &Player, physics_world: &PhysicsWorld) -> f32;
    fn add_by_shot(&self, ball: &GameBall, physics_world: &PhysicsWorld, enemy_goal: Vec2) -> f32;
    fn add_by_goal_progress(
        &self,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        enemy_goal: [f32; 2],
    ) -> f32;
    fn add_by_corner(&self, player: &Player, physics_world: &PhysicsWorld) -> f32;
}

impl Default for ExplorationFitness {
    fn default() -> Self {
        Self {
            per_distance: 1.0,
            per_goal: 150.0,
            per_score: 0.0,
            per_goal_progress: 1.0,
            per_touch: 0.5,
            per_in_goal: 10.0,
            per_inactivity: -0.01,
            per_corner: -0.1,
        }
    }
}

impl FitnessFunction for ExplorationFitness {
    fn add_by_situation(
        &self,
        player: &mut Player,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        score: [u32; 2],
    ) -> f32 {
        let mut fitness_gained = 0.0;

        let new_dist = player.get_distance_to(ball.physics.position(physics_world), physics_world);
        let prev_dist = player.prev_ball_distance.unwrap_or(new_dist);

        fitness_gained += self.per_distance * (prev_dist - new_dist);

        if player.team == Team::Blue {
            fitness_gained += self.per_score * (score[0] - score[1]) as f32
        } else {
            fitness_gained += self.per_score * (score[1] - score[0]) as f32
        }

        fitness_gained
    }
    fn add_by_touch(&self) -> f32 {
        self.per_touch
    }
    fn add_by_inactivity(&self, player: &Player, physics_world: &PhysicsWorld) -> f32 {
        let velocity: Vec2 = player.physics.velocity(physics_world).into();
        let speed = velocity.length();
        if speed < IDLE_SPEED {
            self.per_inactivity
        } else {
            0.0
        }
    }
    fn add_by_shot(&self, ball: &GameBall, physics_world: &PhysicsWorld, enemy_goal: Vec2) -> f32 {
        if !ball.shot_valid {
            return 0.0;
        }
        let ref_vel: Vec2 = ball.shot_ref_vel.into();
        let velocity: Vec2 = ball.physics.velocity(physics_world).into();
        let speed_after = velocity.length();
        if speed_after <= 0.0 {
            return 0.0;
        }
        let gain = speed_after - ref_vel.length();
        if gain < MIN_SHOT_GAIN {
            return 0.0;
        }

        let pos: Vec2 = ball.physics.position(physics_world).into();
        let to_goal: Vec2 = [enemy_goal[0] - pos[0], enemy_goal[1] - pos[1]].into();
        let dist = to_goal.length();
        if dist <= 0.0 {
            return 0.0;
        }
        let aim = (velocity[0] * to_goal[0] + velocity[1] * to_goal[1]) / (speed_after * dist);
        if aim < SHOT_TOLERANCE {
            return 0.0;
        }
        let power = ((gain - MIN_SHOT_GAIN) / (FULL_SHOT_GAIN - MIN_SHOT_GAIN)).clamp(0.0, 1.0);
        self.per_in_goal * power
    }
    fn add_by_goal_progress(
        &self,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        enemy_goal: [f32; 2],
    ) -> f32 {
        let now_pos = ball.distance_to_goal(physics_world, enemy_goal);
        let previous_pos = ball.prev_goal_distance.unwrap_or(now_pos);
        self.per_goal_progress * (previous_pos - now_pos)
    }
    fn add_by_corner(&self, player: &Player, physics_world: &PhysicsWorld) -> f32 {
        if player.physics.is_in_corner(
            player.physics.position(physics_world),
            Some(PLAYER_CORNER_MARGIN),
        ) {
            self.per_corner
        } else {
            0.0
        }
    }
}
