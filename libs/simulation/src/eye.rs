use crate::*;

#[derive(Debug)]
pub struct Eye {}
impl Eye {
    #[allow(clippy::too_many_arguments)]
    pub fn see(
        &self,
        physics_world: &PhysicsWorld,
        parent_player: &Player,
        other_players: Option<Vec<&Player>>,
        ball: &GameBall,
        own_goal_pos: [f32; 2],
        enemy_goal_pos: [f32; 2],
    ) -> Vec<f32> {
        let mut inputs: Vec<f32> = Vec::with_capacity(14);

        let ball_pos = ball.physics.position(physics_world);
        let player_pos = parent_player.physics.position(physics_world);

        // Dirección al balón.
        inputs.push((ball_pos[0] - player_pos[0]) / FIELD_HALF_WIDTH);
        inputs.push((ball_pos[1] - player_pos[1]) / FIELD_HALF_HEIGHT);

        // Posición del jugador en el campo (en base 1)
        inputs.push(player_pos[0] / FIELD_HALF_WIDTH);
        inputs.push(player_pos[1] / FIELD_HALF_HEIGHT);

        // El vector de la posición de la pelota a la porteria rival

        inputs.push((enemy_goal_pos[0] - ball_pos[0]) / FIELD_HALF_WIDTH);
        inputs.push((enemy_goal_pos[1] - ball_pos[1]) / FIELD_HALF_HEIGHT);

        // El vector de la posición de la pelota a la porteria propia
        inputs.push((own_goal_pos[0] - ball_pos[0]) / FIELD_HALF_WIDTH);
        inputs.push((own_goal_pos[1] - ball_pos[1]) / FIELD_HALF_HEIGHT);

        // Distancia a cada pared
        let dist_north = FIELD_HALF_HEIGHT - player_pos[1];
        let dist_south = FIELD_HALF_HEIGHT + player_pos[1];
        let dist_east = FIELD_HALF_WIDTH - player_pos[0];
        let dist_west = FIELD_HALF_WIDTH + player_pos[0];
        inputs.push(dist_north / FIELD_HALF_HEIGHT);
        inputs.push(dist_south / FIELD_HALF_HEIGHT);
        inputs.push(dist_east / FIELD_HALF_WIDTH);
        inputs.push(dist_west / FIELD_HALF_WIDTH);

        // Posición del compañero mas cercano si hay, si no hay es none
        let mut closest_teamate_pos: Option<[f32; 2]> = None;
        let mut closest_teamate_distance = f32::MAX;
        if let Some(players) = other_players {
            for player in players.iter() {
                if player.team != parent_player.team {
                    continue;
                }
                let dx = player.physics.position(physics_world)[0] - player_pos[0];
                let dy = player.physics.position(physics_world)[1] - player_pos[1];
                let distance = (dx * dx + dy * dy).sqrt();
                if distance < closest_teamate_distance {
                    closest_teamate_distance = distance;
                    closest_teamate_pos = Some([dx, dy]);
                }
            }
        }
        if let Some([teamate_x, teamate_y]) = closest_teamate_pos {
            inputs.push(teamate_x / FIELD_HALF_WIDTH);
            inputs.push(teamate_y / FIELD_HALF_HEIGHT);
        } else {
            inputs.push(0.0);
            inputs.push(0.0);
        }

        inputs
    }
}
