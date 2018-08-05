var gulp = require('gulp')
var babel = require('gulp-babel')
var webpack = require('webpack-stream')
var gulpbufferify = require('gulp-bufferify')
var config = require('./webpack.config')

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