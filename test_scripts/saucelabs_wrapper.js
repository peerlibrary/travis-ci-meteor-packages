#!/user/bin/env node
console.log("\n\nStarting SauceLabs test script");

var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var workingDir = process.env.WORKING_DIR || process.env.PACKAGE_DIR || './';
console.log("workingDir is " + workingDir);

var serverArgs = ['test-packages', '--once', '-p', 3000];
if (!process.env.PACKAGES) {
  serverArgs.push('./');
} else if (process.env.PACKAGES != '') {
  serverArgs = serverArgs.concat(process.env.PACKAGES.split(';'));
}

var clientArgs = ['./' + process.env.TEST_SCRIPTS_DIR + '/saucelabs_runner.js',
                  '.saucelabs_config.json', 'http://localhost:3000'];

var meteor = spawn(process.env.TEST_COMMAND || 'mrt', serverArgs, {cwd: workingDir});
meteor.stdout.pipe(process.stdout);
meteor.stderr.pipe(process.stderr);

meteor.on('close', function (code) {
  console.log("mrt exited with code" + code);
  process.exit(code);
});

meteor.stdout.on('data', function startTesting (data) {
  var data = data.toString();
  if (data.match(/10015|listening/)) {
    console.log("starting tests...");
    meteor.stdout.removeListener('data', startTesting);
    runTestSuite();
  }
});

var runTestSuite = function () {
  clientProcess = spawn('node', clientArgs, {stdio: 'inherit'});

  clientProcess.on('close', function (code) {
    console.log("Stopping Meteor");
    meteor.kill('SIGQUIT');
    exec('killall mongod');
    process.exit(code);
  });
}
