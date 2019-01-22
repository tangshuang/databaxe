module.exports = {
  mode: 'none',
  entry: __dirname + '/src/databaxe.js',
  output: {
    path: __dirname + '/dist',
    filename: 'databaxe.js',
    library: 'databaxe',
    libraryTarget: 'umd',
    globalObject: 'typeof window !== undefined ? window : typeof global !== undefined ? global : typeof self !== undefined ? self : this',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
      },
    ]
  },
  externals: {
    'interpolate': true,
    'object-hashcode': true,
    'hello-async': true,
    'axios': true,
    'hello-storage': true,
  },
}
