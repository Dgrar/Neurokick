use crate::*;

//    pub ball_relative: (f32, f32),
//    pub closest_ally: Option<(f32, f32)>,
//    pub closest_enemy: (f32, f32),
//    pub enemy_goal: (f32, f32),
//    pub own_goal: (f32, f32),
//    pub field_limits: [f32; 4],
#[derive(Debug)]
pub struct Eye {}
impl Eye {
    #[allow(clippy::too_many_arguments)]
    pub fn see(
        &self,
        physics_world: &PhysicsWorld,
        parent_player: Player,
        other_players: Option<Vec<Player>>,
        ball: GameBall,
        own_goal_pos: f32,
        enemy_goal_pos: f32,
        field_limits: [f32; 4],
    ) -> Vec<f32> {
        let mut inputs: Vec<f32> = Vec::new();

        let ball_pos = ball.physics.position(physics_world);
        let player_pos = parent_player.physics.position(physics_world);

        let ball_relative_x = ball_pos[0] - player_pos[0];
        let ball_relative_y = ball_pos[1] - player_pos[1];

        inputs.push(ball_relative_x);
        inputs.push(ball_relative_y);

        let mut closest_teamate_distance = f32::MAX;
        let mut closest_teamate_pos: Option<[f32; 2]> = None;
        let mut closest_enemy_distance = f32::MAX;
        let mut closest_enemy_pos: [f32; 2] = [0.0, 0.0];
        if let Some(players) = other_players {
            for player in players.iter() {
                let dx = player.physics.position(physics_world)[0] - player_pos[0];
                let dy = player.physics.position(physics_world)[1] - player_pos[1];
                let distance = (dx * dx + dy * dy).sqrt();

                if player.team == parent_player.team {
                    if distance < closest_teamate_distance {
                        closest_teamate_distance = distance;
                        closest_teamate_pos = Some([dx, dy]);
                    }
                } else {
                    if distance < closest_enemy_distance {
                        closest_enemy_distance = distance;
                        closest_enemy_pos = [dx, dy];
                    }
                }
            }
        }
        if let Some([teamate_x, teamate_y]) = closest_teamate_pos {
            inputs.push(teamate_x);
            inputs.push(teamate_y);
        } else {
            inputs.push(0.0);
            inputs.push(0.0);
        }

        inputs.push(closest_enemy_pos[0]);
        inputs.push(closest_enemy_pos[1]);

        inputs.push(enemy_goal_pos);
        inputs.push(own_goal_pos);
        #[allow(unused_must_use)]
        field_limits.map(|limit| inputs.push(limit));

        inputs
    }
}
