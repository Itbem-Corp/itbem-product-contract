import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(root, 'contract', 'products.v1.json')

export function loadContract() {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'))
}

export function dashboardCatalog(contract = loadContract()) {
  return Object.fromEntries(contract.products.map((product) => [product.code, {
    identity: product.identity,
    deployment: {
      organizationCode: product.code,
      hostname: product.deployment.dashboardHostname,
      hostnames: product.deployment.dashboardHostnames,
      localHostnames: product.deployment.localDashboardHostnames,
      apiHostname: product.deployment.apiHostname,
      clientIdEnv: product.deployment.cognitoClientEnv
    }
  }]))
}
