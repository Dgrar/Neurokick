use crate::*;

#[derive(Debug, Clone)]
pub struct PlayerIndividual {
    fitness: f32,
    genome: Vec<f32>,
}

impl PlayerIndividual {
    pub fn from_player(player: Player) -> PlayerIndividual {
        let fitness = player.fitness;
        let genome = player.brain.to_genome();

        PlayerIndividual { fitness, genome }
    }
}

impl Individual for PlayerIndividual {
    fn create(genome: Vec<f32>) -> Self {
        Self {
            genome,
            fitness: 0.0,
        }
    }
    fn fitness(&self) -> f32 {
        self.fitness
    }

    fn genome(&self) -> &Vec<f32> {
        &self.genome
    }
}
