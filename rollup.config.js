import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  onwarn(warning, warn) {
    // Ignore circular dependencies in node_modules
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      if (warning.ids && warning.ids.every((id) => id.includes('node_modules'))) {
        return;
      }
    }
    warn(warning);
  },
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/axonkit-client.esm.js',
      format: 'es',
      sourcemap: false,
    },
    {
      file: 'dist/axonkit-client.umd.js',
      format: 'umd',
      name: 'AxonKit',
      sourcemap: false,
    },
  ],
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.build.json',
      declaration: true,
      declarationDir: 'dist',
      sourceMap: false,
      inlineSources: false,
    }),
    terser(),
  ],
};
