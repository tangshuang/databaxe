class ComponentB {
  constructor(container, DataSources) {
    this.container = container
    this.dbx = new DataBaxe({ id: 'B', debug: true, expire: 1000 })
    this.dbx.register(Object.assign({ id: 'studentsB' }, DataSources.STUDENTS))
    this.dbx.autorun(this.render.bind(this))
  }
  async render() {
    let students = await this.dbx.get('studentsB')
    let list = ''
    students.forEach(std => {
      list += `
        <tr>
          <td>${std.name}</td>
          <td>${std.score}</td>
        </tr>
      `
    })
    let html = `
      <table border="0" cellspacing="0" cellpadding="0">
        ${list}
      </table>
    `
    document.querySelector(this.container).innerHTML = html
  }
  save() {
    this.dbx.save('studentsB', { testdata1: 'this is 1' })
    this.dbx.save('studentsB', { testdata2: 'another msg' })
  }
}
