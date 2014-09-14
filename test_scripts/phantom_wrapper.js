#!/usr/bin/env node

console.log("\n\nStarting PhantomJS test script");

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var workingDir = process.env.WORKING_DIR || process.env.PACKAGE_DIR || './';
console.log("workingDir is " + workingDir);

var serverArgs = ['test-packages', '--once', '--driver-package', 'test-in-console', '-p', 10015];
if (!process.env.PACKAGES) {
  serverArgs.push('./');
} else if (process.env.PACKAGES != '') {
  serverArgs = serverArgs.concat(process.env.PACKAGES.split(';'));
}

var clientArgs = ['./' + process.env.TEST_SCRIPTS_DIR + '/phantom_runner.js', 'http://localhost:10015'];

var meteor = spawn(process.env.TEST_COMMAND || 'mrt', serverArgs, {cwd: workingDir});
meteor.stdout.pipe(process.stdout);
meteor.stderr.pipe(process.stderr);

meteor.on('close', function (code) {
  console.log("mrt exited with code" + code);
  process.exit(code);
});

meteor.stdout.on('data', function startTesting(data) {
  var data = data.toString();
  if (data.match(/10015|listening/)) {
    console.log("starting tests...");
    meteor.stdout.removeListener('data', startTesting);
    runTestSuite();
  }
});

var runTestSuite = function() {
  var clientProcess = spawn('phantomjs', clientArgs, {stdio: 'inherit'});

  clientProcess.on('close', function (code) {
    console.log("Stopping Meteor");
    meteor.kill('SIGQUIT');
    // Make sure mongod is also stopped
    exec('killall mongod');
    process.exit(code);
  });

  clientProcess.on('error', function (error) {
    console.log("PhantomJS client process errored: " + error.toString());
    process.exit(1);
  });
}
