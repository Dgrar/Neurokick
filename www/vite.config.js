import {defineConfig} from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
    plugins: [wasm()],
    worker: {
        // Los workers cargan el .wasm (top-level await): necesitan formato ES,
        // el formato IIFE por defecto lo prohíbe y rompe `vite build`.
        format: "es",
    },
});
