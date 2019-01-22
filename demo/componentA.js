class ComponentA {
  constructor(container, DataSources) {
    this.container = container
    this.dbx = new DataBaxe({ id: 'A' })
    this.dbx.register(Object.assign({ id: 'studentsA' }, DataSources.STUDENTS))
    this.dbx.autorun(this.render.bind(this))
  }
  async render() {
    let students = await this.dbx.get('studentsA')
    let list = ''
    students.forEach(std => {
      list += '<li>' + std.name + ': ' + std.score + '</li>'
    })
    let html = `<ul>${list}</ul>`
    document.querySelector(this.container).innerHTML = html
  }
}
