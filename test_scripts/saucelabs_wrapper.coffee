#!/usr/bin/env coffee
console.log "\n\nStarting SauceLabs test script"

if process.env.SKIP_SAUCELABS_TEST?
  console.log "SKIP_SAUCELABS_TEST flag is up, skipping SauceLabs testing"
  process.exit 0

spawn = require('child_process').spawn

workingDir = process.env.WORKING_DIR or process.env.PACKAGE_DIR or './'
console.log "workingDir is " + workingDir

serverArgs = ['test-packages', '--once', '-p', 3000]
if not process.env.PACKAGES?
  serverArgs.push './'
else if process.env.PACKAGES isnt ''
  serverArgs = serverArgs.concat process.env.PACKAGES.split ';'

clientArgs = ["./#{process.env.TEST_SCRIPTS_DIR}/saucelabs_runner.coffee", '.saucelabs_config.json', 'http://localhost:3000']

meteor = spawn (process.env.TEST_COMMAND or 'mrt'), serverArgs, cwd: workingDir
meteor.stdout.pipe process.stdout
meteor.stderr.pipe process.stderr

meteor.on 'close', (code) ->
  console.log "mrt exited with code #{code}"
  process.exit code

startTesting = (data) ->
  data = data.toString()
  if data.match /10015|listening/
    console.log 'starting testing...'
    meteor.stdout.removeListener 'data', startTesting
    runTestSuite()
meteor.stdout.on 'data', startTesting

runTestSuite = () ->
  clientProcess = spawn 'coffee', clientArgs
  clientProcess.stdout.pipe process.stdout
  clientProcess.stderr.pipe process.stderr

  clientProcess.on 'close', (code) ->
    meteor.kill 'SIGQUIT'
    process.exit code
