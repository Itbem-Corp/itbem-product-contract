import { loadContract } from './contract.mjs'
import { validateProductContract, validateRequestContext, validateRuntimeMessages } from './invariants.mjs'
import fs from 'node:fs'

validateProductContract(loadContract())

const requestContext = JSON.parse(fs.readFileSync(new URL('../contract/request-context.v1.json', import.meta.url), 'utf8'))
validateRequestContext(requestContext)

const runtimeMessages = JSON.parse(fs.readFileSync(new URL('../contract/runtime-messages.v1.json', import.meta.url), 'utf8'))
validateRuntimeMessages(runtimeMessages)
