use crate::*;
use std::default::Default;
//*   **Acercamiento al balón:** `R_acercar = (Distancia_anterior - Distancia_actual) * 0.1`
//*   **Toque de balón (`+1.0` punto):** Colisión directa con el balón. Para evitar la explotación por contacto continuo, este premio se valida comprobando que el `current_frame - last_touch_frame > 30` (1 segundo a 30fps) o si el toque fue producto de una acción explícita de Chute.
//*   **Chute orientado (`+5.0` puntos):** Incremento de velocidad de la pelota si el vector resultante se dirige al campo rival.
//*   **Anotación de Gol (`+50.0` puntos):** Máxima recompensa instantánea de la fase.
//*   **Penalización por Inactividad (`-0.01` puntos/s):** Aplicada si el jugador o el balón permanecen estáticos.
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
}

impl Default for ExplorationFitness {
    fn default() -> Self {
        Self {
            per_distance: 0.1,
            per_goal: 50.0,
            per_touch: 1.0,
            per_in_goal: 5.0,
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
        score: [u32; 2], // [away, local]
    ) -> f32 {
        let mut new_fitness = player.fitness;

        // distancia anterior
        let new_player_distance =
            player.get_distance_to(ball.physics.position(physics_world), physics_world);

        new_fitness += self.per_distance
            * (new_player_distance - player.prev_ball_distance.unwrap_or(new_player_distance));

        new_fitness
    }
}
