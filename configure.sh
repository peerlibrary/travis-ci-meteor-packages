#!/bin/sh

#configuring the system
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/Makefile
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/start_test.js
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/phantom_runner.js
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/saucelabs_runner.coffee
wget --no-cache https://raw.github.com/peerlibrary/travis-ci-meteor-packages/saucelabs/package.json

#install meteor
curl https://install.meteor.com | /bin/sh

#installing meteorite
npm install -g meteorite

#installing dependencies
npm install

mrt update
