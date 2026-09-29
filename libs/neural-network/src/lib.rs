use rand::{Rng, RngExt};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Activation {
    Sigmoid, // Para el Tiro (Salida 0.0 a 1.0)
    Tanh,    // Para el Movimiento X / Y (Salida -1.0 a 1.0)
    Relu,    // Capas internas ocultas
}

impl Activation {
    fn apply(&self, x: f32) -> f32 {
        match self {
            Activation::Sigmoid => 1.0 / (1.0 + (-x).exp()),
            Activation::Tanh => x.tanh(),
            Activation::Relu => x.max(0.0),
        }
    }
}

pub struct NeuronTopology {
    pub activation: Activation,
}

pub struct LayerTopology {
    pub neurons: Vec<NeuronTopology>,
}

impl LayerTopology {
    pub fn uniform_layer(size: usize, activation: Activation) -> LayerTopology {
        let neurons = (0..size).map(|_| NeuronTopology { activation }).collect();
        LayerTopology { neurons }
    }

    pub fn output_layer() -> LayerTopology {
        let neurons = vec![
            NeuronTopology {
                activation: Activation::Tanh,
            },
            NeuronTopology {
                activation: Activation::Tanh,
            },
            NeuronTopology {
                activation: Activation::Sigmoid,
            },
        ];

        LayerTopology { neurons }
    }
}

#[derive(Debug)]
pub struct Network {
    layers: Vec<Layer>,
}

impl Network {
    pub fn random(
        rng: &mut dyn Rng,
        inputs_size: usize,
        layers_topology: &[LayerTopology],
    ) -> Network {
        assert!(!layers_topology.is_empty());

        let mut layers: Vec<Layer> = Vec::new();
        let mut current_input_size = inputs_size;

        for layer_topology in layers_topology {
            layers.push(Layer::random(rng, current_input_size, layer_topology));
            current_input_size = layer_topology.neurons.len();
        }

        Network { layers }
    }

    pub fn propagate(&self, inputs: &[f32]) -> Vec<f32> {
        self.layers
            .iter()
            .fold(inputs.to_vec(), |curr_inputs, layer| {
                layer.propagate(curr_inputs.as_slice())
            })
    }
}

#[derive(Debug)]
pub struct Layer {
    neurons: Vec<Neuron>,
}

impl Layer {
    pub fn random(rng: &mut dyn Rng, input_size: usize, topology: &LayerTopology) -> Layer {
        assert!(input_size > 0 && !topology.neurons.is_empty());
        let neurons = topology
            .neurons
            .iter()
            .map(|ind_topology| Neuron::random(rng, input_size, ind_topology.activation))
            .collect();
        Layer { neurons }
    }

    fn propagate(&self, inputs: &[f32]) -> Vec<f32> {
        self.neurons
            .iter()
            .map(|neuron| neuron.propagate(inputs))
            .collect()
    }
}

#[derive(Debug)]
pub struct Neuron {
    bias: f32,
    weights: Vec<f32>,
    activation: Activation,
}

impl Neuron {
    pub fn random(rng: &mut dyn Rng, input_size: usize, activation: Activation) -> Neuron {
        let (limit_weight, limit_bias) = match activation {
            Activation::Relu => {
                // Kaiming/He initialization: raiz(2/(input_size))
                // Compensa ReLu al forzar bias positivo
                let limit = (2.0 / input_size as f32).sqrt();

                (limit, 0.01)
            }
            Activation::Tanh | Activation::Sigmoid => {
                // Xavier / Glorot Initialization: raiz(1/ input_size)
                let limit: f32 = (1.0 / input_size as f32).sqrt();

                (limit, limit)
            }
        };

        let bias = if activation == Activation::Relu {
            limit_bias // 0.01 constante para no matar neuronas con valores nulos
        } else {
            rng.random_range(-limit_bias..limit_bias)
        };
        let weights = (0..input_size)
            .map(|_| rng.random_range(-limit_weight..limit_weight))
            .collect();
        Neuron {
            bias,
            weights,
            activation,
        }
    }

    fn propagate(&self, inputs: &[f32]) -> f32 {
        assert_eq!(self.weights.len(), inputs.len());
        let mut sum = 0.0;
        for (i, input) in inputs.iter().enumerate() {
            sum += self.weights[i] * input;
        }
        sum += self.bias;
        self.activation.apply(sum)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;
    #[test]
    fn random() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());
        let neuron = Neuron::random(&mut rng, 4, Activation::Relu);
        assert_relative_eq!(neuron.bias, 0.01);
        assert_relative_eq!(
            neuron.weights.as_slice(),
            vec![-0.44230857, 0.47647637, 0.57850236, 0.18586218].as_ref()
        )
    }
    #[test]
    fn test_propagate_deterministic() {
        let mut rng = ChaCha8Rng::from_seed(Default::default());

        let topologia = vec![
            LayerTopology::uniform_layer(4, Activation::Relu),
            LayerTopology::uniform_layer(8, Activation::Relu),
            LayerTopology::output_layer(),
        ];

        let network = Network::random(&mut rng, 4, &topologia);
        let inputs = vec![1.2, 4.2, 0.1, -2.4];

        let result = network.propagate(inputs.as_slice());

        println!("Network response: {:?}", result);
        assert_relative_eq!(
            result.as_slice(),
            [-0.015621166, -0.65999174, 0.57196516].as_ref()
        );
    }
}
