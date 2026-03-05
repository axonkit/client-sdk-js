import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const external = ['mediasoup-client'];

export default {
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
      globals: {
        'mediasoup-client': 'mediasoupClient',
      },
    },
  ],
  external,
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', declaration: true, declarationDir: 'dist' }),
    terser(),
  ],
};
