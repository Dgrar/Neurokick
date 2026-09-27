mod ball;
mod game_world;
mod physics_component;
mod player;

use {ball::*, game_world::*, physics_component::*, player::*};

use rapier2d::prelude::*;
use std::f32::consts::PI;

const FPS: f32 = 1.0 / 120.0;

fn main() {
    let mut world = PhysicsWorld::new();
    world.integration_parameters.dt = FPS;
}
