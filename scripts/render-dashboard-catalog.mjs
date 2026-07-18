import { dashboardCatalog } from './contract.mjs'

process.stdout.write(`${JSON.stringify(dashboardCatalog(), null, 2)}\n`)
