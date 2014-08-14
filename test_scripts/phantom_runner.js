var page = require('webpage').create();
var system = require('system');

var url = system.args[1]
if (typeof(url) === 'undefined') {
  console.log("Specify tests url in the command line");
  phantom.exit(1);
}
if (url.substring(url.length - 1) != '/') url += '/';
var platform = system.args[2] || "local";

console.log("Running Meteor tests in PhantomJS... " + url);
page.onConsoleMessage = function (message) {
  console.log(message);
};
page.open(url + platform);
setInterval(function () {
  var done = page.evaluate(function () {
    if (typeof TEST_STATUS !== 'undefined')
      return TEST_STATUS.DONE;
    return typeof DONE !== 'undefined' && DONE;
  });
  if (done) {
    var failures = page.evaluate(function () {
      if (typeof TEST_STATUS !== 'undefined')
        return TEST_STATUS.FAILURES;
      if (typeof FAILURES === 'undefined') {
        return 1;
      }
      return 0;
    });
    phantom.exit(failures ? 1 : 0);
  }
}, 500);
