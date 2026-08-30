import { publicExperienceCatalog } from './contract.mjs'

process.stdout.write(`${JSON.stringify(publicExperienceCatalog(), null, 2)}\n`)
