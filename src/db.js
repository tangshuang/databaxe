import HelloIndexedDB from 'hello-indexeddb'

export const $dataDB = new HelloIndexedDB({
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
  use: 'data',
})
export const $snapshotsDB = $dataDB.use('snapshots')