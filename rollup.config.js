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
      sourcemap: true,
    },
    {
      file: 'dist/axonkit-client.umd.js',
      format: 'umd',
      name: 'AxonKit',
      sourcemap: true,
    },
  ],
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist' }),
    terser(),
  ],
};
