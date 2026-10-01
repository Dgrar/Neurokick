use rand::{Rng, rng, seq::IndexedRandom};

pub struct GeneticAlgorithm<S> {
    selection_method: S,
}

pub trait Individual {
    fn create(genome: Vec<f32>) -> Self;
    fn fitness(&self) -> f32;
    fn genome(&self) -> Vec<f32>;
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
        //crossover_method: impl CrossoverMethod + 'static,
        //mutation_method: impl MutationMethod + 'static,
    ) -> Self {
        Self {
            selection_method,
            //crossover_method: Box::new(crossover_method),
            //mutation_method: Box::new(mutation_method),
        }
    }
    pub fn evolve<I>(&self, rng: &mut dyn Rng, population: &[I]) -> Vec<I>
    where
        I: Individual,
    {
        assert!(!population.is_empty());

        let new_population = (0..population.len())
            .map(|_| {
                let parent_a = self.selection_method.select(rng, population).genome();
                let parent_b = self.selection_method.select(rng, population).genome();

                // Todo Crossover
                // Todo Mutation

                I::create(parent_a)
            })
            .collect();

        new_population
    }
}

pub struct StochasticUniversalSelection;

impl SelectionMethod for StochasticUniversalSelection {
    fn select<'a, I>(&self, rng: &mut dyn Rng, individuals: &'a [I]) -> &'a I
    where
        I: Individual,
    {
        individuals
            .choose_weighted(rng, |individual| individual.fitness())
            .expect("No se ha podido escoger")
    }
}
