var gulp = require('gulp')
var babel = require('gulp-babel')
var webpack = require('webpack-stream')
var webpackbufferify = require('webpack-bufferify')
var gulpbufferify = require('gulp-bufferify')

var config = {
  mode: 'none',
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

gulp.src(__dirname + '/src/**/*')
  .pipe(babel())
  .pipe(gulpbufferify(function(content, file) {
    if (file.history[0].split('/').pop() === 'databaxe.js') {
      content = content.replace('exports.default = DataBaxe;', 'module.exports = DataBaxe;')
    }
    return content
  }))
  .pipe(gulp.dest(__dirname + '/dist'))

gulp.src(__dirname + '/src/databaxe.js')
  .pipe(webpack(config))
  .pipe(gulp.dest(__dirname + '/dist'))

config.output.filename = 'databaxe.module.js'
config.externals = [
  'hello-async',
  'hello-indexeddb',
  'hello-worker',
  'interpolate',
  'lodash.merge',
  'object-hashcode'
]
gulp.src(__dirname + '/src/databaxe.js')
  .pipe(webpack(config))
  .pipe(gulp.dest(__dirname + '/dist'))
