module.exports = [
  {
    path: 'dist/axonkit-client.esm.js',
    import: '{ Room }',
    limit: '100 kB',
  },
  {
    path: 'dist/axonkit-client.umd.js',
    import: '{ Room }',
    limit: '120 kB',
  },
];
