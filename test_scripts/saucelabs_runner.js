console.log("Running Meteor tests on SauceLabs");

var _ = require('underscore');
var fs = require('fs');
var http = require('http');
var webdriver = require('wd');
var wdSync = require('wd-sync');
var _when = require('when');
var parallel = require('when/parallel');
var sequence = require('when/sequence');
var rerun = require('rerun');
var clc = require('cli-color');

var httpRequestsWithoutResponse = 0;
var exitStatus = null;
var passedBrowsersCount = 0;
var failedBrowsersCount = 0;
var erroredBrowsersCount = 0;
var totalBrowserRunCount = 0;

var STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  ERROR: 'error'
};

var SauceLabs = {
  username: null,
  apikey: null,

  createClient: function () {
    return wdSync.remote(
      'ondemand.saucelabs.com',
      80,
      this.username,
      this.apikey
    );
  },

  setTestResult: function (sessionId, isPassed) {
    var result = _when.defer();

    try {
      var body = new Buffer(JSON.stringify({data: isPassed}));
      httpRequestsWithoutResponse++;

      var request = http.request({
        hostname: 'saucelabs.com',
        port: 80,
        path: '/rest/v1/' + this.username + '/jobs/' + sessionId,
        method: 'PUT',
        auth: this.username + ':' + this.apikey,
        headers: {'Content-length': body.length}
      }, function (response) {
        httpRequestsWithoutResponse--;
        if (response.statusCode === 200) {
          result.resolve();
        } else {
          result.reject('http status code ' + result.statusCode);
        }
        exitIfFinished();
      });

      request.on('error', function (error) {
        result.reject(error);
      });

      request.write(body);
      request.end();
    } catch (error) {
      result.reject(error);
    }

    return result.promise;
  }
}

var BrowserTest = (function () {
  function BrowserTest (browserCapabilities, minimumPassedTestsOnClientRequired,
                        minimumPassedTestsOnServerRequired) {
    this.run = ++totalBrowserRunCount;
    this.tryCount = 0;
    this.browserCapabilities = browserCapabilities;
    this.minimumPassedTestsOnClientRequired = minimumPassedTestsOnClientRequired || 0;
    this.minimumPassedTestsOnServerRequired = minimumPassedTestsOnServerRequired || 0;
  }

  BrowserTest.prototype.getDescription = function () {
    return this.browserCapabilities.browserName +
           " " + this.browserCapabilities.version +
           " on " + this.browserCapabilities.platform;
  }

  BrowserTest.prototype.increaseTryCount = function () {
    this.tryCount++;
  }

  BrowserTest.prototype.getTryCount = function() {
    return this.tryCount;
  }

  BrowserTest.prototype.setTestResult = function (testResult) {
    if (this.testResult)
      return; // Do not allow overriding existing test result

    this.testResult = testResult;
    if (this.testResult && this.testResult.status === STATUS.PASS) {
      passedBrowsersCount++;
      SauceLabs.setTestResult(this.sessionId, true);
    } else if (this.testResult && this.testResult.status === STATUS.FAIL) {
      failedBrowsersCount++;
      SauceLabs.setTestResult(this.sessionId, false);
    } else {
      erroredBrowsersCount++;
    }
  }

  BrowserTest.prototype.getTestCounts = function () {
    if (this.testResult && typeof this.testResult.passedCount !== 'undefined' &&
        typeof this.testResult.failedCount !== 'undefined') {

      return this.testResult.passedCount + " tests passed, " +
             this.testResult.failedCount + " tests failed"
    } else {
      return "Invalid test status"
    }
  }

  BrowserTest.prototype.getTestDetailsLink = function() {
    if (this.sessionId) {
      return "Details on SauceLabs: https://saucelabs.com/tests/" + this.sessionId;
    } else {
      return "Unable to generate test details link because test did not initialize on SauceLabs"
    }
  }

  // Logging methods
  BrowserTest.prototype.logVerbose = function (message) {
    console.log(this.run + ': ' + message);
  }

  BrowserTest.prototype.logLaunch = function () {
    if (this.tryCount === 1) {
      console.log(clc.whiteBright.bold.bgYellow("\n## Launching browser " + this.getDescription() + "\n"));
    } else {
      console.log(clc.whiteBright.bold.bgYellow("\n## Relaunching browser " + this.getDescription() + " (Try " + this.tryCount + ")\n"));
    }
  }

  BrowserTest.prototype.logSuccess = function () {
    console.log(clc.whiteBright.bold.bgGreen("\n## Test passed in " + this.getDescription()));
    conosle.log(clc.whiteBright.bold.bgGreen("## " + this.getTestCounts()));
    console.log(clc.whiteBright.bold.bgGreen("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logFailure = function() {
    console.log(clc.whiteBright.bold.bgRed("\n## Test failed in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestCounts()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logError = function(error) {
    console.log(clc.whiteBright.bold.bgRed("\n## Test errored in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("## Error: " + error.toString()));
    console.log(clc.whiteBright.bold.bgRed("## " + this.getTestDetailsLink() + "\n"));
  }

  BrowserTest.prototype.logTimeout = function(error) {
    console.log(clc.whiteBright.bold.bgRed("\n## Test timed out in " + this.getDescription()));
    console.log(clc.whiteBright.bold.bgRed("\n## Retrying...\n"));
  }

  // Test implementation
  var now = function () {
    return new Date().getTime();
  }

  // Params:
  //   timeout: poll timeout in ms
  //   interval: poll interval in ms
  //   progressFunction: progress callback
  //   testFunction: function which tests if polling is over
  var poll = function(params) {
    var give_up = now() + params.timeout;
    while (true) {
      var ok = params.testFunction();
      if (ok !== null && typeof ok !== 'undefined') {
        return ok;
      } else if (now() > give_up) {
        return null;
      } else {
        if (params.progressFunction !== null && typeof params.progressFunction !== 'undefined') {
          params.progressFunction();
          wdSync.sleep(params.interval);
        }
      }
    }
  }

  // Creates client on SauceLabs
  BrowserTest.prototype.createClient = function() {
    var client = SauceLabs.createClient();
    var browserTest = this;
    client.browser.on('status', function(info) {
      browserTest.logVerbose("Status: " + info);
    });
    client.browser.on('command', function(meth, path) {
      browserTest.logVerbose("Command: " + meth + " " + path);
    });
    return client;
  }

  // Runs tests
  BrowserTest.prototype.runTests = function() {
    var done = _when.defer();

    this.logLaunch();
    var client = this.createClient();
    var browser = client.browser;
    var browserTest = this;

    // TODO: extend browser capabilities (max-duration, name, tunnel identifier)

    client.sync(function () {
      var testStatus = null;
      try {
        // Initiate browser
        browserTest.sessionId = browser.init(browserTest.browserCapabilities);
        browser.setImplicitWaitTimeout(1000);

        // Get main (and only) browser window
        windowHandles = browser.windowHandles();
        if (windowHandles.length !== 1) throw new Error("Expected one open window.");
        mainWindowHandle = windowHandles[0];

        // Load test URL in browser
        browser.get(url);

        // Wait for header to appear. When it does, tests are running.
        var ok = poll({
          timeout: 10000,
          interval: 1000,
          progressFunction: function() {
            return browser.hasElementByCssSelector('.header');
          },
          testFunction: function() {
            browserTest.logVerbose("Waiting for .header div to appear");
          }
        });
        browserTest.logVerbose("Tests are running");

        // Check test results
        result = poll({
          timeout: 20000,
          interval: 1000,
          progressFunction: function() {
            clientTestFilter = function (element) {
              return element.text().search('C: ') >= 0;
            }
            serverTestFilter = function (element) {
              return element.text().search('S: ') >= 0;
            }

            // Focus main window
            browser.window(mainWindowHandle);

            // Check status divs
            var runningCount = browser.elementsByCssSelector('.running').length;
            var failedCount = browser.elementsByCssSelector('.failed').length;
            var passedCount = browser.elementsByCssSelector('.passed').length;
            var clientPassedCount = _.countBy(browser.elementsByCssSelector('.succeeded'), clientTestFilter).true;
            var serverPassedCount = _.countBy(browser.elementsByCssSelector('.succeeded'), serverTestFilter).true;

            console.log(runningCount);
            console.log(failedCount);
            console.log(passedCount);
            console.log(clientPassedCount);
            console.log(serverPassedCount);

            // Determine test status
            if (runningCount == 0 && failedCount == 0 && passedCount > 0 &&
                clientPassedCount >= browserTest.minimumPassedTestsOnClientRequired &&
                serverPassedCount >= browserTest.minimumPassedTestsOnServerRequired) {
              return {
                status: STATUS.PASS,
                passedCount: passedCount,
                clientPassedCount: clientPassedCount,
                serverPassedCount: serverPassedCount,
                failedCount: 0
              };
            }
            else if (runningCount == 0 && (failedCount > 0 || passedCount == 0 ||
                                           clientPassedCount < browserTest.minimumPassedTestsOnClientRequired ||
                                           serverPassedCount < browserTest.minimumPassedTestsOnServerRequired)) {
              return {
                status: STATUS.FAILED,
                passedCount: passedCount,
                clientPassedCount: clientPassedCount,
                serverPassedCount: serverPassedCount,
                failedCount: failedCount
              };
            }
            else {
              return null;
            }
          },
          testFunction: function() {
            browserTest.logVerbose("Waiting for tests to finish...");
          }
        });

        if (!result)
          throw new Error("Tests did not complete within timeout.");
      } catch (error) {
        browserTest.logVerbose("Error: " + error);
        // Do not continue testing if error occurs. Do not try to set status because it will fail as well.
        done.reject(new rerun.RejectError(error.message));
        return;
      }

      // Shut down browser
      try {
        browserTest.logVerbose("Shutting down the browser");
        browser.quit();
      } catch (error) {
        browserTest.logVerbose("Unable to shut down browser. Error " + error);
      }

      // Set test result
      browserTest.setTestResult(result);

      // Log status and resolve
      if (result.status === STATUS.PASS) {
        browserTest.logSuccess();
        done.resolve(true);
      } else if (result.status === STATUS.FAIL) {
        browserTest.logFailure();
        done.resolve(false);
      } else {
        done.reject(new rerun.RejectError("Browser test errored on SauceLabs"));
      }
    });

    return done.promise;
  }

  return BrowserTest;
})();

var readJsonFile = function (filePath) {
  var contents = fs.readFileSync(filePath, 'utf-8');
  try {
    var json = JSON.parse(contents);
  } catch (error) {
    console.log("Unable to parse " + filePath + " as JSON:");
    console.log(error);
    process.exit(1);
  }
  return json;
}

// Check environment variables, set defaults
if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
  console.log("SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are requrired.");
  process.exit(1);
} else {
  SauceLabs.username = process.env.SAUCE_USERNAME;
  SauceLabs.apikey = process.env.SAUCE_ACCESS_KEY;
}
if (!process.env.SAUCELABS_REQUIRE_SERVER_TEST) process.env.SAUCELABS_REQUIRE_SERVER_TEST = '0';
if (!process.env.SAUCELABS_REQUIRE_CLIENT_TEST) process.env.SAUCELABS_REQUIRE_CLIENT_TEST = '1';
var minimumRequiredServerTests = 0;
var minimumRequiredClientTests = 0;
if (process.env.SAUCELABS_REQUIRE_CLIENT_TEST == '1') minimumRequiredServerTests = 1;
if (process.env.SAUCELABS_REQUIRE_SERVER_TEST == '1') minimumRequiredClientTests = 1;

// Check CLI arguments and read config file
var testConfigFile = process.argv[2];
if (!testConfigFile) {
  console.log("Specify the SauceLabs test config JSON file on the command line");
  process.exit(1);
}
var testConfig = readJsonFile(testConfigFile);

var url = process.argv[3];
if (!url) {
  console.log("Specify the Meteor tinytest application URL");
  process.exit(1);
}

// Generate single browser test task
var singleBrowserTimeout = 90 * 1000 // ms
var retry = rerun.promise;
var genTask = function (browserCapabilities) {
  browserCapabilities = _.extend(browserCapabilities, {
    'max-duration': 120,
    name: testConfig.name,
    'tunnel-identifier': process.env.TRAVIS_JOB_NUMBER
  });
  var browserTest = new BrowserTest(browserCapabilities, minimumRequiredClientTests, minimumRequiredServerTests);
  return function () {
    var promise = retry(function() {
      console.log("Calling retry function");
      browserTest.increaseTryCount();
      if (browserTest.getTryCount() > 1) browserTest.logTimeout();
      return browserTest.runTests().timeout(singleBrowserTimeout, "Browser timed out.");
    }, {
      retries: 2,
      retryTimeout: 20 * 1000, // ms
      retryFactor: 1
    });

    return promise.catch(function (error) {
      browserTest.setTestResult({
        status: STATUS.ERROR,
        errorDetails: error.toString()
      });
      browserTest.logError(error);
    });
  };
}

// Generate task list
var tasks = _.map(testConfig.browsers, genTask);

// Execute tasks from task list in sequence
sequence(tasks).then(function (result) {
  var result = _.every(result, function (element) { return element === true });
  // TODO: Output summary
  if (result) {
    exitStatus = 0;
    exitIfFinished();
  } else {
    exitStatus = 1;
    exitIfFinished();
  }
}, function (error) {
  console.log(error);
  exitStatus = 2;
  exitIfFinished();
});

var exitIfFinished = function() {
  if (httpRequestsWithoutResponse > 0 || exitStatus === null) return;
  console.log("Exiting with status " + exitStatus);
  process.exit(exitStatus);
}

