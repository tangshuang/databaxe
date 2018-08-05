var webpackbufferify = require('webpack-bufferify')

module.exports = {
  mode: 'none',
  entry: __dirname + '/src/databaxe.js',
  output: {
    path: __dirname + '/dist',
    filename: 'databaxe.bundle.js',
    library: 'DataBaxe',
    libraryTarget: 'umd',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
      },
    ]
  },
  plugins: [
    webpackbufferify(function(content) {
      content = content.replace('exports.default = DataBaxe;', 'module.exports = DataBaxe;')
      return content
    }),
  ],
}
