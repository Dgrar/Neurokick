use crate::*;
use std::default::Default;
//*   **Acercamiento al balón:** `R_acercar = (Distancia_anterior - Distancia_actual) * 0.1`
//*   **Toque de balón (`+1.0` punto):** Colisión directa con el balón. Para evitar la explotación por contacto continuo, este premio se valida comprobando que el `current_frame - last_touch_frame > 30` (1 segundo a 30fps) o si el toque fue producto de una acción explícita de Chute.
//*   **Chute orientado (`+10.0` puntos):** Incremento de velocidad de la pelota si el vector resultante se dirige al campo rival.
//*   **Anotación de Gol (`+50.0` puntos):** Máxima recompensa instantánea de la fase.
//*   **Penalización por Inactividad (`-0.01` puntos/s):** Aplicada si el jugador o el balón permanecen estáticos.

const IDLE_SPEED: f32 = 1.0;
const MIN_SHOT_GAIN: f32 = 1.0;
// En radianes 0.7 es aprox 45%
const SHOT_TOLERANCE: f32 = 0.7;

pub struct ExplorationFitness {
    per_distance: f32,
    per_goal: f32,
    per_touch: f32,
    per_in_goal: f32,
    per_inactivity: f32,
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
    fn add_by_shot(
        &self,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        prev_vel: Vec2,
        enemy_goal: Vec2,
    ) -> f32;
}

impl Default for ExplorationFitness {
    fn default() -> Self {
        Self {
            per_distance: 0.1,
            per_goal: 50.0,
            per_touch: 1.0,
            per_in_goal: 10.0,
            per_inactivity: -0.01,
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
        let new_dist = player.get_distance_to(ball.physics.position(physics_world), physics_world);
        let prev_dist = player.prev_ball_distance.unwrap_or(new_dist);
        self.per_distance * (prev_dist - new_dist)
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
    fn add_by_shot(
        &self,
        ball: &GameBall,
        physics_world: &PhysicsWorld,
        prev_vel: Vec2,
        enemy_goal: Vec2,
    ) -> f32 {
        let velocity: Vec2 = ball.physics.velocity(physics_world).into();
        let speed_after = velocity.length();
        let speed_before = prev_vel.length();

        if speed_after <= speed_before + MIN_SHOT_GAIN {
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
        self.per_in_goal
    }
}
