// Script para comprobar que funciona la física

mod ball;
mod game_world;
mod physics_component;
mod player;

use {ball::*, game_world::*, physics_component::*, player::*};

use rapier2d::prelude::*;
use std::f32::consts::PI;

const FPS: f32 = 1.0 / 120.0;

fn main() {
    let mut world = GameWorld::new(PhysicsWorld::new());
    world.physics.integration_parameters.dt = FPS;
    world.physics.gravity = Vec2 { x: 0.0, y: 0.0 };

    world.apply_external_force(0, -90.0, 1.4);
    for i in 0..1000 {
        world.step();
        if i % 20 == 0 {
            println!("{:?}", world.get_world_state());
        }
    }
}
