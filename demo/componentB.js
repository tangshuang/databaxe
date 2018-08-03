import DataBaxe from '../src/databaxe'

export default class ComponentA {
  constructor(container, DataSources) {
    this.container = container
    this.data = new DataBaxe({ id: 'B', debug: true, expires: 1000, snapshots: 10 })
    this.data.register(Object.assign({ id: 'studentsB' }, DataSources.STUDENTS))
    this.data.autorun(this.render.bind(this))
  }
  async render() {
    let students = await this.data.get('studentsB')
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
    this.data.save('studentsB', {}, { testdata1: 'this is 1' }, { method: 'post' })
    this.data.save('studentsB', {}, { testdata2: 'another msg' }, { method: 'post' })
  }
}