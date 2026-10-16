use crate::*;

pub const EYE_INPUTS: usize = 16;

#[derive(Debug)]
pub struct Eye {}

impl Eye {
    #[allow(clippy::too_many_arguments)]
    pub fn see(
        &self,
        physics_world: &PhysicsWorld,
        parent_player: &Player,
        _other_players: Option<Vec<&Player>>,
        ball: &GameBall,
        own_goal_pos: [f32; 2],
        enemy_goal_pos: [f32; 2],
    ) -> Vec<f32> {
        let mut inputs: Vec<f32> = Vec::with_capacity(EYE_INPUTS);

        let ball_pos = ball.physics.position(physics_world);
        let ball_vel = ball.physics.velocity(physics_world);
        let player_pos = parent_player.physics.position(physics_world);

        let dx = ball_pos[0] - player_pos[0];
        let dy = ball_pos[1] - player_pos[1];
        let dist_to_ball = (dx * dx + dy * dy).sqrt();

        inputs.push(dx / FIELD_HALF_WIDTH);
        inputs.push(dy / FIELD_HALF_HEIGHT);
        inputs.push(dist_to_ball / FIELD_HALF_WIDTH);

        inputs.push(ball_vel[0] / BALL_MAX_SPEED);
        inputs.push(ball_vel[1] / BALL_MAX_SPEED);

        inputs.push(player_pos[0] / FIELD_HALF_WIDTH);
        inputs.push(player_pos[1] / FIELD_HALF_HEIGHT);

        let gx = enemy_goal_pos[0] - ball_pos[0];
        let gy = enemy_goal_pos[1] - ball_pos[1];
        inputs.push(gx / FIELD_HALF_WIDTH);
        inputs.push(gy / FIELD_HALF_HEIGHT);
        inputs.push((gx * gx + gy * gy).sqrt() / FIELD_HALF_WIDTH);

        let ox = own_goal_pos[0] - ball_pos[0];
        let oy = own_goal_pos[1] - ball_pos[1];
        inputs.push(ox / FIELD_HALF_WIDTH);
        inputs.push(oy / FIELD_HALF_HEIGHT);

        let dist_north = FIELD_HALF_HEIGHT - player_pos[1];
        let dist_south = FIELD_HALF_HEIGHT + player_pos[1];
        let dist_east = FIELD_HALF_WIDTH - player_pos[0];
        let dist_west = FIELD_HALF_WIDTH + player_pos[0];
        inputs.push(dist_north / FIELD_HALF_HEIGHT);
        inputs.push(dist_south / FIELD_HALF_HEIGHT);
        inputs.push(dist_east / FIELD_HALF_WIDTH);
        inputs.push(dist_west / FIELD_HALF_WIDTH);

        debug_assert_eq!(inputs.len(), EYE_INPUTS);
        inputs
    }
}
