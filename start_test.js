#!/usr/bin/env node
var spawn = require('child_process').spawn;

var testOnPhantomJS = !process.env.SKIP_PHANTOMJS_TESTS
var testOnSauceLabs = !process.env.SKIP_SAUCELABS_TESTS

var workingDir = process.env.WORKING_DIR || process.env.PACKAGE_DIR || './';
var phantomjsServerArgs = ['test-packages', '--once', '--driver-package', 'test-in-console', '-p', 10015];
var sauceLabsServerArgs = ['test-packages', '--once', '-p', 3000];
if (typeof process.env.PACKAGES === 'undefined') {
  phantomjsServerArgs.push('./');
  sauceLabsServerArgs.push('./');
}
else if (process.env.PACKAGES !== '') {
  phantomjsServerArgs = phantomJSargs.concat(process.env.PACKAGES.split(';'));
  sauceLabsServerArgs = sauceLabsArgs.concat(process.env.PACKAGES.split(';'));
}

phantomjsClientArgs = ['./phantom_runner.js', 'http://localhost:10015'];
sauceLabsClientArgs = ['./saucelabs_runner.coffee', '.saucelabs_config.json', 'http://localhost:3000'];

runTests(phantomjsServerArgs, 'phantomjs', phantomjsClientArgs, function() {
  runTests(sauceLabsServerArgs, 'coffee', sauceLabsClientArgs, function() {
    process.exit(0);
  });
});

function runTests(serverArgs, client, clientArgs, callback) {
  if (
    client === 'phantomjs' && process.env.SKIP_PHANTOMJS_TESTS ||
    client === 'coffee' && process.env.SKIP_SAUCELABS_TESTS
  ) {
    if (callback) {
      callback();
    }
    return;
  }

  var meteor = spawn((process.env.TEST_COMMAND || 'mrt'), serverArgs, {cwd: workingDir});
  meteor.stdout.pipe(process.stdout);
  meteor.stderr.pipe(process.stderr);
  meteor.on('close', function (code) {
    console.log('mrt exited with code ' + code);
    process.exit(code);
  });

  meteor.stdout.on('data', function startTesting(data) {
    var data = data.toString();
    if(data.match(/10015|listening/)) {
      console.log('starting testing...');
      meteor.stdout.removeListener('data', startTesting);
      runTestSuite();
    }
  });

  function runTestSuite() {
    var clientProcess = spawn(client, clientArgs);
    clientProcess.stdout.pipe(process.stdout);
    clientProcess.stderr.pipe(process.stderr);

    clientProcess.on('close', function(code) {
      meteor.kill('SIGQUIT');
      if (code) {
        process.exit(code);
      } else if (callback) {
        callback()
      }
    });
  }
}
