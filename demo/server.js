var express = require('express')
var app = express()
var bodyParser = require('body-parser')

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

var data = () => ([
  {
    name: 'lily',
    score: 128,
  },
  {
    name: 'gaofei',
    score: 140,
  },
  {
    name: 'jojo',
    score: 129,
  },
  {
    name: 'babi (has random score)',
    score: parseInt(Math.random() * 1000),
  },
])

app.get('/students', (req, res) => {
  res.json(data())
})
app.post('/students', (req, res) => {
  res.json(req.body)
})

app.use(express.static(__dirname + '/../dist'))
app.use(express.static(__dirname))

app.listen('3999', () => console.log('http://localhost:3999'))