'use strict';

require('../lib/util/externals').use({
  Events: require('backbone-events-standalone'),
  extend: require('lodash/object/extend')
});

var Promise = require('bluebird');
Promise.config({
  warnings: true,
  longStackTraces: true,
  cancellation: true
});

require('setimmediate');
Promise.setScheduler(function(fn) {
  window.setImmediate(fn);
});

var RemoteServerControl = require('./helpers/remote-server-control');

describe('browser integration tests', function() {
  this.timeout(30000);

  before(function(done) {
    this.serverControl = new RemoteServerControl();
    this.serverControl.setup()
      .bind(this)
      .then(function(urls) {
        this.urls = urls;
      })
      .nodeify(done);
  });

  after(function(done) {
    this.serverControl.teardown()
      .nodeify(done);
  });

  beforeEach(function() {
    this.urlDirect = this.urls.bayeux;
    this.urlProxied = this.urls.proxied;

    this.clientOptions = {
      retry: 500,
      timeout: 1000
    };
  });

  afterEach(function(done) {
    this.serverControl.restoreAll().nodeify(done);
  });


  require('./browser-websocket-test');
  require('./client-long-polling-test');
  require('./client-websockets-test');
  require('./client-all-transports-test');
});

describe('browser unit tests', function() {
  require('./extensions-test');
  require('./transport-pool-test');
  require('./statemachine-mixin-test');
});
