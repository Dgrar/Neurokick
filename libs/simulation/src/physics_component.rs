use crate::*;

pub struct PhysicsComponent {
    // El handle permite acceder al cuerpo mediante (world.getRigidBody(body_handle))
    body_handle: RigidBodyHandle,
    mass: f32,
    max_speed: f32,
    linear_damping: f32, // Fricción
}
#[allow(clippy::too_many_arguments)]
impl PhysicsComponent {
    pub fn new_circular(
        physics_world: &mut PhysicsWorld,
        pos: [f32; 2],
        radius: f32,
        mass: f32,
        max_speed: f32,
        restitution: f32,
        friction: f32,
        linear_damping: f32,
    ) -> Self {
        // Creamos un rigidbodybuilder y lo hacemos dinamico (Responde a fuerzas y colisiones, tambien las genera)
        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(Vec2 {
                // Le ponemos la posición del objeto
                x: pos[0],
                y: pos[1],
            })
            .linear_damping(linear_damping) // Hacemos que la disipacion de energía sea la establecida
            .linvel(Vec2 { x: 0.0, y: 0.0 }) // Hacemos que su velocidad inicial sea 0.0
            .build(); // Lo metemos en el mundo

        // Obtenemos el handle y lo insertamos en el mundo físico
        let body_handle = physics_world.bodies.insert(rigid_body);

        // Creamos el collider con forma de bola
        let collider = ColliderBuilder::ball(radius)
            .density(mass / (radius * radius * PI)) // Densidad = masa/volumen -> De circulo es Pi*r^2
            .friction(friction) // Friccion variable segun el objeto, la energia que pierde por rozamiento
            .restitution(restitution) // Lo que bota (Variable: bola: 0.7, jugador 0.2)
            .build();

        // Obtenemos el handle del collider, pero asociado al RigidBody de antes
        physics_world.colliders.insert_with_parent(
            collider,                  // Queremos el collider
            body_handle,               // El RigidBody padre del collider
            &mut physics_world.bodies, // La lista de los cuerpos del mundo (Mutable)
        );

        Self {
            body_handle,
            mass,
            max_speed,
            linear_damping,
        }
    }

    pub fn apply_force(&self, physics_world: &mut PhysicsWorld, fx: f32, fy: f32) {
        // Obtenemos el rigidbody de la lista de los rigidbodies del mundo físico
        let body = &mut physics_world.bodies[self.body_handle];

        // Aplicamos fuerza al cuerpo, el true es si se aplica en el centro de masa
        body.add_force(Vec2 { x: fx, y: fy }, true);

        // Calculamos la velocidad
        let current_vel = body.linvel();

        // Si es mayor que la velocidad máxima
        if current_vel.length() > self.max_speed {
            // Capamos la velocidad al vector por la velocidad maxima
            let capped_vel = (current_vel.normalize()) * self.max_speed;
            // La aplicamos
            body.set_linvel(capped_vel, true);
        }
    }

    // Funcion que devuelve la posicion
    pub fn position(&self, physics_world: &PhysicsWorld) -> [f32; 2] {
        let body = &physics_world.bodies[self.body_handle];
        let positions = body.translation();
        [positions[0], positions[1]]
    }
    // Función que devuelve la velocidad
    pub fn velocity(&self, physics_world: &PhysicsWorld) -> [f32; 2] {
        // Extraemos el rigidbody del mundo
        let body = &physics_world.bodies[self.body_handle];
        let velocity = body.linvel();
        [velocity[0], velocity[1]]
    }
}
