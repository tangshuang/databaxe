import HelloIndexedDB from 'hello-indexeddb'

const $DB = new HelloIndexedDB({
  name: 'databaxe',
  version: 1,
  stores: [
    {
      name: 'data',
      primaryKey: 'requestId',
    },
    {
      name: 'snapshots',
      primaryKey: 'id',
      autoIncrement: true,
      indexes: [
        {
          name: 'id',
          unique: true,
        },
        {
          name: 'requestId',
        },
      ],
    },
  ],
})

export const $dataDB = $DB.use('data')
export const $snapshotsDB = $DB.use('snapshots')