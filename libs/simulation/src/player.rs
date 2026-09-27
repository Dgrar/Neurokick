use crate::*;

const PLAYER_MAX_SPEED: i32 = 10;
const PLAYER_FRICTION: f32 = 0.5;
const PLAYER_DAMPING: f32 = 0.1;
const PLAYER_RADIUS: f32 = 9.5;
const PLAYER_RETRIBUTION: f32 = 0.2;
pub struct Player {
    // brain: Red neuronal
    // eye: el ojo
    pub physics: PhysicsComponent,
}
