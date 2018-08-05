class ComponentA {
  constructor(container, DataSources) {
    this.container = container
    this.data = new DataBaxe({ id: 'A', snapshots: 10 })
    this.data.register(Object.assign({ id: 'studentsA' }, DataSources.STUDENTS))
    this.data.autorun(this.render.bind(this))
  }
  async render() {
    let students = await this.data.get('studentsA')
    let list = ''
    students.forEach(std => {
      list += '<li>' + std.name + ': ' + std.score + '</li>'
    })
    let html = `<ul>${list}</ul>`
    document.querySelector(this.container).innerHTML = html
  }
}