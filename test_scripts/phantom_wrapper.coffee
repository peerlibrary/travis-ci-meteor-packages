#/usr/bin/env coffee
console.log "\n\nStarting PhantomJS test script"

spawn = require('child_process').spawn

workingDir = process.env.WORKING_DIR or process.env.PACKAGE_DIR or './'
console.log "workingDir is " + workingDir

serverArgs = ['test-packages', '--once', '--driver-package', 'test-in-console', '-p', 10015]
if not process.env.PACKAGES?
  serverArgs.push './'
else if process.env.PACKAGES isnt ''
  serverArgs = serverArgs.concat process.env.PACKAGES.split ';'

clientArgs = ["./#{process.env.TEST_SCRIPTS_DIR}/phantom_runner.js", 'http://localhost:10015']

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
  clientProcess = spawn 'phantomjs', clientArgs
  clientProcess.stdout.pipe process.stdout
  clientProcess.stderr.pipe process.stderr

  clientProcess.on 'close', (code) ->
    console.log "Sending SIGQUIT to meteor"
    meteor.kill 'SIGQUIT'
    process.exit code

  clientProcess.on 'error', (error) ->
    console.log "PhantomJS client process errored: #{error.toString()}"
    process.exit 1
