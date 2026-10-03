use genetic_algorithm::{
    GaussianMutation, GeneticAlgorithm, Individual, RouletteSelection, UniformCrossover,
};

#[derive(Clone, Debug)]
struct TestIndividual {
    genome: Vec<f32>,
    fitness: f32,
}

impl Individual for TestIndividual {
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
#[cfg(test)]
mod tests {
    use super::*;
    use genetic_algorithm::{
        ArithmeticCrossover, CrossoverMethod, RandomArithmeticCrossover, SelectionMethod, Stats,
        TournamentSelection,
    };
    use rand::{Rng, RngExt, SeedableRng};
    use rand_chacha::ChaCha8Rng;
    use rayon::prelude::*;

    const POPULATION_SIZE: usize = 40;
    const EPOCHS: usize = 1000;
    const FIXED_ELITISM: usize = 2;
    const SEEDS: [u8; 4] = [1, 7, 10, 42];

    fn target_genes() -> Vec<f32> {
        vec![0.5, -0.8, 0.1, 0.2, -0.9, -0.1, 0.7, -0.4]
    }

    #[derive(Debug)]
    struct RunResult {
        seed: u8,
        param: String,
        initial_max: f32,
        final_max: f32,
        initial_avg: f32,
        final_avg: f32,
    }

    impl RunResult {
        fn improvement(&self) -> f32 {
            self.final_max - self.initial_max
        }

        fn improved(&self) -> bool {
            self.final_max > self.initial_max
        }
    }
    // Fn para evaluar el fitness
    fn evaluate_population(population: &mut [TestIndividual], target_genes: &[f32]) {
        population.par_iter_mut().for_each(|individual| {
            let mut distance_squared = 0.0;
            for (curr, targ) in individual.genome().iter().zip(target_genes.iter()) {
                distance_squared += (curr - targ).powi(2);
            }
            let distance = distance_squared.sqrt();
            individual.fitness = 100.0 / (1.0 + distance);
        });
    }
    // Fn para generar población aleatoria
    fn random_population(
        rng: &mut ChaCha8Rng,
        population_size: usize,
        genome_len: usize,
    ) -> Vec<TestIndividual> {
        (0..population_size)
            .map(|_| {
                let genes: Vec<f32> = (0..genome_len)
                    .map(|_| rng.random_range(-1.0..1.0))
                    .collect();
                TestIndividual::create(genes)
            })
            .collect()
    }

    // Fn para evolucionar
    fn run_evolution<S>(
        ga: &GeneticAlgorithm<S>,
        seed: u8,
        param: String,
        elitism: usize,
        target_genes: &[f32],
    ) -> (RunResult, TestIndividual)
    where
        S: SelectionMethod,
    {
        let mut rng = ChaCha8Rng::from_seed([seed; 32]);
        let mut population = random_population(&mut rng, POPULATION_SIZE, target_genes.len());

        let mut initial_max = 0.0;
        let mut initial_avg = 0.0;

        for generation in 0..EPOCHS {
            evaluate_population(&mut population, target_genes);
            if generation == 0 {
                let stats = Stats::new(&population);
                initial_max = stats.max_fitness;
                initial_avg = stats.avg_fitness;
            }

            let (next_gen, _) = ga.evolve(&mut rng, &population, elitism);
            population = next_gen;
        }

        evaluate_population(&mut population, target_genes);
        population.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap());
        let best = population[0].clone();

        let final_max = population[0].fitness;
        let final_avg = population.iter().map(|i| i.fitness).sum::<f32>() / population.len() as f32;

        (
            RunResult {
                seed,
                param,
                initial_max,
                final_max,
                initial_avg,
                final_avg,
            },
            best,
        )
    }

    fn print_progress(row: &RunResult) {
        println!(
            "seed={:>3} {:>11} | init_max={:>7.3} -> final_max={:>7.3} (Δ {:+7.3}) | init_avg={:>7.3} -> final_avg={:>7.3}",
            row.seed,
            row.param,
            row.initial_max,
            row.final_max,
            row.improvement(),
            row.initial_avg,
            row.final_avg,
        );
    }

    fn print_detail_table(results: &[RunResult]) {
        println!();
        println!("TABLA DETALLADA (cada fila = una seed × un valor del parámetro)");
        println!(
            "| {:>4} | {:>11} | {:>9} | {:>9} | {:>9} | {:>9} | {:>9} | {:>5} |",
            "seed", "param", "init_max", "final_max", "init_avg", "final_avg", "mejora Δ", "OK?"
        );
        println!(
            "|{:-<6}|{:-<13}|{:-<11}|{:-<11}|{:-<11}|{:-<11}|{:-<11}|{:-<7}|",
            "", "", "", "", "", "", "", ""
        );
        for r in results {
            println!(
                "| {:>4} | {:>11} | {:>9.3} | {:>9.3} | {:>9.3} | {:>9.3} | {:>+9.3} | {:>5} |",
                r.seed,
                r.param,
                r.initial_max,
                r.final_max,
                r.initial_avg,
                r.final_avg,
                r.improvement(),
                if r.improved() { "SI" } else { "NO" },
            );
        }
    }

    fn print_pivot(
        title: &str,
        params_order: &[String],
        results: &[RunResult],
        value: impl Fn(&RunResult) -> f32,
        signed: bool,
    ) {
        println!();
        println!("{title}");
        print!("| {:>4} |", "seed");
        for p in params_order {
            print!(" {:>11} |", p);
        }
        println!();
        print!("|{:-<6}|", "");
        for _ in params_order {
            print!("{:-<13}|", "");
        }
        println!();
        for &seed in &SEEDS {
            print!("| {:>4} |", seed);
            for p in params_order {
                let r = results
                    .iter()
                    .find(|r| r.seed == seed && r.param == *p)
                    .unwrap();
                if signed {
                    print!(" {:>+11.3} |", value(r));
                } else {
                    print!(" {:>11.3} |", value(r));
                }
            }
            println!();
        }
    }

    fn print_best_genomes(title: &str, target: &[f32], bests: &[(u8, String, Vec<f32>)]) {
        println!();
        println!("{title}");
        println!("  target: {target:?}");
        for (seed, param, genome) in bests {
            println!("  seed={seed:>3} {param:>11}: {genome:?}");
        }
    }

    fn assert_all_improved(results: &[RunResult]) {
        let failures: Vec<&RunResult> = results.iter().filter(|r| !r.improved()).collect();
        assert!(
            failures.is_empty(),
            "Los individuos no mejoran en {} combinaciones: {:?}",
            failures.len(),
            failures
        );
    }

    // Test de Roulette Y Uniform
    #[test]
    fn verify_convergency() {
        let target_genes = target_genes();
        let elitisms = [0, 1, 2, 3, 5, 10, 20];

        let mut results: Vec<RunResult> = Vec::with_capacity(SEEDS.len() * elitisms.len());
        let mut bests: Vec<(u8, String, Vec<f32>)> =
            Vec::with_capacity(SEEDS.len() * elitisms.len());

        for &seed in &SEEDS {
            for &elitism in &elitisms {
                let ga = GeneticAlgorithm::new(
                    RouletteSelection,
                    UniformCrossover,
                    GaussianMutation::new(0.2, 0.4),
                );
                let param = format!("elit={elitism}");
                let (row, best) = run_evolution(&ga, seed, param.clone(), elitism, &target_genes);
                print_progress(&row);
                bests.push((seed, param, best.genome.clone()));
                results.push(row);
            }
        }

        let order: Vec<String> = elitisms.iter().map(|e| format!("elit={e}")).collect();
        print_detail_table(&results);
        print_pivot(
            "TABLA PIVOTE: final_max por (seed × elitism)",
            &order,
            &results,
            |r| r.final_max,
            false,
        );
        print_pivot(
            "TABLA PIVOTE: mejora Δ por (seed × elitism)",
            &order,
            &results,
            |r| r.improvement(),
            true,
        );
        print_best_genomes(
            "MEJOR GENOMA por (seed × elitism) vs TARGET:",
            &target_genes,
            &bests,
        );
        assert_all_improved(&results);
    }

    // Test de tournamentSelection
    #[test]
    fn verify_convergency_tournament() {
        let target_genes = target_genes();
        let tournament_sizes = [1, 2, 3, 5, 10];

        let mut results: Vec<RunResult> = Vec::with_capacity(SEEDS.len() * tournament_sizes.len());
        let mut bests: Vec<(u8, String, Vec<f32>)> =
            Vec::with_capacity(SEEDS.len() * tournament_sizes.len());

        for &seed in &SEEDS {
            for &k in &tournament_sizes {
                let ga = GeneticAlgorithm::new(
                    TournamentSelection::new(k),
                    UniformCrossover,
                    GaussianMutation::new(0.2, 0.4),
                );
                let param = format!("k={k}");
                let (row, best) =
                    run_evolution(&ga, seed, param.clone(), FIXED_ELITISM, &target_genes);
                print_progress(&row);
                bests.push((seed, param, best.genome.clone()));
                results.push(row);
            }
        }

        let order: Vec<String> = tournament_sizes.iter().map(|k| format!("k={k}")).collect();
        print_detail_table(&results);
        print_pivot(
            "TABLA PIVOTE: final_max por (seed × torneo k)",
            &order,
            &results,
            |r| r.final_max,
            false,
        );
        print_pivot(
            "TABLA PIVOTE: mejora Δ por (seed × torneo k)",
            &order,
            &results,
            |r| r.improvement(),
            true,
        );
        print_best_genomes(
            "MEJOR GENOMA por (seed × torneo k) vs TARGET:",
            &target_genes,
            &bests,
        );
        assert_all_improved(&results);
    }

    // Test de alphas diferentes
    #[test]
    fn verify_convergency_arithmetic() {
        let target_genes = target_genes();
        let alphas = [0.1_f32, 0.25, 0.5];

        let mut results: Vec<RunResult> = Vec::with_capacity(SEEDS.len() * (alphas.len() + 1));
        let mut bests: Vec<(u8, String, Vec<f32>)> =
            Vec::with_capacity(SEEDS.len() * (alphas.len() + 1));

        for &seed in &SEEDS {
            for &alpha in &alphas {
                let ga = GeneticAlgorithm::new(
                    RouletteSelection,
                    ArithmeticCrossover::new(alpha),
                    GaussianMutation::new(0.2, 0.4),
                );
                let param = format!("alpha={alpha:.2}");
                let (row, best) =
                    run_evolution(&ga, seed, param.clone(), FIXED_ELITISM, &target_genes);
                print_progress(&row);
                bests.push((seed, param, best.genome.clone()));
                results.push(row);
            }
            let ga_rnd = GeneticAlgorithm::new(
                RouletteSelection,
                RandomArithmeticCrossover,
                GaussianMutation::new(0.2, 0.4),
            );
            let (row, best) = run_evolution(
                &ga_rnd,
                seed,
                "alpha=RND".to_string(),
                FIXED_ELITISM,
                &target_genes,
            );
            print_progress(&row);
            bests.push((seed, "alpha=RND".to_string(), best.genome.clone()));
            results.push(row);
        }

        let order = vec![
            "alpha=0.10".to_string(),
            "alpha=0.25".to_string(),
            "alpha=0.50".to_string(),
            "alpha=RND".to_string(),
        ];
        print_detail_table(&results);
        print_pivot(
            "TABLA PIVOTE: final_max por (seed × alpha)",
            &order,
            &results,
            |r| r.final_max,
            false,
        );
        print_pivot(
            "TABLA PIVOTE: mejora Δ por (seed × alpha)",
            &order,
            &results,
            |r| r.improvement(),
            true,
        );
        print_best_genomes(
            "MEJOR GENOMA por (seed × alpha) vs TARGET:",
            &target_genes,
            &bests,
        );
        assert_all_improved(&results);
    }
    #[test]
    fn guess_string_test() {}
}
