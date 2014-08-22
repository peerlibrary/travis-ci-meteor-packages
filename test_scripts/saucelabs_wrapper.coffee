#!/usr/bin/env coffee
console.log "\n\nStarting SauceLabs test script"

spawn = require('child_process').spawn
exec = require('child_process').exec

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
  clientProcess = spawn 'coffee', clientArgs, stdio: 'inherit'

  clientProcess.on 'close', (code) ->
    console.log "Stopping Meteor"
    meteor.kill 'SIGQUIT'
    exec 'killall mongod'
    process.exit code
