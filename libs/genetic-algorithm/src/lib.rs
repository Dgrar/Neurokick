use rand::{Rng, RngExt, rng, seq::IndexedRandom};

pub struct GeneticAlgorithm<S> {
    selection_method: S,
    crossover_method: Box<dyn CrossoverMethod>,
    mutation_method: Box<dyn MutationMethod>,
}

pub trait Individual {
    fn create(genome: Vec<f32>) -> Self;
    fn fitness(&self) -> f32;
    fn genome(&self) -> &Vec<f32>;
}

pub trait SelectionMethod {
    fn select<'a, I>(&self, rng: &mut dyn Rng, individuals: &'a [I]) -> &'a I
    where
        I: Individual;
}

impl<S> GeneticAlgorithm<S>
where
    S: SelectionMethod,
{
    pub fn new(
        selection_method: S,
        crossover_method: impl CrossoverMethod + 'static,
        mutation_method: impl MutationMethod + 'static,
    ) -> Self {
        Self {
            selection_method,
            crossover_method: Box::new(crossover_method),
            mutation_method: Box::new(mutation_method),
        }
    }
    pub fn evolve<I>(&self, rng: &mut dyn Rng, population: &[I]) -> Vec<I>
    where
        I: Individual,
    {
        assert!(!population.is_empty());

        (0..population.len())
            .map(|_| {
                let parent_a = self.selection_method.select(rng, population).genome();
                let parent_b = self.selection_method.select(rng, population).genome();

                let mut child = self.crossover_method.cross(rng, &parent_a, &parent_b);
                self.mutation_method.mutate(rng, &mut child);

                I::create(child)
            })
            .collect()
    }
}
#[derive(Debug)]
pub struct RouletteSelection;

impl SelectionMethod for RouletteSelection {
    fn select<'a, I>(&self, rng: &mut dyn Rng, individuals: &'a [I]) -> &'a I
    where
        I: Individual,
    {
        individuals
            .choose_weighted(rng, |individual| individual.fitness())
            .expect("No se ha podido escoger")
    }
}

pub trait CrossoverMethod {
    fn cross(&self, rng: &mut dyn Rng, parent_a: &[f32], parent_b: &[f32]) -> Vec<f32>;
}

#[derive(Debug)]
pub struct UniformCrossover;

impl CrossoverMethod for UniformCrossover {
    fn cross(&self, rng: &mut dyn Rng, parent_a: &[f32], parent_b: &[f32]) -> Vec<f32> {
        assert_eq!(parent_a.len(), parent_b.len());
        parent_a
            .iter()
            .zip(parent_b)
            .map(|(&a, &b)| if rng.random_bool(0.5) { a } else { b })
            .collect()
    }
}

pub trait MutationMethod {
    fn mutate(&self, rng: &mut dyn Rng, child: &mut Vec<f32>);
}

pub struct GaussianMutation {
    chance: f32,
    coefficient: f32,
}

impl GaussianMutation {
    pub fn new(chance: f32, coefficient: f32) -> Self {
        assert!(chance >= 0.0 && chance <= 1.0);
        Self {
            chance,
            coefficient,
        }
    }
}

impl MutationMethod for GaussianMutation {
    fn mutate(&self, rng: &mut dyn Rng, child: &mut Vec<f32>) {
        for gene in child.iter_mut() {
            let sign = if rng.random_bool(0.5) { 1.0 } else { -1.0 };

            if rng.random_bool(self.chance as f64) {
                *gene += self.coefficient * sign * rng.random::<f32>()
            }
        }
    }
}
#[cfg(test)]
mod tests {

    enum TestIndividual {
        WithGenome { chromosome: Vec<f32> },
        WithFitness { fitness: f32 },
    }

    impl TestIndividual {
        fn new(fitness: f32) -> Self {
            Self::WithFitness { fitness }
        }
    }
    impl Individual for TestIndividual {
        fn create(chromosome: Vec<f32>) -> Self {
            Self::WithGenome { chromosome }
        }

        fn fitness(&self) -> f32 {
            match self {
                Self::WithGenome { chromosome } => chromosome.iter().sum(),

                Self::WithFitness { fitness } => *fitness,
            }
        }
        fn genome(&self) -> &Vec<f32> {
            match self {
                Self::WithGenome { chromosome } => chromosome,

                Self::WithFitness { .. } => {
                    panic!("Usa un TestIndividual de fitness")
                }
            }
        }
    }
    use std::collections::BTreeMap;

    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;
    #[test]
    fn test_selection_method() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());

        let population = vec![
            TestIndividual::new(2.0),
            TestIndividual::new(1.0),
            TestIndividual::new(4.0),
            TestIndividual::new(6.0),
        ];

        let mut actual_histogram = BTreeMap::new();

        for _ in 0..1000 {
            let fitness = RouletteSelection.select(&mut rng, &population).fitness() as i32;

            *actual_histogram.entry(fitness).or_insert(0) += 1
        }
        let expected_histogram = BTreeMap::from_iter([(1, 76), (2, 155), (4, 310), (6, 459)]);

        assert_eq!(actual_histogram, expected_histogram);
    }
    #[test]
    fn test_crossover_method() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());
        let parent_a = TestIndividual::create(vec![0.0, 0.12, 1.1, 0.2]);
        let parent_b = TestIndividual::create(vec![0.32, 0.42, 0.9, 0.67]);

        let child_genes = UniformCrossover.cross(&mut rng, parent_a.genome(), parent_b.genome());

        let expected_genome = vec![0.32, 0.42, 1.1, 0.2];

        assert_eq!(child_genes, expected_genome)
    }

    mod test_mutation_method {
        use super::*;
        use approx::assert_relative_eq;
        fn actual(chance: f32, coeff: f32) -> Vec<f32> {
            let mut rng: ChaCha8Rng = ChaCha8Rng::from_seed(Default::default());
            let mut child: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0, 5.0].into_iter().collect();
            GaussianMutation::new(chance, coeff).mutate(&mut rng, &mut child);

            child.into_iter().collect()
        }
        #[test]
        fn check_0_probability() {
            let actual = actual(0.0, 1.0);
            let expected = vec![1.0, 2.0, 3.0, 4.0, 5.0];

            assert_relative_eq!(actual.as_slice(), expected.as_slice());
        }
        #[test]
        fn check_0_coeff() {
            let actual = actual(1.0, 0.0);
            let expected = vec![1.0, 2.0, 3.0, 4.0, 5.0];

            assert_relative_eq!(actual.as_slice(), expected.as_slice());
        }
        #[test]
        fn check_max_probability() {
            let actual = actual(1.0, 0.3);
            let expected = vec![0.7272811, 1.9302752, 3.134625, 4.0296926, 5.2167854];

            assert_relative_eq!(actual.as_slice(), expected.as_slice());
        }
    }
}
